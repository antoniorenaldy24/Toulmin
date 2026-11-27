import { stripJatsAndHtmlTags } from "@toulmin/core-l0";
import { longestQuotedOrSentenceSegment, normalizeDoi, titleSim } from "./mismatch.js";
import { isPreprintVenueOrType, UpstreamHttpError, type OpenAlexAuthor, type UpstreamFetchFn } from "./openalex.js";

export interface CrossrefRetractionInfo {
  readonly isRetracted: boolean;
  readonly noticeDoi?: string;
}

export interface CrossrefWorkRecord {
  readonly doi: string | null;
  readonly title: string | null;
  readonly authors: OpenAlexAuthor[];
  readonly authorCount: number;
  readonly year: number | null;
  readonly venue: string | null;
  readonly isPreprint: boolean;
  readonly abstract: string | null;
  readonly retraction: CrossrefRetractionInfo;
  readonly score?: number;
}

export interface CrossrefClientOptions {
  readonly mailto: string;
  readonly fetchFn: UpstreamFetchFn;
  readonly acquireSingleToken: () => Promise<void>;
  readonly acquireQueryToken: () => Promise<void>;
}

function extractCrossrefYear(msg: Record<string, unknown>): number | null {
  for (const key of ["published-print", "published-online", "issued", "created"]) {
    const field = msg[key];
    if (typeof field === "object" && field !== null) {
      const parts = (field as Record<string, unknown>)["date-parts"];
      if (Array.isArray(parts) && Array.isArray(parts[0]) && typeof parts[0][0] === "number") {
        return parts[0][0];
      }
    }
  }
  return null;
}

function extractCrossrefRetraction(msg: Record<string, unknown>): CrossrefRetractionInfo {
  const relation = msg["relation"];
  if (typeof relation === "object" && relation !== null) {
    const isRetractedBy = (relation as Record<string, unknown>)["is-retracted-by"];
    if (Array.isArray(isRetractedBy) && isRetractedBy.length > 0) {
      const first = isRetractedBy[0];
      const noticeDoi =
        typeof first === "object" && first !== null && typeof (first as Record<string, unknown>)["id"] === "string"
          ? normalizeDoi(String((first as Record<string, unknown>)["id"]))
          : undefined;
      return noticeDoi ? { isRetracted: true, noticeDoi } : { isRetracted: true };
    }
  }

  const updatedBy = msg["updated-by"];
  if (Array.isArray(updatedBy)) {
    for (const item of updatedBy) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      const t = typeof rec["type"] === "string" ? rec["type"].toLowerCase() : "";
      if (t === "retraction") {
        const noticeDoi = typeof rec["DOI"] === "string" ? normalizeDoi(rec["DOI"]) : undefined;
        return noticeDoi ? { isRetracted: true, noticeDoi } : { isRetracted: true };
      }
    }
  }

  return { isRetracted: false };
}

export function parseCrossrefMessage(raw: unknown): CrossrefWorkRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;

  const doi = typeof msg["DOI"] === "string" ? normalizeDoi(msg["DOI"]) : null;
  const titleArr = Array.isArray(msg["title"]) ? msg["title"] : [];
  const title = typeof titleArr[0] === "string" ? titleArr[0].trim() : null;

  const rawAuthors = Array.isArray(msg["author"]) ? msg["author"] : [];
  const allAuthors: OpenAlexAuthor[] = [];
  for (const a of rawAuthors) {
    if (typeof a !== "object" || a === null) continue;
    const rec = a as Record<string, unknown>;
    const family = typeof rec["family"] === "string" ? rec["family"].trim() : "";
    const given = typeof rec["given"] === "string" ? rec["given"].trim() : undefined;
    if (family) {
      allAuthors.push(given ? { family, given } : { family });
    }
  }

  const containerArr = Array.isArray(msg["container-title"]) ? msg["container-title"] : [];
  const venue = typeof containerArr[0] === "string" ? containerArr[0].trim() : null;
  const rawAbstract = typeof msg["abstract"] === "string" ? msg["abstract"] : null;
  const strippedAbstract = rawAbstract ? stripJatsAndHtmlTags(rawAbstract).trim() : null;
  const abstract = strippedAbstract && strippedAbstract.length > 0 ? strippedAbstract : null;
  const score = typeof msg["score"] === "number" ? msg["score"] : undefined;

  return {
    doi,
    title,
    authors: allAuthors.slice(0, 3),
    authorCount: allAuthors.length,
    year: extractCrossrefYear(msg),
    venue,
    isPreprint: isPreprintVenueOrType(msg["type"], venue),
    abstract,
    retraction: extractCrossrefRetraction(msg),
    ...(score !== undefined ? { score } : {}),
  };
}

export async function fetchCrossrefByDoi(
  doi: string,
  opts: CrossrefClientOptions
): Promise<CrossrefWorkRecord | null> {
  const norm = normalizeDoi(doi);
  await opts.acquireSingleToken();
  const url = `https://api.crossref.org/works/${encodeURIComponent(norm)}?mailto=${encodeURIComponent(opts.mailto)}`;
  const res = await opts.fetchFn(url, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new UpstreamHttpError("crossref", res.status, `Crossref DOI returned ${res.status}`);
  }
  const json = (await res.json()) as { message?: unknown };
  return parseCrossrefMessage(json.message);
}

/**
 * Crossref bibliographic query for raw reference strings (`05` §3.1 step 5):
 * top hit accepted iff `score >= 60` and `titleSim >= 0.6` against the longest quoted/sentence-cased segment.
 */
export async function queryCrossrefBibliographic(
  rawRef: string,
  opts: CrossrefClientOptions
): Promise<CrossrefWorkRecord | null> {
  await opts.acquireQueryToken();
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(rawRef)}&rows=3&mailto=${encodeURIComponent(opts.mailto)}`;
  const res = await opts.fetchFn(url, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new UpstreamHttpError("crossref", res.status, `Crossref query returned ${res.status}`);
  }
  const json = (await res.json()) as { message?: { items?: unknown[] } };
  const items = Array.isArray(json.message?.items) ? json.message.items : [];
  if (items.length === 0) return null;

  const top = parseCrossrefMessage(items[0]);
  if (!top || !top.title) return null;
  if ((top.score ?? 0) < 60) return null;

  const segment = longestQuotedOrSentenceSegment(rawRef);
  if (titleSim(segment, top.title) < 0.6) return null;
  return top;
}
