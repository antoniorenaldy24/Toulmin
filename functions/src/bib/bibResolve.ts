import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { BibResolveItem, BibResolveResponse, BibResult } from "@toulmin/schemas";
import { extractClientNetworkPrefix, type RawRequestWithIp } from "../common/clientIp.js";
import { BASE, SERVICE_ACCOUNTS, yyyymmdd } from "../common/config.js";
import {
  CounterEngine,
  GlobalStateCache,
  wrapAdminFirestore,
  type FirestoreLike,
} from "../common/counters.js";
import {
  assertJudgeLane,
  assertNotHardStopped,
  assertPublicLane,
  type CallerAuthContext,
  type JudgeLaneValidator,
} from "../common/lanes.js";
import { defaultLogger, type SafeLogger } from "../common/log.js";
import { assertValidBibResolveRequest } from "../common/validate.js";
import { JudgeValidityCache } from "../judge/validity.js";
import { computeNetHash } from "../quota/netHash.js";
import {
  fetchCrossrefByDoi,
  queryCrossrefBibliographic,
  type CrossrefWorkRecord,
} from "./crossref.js";
import { checkDoiHandle } from "./doiHandle.js";
import { computeMetadataMismatch, normalizeDoi } from "./mismatch.js";
import {
  fetchOpenAlexByDois,
  fetchOpenAlexById,
  searchOpenAlexByTitle,
  UpstreamHttpError,
  type OpenAlexAuthor,
  type OpenAlexWorkRecord,
  type UpstreamFetchFn,
} from "./openalex.js";
import { fetchSemanticScholarBatch, type S2WorkRecord } from "./s2.js";

const OPENALEX_API_KEY = defineSecret("OPENALEX_API_KEY");
const S2_API_KEY = defineSecret("S2_API_KEY");
const CROSSREF_MAILTO = defineSecret("CROSSREF_MAILTO");
const NET_HASH_PEPPER = defineSecret("NET_HASH_PEPPER");

const RETRACTION_RECHECK_MS = 7 * 86_400_000;
const REFMETA_TTL_MS = 30 * 86_400_000;
const CALL_TIME_BUDGET_MS = 100_000;
const ABSTRACT_LRU_MAX = 2_000;
const ABSTRACT_LRU_TTL_MS = 10 * 60_000;

export interface RwRetractionEntry {
  readonly nature: string;
  readonly date?: string;
  readonly noticeDoi?: string;
}

export interface StoredRefMeta {
  readonly refId: string;
  readonly doi: string | null;
  readonly openalexId: string | null;
  readonly s2PaperId?: string | null;
  readonly title: string | null;
  readonly authors: OpenAlexAuthor[];
  readonly authorCount: number;
  readonly year: number | null;
  readonly venue: string | null;
  readonly isPreprint: boolean;
  readonly isRetracted: boolean;
  readonly retraction: {
    source: "OPENALEX" | "CROSSREF" | "RW_SNAPSHOT";
    date?: string;
    noticeDoi?: string;
  } | null;
  readonly retractionCheckedAt: number;
  readonly oaAvailable: boolean;
  readonly oa: {
    readonly pmcid: string | null;
    readonly arxivId: string | null;
    readonly pdfUrl: string | null;
    readonly license: string | null;
    readonly licenseSource: "OPENALEX" | "JATS" | "UNPAYWALL" | "ARXIV" | null;
  };
  readonly expireAt: Date | number;
}

/**
 * Token bucket rate limiter (`05` §3.1 step 2).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  private readonly ratePerSec: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    ratePerSec: number,
    options?: {
      readonly capacity?: number;
      readonly now?: () => number;
      readonly sleep?: (ms: number) => Promise<void>;
    }
  ) {
    this.ratePerSec = ratePerSec;
    this.capacity = options?.capacity ?? Math.max(1, ratePerSec);
    this.tokens = this.capacity;
    this.now = options?.now ?? (() => Date.now());
    this.sleep =
      options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))));
    this.lastRefillMs = this.now();
  }

  async acquire(): Promise<void> {
    while (true) {
      const current = this.now();
      const elapsedSec = Math.max(0, (current - this.lastRefillMs) / 1000);
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.ratePerSec);
      this.lastRefillMs = current;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
      const sleepMs = Math.max(1, waitMs);
      await this.sleep(sleepMs);
      if (this.now() <= current) {
        // Virtual/frozen clock: credit tokens for the slept interval to prevent infinite wait loops.
        this.tokens = Math.min(this.capacity, this.tokens + (sleepMs / 1000) * this.ratePerSec);
      }
    }
  }
}

export interface AbstractCacheEntry {
  readonly abstract: string;
  readonly source: "OPENALEX" | "S2" | "CROSSREF";
  readonly expiresAt: number;
}

/**
 * Per-instance in-memory LRU cache (max 2,000 entries, 10-minute TTL) for abstract coalescing.
 * Never persisted to Firestore or disk (`05` §3.1 step 10, D-11).
 */
