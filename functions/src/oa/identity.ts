import type { OaParseResponse } from "@toulmin/schemas";
import type { StoredRefMeta } from "../bib/bibResolve.js";
import { normalizeDoi, titleSim } from "../bib/mismatch.js";

/**
 * Verifies parsed document identity against `/refmeta` (`05` §3.2.5 step 1, `AC-FN-04`):
 * - JATS: `<article-id pub-id-type="doi">` matches reference DOI (case-insensitive)
 * - PDF: first DOI on pages 1–2 matches reference DOI; if no DOI printed,
 *   first-page title has `titleSim >= 0.8` with `/refmeta.title`
 * - arXiv: arXiv ID printed on page 1 matches (or DOI on pages 1–2 matches)
 */
export function verifyDocumentIdentity(
  source: "JATS" | "PDF" | "ARXIV",
  identity: OaParseResponse["identity"],
  refMeta: StoredRefMeta
): boolean {
  const expectedDoi = refMeta.doi ? normalizeDoi(refMeta.doi) : null;

  if (source === "JATS") {
    if (!expectedDoi) {
      // No DOI recorded in refmeta: cannot fail DOI comparison if refId is oa:W... without DOI
      return refMeta.openalexId !== null;
    }
    return identity.jatsDoi !== null && normalizeDoi(identity.jatsDoi) === expectedDoi;
  }

  if (source === "ARXIV") {
    const expectedArxiv = refMeta.oa.arxivId?.toLowerCase() ?? null;
    if (expectedArxiv && identity.arxivIdOnPage1) {
      const stripVer = (id: string) => id.replace(/v[0-9]+$/i, "").toLowerCase();
      return stripVer(identity.arxivIdOnPage1) === stripVer(expectedArxiv);
    }
    if (expectedDoi && identity.doiOnPage1to2) {
      return normalizeDoi(identity.doiOnPage1to2) === expectedDoi;
    }
    if (identity.firstPageTitle && refMeta.title) {
      return titleSim(identity.firstPageTitle, refMeta.title) >= 0.8;
    }
    return false;
  }

  // PDF
  if (identity.doiOnPage1to2 !== null) {
    if (!expectedDoi) return true;
    return normalizeDoi(identity.doiOnPage1to2) === expectedDoi;
  }
  if (identity.firstPageTitle && refMeta.title) {
    return titleSim(identity.firstPageTitle, refMeta.title) >= 0.8;
  }
  return false;
}
