import { normalizeDoi } from "./mismatch.js";
import { UpstreamHttpError, type OpenAlexAuthor, type UpstreamFetchFn } from "./openalex.js";

export interface S2WorkRecord {
  readonly doi: string;
  readonly s2PaperId: string | null;
  readonly title: string | null;
  readonly abstract: string | null;
  readonly year: number | null;
  readonly authors: OpenAlexAuthor[];
  readonly authorCount: number;
  readonly venue: string | null;
  readonly oaPdfUrl: string | null;
  readonly isOpenAccess: boolean;
}

export interface S2ClientOptions {
  readonly apiKey: string;
  readonly fetchFn: UpstreamFetchFn;
  readonly acquireRateToken: () => Promise<void>;
}

const S2_FIELDS =
  "title,abstract,year,authors,externalIds,isOpenAccess,openAccessPdf,journal,publicationTypes";

function splitS2Author(name: string): OpenAlexAuthor {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { family: parts[0] ?? "" };
  return {
    family: parts[parts.length - 1]!,
    given: parts.slice(0, -1).join(" "),
  };
}

/**
 * Batch-fetches Semantic Scholar records by DOI (`05` §3.1 step 4, ≤ 500 ids per call).
 */
export async function fetchSemanticScholarBatch(
  dois: readonly string[],
  opts: S2ClientOptions
): Promise<Map<string, S2WorkRecord>> {
  const out = new Map<string, S2WorkRecord>();
  const uniqueDois = Array.from(new Set(dois.map(normalizeDoi).filter((d) => d.length > 0)));
  if (uniqueDois.length === 0) return out;

  for (let i = 0; i < uniqueDois.length; i += 500) {
    const chunk = uniqueDois.slice(i, i + 500);
    await opts.acquireRateToken();
    const url = `https://api.semanticscholar.org/graph/v1/paper/batch?fields=${S2_FIELDS}`;
    const res = await opts.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
      },
      body: JSON.stringify({
        ids: chunk.map((d) => `DOI:${d}`),
      }),
    });
    if (res.status === 404) continue;
    if (!res.ok) {
      throw new UpstreamHttpError("s2", res.status, `Semantic Scholar batch returned ${res.status}`);
    }

    const items = (await res.json()) as unknown;
    if (!Array.isArray(items)) continue;
    for (let idx = 0; idx < items.length; idx += 1) {
      const raw = items[idx];
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const extIds =
        typeof r["externalIds"] === "object" && r["externalIds"] !== null
          ? (r["externalIds"] as Record<string, unknown>)
          : null;
      const extDoi = typeof extIds?.["DOI"] === "string" ? normalizeDoi(extIds["DOI"]) : null;
      const keyDoi = extDoi ?? chunk[idx]!;
      const rawAuthors = Array.isArray(r["authors"]) ? r["authors"] : [];
      const authors: OpenAlexAuthor[] = [];
      for (const a of rawAuthors) {
        if (typeof a === "object" && a !== null && typeof (a as Record<string, unknown>)["name"] === "string") {
          authors.push(splitS2Author(String((a as Record<string, unknown>)["name"])));
        }
      }
      const journalObj =
        typeof r["journal"] === "object" && r["journal"] !== null
          ? (r["journal"] as Record<string, unknown>)
          : null;
      const oaPdfObj =
        typeof r["openAccessPdf"] === "object" && r["openAccessPdf"] !== null
          ? (r["openAccessPdf"] as Record<string, unknown>)
          : null;
      const oaPdfUrl =
        typeof oaPdfObj?.["url"] === "string" && oaPdfObj["url"].startsWith("https://")
          ? oaPdfObj["url"]
          : null;
      const abstract =
        typeof r["abstract"] === "string" && r["abstract"].trim().length > 0
          ? r["abstract"].trim()
          : null;

      out.set(keyDoi, {
        doi: keyDoi,
        s2PaperId: typeof r["paperId"] === "string" ? r["paperId"] : null,
        title: typeof r["title"] === "string" ? r["title"].trim() : null,
        abstract,
        year: typeof r["year"] === "number" ? r["year"] : null,
        authors: authors.slice(0, 3),
        authorCount: authors.length,
        venue: typeof journalObj?.["name"] === "string" ? journalObj["name"].trim() : null,
        oaPdfUrl,
        isOpenAccess: r["isOpenAccess"] === true,
      });
    }
  }

  return out;
}
