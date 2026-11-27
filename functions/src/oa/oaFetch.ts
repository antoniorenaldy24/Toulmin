import { createHash } from "node:crypto";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { OaFetchResponse, OaFetchSection, OaParseResponse } from "@toulmin/schemas";
import {
  createDefaultBibRateBuckets,
  createStorageRwLookup,
  parseStoredRefMeta,
  resolveSingleRefMetaInternal,
  type BibRateBuckets,
  type StoredRefMeta,
} from "../bib/bibResolve.js";
import { normalizeDoi } from "../bib/mismatch.js";
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
import { assertValidOaFetchRequest } from "../common/validate.js";
import { JudgeValidityCache } from "../judge/validity.js";
import { detectMagicBytes } from "../net/magic.js";
import { safeFetch, SafeFetchError, type SafeFetchOptions } from "../net/safeFetch.js";
import { extractJatsLicenseFromNodes } from "../oaparse/jats.js";
import { computeNetHash } from "../quota/netHash.js";
import { acquireArxivLock, fetchArxivOaiLicense } from "./arxivOai.js";
import {
  buildSanitizedSections,
  parseXmlOrderedFromText,
  resanitizeCachedSections,
} from "./oaXmlHelper.js";
import { verifyDocumentIdentity } from "./identity.js";
import { buildOaCandidates, isCacheableOpenLicense, normalizeLicense } from "./locate.js";

const UNPAYWALL_EMAIL = defineSecret("UNPAYWALL_EMAIL");
const NET_HASH_PEPPER = defineSecret("NET_HASH_PEPPER");

const CACHE_MAX_AGE_MS = 90 * 86_400_000;
const PARSE_SEMAPHORE_WAIT_MS = 20_000;
const PARSER_RETRY_WAIT_MS = 2_000;
const OA_CALL_TIME_BUDGET_MS = 55_000;

export interface CachedOaChunksDoc {
  readonly refId: string;
  readonly source: "JATS" | "PDF" | "ARXIV";
  readonly license: string;
  readonly licenseSource: string | null;
  readonly sourceSha256: string;
  readonly fetchedAt: number;
  readonly sections: OaFetchSection[];
}

export interface OaStorageAdapter {
  readChunks(objectPath: string): Promise<CachedOaChunksDoc | null>;
  writeChunks(objectPath: string, doc: CachedOaChunksDoc): Promise<void>;
}

export class ParserHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ParserHttpError";
    this.status = status;
  }
}

export type InvokeParserFn = (params: {
  readonly parserName: "oaParse" | "oaParseJudge";
  readonly refId: string;
  readonly bytes: Uint8Array;
}) => Promise<OaParseResponse>;

/**
 * Per-instance bounded concurrency semaphore (`05` §3.2.4):
 * 3 slots for `oaFetch` (3 × 3 = 9 ≤ 10 `oaParse` instances),
 * 2 slots for `oaFetchJudge` (2 × 2 = 4 `oaParseJudge` instances).
 */
export class ParseSemaphore {
  private readonly capacity: number;
  private inUse = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly now: () => number;

  constructor(capacity: number, now: () => number = () => Date.now()) {
    this.capacity = capacity;
    this.now = now;
  }

  async acquire(timeoutMs: number = PARSE_SEMAPHORE_WAIT_MS): Promise<boolean> {
    if (this.inUse < this.capacity) {
      this.inUse += 1;
      return true;
    }

    const deadline = this.now() + timeoutMs;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onSlot = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.inUse += 1;
        resolve(true);
      };
      const remaining = Math.max(0, deadline - this.now());
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.waiters.indexOf(onSlot);
        if (idx !== -1) this.waiters.splice(idx, 1);
        resolve(false);
      }, remaining);
      this.waiters.push(onSlot);
    });
  }

  release(): void {
    if (this.inUse > 0) {
      this.inUse -= 1;
    }
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}