export class AbstractLruCache {
  private readonly map = new Map<string, AbstractCacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options?: {
    readonly maxEntries?: number;
    readonly ttlMs?: number;
    readonly now?: () => number;
  }) {
    this.maxEntries = options?.maxEntries ?? ABSTRACT_LRU_MAX;
    this.ttlMs = options?.ttlMs ?? ABSTRACT_LRU_TTL_MS;
    this.now = options?.now ?? (() => Date.now());
  }

  get(refId: string): { abstract: string; source: "OPENALEX" | "S2" | "CROSSREF" } | null {
    const entry = this.map.get(refId);
    if (!entry) return null;
    if (this.now() >= entry.expiresAt) {
      this.map.delete(refId);
      return null;
    }
    // Refresh recency
    this.map.delete(refId);
    this.map.set(refId, entry);
    return { abstract: entry.abstract, source: entry.source };
  }

  set(refId: string, abstract: string, source: "OPENALEX" | "S2" | "CROSSREF"): void {
    if (this.map.has(refId)) {
      this.map.delete(refId);
    } else if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    this.map.set(refId, {
      abstract,
      source,
      expiresAt: this.now() + this.ttlMs,
    });
  }
}

export interface BibResolveRequestLike {
  readonly app?: { readonly appId?: string } | undefined;
  readonly auth?: CallerAuthContext | undefined;
  readonly data: unknown;
  readonly rawRequest?: RawRequestWithIp | undefined;
}

export interface BibRateBuckets {
  readonly openalex: TokenBucket;
  readonly s2: TokenBucket;
  readonly crossrefSingle: TokenBucket;
  readonly crossrefQuery: TokenBucket;
  readonly doiHandle: TokenBucket;
}

export function createDefaultBibRateBuckets(
  now: () => number = () => Date.now(),
  sleep?: (ms: number) => Promise<void>
): BibRateBuckets {
  const s2Opts = sleep ? { capacity: 1, now, sleep } : { capacity: 1, now };
  const oaOpts = sleep ? { capacity: 5, now, sleep } : { capacity: 5, now };
  const crSingleOpts = sleep ? { capacity: 2.5, now, sleep } : { capacity: 2.5, now };
  const crQueryOpts = sleep ? { capacity: 1, now, sleep } : { capacity: 1, now };
  const doiOpts = sleep ? { capacity: 2, now, sleep } : { capacity: 2, now };
  return {
    openalex: new TokenBucket(5, oaOpts),
    s2: new TokenBucket(0.5, s2Opts),
    crossrefSingle: new TokenBucket(2.5, crSingleOpts),
    crossrefQuery: new TokenBucket(0.5, crQueryOpts),
    doiHandle: new TokenBucket(2, doiOpts),
  };
}

export interface BibResolveDeps {
  readonly lane: "public" | "judge";
  readonly db: FirestoreLike;
  readonly stateCache: GlobalStateCache;
  readonly counters: CounterEngine;
  readonly judgeValidator: JudgeLaneValidator;
  readonly getOpenAlexApiKey: () => string;
  readonly getS2ApiKey: () => string;
  readonly getCrossrefMailto: () => string;
  readonly getNetHashPepper: () => string;
  readonly fetchFn?: UpstreamFetchFn;
  readonly buckets?: BibRateBuckets;
  readonly abstractCache?: AbstractLruCache;
  readonly lookupRwRetraction?: (doi: string) => Promise<RwRetractionEntry | null>;
  /** `VERIFY-AT-SPIKE BE-2`: OpenAlex OR-filter (`true`) vs singleton fallback (`false`, default). */
  readonly spike_be_2_primary?: boolean;
  /** `VERIFY-AT-SPIKE BE-4`: handle API (`true`) vs HEAD manual redirect fallback (`false`, default). */
  readonly spike_be_4_primary?: boolean;
  readonly now?: () => number;
  readonly trustedProxyHopsFromRight?: number;
  readonly logger?: SafeLogger;
}

export function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function defaultUpstreamFetch(): UpstreamFetchFn {
  return async (url, init) => {
    const res = await fetch(url, {
      ...(init?.method ? { method: init.method } : {}),
      ...(init?.headers ? { headers: { ...init.headers } } : {}),
      ...(init?.body !== undefined ? { body: init.body } : {}),
      ...(init?.redirect ? { redirect: init.redirect } : {}),
    });
    return {
      status: res.status,
      ok: res.ok,
      json: () => res.json(),
    };
  };
}

/**
 * Loads the latest gzipped Retraction Watch snapshot named by `/global/state.rwLatest` (`05` §3.1 step 8, §3.6)
 * with per-instance path-keyed in-memory caching.
 */
