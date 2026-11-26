/**
 * Pure User-Provided PDF Reference Chunking & Page-1 DOI Scanner
 * (`docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` §5.4).
 *
 * Reuses Tier A `chunkPdfPages` and `computeEvidenceVersion` (`packages/core-l0/src/chunk.ts`).
 * Pure TypeScript: zero Node I/O, zero `pdfjs-dist` worker runtime, zero DOM/network/regexes.
 */

import {
  chunkPdfPages,
  computeEvidenceVersion,
  type ChunkPdfOptions,
  type ChunkPdfResult,
  type PdfPageInput,
} from "../chunk.js";
import { normLower } from "../norm.js";
import { isValidArxivId, isValidDoi } from "@toulmin/schemas";

export interface IngestUserPdfInput {
  readonly refId?: string;
  readonly pages: readonly PdfPageInput[];
  readonly bibliography?: readonly { readonly refId: string; readonly doi: string | null }[];
  readonly chunkOptions?: Omit<ChunkPdfOptions, "sourceKind">;
}

export interface IngestUserPdfResult {
  readonly pdf: ChunkPdfResult;
  readonly page1Doi: string | null;
  readonly page1ArxivId: string | null;
  readonly matchedRefId: string | null;
  readonly evidenceVersion: string;
}

function isAsciiDigitCode(cu: number): boolean {
  return cu >= 48 && cu <= 57;
}

function isDisallowedPage1DoiChar(cu: number): boolean {
  // SPACE, quotes, '<', '>', controls
  return cu <= 32 || cu === 34 || cu === 60 || cu === 62 || cu === 127 || cu === 160;
}

/**
 * Pure O(n) page-1 DOI scanner (`03` §5.4):
 * matches `10.` + 4–9 `DIGIT` + `/` + 1–300 chars not `{SPACE, '"', '<', '>'}`,
 * strips trailing `.`, `,`, `;`, `)`, and validates with `isValidDoi`.
 */
export function scanPage1Doi(page1Text: string): string | null {
  const n = page1Text.length;
  let pos = 0;
  while (pos < n) {
    const idx = page1Text.indexOf("10.", pos);
    if (idx === -1) return null;
    if (idx > 0 && isAsciiDigitCode(page1Text.charCodeAt(idx - 1))) {
      pos = idx + 3;
      continue;
    }

    let slashPos = idx + 3;
    let regDigits = 0;
    while (slashPos < n && isAsciiDigitCode(page1Text.charCodeAt(slashPos)) && regDigits <= 9) {
      regDigits += 1;
      slashPos += 1;
    }
    if (regDigits < 4 || regDigits > 9 || slashPos >= n || page1Text.charCodeAt(slashPos) !== 47 /* '/' */) {
      pos = idx + 3;
      continue;
    }

    const sufStart = slashPos + 1;
    let sufEnd = sufStart;
    while (sufEnd < n && sufEnd - sufStart < 300) {
      const cu = page1Text.charCodeAt(sufEnd);
      if (isDisallowedPage1DoiChar(cu)) break;
      sufEnd += 1;
    }
    let cand = page1Text.slice(idx, sufEnd);
    while (cand.length > sufStart - idx) {
      const tail = cand.charAt(cand.length - 1);
      if (tail === "." || tail === "," || tail === ";" || tail === ")") {
        cand = cand.slice(0, cand.length - 1);
      } else {
        break;
      }
    }
    if (isValidDoi(cand)) {
      return cand;
    }
    pos = idx + 3;
  }
  return null;
}

function asciiLower(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    out += cu >= 65 && cu <= 90 ? String.fromCharCode(cu + 32) : text.charAt(i);
  }
  return out;
}

/**
 * Pure page-1 arXiv identifier scanner (`arXiv:DDDD.DDDDD(vN)?` or `arXiv:archive/DDDDDDD(vN)?`).
 */
export function scanPage1ArxivId(page1Text: string): string | null {
  const lower = asciiLower(page1Text);
  let pos = 0;
  while (pos < lower.length) {
    const idx = lower.indexOf("arxiv:", pos);
    if (idx === -1) return null;
    let start = idx + 6;
    while (start < page1Text.length && page1Text.charCodeAt(start) === 32) start += 1;
    let end = start;
    while (end < page1Text.length) {
      const cu = page1Text.charCodeAt(end);
      if (isDisallowedPage1DoiChar(cu) || cu === 41 || cu === 93 || cu === 44 || cu === 59) {
        break;
      }
      end += 1;
    }
    let cand = page1Text.slice(start, end);
    if (cand.endsWith(".")) cand = cand.slice(0, cand.length - 1);
    if (isValidArxivId(cand)) return cand;
    pos = idx + 6;
  }
  return null;
}

export function matchPdfToReference(
  page1Doi: string | null,
  bibliography: readonly { readonly refId: string; readonly doi: string | null }[],
): string | null {
  if (page1Doi === null) return null;
  const target = normLower(page1Doi);
  for (const entry of bibliography) {
    if (entry.doi !== null && normLower(entry.doi) === target) {
      return entry.refId;
    }
  }
  return null;
}

/**
 * End-to-end pure User PDF chunking + page-1 DOI matching + `evidenceVersion` calculation (`03` §5.4).
 */
export function ingestUserPdf(input: IngestUserPdfInput): IngestUserPdfResult {
  const initialRefId = input.refId ?? "user_pdf";
  let pdf = chunkPdfPages(initialRefId, input.pages, {
    ...(input.chunkOptions ?? {}),
    sourceKind: "USER_PDF",
  });
  const page1Text = pdf.pageTexts[0] ?? "";
  const page1Doi = scanPage1Doi(page1Text);
  const page1ArxivId = scanPage1ArxivId(page1Text);
  const matchedRefId =
    input.bibliography !== undefined ? matchPdfToReference(page1Doi, input.bibliography) : null;
  if (input.refId === undefined && matchedRefId !== null && matchedRefId !== initialRefId) {
    pdf = chunkPdfPages(matchedRefId, input.pages, {
      ...(input.chunkOptions ?? {}),
      sourceKind: "USER_PDF",
    });
  }
  const evidenceVersion = computeEvidenceVersion(pdf.units.map((u) => u.chunkId));

  return {
    pdf,
    page1Doi,
    page1ArxivId,
    matchedRefId,
    evidenceVersion,
  };
}