export interface OaFetchRequestLike {
  readonly app?: { readonly appId?: string } | undefined;
  readonly auth?: CallerAuthContext | undefined;
  readonly data: unknown;
  readonly rawRequest?: RawRequestWithIp | undefined;
}

export interface OaFetchDeps {
  readonly lane: "public" | "judge";
  readonly db: FirestoreLike;
  readonly stateCache: GlobalStateCache;
  readonly counters: CounterEngine;
  readonly judgeValidator: JudgeLaneValidator;
  readonly storage: OaStorageAdapter;
  readonly semaphore: ParseSemaphore;
  readonly invokeParser: InvokeParserFn;
  readonly getUnpaywallEmail: () => string;
  readonly getNetHashPepper: () => string;
  readonly resolveRefMeta?: (refId: string, request: OaFetchRequestLike) => Promise<StoredRefMeta | null>;
  readonly safeFetchImpl?: (url: string, opts: SafeFetchOptions) => Promise<{
    finalUrl: string;
    pinnedIp: string;
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Uint8Array;
  }>;
  readonly confirmUnpaywall?: (doi: string) => Promise<string | null>;
  readonly fetchArxivLicense?: (arxivId: string) => Promise<string | null>;
  readonly spike_be_2_primary?: boolean;
  readonly parseSemaphoreWaitMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly trustedProxyHopsFromRight?: number;
  readonly logger?: SafeLogger;
}

function sha256hexBytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createDefaultStorageAdapter(): OaStorageAdapter {
  const bucket = getStorage().bucket();
  return {
    async readChunks(objectPath) {
      const file = bucket.file(objectPath);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [buf] = await file.download();
      return JSON.parse(buf.toString("utf8")) as CachedOaChunksDoc;
    },
    async writeChunks(objectPath, doc) {
      const file = bucket.file(objectPath);
      await file.save(JSON.stringify(doc), {
        contentType: "application/json",
        resumable: false,
      });
    },
  };
}