export function createStorageRwLookup(
  stateCache: GlobalStateCache,
  downloadSnapshotBytes?: (objectPath: string) => Promise<Uint8Array>,
  logger: SafeLogger = defaultLogger
): (doi: string) => Promise<RwRetractionEntry | null> {
  let cachedPath: string | null = null;
  let cachedMap = new Map<string, RwRetractionEntry>();

  const defaultDownload = async (objectPath: string): Promise<Uint8Array> => {
    const [buf] = await getStorage().bucket().file(objectPath).download();
    return buf;
  };
  const downloader = downloadSnapshotBytes ?? defaultDownload;

  return async (rawDoi: string): Promise<RwRetractionEntry | null> => {
    const norm = normalizeDoi(rawDoi);
    if (!norm) return null;

    let rwPath: string | null = null;
    try {
      const state = await stateCache.get();
      rwPath = typeof state.rwLatest === "string" && state.rwLatest.length > 0 ? state.rwLatest : null;
    } catch {
      return null;
    }

    if (!rwPath) {
      return null;
    }

    if (rwPath !== cachedPath) {
      try {
        const gzBytes = await downloader(rwPath);
        const jsonText = gunzipSync(gzBytes).toString("utf8");
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        const nextMap = new Map<string, RwRetractionEntry>();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v !== "object" || v === null) continue;
            const rec = v as Record<string, unknown>;
            const nature = typeof rec["nature"] === "string" ? rec["nature"] : "Retraction";
            const date = typeof rec["date"] === "string" ? rec["date"] : undefined;
            const noticeDoi = typeof rec["noticeDoi"] === "string" ? rec["noticeDoi"] : undefined;
            nextMap.set(normalizeDoi(k), {
              nature,
              ...(date ? { date } : {}),
              ...(noticeDoi ? { noticeDoi } : {}),
            });
          }
        }
        cachedPath = rwPath;
        cachedMap = nextMap;
      } catch (err) {
        logger.warn("bibResolve.rw_snapshot_error", {
          errorClass: err instanceof Error ? err.name : "Error",
        });
        return null;
      }
    }

    return cachedMap.get(norm) ?? null;
  };
}

function mergeTransientError(
  a: "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | null,
  b: "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | null
): "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | null {
  if (a === "RATE_LIMITED" || b === "RATE_LIMITED") return "RATE_LIMITED";
  return a ?? b;
}

function makeEmptyBibResult(key: string, status: BibResult["status"]): BibResult {
  return {
    key,
    status,
    refId: null,
    doi: null,
    openalexId: null,
    s2PaperId: null,
    title: null,
    authors: [],
    authorCount: 0,
    year: null,
    venue: null,
    isPreprint: false,
    isRetracted: false,
    retraction: null,
    mismatch: null,
    oaAvailable: false,
    abstract: null,
    abstractSource: null,
  };
}

function classifyUpstreamError(err: unknown): "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" {
  if (err instanceof UpstreamHttpError && err.status === 429) {
    return "RATE_LIMITED";
  }
  return "UPSTREAM_UNAVAILABLE";
}

function mergeCandidateWork(
  oa: OpenAlexWorkRecord | undefined,
  s2: S2WorkRecord | undefined,
  cr: CrossrefWorkRecord | undefined,
  rw: RwRetractionEntry | null
): {
  refId: string | null;
  doi: string | null;
  openalexId: string | null;
  s2PaperId: string | null;
  title: string | null;
  authors: Array<{ family: string; given?: string }>;
  authorCount: number;
  year: number | null;
  venue: string | null;
  isPreprint: boolean;
  isRetracted: boolean;
  retraction: BibResult["retraction"];
  oaAvailable: boolean;
  abstract: string | null;
  abstractSource: BibResult["abstractSource"];
  oaMeta: StoredRefMeta["oa"];
} {
  const doi = oa?.doi ?? cr?.doi ?? s2?.doi ?? null;
  const openalexId = oa?.openalexId ?? null;
  const refId = doi ? `doi:${doi}` : openalexId ? `oa:${openalexId}` : null;

  const title = oa?.title ?? cr?.title ?? s2?.title ?? null;
  const authors =
    oa && oa.authors.length > 0
      ? oa.authors
      : cr && cr.authors.length > 0
        ? cr.authors
        : s2?.authors ?? [];
  const authorCount =
    oa && oa.authorCount > 0
      ? oa.authorCount
      : cr && cr.authorCount > 0
        ? cr.authorCount
        : s2?.authorCount ?? authors.length;
  const year = oa?.year ?? cr?.year ?? s2?.year ?? null;
  const venue = oa?.venue ?? cr?.venue ?? s2?.venue ?? null;
  const isPreprint = (oa?.isPreprint ?? false) || (cr?.isPreprint ?? false);

  let abstract: string | null = null;
  let abstractSource: BibResult["abstractSource"] = null;
  if (oa?.abstract) {
    abstract = oa.abstract;
    abstractSource = "OPENALEX";
  } else if (s2?.abstract) {
    abstract = s2.abstract;
    abstractSource = "S2";
  } else if (cr?.abstract) {
    abstract = cr.abstract;
    abstractSource = "CROSSREF";
  }

  let retraction: BibResult["retraction"] = null;
  let isRetracted = false;
  if (rw) {
    isRetracted = true;
    retraction = {
      source: "RW_SNAPSHOT",
      ...(rw.date ? { date: rw.date } : {}),
      ...(rw.noticeDoi ? { noticeDoi: rw.noticeDoi } : {}),
    };
  } else if (cr?.retraction.isRetracted) {
    isRetracted = true;
    retraction = {
      source: "CROSSREF",
      ...(cr.retraction.noticeDoi ? { noticeDoi: cr.retraction.noticeDoi } : {}),
    };
  } else if (oa?.isRetracted) {
    isRetracted = true;
    retraction = { source: "OPENALEX" };
  }

  const pmcid = oa?.pmcid ?? null;
  const arxivId = oa?.arxivId ?? null;
  const pdfUrl = oa?.oaPdfUrl ?? s2?.oaPdfUrl ?? null;
  const license = oa?.oaLicense ?? null;
  const licenseSource = license ? "OPENALEX" : null;
  const oaAvailable =
    Boolean(pmcid) || Boolean(arxivId) || Boolean(pdfUrl) || (oa?.oaAvailable ?? false) || (s2?.isOpenAccess ?? false);

  return {
    refId,
    doi,
    openalexId,
    s2PaperId: s2?.s2PaperId ?? null,
    title,
    authors: authors.map((a) => (a.given ? { family: a.family, given: a.given } : { family: a.family })),
    authorCount,
    year,
    venue,
    isPreprint,
    isRetracted,
    retraction,
    oaAvailable,
    abstract,
    abstractSource,
    oaMeta: {
      pmcid,
      arxivId,
      pdfUrl,
      license,
      licenseSource,
    },
  };
}

