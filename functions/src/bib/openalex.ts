import { normalizeDoi, firstAuthorsMatch, titleSim } from "./mismatch.js";

export interface OpenAlexAuthor {
  readonly family: string;
  readonly given?: string;
}

export interface OpenAlexWorkRecord {
  readonly openalexId: string | null;
  readonly doi: string | null;
  readonly title: string | null;
  readonly authors: OpenAlexAuthor[];
  readonly authorCount: number;
  readonly year: number | null;
  readonly venue: string | null;
  readonly isPreprint: boolean;
  readonly isRetracted: boolean;
  readonly abstract: string | null;
  readonly oaPdfUrl: string | null;
  readonly oaLicense: string | null;
  readonly pmcid: string | null;
  readonly arxivId: string | null;
  readonly oaAvailable: boolean;
}

export type UpstreamFetchFn = (
  url: string,
  init?: {
    readonly method?: "GET" | "POST" | "HEAD";
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly redirect?: "follow" | "manual";
  }
) => Promise<{
  readonly status: number;
  readonly ok: boolean;
  readonly json: () => Promise<unknown>;
}>;

export class UpstreamHttpError extends Error {
  readonly status: number;
  readonly upstream: string;

  constructor(upstream: string, status: number, message: string) {
    super(message);
    this.name = "UpstreamHttpError";
    this.upstream = upstream;
    this.status = status;
  }
}

const PREPRINT_VENUES = ["arxiv", "biorxiv", "medrxiv", "ssrn", "research square"];

const OPENALEX_SELECT =
  "id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,is_retracted,ids,type";

export function reconstructAbstract(invertedIndex: unknown): string | null {
  if (typeof invertedIndex !== "object" || invertedIndex === null || Array.isArray(invertedIndex)) {
    return null;
  }
  const positions: string[] = [];
  let maxPos = -1;
  for (const [word, idxs] of Object.entries(invertedIndex as Record<string, unknown>)) {
    if (!Array.isArray(idxs)) continue;
    for (const pos of idxs) {
      if (typeof pos === "number" && Number.isInteger(pos) && pos >= 0 && pos < 100_000) {
        positions[pos] = word;
        if (pos > maxPos) maxPos = pos;
      }
    }
  }
  if (maxPos < 0) return null;
  const words: string[] = [];
  for (let i = 0; i <= maxPos; i += 1) {
    const w = positions[i];
    if (w !== undefined) words.push(w);
  }
  const text = words.join(" ").trim();
  return text.length > 0 ? text : null;
}

export function isPreprintVenueOrType(type: unknown, venue: string | null): boolean {
  if (typeof type === "string" && type.toLowerCase() === "preprint") {
    return true;
  }
  if (venue) {
    const vLower = venue.toLowerCase();
    for (const p of PREPRINT_VENUES) {
      if (vLower.includes(p)) return true;
    }
  }
  return false;
}

function splitAuthorDisplayName(displayName: string): OpenAlexAuthor {
  const trimmed = displayName.trim();
  if (!trimmed) return { family: "" };
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx !== -1) {
    const family = trimmed.slice(0, commaIdx).trim();
    const given = trimmed.slice(commaIdx + 1).trim();
    return given ? { family, given } : { family };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { family: parts[0]! };
  const family = parts[parts.length - 1]!;
  const given = parts.slice(0, -1).join(" ");
  return given ? { family, given } : { family };
}

function stripOpenAlexIdPrefix(id: unknown): string | null {
  if (typeof id !== "string" || !id) return null;
  const idx = id.lastIndexOf("/");
  const shortId = idx !== -1 ? id.slice(idx + 1) : id;
  return /^W[0-9]{1,12}$/.test(shortId) ? shortId : null;
}

function extractPmcid(ids: unknown): string | null {
  if (typeof ids !== "object" || ids === null) return null;
  const raw = (ids as Record<string, unknown>)["pmcid"];
  if (typeof raw !== "string") return null;
  const match = raw.toUpperCase().match(/PMC[0-9]{1,10}/);
  return match ? match[0] : null;
}

function extractArxivIdFromIdsOrVenue(ids: unknown, doi: string | null): string | null {
  if (doi && doi.startsWith("10.48550/arxiv.")) {
    return doi.slice("10.48550/arxiv.".length);
  }
  if (typeof ids === "object" && ids !== null) {
    const raw = (ids as Record<string, unknown>)["arxiv"];
    if (typeof raw === "string") {
      const idx = raw.lastIndexOf("/abs/");
      if (idx !== -1) return raw.slice(idx + 5);
    }
  }
  return null;
}