function createDefaultParserInvoker(): InvokeParserFn {
  return async ({ parserName, refId, bytes }) => {
    const projectId =
      process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["GCLOUD_PROJECT"] ?? "toulmin-prod";
    const baseUrl =
      process.env["TOULMIN_PARSER_BASE_URL"] ?? `https://us-central1-${projectId}.cloudfunctions.net`;
    const audience = `${baseUrl}/${parserName}`;

    // Obtain Google-signed OIDC ID token for the private parser service (`oafetch-sa` -> `oaParse`/`oaParseJudge`).
    let idToken = "";
    try {
      const tokenResp = await fetch(
        `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
        { headers: { "Metadata-Flavor": "Google" } }
      );
      if (tokenResp.ok) {
        idToken = (await tokenResp.text()).trim();
      }
    } catch {
      // Local emulator / non-GCE fallback leaves Authorization unset if metadata server is absent
    }

    const resp = await fetch(audience, {
      method: "POST",
      headers: {
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        "Content-Type": "application/octet-stream",
        "x-toulmin-refid": refId,
      },
      body: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    });
    if (!resp.ok) {
      throw new ParserHttpError(resp.status, `Parser ${parserName} returned HTTP ${resp.status}`);
    }
    return (await resp.json()) as OaParseResponse;
  };
}

export function createOaFetchHandler(
  deps: OaFetchDeps
): (request: OaFetchRequestLike) => Promise<OaFetchResponse> {
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))));
  const logger = deps.logger ?? defaultLogger;
  const fetchBinary = deps.safeFetchImpl ?? safeFetch;

  return async (request: OaFetchRequestLike): Promise<OaFetchResponse> => {
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

    const req = assertValidOaFetchRequest(request.data);
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
      field: "oaFetch",
      n: 1,
      netHash,
      atomic: true,
    });
    if (reservation.granted === 0) {
      throw new HttpsError("resource-exhausted", reservation.deniedReason ?? "QUOTA_EXCEEDED");
    }

    let refunded = false;
    const refundReservation = async (): Promise<void> => {
      if (refunded) return;
      refunded = true;
      await deps.counters.refund({
        uid,
        pool,
        field: "oaFetch",
        count: 1,
        netHash,
        day,
      });
    };

    const canonicalRefId = req.refId.startsWith("doi:")
      ? `doi:${normalizeDoi(req.refId.slice(4))}`
      : req.refId;
    const refIdHash = sha256hexBytes(canonicalRefId);
    const cachePath = `oa/${refIdHash}/chunks.json`;

    try {
      // 1. Check Storage cache (< 90 days old); always re-run sanitizer on stored units
      const cachedDoc = await deps.storage.readChunks(cachePath);
      if (cachedDoc && now() - cachedDoc.fetchedAt < CACHE_MAX_AGE_MS) {
        const resanitized = resanitizeCachedSections(cachedDoc.sections);
        logger.info("oaFetch.cache_hit", {
          uid,
          lane: deps.lane,
          refIdHash,
          source: cachedDoc.source,
          latencyMs: Math.max(0, now() - startMs),
        });
        return {
          refId: req.refId,
          source: cachedDoc.source,
          license: cachedDoc.license,
          cached: true,
          sections: resanitized,
          fetchedAt: cachedDoc.fetchedAt,
        };
      }

      // 2. Read /refmeta/{sha256hex(canonicalRefId)} or run internal refmeta lookup if missing
      const metaSnap = await deps.db.doc(`refmeta/${refIdHash}`).get();
      let refMeta = metaSnap.exists ? parseStoredRefMeta(metaSnap.data()) : null;
      if (!refMeta && deps.resolveRefMeta) {
        refMeta = await deps.resolveRefMeta(canonicalRefId, request);
      }

      if (!refMeta) {
        await refundReservation();
        return {
          refId: req.refId,
          source: "NONE",
          reason: "NO_OA",
          license: null,
          cached: false,
          sections: [],
          fetchedAt: now(),
        };
      }

      const unpaywallEmail = deps.getUnpaywallEmail();
      const safeFetchOpts: SafeFetchOptions = { userAgentMailto: unpaywallEmail };
      const candidates = await buildOaCandidates(refMeta, {
        unpaywallEmail,
        safeFetchOpts,
        ...(deps.confirmUnpaywall ? { confirmUnpaywall: deps.confirmUnpaywall } : {}),
      });

      if (candidates.length === 0) {
        await refundReservation();
        return {
          refId: req.refId,
          source: "NONE",
          reason: "NO_OA",
          license: null,
          cached: false,
          sections: [],
          fetchedAt: now(),
        };
      }

      let lastFailureReason: OaFetchResponse["reason"] = "FETCH_FAILED";
      const parserName = deps.lane === "judge" ? "oaParseJudge" : "oaParse";
      const semWaitMs = deps.parseSemaphoreWaitMs ?? PARSE_SEMAPHORE_WAIT_MS;
      const useArxivPrimary =
        deps.spike_be_2_primary ?? process.env["SPIKE_BE_2_PRIMARY"] === "true";

      for (const candidate of candidates) {
        if (now() - startMs >= OA_CALL_TIME_BUDGET_MS) {
          lastFailureReason = "FETCH_FAILED";
          break;
        }

        let resolvedLicense = candidate.preKnownLicense;
        let licenseSource = candidate.licenseSource;

        if (candidate.source === "ARXIV" && candidate.arxivId) {
          const lock = await acquireArxivLock(deps.db, now, sleep);
          if (!lock.acquired) {
            lastFailureReason = "FETCH_FAILED";
            continue;
          }
          if (!useArxivPrimary) {
            resolvedLicense = null;
            licenseSource = null;
          } else {
            try {
              const rawArxivLic = deps.fetchArxivLicense
                ? await deps.fetchArxivLicense(candidate.arxivId)
                : await fetchArxivOaiLicense(candidate.arxivId, safeFetchOpts);
              resolvedLicense = normalizeLicense(rawArxivLic);
              licenseSource = "ARXIV";
            } catch {
              resolvedLicense = null;
              licenseSource = null;
            }
          }
        }

        let fetchedBytes: Uint8Array;
        try {
          const resp = await fetchBinary(candidate.url, {
            ...safeFetchOpts,
            accept:
              candidate.expectedFormat === "XML"
                ? "application/xml, text/xml"
                : "application/pdf",
          });
          fetchedBytes = resp.body;
        } catch (err) {
          if (err instanceof SafeFetchError) {
            lastFailureReason = "FETCH_FAILED";
          } else {
            lastFailureReason = "FETCH_FAILED";
          }
          continue;
        }

        const magic = detectMagicBytes(fetchedBytes);
        if (magic !== candidate.expectedFormat) {
          lastFailureReason = "FETCH_FAILED";
          continue;
        }

        if (candidate.source === "JATS") {
          const xmlText = new TextDecoder("utf-8").decode(fetchedBytes);
          const jatsLic = extractJatsLicenseFromNodes(parseXmlOrderedFromText(xmlText));
          const normJats = normalizeLicense(jatsLic);
          if (normJats !== null) {
            resolvedLicense = normJats;
            licenseSource = "JATS";
          }
        }

        // Acquire per-instance parse semaphore (wait <= 20 s)
        const semStart = now();
        const acquired = await deps.semaphore.acquire(semWaitMs);
        if (!acquired) {
          await refundReservation();
          return {
            refId: req.refId,
            source: "NONE",
            reason: "PARSER_BUSY",
            license: null,
            cached: false,
            sections: [],
            fetchedAt: now(),
          };
        }

        let parsed: OaParseResponse;
        try {
          try {
            parsed = await deps.invokeParser({
              parserName,
              refId: canonicalRefId,
              bytes: fetchedBytes,
            });
          } catch (err) {
            const isRetryable =
              err instanceof ParserHttpError && (err.status === 429 || err.status === 503);
            const elapsedWait = now() - semStart;
            if (isRetryable && elapsedWait + PARSER_RETRY_WAIT_MS <= semWaitMs) {
              await sleep(PARSER_RETRY_WAIT_MS);
              parsed = await deps.invokeParser({
                parserName,
                refId: canonicalRefId,
                bytes: fetchedBytes,
              });
            } else {
              throw err;
            }
          }
        } catch (err) {
          lastFailureReason =
            err instanceof ParserHttpError && (err.status === 429 || err.status === 503)
              ? "PARSER_BUSY"
              : "FETCH_FAILED";
          continue;
        } finally {
          deps.semaphore.release();
        }

        // Page-1 DOI / identity match (05 §3.2.5 step 1)
        if (!verifyDocumentIdentity(candidate.source, parsed.identity, refMeta)) {
          lastFailureReason = "IDENTITY_MISMATCH";
          continue;
        }

        const sections = buildSanitizedSections(canonicalRefId, parsed.units, {
          hiddenPdfText: parsed.kind === "PDF" && parsed.hiddenTextDropped > 0,
        });
        const fetchedAt = now();
        const cacheable = isCacheableOpenLicense(resolvedLicense);

        if (cacheable && resolvedLicense !== null) {
          const docToSave: CachedOaChunksDoc = {
            refId: canonicalRefId,
            source: candidate.source,
            license: resolvedLicense,
            licenseSource,
            sourceSha256: sha256hexBytes(fetchedBytes),
            fetchedAt,
            sections,
          };
          await deps.storage.writeChunks(cachePath, docToSave);
        }

        logger.info("oaFetch.success", {
          uid,
          lane: deps.lane,
          refIdHash,
          source: candidate.source,
          cachedOnServer: cacheable,
          sectionCount: sections.length,
          latencyMs: Math.max(0, now() - startMs),
        });

        return {
          refId: req.refId,
          source: candidate.source,
          ...(resolvedLicense === null ? { reason: "LICENSE_UNKNOWN" as const } : {}),
          license: resolvedLicense,
          cached: false,
          sections,
          fetchedAt,
        };
      }

      await refundReservation();
      logger.warn("oaFetch.none", {
        uid,
        lane: deps.lane,
        refIdHash,
        reason: lastFailureReason,
        latencyMs: Math.max(0, now() - startMs),
      });

      return {
        refId: req.refId,
        source: "NONE",
        reason: lastFailureReason,
        license: null,
        cached: false,
        sections: [],
        fetchedAt: now(),
      };
    } catch (err) {
      await refundReservation().catch(() => undefined);
      throw err;
    }
  };
}

const defaultSemaphores: Record<"public" | "judge", ParseSemaphore> = {
  public: new ParseSemaphore(3),
  judge: new ParseSemaphore(2),
};

const defaultOaBibBuckets: Record<"public" | "judge", BibRateBuckets> = {
  public: createDefaultBibRateBuckets(),
  judge: createDefaultBibRateBuckets(),
};

const cachedOaHandlers: Partial<
  Record<"public" | "judge", (request: OaFetchRequestLike) => Promise<OaFetchResponse>>
> = {};

function getDefaultOaHandler(
  lane: "public" | "judge"
): (request: OaFetchRequestLike) => Promise<OaFetchResponse> {
  const existing = cachedOaHandlers[lane];
  if (existing) return existing;

  const app = getApps().length > 0 ? getApp() : initializeApp();
  const db = wrapAdminFirestore(getFirestore(app));
  const stateCache = new GlobalStateCache(db);
  const counters = new CounterEngine(db, stateCache);
  const judgeValidator = new JudgeValidityCache(db);
  const storage = createDefaultStorageAdapter();
  const invokeParser = createDefaultParserInvoker();
  const rwLookup = createStorageRwLookup(stateCache);

  const handler = createOaFetchHandler({
    lane,
    db,
    stateCache,
    counters,
    judgeValidator,
    storage,
    semaphore: defaultSemaphores[lane],
    invokeParser,
    getUnpaywallEmail: () => UNPAYWALL_EMAIL.value(),
    getNetHashPepper: () => NET_HASH_PEPPER.value(),
    spike_be_2_primary: process.env["SPIKE_BE_2_PRIMARY"] === "true",
    resolveRefMeta: async (refId) =>
      resolveSingleRefMetaInternal(refId, {
        db,
        stateCache,
        crossrefMailto: UNPAYWALL_EMAIL.value(),
        buckets: defaultOaBibBuckets[lane],
        lookupRwRetraction: rwLookup,
      }),
  });
  cachedOaHandlers[lane] = handler;
  return handler;
}

export const oaFetch = onCall(
  {
    ...BASE,
    maxInstances: 3,
    concurrency: 4,
    memory: "512MiB",
    cpu: 1,
    timeoutSeconds: 60,
    serviceAccount: SERVICE_ACCOUNTS.oafetch,
    secrets: [UNPAYWALL_EMAIL, NET_HASH_PEPPER],
  },
  async (request) => getDefaultOaHandler("public")(request as unknown as OaFetchRequestLike)
);

export const oaFetchJudge = onCall(
  {
    ...BASE,
    maxInstances: 2,
    concurrency: 4,
    memory: "512MiB",
    cpu: 1,
    timeoutSeconds: 60,
    serviceAccount: SERVICE_ACCOUNTS.oafetch,
    secrets: [UNPAYWALL_EMAIL, NET_HASH_PEPPER],
  },
  async (request) => getDefaultOaHandler("judge")(request as unknown as OaFetchRequestLike)
);