function buildStoredRefMeta(
  refId: string,
  merged: ReturnType<typeof mergeCandidateWork>,
  nowMs: number
): StoredRefMeta {
  // D-11 / AC-FN-03: NEVER store `abstract` or `abstractSource` in Firestore `/refmeta`.
  return {
    refId,
    doi: merged.doi,
    openalexId: merged.openalexId,
    ...(merged.s2PaperId ? { s2PaperId: merged.s2PaperId } : {}),
    title: merged.title,
    authors: merged.authors,
    authorCount: merged.authorCount,
    year: merged.year,
    venue: merged.venue,
    isPreprint: merged.isPreprint,
    isRetracted: merged.isRetracted,
    retraction: merged.retraction,
    retractionCheckedAt: nowMs,
    oaAvailable: merged.oaAvailable,
    oa: merged.oaMeta,
    expireAt: new Date(nowMs + REFMETA_TTL_MS),
  };
}

export function parseStoredRefMeta(data: Record<string, unknown> | undefined): StoredRefMeta | null {
  if (!data || typeof data["refId"] !== "string") return null;
  const rawOa =
    typeof data["oa"] === "object" && data["oa"] !== null
      ? (data["oa"] as Record<string, unknown>)
      : {};
  const rawAuthors = Array.isArray(data["authors"]) ? data["authors"] : [];
  const authors: OpenAlexAuthor[] = [];
  for (const a of rawAuthors) {
    if (typeof a === "object" && a !== null && typeof (a as Record<string, unknown>)["family"] === "string") {
      const rec = a as Record<string, unknown>;
      const given = typeof rec["given"] === "string" ? rec["given"] : undefined;
      authors.push(given ? { family: String(rec["family"]), given } : { family: String(rec["family"]) });
    }
  }
  const rawRetraction =
    typeof data["retraction"] === "object" && data["retraction"] !== null
      ? (data["retraction"] as BibResult["retraction"])
      : null;

  return {
    refId: String(data["refId"]),
    doi: typeof data["doi"] === "string" ? data["doi"] : null,
    openalexId: typeof data["openalexId"] === "string" ? data["openalexId"] : null,
    s2PaperId: typeof data["s2PaperId"] === "string" ? data["s2PaperId"] : null,
    title: typeof data["title"] === "string" ? data["title"] : null,
    authors,
    authorCount: typeof data["authorCount"] === "number" ? data["authorCount"] : authors.length,
    year: typeof data["year"] === "number" ? data["year"] : null,
    venue: typeof data["venue"] === "string" ? data["venue"] : null,
    isPreprint: data["isPreprint"] === true,
    isRetracted: data["isRetracted"] === true,
    retraction: rawRetraction,
    retractionCheckedAt:
      typeof data["retractionCheckedAt"] === "number" ? data["retractionCheckedAt"] : 0,
    oaAvailable: data["oaAvailable"] === true,
    oa: {
      pmcid: typeof rawOa["pmcid"] === "string" ? rawOa["pmcid"] : null,
      arxivId: typeof rawOa["arxivId"] === "string" ? rawOa["arxivId"] : null,
      pdfUrl: typeof rawOa["pdfUrl"] === "string" ? rawOa["pdfUrl"] : null,
      license: typeof rawOa["license"] === "string" ? rawOa["license"] : null,
      licenseSource:
        rawOa["licenseSource"] === "OPENALEX" ||
        rawOa["licenseSource"] === "JATS" ||
        rawOa["licenseSource"] === "UNPAYWALL" ||
        rawOa["licenseSource"] === "ARXIV"
          ? rawOa["licenseSource"]
          : null,
    },
    expireAt: (data["expireAt"] as Date | number | undefined) ?? Date.now() + REFMETA_TTL_MS,
  };
}

