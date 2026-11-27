/**
 * Pure wrapper over `@toulmin/core-l0` chunking, sanitizer, and page-1 DOI/arXiv scanners
 * (`05` §3.2.4, `06` §5.3 rule 5).
 *
 * CRITICAL ISOLATION INVARIANT: This file MUST remain 100% pure (zero `firebase-admin`,
 * zero HTTP clients, zero Secret Manager, zero Node I/O) so `functions/src/oaparse/**`
 * can import it cleanly.
 */

import {
  chunkAbstract,
  chunkJatsOrderedNodes,
  chunkJatsXml,
  chunkPdfPages,
  computeChunkId,
  computeEvidenceVersion,
  sanitizeText,
  stripJatsAndHtmlTags,
  type EvidenceUnit,
  type OrderedXmlNode,
  type PdfPageInput,
  type PdfTextItem,
  type SanitizeResult,
} from "@toulmin/core-l0";
import { scanPage1ArxivId, scanPage1Doi } from "@toulmin/core-l0/ingest/pdf";
import type { OaFetchSection, OaFetchUnit } from "@toulmin/schemas";

export {
  chunkAbstract,
  chunkJatsOrderedNodes,
  chunkJatsXml,
  chunkPdfPages,
  computeChunkId,
  computeEvidenceVersion,
  sanitizeText,
  scanPage1ArxivId,
  scanPage1Doi,
  stripJatsAndHtmlTags,
};
export type { EvidenceUnit, OrderedXmlNode, PdfPageInput, PdfTextItem, SanitizeResult };

/**
 * Converts flat parsed `{ section, text }` units into canonical `chunkId`-addressed,
 * sanitized `OaFetchSection[]` using the frozen `@toulmin/core-l0` rules (`02` §8.7, §9).
 */
export function buildSanitizedSections(
  refId: string,
  parsedUnits: readonly { readonly section: string; readonly text: string }[],
  options?: { readonly hiddenPdfText?: boolean }
): OaFetchSection[] {
  const ordinals = new Map<string, number>();
  const grouped = new Map<string, OaFetchUnit[]>();
  const sectionOrder: string[] = [];

  for (const unit of parsedUnits) {
    const section = unit.section || "unlabeled";
    const ordinal = ordinals.get(section) ?? 0;
    ordinals.set(section, ordinal + 1);

    const chunkId = computeChunkId(refId, "FULLTEXT", section, ordinal, unit.text);
    const san = sanitizeText(
      unit.text,
      options?.hiddenPdfText !== undefined ? { hiddenPdfText: options.hiddenPdfText } : undefined
    );
    let list = grouped.get(section);
    if (!list) {
      list = [];
      grouped.set(section, list);
      sectionOrder.push(section);
    }
    list.push({
      chunkId,
      text: san.text,
      tier: san.tier,
      reasons: [...san.reasons],
    });
  }

  return sectionOrder.map((label) => ({
    label,
    units: grouped.get(label)!,
  }));
}

const BLOCK_REASON_SET: ReadonlySet<string> = new Set([
  "TAG_CHARS",
  "BIDI_OVERRIDE",
  "INVISIBLE_CHARS",
  "MIXED_SCRIPT",
  "HIDDEN_PDF_TEXT",
  "INJ-01",
  "INJ-02",
  "INJ-03",
  "INJ-04",
  "INJ-05",
  "INJ-06",
  "INJ-07",
  "INJ-08",
  "INJ-09",
  "INJ-10",
  "INJ-11",
  "INJ-12",
  "INJ-13",
]);

/**
 * Re-runs the `@toulmin/core-l0` sanitizer on cached units loaded from Storage (`05` §3.2.2)
 * while monotonically preserving historical reasons (`TAG_CHARS`, `BIDI_OVERRIDE`,
 * `INVISIBLE_CHARS`, `PUA_UNMAPPED`, `HIDDEN_PDF_TEXT`) already stripped on initial ingest.
 */
export function resanitizeCachedSections(sections: readonly OaFetchSection[]): OaFetchSection[] {
  return sections.map((sec) => ({
    label: sec.label,
    units: sec.units.map((u) => {
      const hadHiddenPdfText = u.reasons.includes("HIDDEN_PDF_TEXT");
      const san = sanitizeText(u.text, hadHiddenPdfText ? { hiddenPdfText: true } : undefined);

      const mergedReasons: string[] = [];
      const seen = new Set<string>();
      for (const reason of [...u.reasons, ...san.reasons]) {
        if (!seen.has(reason)) {
          seen.add(reason);
          mergedReasons.push(reason);
        }
      }

      let tier: OaFetchUnit["tier"] = san.tier;
      if (
        u.tier === "blocked" ||
        san.tier === "blocked" ||
        mergedReasons.some((r) => BLOCK_REASON_SET.has(r))
      ) {
        tier = "blocked";
      } else if (u.tier === "logged" || san.tier === "logged" || mergedReasons.length > 0) {
        tier = "logged";
      }

      return {
        chunkId: u.chunkId,
        text: san.text,
        tier,
        reasons: mergedReasons,
      };
    }),
  }));
}