export function parseOpenAlexWork(raw: unknown): OpenAlexWorkRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const w = raw as Record<string, unknown>;
  const openalexId = stripOpenAlexIdPrefix(w["id"]);
  const rawDoi = typeof w["doi"] === "string" ? normalizeDoi(w["doi"]) : null;
  const doi = rawDoi && rawDoi.length > 0 ? rawDoi : null;
  const title = typeof w["display_name"] === "string" ? w["display_name"].trim() : null;
  const year = typeof w["publication_year"] === "number" ? w["publication_year"] : null;

  const rawAuthorships = Array.isArray(w["authorships"]) ? w["authorships"] : [];
  const allAuthors: OpenAlexAuthor[] = [];
  for (const a of rawAuthorships) {
    if (typeof a !== "object" || a === null) continue;
    const authorObj = (a as Record<string, unknown>)["author"];
    if (typeof authorObj === "object" && authorObj !== null) {
      const disp = (authorObj as Record<string, unknown>)["display_name"];
      if (typeof disp === "string" && disp.trim().length > 0) {
        allAuthors.push(splitAuthorDisplayName(disp));
      }
    }
  }

  const primaryLoc =
    typeof w["primary_location"] === "object" && w["primary_location"] !== null
      ? (w["primary_location"] as Record<string, unknown>)
      : null;
  const primarySrc =
    primaryLoc && typeof primaryLoc["source"] === "object" && primaryLoc["source"] !== null
      ? (primaryLoc["source"] as Record<string, unknown>)
      : null;
  const venue =
    primarySrc && typeof primarySrc["display_name"] === "string"
      ? primarySrc["display_name"].trim()
      : null;

  const bestOa =
    typeof w["best_oa_location"] === "object" && w["best_oa_location"] !== null
      ? (w["best_oa_location"] as Record<string, unknown>)
      : null;
  const oaPdfUrl =
    bestOa && typeof bestOa["pdf_url"] === "string" && bestOa["pdf_url"].startsWith("https://")
      ? bestOa["pdf_url"]
      : null;
  const oaLicense =
    bestOa && typeof bestOa["license"] === "string" ? bestOa["license"].trim().toLowerCase() : null;

  const openAccessObj =
    typeof w["open_access"] === "object" && w["open_access"] !== null
      ? (w["open_access"] as Record<string, unknown>)
      : null;
  const pmcid = extractPmcid(w["ids"]);
  const arxivId = extractArxivIdFromIdsOrVenue(w["ids"], doi);
  const oaAvailable =
    Boolean(pmcid) ||
    Boolean(oaPdfUrl) ||
    Boolean(arxivId) ||
    openAccessObj?.["is_oa"] === true;

  return {
    openalexId,
    doi,
    title,
    authors: allAuthors.slice(0, 3),
    authorCount: allAuthors.length,
    year,
    venue,
    isPreprint: isPreprintVenueOrType(w["type"], venue),
    isRetracted: w["is_retracted"] === true,
    abstract: reconstructAbstract(w["abstract_inverted_index"]),
    oaPdfUrl,
    oaLicense,
    pmcid,
    arxivId,
    oaAvailable,
  };
}

export function doiNeedsSingletonQuery(doi: string): boolean {
  return doi.includes("|") || doi.includes(",") || doi.includes("&");
}

export interface OpenAlexClientOptions {
  readonly apiKey: string;
  readonly fetchFn: UpstreamFetchFn;
  readonly acquireRateToken: () => Promise<void>;
  /** `VERIFY-AT-SPIKE BE-2`: OpenAlex OR-filter batch (`true`) vs singleton fallback (`false`, default). */
  readonly spike_be_2_primary?: boolean;
}

function apiKeySuffix(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.length > 0 ? `&api_key=${encodeURIComponent(trimmed)}` : "";
}