export function createBibResolveHandler(
  deps: BibResolveDeps
): (request: BibResolveRequestLike) => Promise<BibResolveResponse> {
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger ?? defaultLogger;
  const fetchFn = deps.fetchFn ?? defaultUpstreamFetch();
  const buckets = deps.buckets ?? createDefaultBibRateBuckets();
  const abstractCache = deps.abstractCache ?? new AbstractLruCache({ now });
  const lookupRw = deps.lookupRwRetraction ?? (async () => null);

  return async (request: BibResolveRequestLike): Promise<BibResolveResponse> => {
    const startMs = now();
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
    }

    await assertNotHardStopped(deps.stateCache);

    if (deps.lane === "judge") {
      await assertJudgeLane(request.auth, deps.judgeValidator);
    } else {
      await assertPublicLane(request.auth, deps.judgeValidator);
    }

    const req = assertValidBibResolveRequest(request.data);
    const uid = request.auth.uid;
    const pool = deps.lane === "judge" ? "judge" : "anon";
    const prefix =
      pool === "anon"
        ? extractClientNetworkPrefix(
            request.rawRequest,
            deps.trustedProxyHopsFromRight !== undefined
              ? { trustedProxyHopsFromRight: deps.trustedProxyHopsFromRight }
              : undefined
          )
        : null;
    const day = yyyymmdd(now());
    const netHash =
      prefix !== null ? computeNetHash(day, prefix, deps.getNetHashPepper()) : null;

    const reservation = await deps.counters.reserve({
      uid,
      pool,
      field: "bibResolve",
      n: req.items.length,
      netHash,
      atomic: true,
    });

    if (reservation.granted === 0) {
      throw new HttpsError("resource-exhausted", reservation.deniedReason ?? "QUOTA_EXCEEDED");
    }

    const openalexKey = deps.getOpenAlexApiKey();
    const s2Key = deps.getS2ApiKey();
    const crossrefMailto = deps.getCrossrefMailto();

    const oaClientOpts = {
      apiKey: openalexKey,
      fetchFn,
      acquireRateToken: () => buckets.openalex.acquire(),
      ...(deps.spike_be_2_primary !== undefined
        ? { spike_be_2_primary: deps.spike_be_2_primary }
        : {}),
    };
    const s2ClientOpts = {
      apiKey: s2Key,
      fetchFn,
      acquireRateToken: () => buckets.s2.acquire(),
    };
    const crClientOpts = {
      mailto: crossrefMailto,
      fetchFn,
      acquireSingleToken: () => buckets.crossrefSingle.acquire(),
      acquireQueryToken: () => buckets.crossrefQuery.acquire(),
    };

    const results: Array<BibResult | null> = new Array(req.items.length).fill(null);
    const pendingItems: Array<{ index: number; item: BibResolveItem; normDoi: string | null }> = [];

    // 1. Check /refmeta cache for explicit DOI items first (handles 7-day retraction re-check, AC-FN-09)
    for (let i = 0; i < req.items.length; i += 1) {
      const item = req.items[i]!;
      const normDoi = item.doi ? normalizeDoi(item.doi) : null;
      if (!normDoi) {
        pendingItems.push({ index: i, item, normDoi: null });
        continue;
      }

      const refId = `doi:${normDoi}`;
      const docSnap = await deps.db.doc(`refmeta/${sha256hex(refId)}`).get();
      const stored = docSnap.exists ? parseStoredRefMeta(docSnap.data()) : null;
      if (!stored) {
        pendingItems.push({ index: i, item, normDoi });
        continue;
      }

      const currentMs = now();
      let isRetracted = stored.isRetracted;
      let retraction = stored.retraction;
      let retractionCheckedAt = stored.retractionCheckedAt;

      if (currentMs - stored.retractionCheckedAt > RETRACTION_RECHECK_MS) {
        if (currentMs - startMs > CALL_TIME_BUDGET_MS) {
          results[i] = makeEmptyBibResult(item.key, "PENDING");
          continue;
        }

        const rwHit = await lookupRw(normDoi);
        let oaHit: OpenAlexWorkRecord | undefined;
        let crHit: CrossrefWorkRecord | null = null;
        let oaCheckedOk = false;
        let crCheckedOk = false;
        try {
          const oaMap = await fetchOpenAlexByDois([normDoi], oaClientOpts);
          oaHit = oaMap.get(normDoi);
          oaCheckedOk = true;
        } catch {
          // Non-fatal during re-check if snapshot or Crossref answers
        }
        try {
          crHit = await fetchCrossrefByDoi(normDoi, crClientOpts);
          crCheckedOk = true;
        } catch {
          // Non-fatal
        }

        if (rwHit) {
          isRetracted = true;
          retraction = {
            source: "RW_SNAPSHOT",
            ...(rwHit.date ? { date: rwHit.date } : {}),
            ...(rwHit.noticeDoi ? { noticeDoi: rwHit.noticeDoi } : {}),
          };
        } else if (crHit?.retraction.isRetracted) {
          isRetracted = true;
          retraction = {
            source: "CROSSREF",
            ...(crHit.retraction.noticeDoi ? { noticeDoi: crHit.retraction.noticeDoi } : {}),
          };
        } else if (oaHit?.isRetracted) {
          isRetracted = true;
          retraction = { source: "OPENALEX" };
        }

        if (rwHit !== null || oaCheckedOk || crCheckedOk) {
          retractionCheckedAt = currentMs;
          await deps.db.runTransaction(async (tx) => {
            tx.set(
              deps.db.doc(`refmeta/${sha256hex(refId)}`),
              {
                isRetracted,
                retraction,
                retractionCheckedAt,
                expireAt: new Date(currentMs + REFMETA_TTL_MS),
              },
              { merge: true }
            );
          });
        }
      }

      const cachedAbs = abstractCache.get(refId);
      const mismatch = computeMetadataMismatch(
        { title: item.title, year: item.year, authors: item.authors },
        {
          title: stored.title,
          year: stored.year,
          firstAuthor: stored.authors[0] ?? null,
          isPreprint: stored.isPreprint,
        }
      );

      results[i] = {
        key: item.key,
        status: mismatch.length > 0 ? "METADATA_MISMATCH" : "RESOLVED",
        refId: stored.refId,
        doi: stored.doi,
        openalexId: stored.openalexId,
        s2PaperId: stored.s2PaperId ?? null,
        title: stored.title,
        authors: stored.authors,
        authorCount: stored.authorCount,
        year: stored.year,
        venue: stored.venue,
        isPreprint: stored.isPreprint,
        isRetracted,
        retraction,
        mismatch: mismatch.length > 0 ? mismatch : null,
        oaAvailable: stored.oaAvailable,
        abstract: cachedAbs?.abstract ?? null,
        abstractSource: cachedAbs?.source ?? null,
      };
    }

    // 2. Batch OpenAlex & Semantic Scholar for explicit DOI items not in /refmeta
    const doiPending = pendingItems.filter((p) => p.normDoi !== null);
    let oaByDoi = new Map<string, OpenAlexWorkRecord>();
    let oaBatchTransientError: "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | null = null;
    if (doiPending.length > 0) {
      try {
        oaByDoi = await fetchOpenAlexByDois(
          doiPending.map((p) => p.normDoi!),
          oaClientOpts
        );
      } catch (err) {
        oaBatchTransientError = classifyUpstreamError(err);
      }
    }

    // Semantic Scholar batch for missing abstracts on DOI items
    const s2NeededDois: string[] = [];
    for (const p of doiPending) {
      const oaRec = oaByDoi.get(p.normDoi!);
      if (!oaRec?.abstract) {
        s2NeededDois.push(p.normDoi!);
      }
    }
    let s2ByDoi = new Map<string, S2WorkRecord>();
    let s2BatchTransientError: "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | null = null;
    if (s2NeededDois.length > 0) {
      try {
        s2ByDoi = await fetchSemanticScholarBatch(s2NeededDois, s2ClientOpts);
      } catch (err) {
        s2BatchTransientError = classifyUpstreamError(err);
      }
    }

    // 3. Process remaining items respecting 100 s deadline
    for (const entry of pendingItems) {
      if (now() - startMs > CALL_TIME_BUDGET_MS) {
        results[entry.index] = makeEmptyBibResult(entry.item.key, "PENDING");
        continue;
      }

      const { item, normDoi } = entry;
      if (normDoi !== null) {
        const oaRec = oaByDoi.get(normDoi);
        const s2Rec = s2ByDoi.get(normDoi);
        let crRec: CrossrefWorkRecord | undefined;
        let transientErr: "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | null = mergeTransientError(
          oaBatchTransientError,
          s2BatchTransientError
        );

        // Crossref DOI check for gaps OR retraction relations
        try {
          const fetchedCr = await fetchCrossrefByDoi(normDoi, crClientOpts);
          if (fetchedCr) crRec = fetchedCr;
        } catch (err) {
          transientErr = mergeTransientError(transientErr, classifyUpstreamError(err));
        }

        const rwEntry = await lookupRw(normDoi);
        if (!oaRec && !s2Rec && !crRec) {
          if (transientErr !== null) {
            results[entry.index] = makeEmptyBibResult(item.key, transientErr);
            continue;
          }
          // Every upstream answered 200/404 with no hit -> check doi.org handle registry
          const handleStatus = await checkDoiHandle(normDoi, {
            fetchFn,
            acquireRateToken: () => buckets.doiHandle.acquire(),
            ...(deps.spike_be_4_primary !== undefined
              ? { spike_be_4_primary: deps.spike_be_4_primary }
              : {}),
          });
          results[entry.index] = makeEmptyBibResult(item.key, handleStatus);
          continue;
        }

        const merged = mergeCandidateWork(oaRec, s2Rec, crRec, rwEntry);
        const refId = merged.refId ?? `doi:${normDoi}`;
        const writeNow = now();
        const storedMeta = buildStoredRefMeta(refId, merged, writeNow);
        await deps.db.runTransaction(async (tx) => {
          tx.set(
            deps.db.doc(`refmeta/${sha256hex(refId)}`),
            storedMeta as unknown as Record<string, unknown>,
            { merge: true }
          );
        });
        if (merged.abstract && merged.abstractSource) {
          abstractCache.set(refId, merged.abstract, merged.abstractSource);
        }

        const mismatch = computeMetadataMismatch(
          { title: item.title, year: item.year, authors: item.authors },
          {
            title: merged.title,
            year: merged.year,
            firstAuthor: merged.authors[0] ?? null,
            isPreprint: merged.isPreprint,
          }
        );

        results[entry.index] = {
          key: item.key,
          status: mismatch.length > 0 ? "METADATA_MISMATCH" : "RESOLVED",
          refId,
          doi: merged.doi,
          openalexId: merged.openalexId,
          s2PaperId: merged.s2PaperId,
          title: merged.title,
          authors: merged.authors,
          authorCount: merged.authorCount,
          year: merged.year,
          venue: merged.venue,
          isPreprint: merged.isPreprint,
          isRetracted: merged.isRetracted,
          retraction: merged.retraction,
          mismatch: mismatch.length > 0 ? mismatch : null,
          oaAvailable: merged.oaAvailable,
          abstract: merged.abstract,
          abstractSource: merged.abstractSource,
        };
        continue;
      }

      // No DOI path
      if (req.doiOnly) {
        results[entry.index] = makeEmptyBibResult(item.key, "NOT_INDEXED");
        continue;
      }

      let oaRec: OpenAlexWorkRecord | undefined;
      let crRec: CrossrefWorkRecord | undefined;
      let transientErr: "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | null = null;

      if (item.title) {
        try {
          const searchRes = await searchOpenAlexByTitle(
            item.title,
            item.year,
            item.authors?.[0],
            oaClientOpts
          );
          if (searchRes.status === "AMBIGUOUS") {
            results[entry.index] = {
              ...makeEmptyBibResult(item.key, "AMBIGUOUS"),
              candidates: searchRes.candidates ?? [],
            };
            continue;
          }
          if (searchRes.status === "HIT" && searchRes.record) {
            oaRec = searchRes.record;
          }
        } catch (err) {
          transientErr = classifyUpstreamError(err);
        }
      }

      if (!oaRec && item.raw) {
        try {
          const foundCr = await queryCrossrefBibliographic(item.raw, crClientOpts);
          if (foundCr) crRec = foundCr;
        } catch (err) {
          transientErr = mergeTransientError(transientErr, classifyUpstreamError(err));
        }
      }

      if (!oaRec && !crRec) {
        results[entry.index] = makeEmptyBibResult(
          item.key,
          transientErr ?? "NOT_INDEXED"
        );
        continue;
      }

      const resolvedDoi = oaRec?.doi ?? crRec?.doi ?? null;
      let s2Rec: S2WorkRecord | undefined;
      if (resolvedDoi && !oaRec?.abstract) {
        try {
          const s2Map = await fetchSemanticScholarBatch([resolvedDoi], s2ClientOpts);
          s2Rec = s2Map.get(resolvedDoi);
        } catch {
          // Optional abstract gap fill
        }
      }
      if (resolvedDoi && oaRec && !crRec) {
        try {
          const fetchedCr = await fetchCrossrefByDoi(resolvedDoi, crClientOpts);
          if (fetchedCr) crRec = fetchedCr;
        } catch {
          // Optional retraction / abstract supplement
        }
      }

      const rwEntry = resolvedDoi ? await lookupRw(resolvedDoi) : null;
      const merged = mergeCandidateWork(oaRec, s2Rec, crRec, rwEntry);
      if (!merged.refId) {
        results[entry.index] = makeEmptyBibResult(item.key, "NOT_INDEXED");
        continue;
      }

      const writeNow = now();
      const storedMeta = buildStoredRefMeta(merged.refId, merged, writeNow);
      await deps.db.runTransaction(async (tx) => {
        tx.set(
          deps.db.doc(`refmeta/${sha256hex(merged.refId!)}`),
          storedMeta as unknown as Record<string, unknown>,
          { merge: true }
        );
      });
      if (merged.abstract && merged.abstractSource) {
        abstractCache.set(merged.refId, merged.abstract, merged.abstractSource);
      }

      const mismatch = computeMetadataMismatch(
        { title: item.title, year: item.year, authors: item.authors },
        {
          title: merged.title,
          year: merged.year,
          firstAuthor: merged.authors[0] ?? null,
          isPreprint: merged.isPreprint,
        }
      );

      results[entry.index] = {
        key: item.key,
        status: mismatch.length > 0 ? "METADATA_MISMATCH" : "RESOLVED",
        refId: merged.refId,
        doi: merged.doi,
        openalexId: merged.openalexId,
        s2PaperId: merged.s2PaperId,
        title: merged.title,
        authors: merged.authors,
        authorCount: merged.authorCount,
        year: merged.year,
        venue: merged.venue,
        isPreprint: merged.isPreprint,
        isRetracted: merged.isRetracted,
        retraction: merged.retraction,
        mismatch: mismatch.length > 0 ? mismatch : null,
        oaAvailable: merged.oaAvailable,
        abstract: merged.abstract,
        abstractSource: merged.abstractSource,
      };
    }

    const finalResults = results.map((r, idx) => r ?? makeEmptyBibResult(req.items[idx]!.key, "PENDING"));
    const unchargedCount = finalResults.filter(
      (r) =>
        r.status === "UPSTREAM_UNAVAILABLE" ||
        r.status === "RATE_LIMITED" ||
        r.status === "PENDING"
    ).length;

    if (unchargedCount > 0) {
      await deps.counters.refund({
        uid,
        pool,
        field: "bibResolve",
        count: unchargedCount,
        netHash,
        day,
      });
    }

    logger.info("bibResolve.completed", {
      uid,
      lane: deps.lane,
      itemCount: finalResults.length,
      refundedCount: unchargedCount,
      latencyMs: Math.max(0, now() - startMs),
    });

    return { results: finalResults };
  };
}

