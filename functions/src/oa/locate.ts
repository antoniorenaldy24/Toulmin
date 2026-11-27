import type { StoredRefMeta } from "../bib/bibResolve.js";
import { safeFetch, type SafeFetchOptions } from "../net/safeFetch.js";

export type OpenLicenseId = "cc-by" | "cc-by-sa" | "cc0" | "public-domain" | "pd";

const CACHEABLE_OPEN_LICENSES = new Set<string>([
  "cc-by",
  "cc-by-sa",
  "cc0",
  "public-domain",
  "pd",
]);

/**
 * Normalizes license URLs and strings to canonical short identifiers (`05` §3.2.2, §3.2.5).
 */
export function normalizeLicense(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean);
  const tokenSet = new Set(tokens);

  if (
    s.includes("non-exclusive") ||
    s.includes("arxiv.org/licenses/nonexclusive") ||
    tokenSet.has("nonexclusive") ||
    (tokenSet.has("non") && tokenSet.has("exclusive"))
  ) {
    return "arxiv-nonexclusive";
  }

  // Restrictive CC clauses MUST be checked before permissive CC-BY / CC-BY-SA matches.
  const hasNc =
    tokenSet.has("nc") ||
    tokenSet.has("noncommercial") ||
    s.includes("/licenses/by-nc") ||
    s.includes("by-nc");
  if (hasNc) {
    return "cc-by-nc";
  }

  const hasNd =
    tokenSet.has("nd") ||
    tokenSet.has("noderivs") ||
    s.includes("/licenses/by-nd") ||
    s.includes("by-nd");
  if (hasNd) {
    return "cc-by-nd";
  }

  if (
    s === "cc-by-sa" ||
    s === "cc by-sa" ||
    s.includes("creativecommons.org/licenses/by-sa/") ||
    /^cc[- ]by[- ]sa(?:[- ]\d+(?:\.\d+)?)?$/.test(s)
  ) {
    return "cc-by-sa";
  }

  if (
    s === "cc-by" ||
    s === "cc by" ||
    s.includes("creativecommons.org/licenses/by/") ||
    /^cc[- ]by(?:[- ]\d+(?:\.\d+)?)?$/.test(s)
  ) {
    return "cc-by";
  }

  if (
    s === "cc0" ||
    /^cc0[- ]\d+(?:\.\d+)?$/.test(s) ||
    s.includes("creativecommons.org/publicdomain/zero/")
  ) {
    return "cc0";
  }

  if (
    s === "public-domain" ||
    s === "public domain" ||
    s === "pd" ||
    s.includes("creativecommons.org/publicdomain/mark/")
  ) {
    return "public-domain";
  }

  if (s === "bronze" || s === "implied-oa" || s === "publisher-specific-oa") {
    return s;
  }
  return s;
}

export function isCacheableOpenLicense(normalizedLicense: string | null): boolean {
  return normalizedLicense !== null && CACHEABLE_OPEN_LICENSES.has(normalizedLicense);
}

/**
 * Restrictiveness ranking (`05` §3.2.2 step 2: if OpenAlex and Unpaywall disagree, use the more restrictive).
 * Higher score = more restrictive.
 */
function restrictivenessScore(normLicense: string | null): number {
  if (normLicense === null) return 100;
  if (normLicense === "pd" || normLicense === "public-domain" || normLicense === "cc0") return 1;
  if (normLicense === "cc-by") return 2;
  if (normLicense === "cc-by-sa") return 3;
  if (normLicense === "cc-by-nd") return 10;
  if (normLicense === "cc-by-nc") return 20;
  return 50;
}

export function pickMoreRestrictiveLicense(
  a: string | null,
  b: string | null
): string | null {
  const na = normalizeLicense(a);
  const nb = normalizeLicense(b);
  if (na === null) return nb === null ? null : nb;
  if (nb === null) return na;
  return restrictivenessScore(na) >= restrictivenessScore(nb) ? na : nb;
}

export interface OaCandidate {
  readonly source: "JATS" | "PDF" | "ARXIV";
  readonly url: string;
  readonly expectedFormat: "XML" | "PDF";
  readonly preKnownLicense: string | null;
  readonly licenseSource: "JATS" | "OPENALEX" | "UNPAYWALL" | "ARXIV" | null;
  readonly arxivId?: string;
}

export async function confirmUnpaywallLicense(
  doi: string,
  unpaywallEmail: string,
  safeFetchOpts: SafeFetchOptions
): Promise<string | null> {
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(unpaywallEmail)}`;
  try {
    const resp = await safeFetch(url, {
      ...safeFetchOpts,
      accept: "application/json",
    });
    const text = new TextDecoder("utf-8").decode(resp.body);
    const json = JSON.parse(text) as {
      best_oa_location?: { license?: unknown } | null;
    };
    const raw = json.best_oa_location?.license;
    return typeof raw === "string" ? normalizeLicense(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Builds server-derived OA fetch candidates in normative order (`05` §3.2.2):
 * 1. Europe PMC JATS (`pmcid`)
 * 2. OpenAlex `best_oa_location.pdf_url` (with Unpaywall license confirmation)
 * 3. arXiv PDF (`arxivId`)
 */
export async function buildOaCandidates(
  refMeta: StoredRefMeta,
  options: {
    readonly unpaywallEmail: string;
    readonly safeFetchOpts: SafeFetchOptions;
    readonly confirmUnpaywall?: (doi: string) => Promise<string | null>;
  }
): Promise<OaCandidate[]> {
  const candidates: OaCandidate[] = [];

  if (refMeta.oa.pmcid) {
    candidates.push({
      source: "JATS",
      url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(refMeta.oa.pmcid)}/fullTextXML`,
      expectedFormat: "XML",
      preKnownLicense: null,
      licenseSource: null,
    });
  }

  if (refMeta.oa.pdfUrl && refMeta.oa.pdfUrl.startsWith("https://")) {
    let license = normalizeLicense(refMeta.oa.license);
    let licenseSource: OaCandidate["licenseSource"] = refMeta.oa.licenseSource ?? "OPENALEX";

    if (refMeta.doi) {
      const unpaywallLic = options.confirmUnpaywall
        ? await options.confirmUnpaywall(refMeta.doi)
        : await confirmUnpaywallLicense(refMeta.doi, options.unpaywallEmail, options.safeFetchOpts);
      if (unpaywallLic !== null) {
        if (license === null) {
          license = unpaywallLic;
          licenseSource = "UNPAYWALL";
        } else {
          const picked = pickMoreRestrictiveLicense(license, unpaywallLic);
          if (picked !== license) {
            license = picked;
            licenseSource = "UNPAYWALL";
          }
        }
      }
    }

    candidates.push({
      source: "PDF",
      url: refMeta.oa.pdfUrl,
      expectedFormat: "PDF",
      preKnownLicense: license,
      licenseSource,
    });
  }

  if (refMeta.oa.arxivId) {
    candidates.push({
      source: "ARXIV",
      url: `https://arxiv.org/pdf/${encodeURIComponent(refMeta.oa.arxivId)}`,
      expectedFormat: "PDF",
      preKnownLicense: null,
      licenseSource: "ARXIV",
      arxivId: refMeta.oa.arxivId,
    });
  }

  return candidates;
}