export async function fetchOpenAlexById(
  workId: string,
  opts: OpenAlexClientOptions
): Promise<OpenAlexWorkRecord | null> {
  const cleanId = workId.replace(/^https?:\/\/openalex\.org\//i, "").trim();
  if (!cleanId) return null;
  await opts.acquireRateToken();
  const url = `https://api.openalex.org/works/${encodeURIComponent(cleanId)}?select=${OPENALEX_SELECT}${apiKeySuffix(opts.apiKey)}`;
  const res = await opts.fetchFn(url, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new UpstreamHttpError("openalex", res.status, `OpenAlex work lookup returned ${res.status}`);
  }
  return parseOpenAlexWork(await res.json());
}

export async function fetchOpenAlexByDois(
  dois: readonly string[],
  opts: OpenAlexClientOptions
): Promise<Map<string, OpenAlexWorkRecord>> {
  const out = new Map<string, OpenAlexWorkRecord>();
  const batchEligible: string[] = [];
  const singletonOnly: string[] = [];
  const useOrFilter = opts.spike_be_2_primary === true;

  for (const rawDoi of dois) {
    const doi = normalizeDoi(rawDoi);
    if (!doi) continue;
    if (!useOrFilter || doiNeedsSingletonQuery(doi)) {
      singletonOnly.push(doi);
    } else {
      batchEligible.push(doi);
    }
  }

  const keyParam = apiKeySuffix(opts.apiKey);

  for (const doi of singletonOnly) {
    await opts.acquireRateToken();
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=${OPENALEX_SELECT}${keyParam}`;
    const res = await opts.fetchFn(url, { method: "GET" });
    if (res.status === 404) continue;
    if (!res.ok) {
      throw new UpstreamHttpError("openalex", res.status, `OpenAlex singleton returned ${res.status}`);
    }
    const parsed = parseOpenAlexWork(await res.json());
    if (parsed) {
      out.set(parsed.doi ?? doi, parsed);
    }
  }

  for (let i = 0; i < batchEligible.length; i += 50) {
    const chunk = batchEligible.slice(i, i + 50);
    await opts.acquireRateToken();
    const filterValue = chunk.map((d) => encodeURIComponent(d)).join("|");
    const url = `https://api.openalex.org/works?filter=doi:${filterValue}&per-page=50&select=${OPENALEX_SELECT}${keyParam}`;
    const res = await opts.fetchFn(url, { method: "GET" });
    if (res.status === 404) continue;
    if (!res.ok) {
      throw new UpstreamHttpError("openalex", res.status, `OpenAlex batch returned ${res.status}`);
    }
    const json = (await res.json()) as { results?: unknown[] };
    const results = Array.isArray(json.results) ? json.results : [];
    for (const item of results) {
      const parsed = parseOpenAlexWork(item);
      if (parsed?.doi) {
        out.set(parsed.doi, parsed);
      }
    }
  }

  return out;
}

export interface OpenAlexTitleSearchResult {
  readonly status: "HIT" | "AMBIGUOUS" | "NONE";
  readonly record?: OpenAlexWorkRecord;
  readonly candidates?: Array<{ doi: string; title: string; year: number }>;
}

export async function searchOpenAlexByTitle(
  title: string,
  year: number | undefined,
  firstAuthor: string | undefined,
  opts: OpenAlexClientOptions
): Promise<OpenAlexTitleSearchResult> {
  await opts.acquireRateToken();
  const yearFilter =
    year !== undefined ? `&filter=publication_year:${year - 1}-${year + 1}` : "";
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}${yearFilter}&per-page=3&select=${OPENALEX_SELECT}${apiKeySuffix(opts.apiKey)}`;
  const res = await opts.fetchFn(url, { method: "GET" });
  if (res.status === 404) return { status: "NONE" };
  if (!res.ok) {
    throw new UpstreamHttpError("openalex", res.status, `OpenAlex search returned ${res.status}`);
  }
  const json = (await res.json()) as { results?: unknown[] };
  const results = Array.isArray(json.results) ? json.results : [];
  const accepted: OpenAlexWorkRecord[] = [];
  for (const item of results) {
    const parsed = parseOpenAlexWork(item);
    if (!parsed || !parsed.title) continue;
    if (titleSim(title, parsed.title) < 0.9) continue;
    if (firstAuthor && parsed.authors[0] && !firstAuthorsMatch(firstAuthor, parsed.authors[0])) {
      continue;
    }
    accepted.push(parsed);
  }

  if (accepted.length === 0) return { status: "NONE" };
  if (accepted.length === 1) return { status: "HIT", record: accepted[0]! };
  return {
    status: "AMBIGUOUS",
    candidates: accepted.slice(0, 3).map((r) => ({
      doi: r.doi ?? "",
      title: r.title ?? "",
      year: r.year ?? 0,
    })),
  };
}