/**
 * Resolves and caches `/refmeta/{sha256hex(refId)}` internally on cache miss inside `oaFetch`
 * (`05` §3.2.2), supporting both `doi:...` and `oa:W...` without charging `bibResolve` user quota.
 */
export async function resolveSingleRefMetaInternal(
  rawRefId: string,
  deps: {
    readonly db: FirestoreLike;
    readonly stateCache: GlobalStateCache;
    readonly crossrefMailto: string;
    readonly fetchFn?: UpstreamFetchFn;
    readonly buckets?: BibRateBuckets;
    readonly lookupRwRetraction?: (doi: string) => Promise<RwRetractionEntry | null>;
    readonly now?: () => number;
  }
): Promise<StoredRefMeta | null> {
  const canonicalRefId = rawRefId.startsWith("doi:")
    ? `doi:${normalizeDoi(rawRefId.slice(4))}`
    : rawRefId.trim();
  const refIdHash = sha256hex(canonicalRefId);

  const existing = await deps.db.doc(`refmeta/${refIdHash}`).get();
  if (existing.exists) {
    return parseStoredRefMeta(existing.data());
  }

  const now = deps.now ?? (() => Date.now());
  const fetchFn = deps.fetchFn ?? defaultUpstreamFetch();
  const buckets = deps.buckets ?? createDefaultBibRateBuckets(now);
  const lookupRw = deps.lookupRwRetraction ?? createStorageRwLookup(deps.stateCache);
  const oaOpts = {
    apiKey: "",
    fetchFn,
    acquireRateToken: () => buckets.openalex.acquire(),
  };
  const crOpts = {
    mailto: deps.crossrefMailto,
    fetchFn,
    acquireSingleToken: () => buckets.crossrefSingle.acquire(),
    acquireQueryToken: () => buckets.crossrefQuery.acquire(),
  };

  let oaRec: OpenAlexWorkRecord | undefined;
  let crRec: CrossrefWorkRecord | undefined;
  let targetDoi: string | null = null;

  if (canonicalRefId.startsWith("doi:")) {
    targetDoi = normalizeDoi(canonicalRefId.slice(4));
    try {
      const oaMap = await fetchOpenAlexByDois([targetDoi], oaOpts);
      oaRec = oaMap.get(targetDoi);
    } catch {
      // Fall back to Crossref below
    }
    try {
      const cr = await fetchCrossrefByDoi(targetDoi, crOpts);
      if (cr) crRec = cr;
    } catch {
      // Non-fatal if OpenAlex returned metadata
    }
  } else if (canonicalRefId.startsWith("oa:")) {
    const workId = canonicalRefId.slice(3);
    try {
      const byId = await fetchOpenAlexById(workId, oaOpts);
      if (byId) oaRec = byId;
    } catch {
      return null;
    }
    targetDoi = oaRec?.doi ?? null;
    if (targetDoi) {
      try {
        const cr = await fetchCrossrefByDoi(targetDoi, crOpts);
        if (cr) crRec = cr;
      } catch {
        // Optional retraction supplement
      }
    }
  } else {
    return null;
  }

  if (!oaRec && !crRec) {
    return null;
  }

  const rwEntry = targetDoi ? await lookupRw(targetDoi) : null;
  const merged = mergeCandidateWork(oaRec, undefined, crRec, rwEntry);
  const storedRefId = canonicalRefId.startsWith("doi:")
    ? canonicalRefId
    : (merged.refId ?? canonicalRefId);
  const storedMeta = buildStoredRefMeta(storedRefId, merged, now());

  await deps.db.runTransaction(async (tx) => {
    tx.set(
      deps.db.doc(`refmeta/${refIdHash}`),
      storedMeta as unknown as Record<string, unknown>,
      { merge: true }
    );
  });

  return storedMeta;
}

const defaultAbstractCache = new AbstractLruCache();
const defaultBucketsByLane: Record<"public" | "judge", BibRateBuckets> = {
  public: createDefaultBibRateBuckets(),
  judge: createDefaultBibRateBuckets(),
};

const cachedHandlers: Partial<
  Record<"public" | "judge", (request: BibResolveRequestLike) => Promise<BibResolveResponse>>
> = {};

function getDefaultBibHandler(
  lane: "public" | "judge"
): (request: BibResolveRequestLike) => Promise<BibResolveResponse> {
  const existing = cachedHandlers[lane];
  if (existing) return existing;

  const app = getApps().length > 0 ? getApp() : initializeApp();
  const db = wrapAdminFirestore(getFirestore(app));
  const stateCache = new GlobalStateCache(db);
  const counters = new CounterEngine(db, stateCache);
  const judgeValidator = new JudgeValidityCache(db);

  const handler = createBibResolveHandler({
    lane,
    db,
    stateCache,
    counters,
    judgeValidator,
    getOpenAlexApiKey: () => OPENALEX_API_KEY.value(),
    getS2ApiKey: () => S2_API_KEY.value(),
    getCrossrefMailto: () => CROSSREF_MAILTO.value(),
    getNetHashPepper: () => NET_HASH_PEPPER.value(),
    buckets: defaultBucketsByLane[lane],
    abstractCache: defaultAbstractCache,
    lookupRwRetraction: createStorageRwLookup(stateCache),
    spike_be_2_primary: process.env["SPIKE_BE_2_PRIMARY"] === "true",
    spike_be_4_primary: process.env["SPIKE_BE_4_PRIMARY"] === "true",
  });
  cachedHandlers[lane] = handler;
  return handler;
}

const BIB_CALLABLE_OPTS = {
  ...BASE,
  maxInstances: 1,
  concurrency: 20,
  memory: "512MiB" as const,
  cpu: 1,
  timeoutSeconds: 120,
  serviceAccount: SERVICE_ACCOUNTS.bib,
  secrets: [OPENALEX_API_KEY, S2_API_KEY, CROSSREF_MAILTO, NET_HASH_PEPPER],
};

export const bibResolve = onCall(BIB_CALLABLE_OPTS, async (request) =>
  getDefaultBibHandler("public")(request as unknown as BibResolveRequestLike)
);

export const bibResolveJudge = onCall(BIB_CALLABLE_OPTS, async (request) =>
  getDefaultBibHandler("judge")(request as unknown as BibResolveRequestLike)
);
