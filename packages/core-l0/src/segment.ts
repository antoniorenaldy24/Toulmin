/**
 * Rule-based deterministic sentence segmentation and Stage 1 eligibility
 * (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §4, `01` §3.1 `claimId`/`occurrenceIndex`).
 *
 * Strictly zero platform segmenters (`Intl.Segmenter`), zero regular expressions,
 * zero `.toLowerCase()`, and zero `.normalize()`.
 */

import {
  extractWordSpans,
  getWordSpanStats,
  scanCitations,
  type CitationMarker,
  type ScanCitationsOptions,
} from "./citations.js";
import { normSentence, type TextRangeLike } from "./latex.js";
import { preMask, type PreMaskResult, type SourceFormat } from "./mask.js";
import {
  codePointAtSafe,
  isDigit,
  isLetter,
  isLower,
  isPunctSent,
  isCloser,
  isSpace,
  isUpper,
  norm,
  normLower,
  sha256hex,
} from "./norm.js";
import type { CanonicalSectionLabel, ImportQualityReport, SectionState } from "./sections.js";

export const CLASS_N_ABBREVS: ReadonlySet<string> = new Set([
  "e.g.",
  "i.e.",
  "cf.",
  "vs.",
  "viz.",
  "fig.",
  "figs.",
  "eq.",
  "eqs.",
  "ref.",
  "refs.",
  "no.",
  "nos.",
  "vol.",
  "vols.",
  "pp.",
  "p.",
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "st.",
  "jr.",
  "sr.",
  "dept.",
  "univ.",
  "ch.",
  "tab.",
  "suppl.",
  "ca.",
  "approx.",
  "n.b.",
  "op.",
  "ed.",
  "eds.",
]);

export const CLASS_T_ABBREVS: ReadonlySet<string> = new Set([
  "etc.",
  "al.",
  "min.",
  "max.",
  "avg.",
  "std.",
  "resp.",
  "inc.",
  "ltd.",
  "co.",
  "corp.",
  "a.m.",
  "p.m.",
  "u.s.",
  "u.k.",
  "e.u.",
  "sec.",
  "i.v.",
  "i.p.",
  "s.c.",
  "p.o.",
  "b.i.d.",
  "t.i.d.",
  "q.d.",
]);

export const INITIAL_TERMINAL_PRECEDERS: ReadonlySet<string> = new Set([
  "group",
  "groups",
  "vitamin",
  "type",
  "phase",
  "class",
  "stage",
  "grade",
  "arm",
  "cohort",
  "panel",
  "figure",
  "table",
  "appendix",
  "part",
  "section",
  "condition",
  "site",
  "strain",
  "model",
  "protocol",
  "hepatitis",
  "factor",
  "version",
  "plan",
  "schedule",
  "block",
  "ward",
  "zone",
  "level",
]);

export interface SegmentedSentence {
  readonly start: number;
  readonly end: number;
  readonly rawText: string;
  readonly maskedText: string;
  readonly markers: readonly CitationMarker[];
  readonly section: CanonicalSectionLabel;
  readonly subsection: string | null;
  readonly normText: string;
  readonly sentenceHash: string;
  readonly occurrenceIndex: number;
  readonly eligible: boolean;
  readonly wordCount: number;
}

export interface SegmentOptions {
  readonly frontMatterMath?: boolean;
  readonly preMaskResult?: PreMaskResult;
  readonly citationOptions?: Omit<ScanCitationsOptions, "customCiteMacros">;
  readonly customCiteMacros?: ReadonlySet<string>;
  readonly report?: ImportQualityReport;
}

export interface SegmentDocumentResult {
  readonly sentences: readonly SegmentedSentence[];
  readonly preMaskResult: PreMaskResult;
  readonly allMarkers: readonly CitationMarker[];
  readonly report: ImportQualityReport;
}

function isMaskCode(code: number): boolean {
  return code === 0xe000;
}

function isHorizontalSpaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

function isOpeningDelimiterChar(cp: number): boolean {
  return (
    cp === 0x28 || // '('
    cp === 0x5b || // '['
    cp === 0x7b || // '{'
    cp === 0x22 || // '"'
    cp === 0x27 || // '\''
    cp === 0x201c || // '“'
    cp === 0x2018 // '‘'
  );
}

function stripLeadingOpenDelimiters(token: string): string {
  let i = 0;
  while (i < token.length) {
    const unit = codePointAtSafe(token, i);
    if (unit.isUnpairedSurrogate || !isOpeningDelimiterChar(unit.cp)) {
      break;
    }
    i += unit.len;
  }
  return token.slice(i);
}

function countLettersInString(s: string): number {
  let count = 0;
  let i = 0;
  let prevIsLetter = false;
  while (i < s.length) {
    const unit = codePointAtSafe(s, i);
    if (!unit.isUnpairedSurrogate && isLetter(unit.cp, prevIsLetter)) {
      count++;
      prevIsLetter = true;
    } else {
      prevIsLetter = false;
    }
    i += unit.len;
  }
  return count;
}

/**
 * Checks whether a single token before `.` is strictly one `UPPER` letter
 * (plus any attached Mn/Mc combining marks) followed immediately by `.`.
 */
function isSingleUpperInitialWithDot(cleanToken: string): boolean {
  if (!cleanToken.endsWith(".") || cleanToken.length < 2) return false;
  const body = cleanToken.slice(0, -1);
  const first = codePointAtSafe(body, 0);
  if (first.isUnpairedSurrogate || !isUpper(first.cp)) return false;
  let pos = first.len;
  while (pos < body.length) {
    const next = codePointAtSafe(body, pos);
    if (next.isUnpairedSurrogate || !isLetter(next.cp, true) || isUpper(next.cp) || isLower(next.cp)) {
      return false;
    }
    // Note: isLetter(cp, true) with !isUpper && !isLower matches only Mn/Mc combining marks cleanly,
    // wait — Lo/Lm letters also satisfy !isUpper && !isLower, so verify general category isn't a second base letter:
    if (isLetter(next.cp, false)) {
      return false;
    }
    pos += next.len;
  }
  return pos === body.length;
}

/**
 * Checks `02` §4.4 Rule 4 lowercase continuation exceptions:
 * - `LOWER{1,3}` + `UPPER` (`mRNA`, `siRNA`, `iPSC`, `pH`)
 * - `LOWER{1,3}` + `DIGIT` (`p53`, `t1`)
 * - `LOWER{1,2}` + `-` + (`LETTER` | `DIGIT`) (`t-test`, `p-value`, `n-3`)
 */
function matchesLowercaseBoundaryException(wordText: string): boolean {
  let pos = 0;
  let lowerCount = 0;
  while (pos < wordText.length && lowerCount < 4) {
    const unit = codePointAtSafe(wordText, pos);
    if (unit.isUnpairedSurrogate) return false;
    if (isLower(unit.cp)) {
      lowerCount++;
      pos += unit.len;
      continue;
    }
    if (isLetter(unit.cp, true) && !isLetter(unit.cp, false) && lowerCount > 0) {
      // Trailing combining mark stays attached to preceding LOWER letter
      pos += unit.len;
      continue;
    }
    break;
  }

  if (lowerCount < 1 || lowerCount > 3 || pos >= wordText.length) {
    return false;
  }

  const unitAfter = codePointAtSafe(wordText, pos);
  if (unitAfter.isUnpairedSurrogate) return false;

  if (isUpper(unitAfter.cp) || isDigit(unitAfter.cp)) {
    return true;
  }

  if (lowerCount <= 2 && unitAfter.cp === 0x2d && pos + 1 < wordText.length) {
    const unitPastHyphen = codePointAtSafe(wordText, pos + 1);
    if (
      !unitPastHyphen.isUnpairedSurrogate &&
      (isLetter(unitPastHyphen.cp, false) || isDigit(unitPastHyphen.cp))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks `02` §4.4 Rule 5 inline numbered list: next token is `DIGIT{1,2}` followed by `)`.
 */
function isInlineNumberedListTokenAt(text: string, pos: number, limit: number): boolean {
  let d = 0;
  while (pos + d < limit && d < 3 && isDigit(text.charCodeAt(pos + d))) {
    d++;
  }
  return (d === 1 || d === 2) && pos + d < limit && text.charCodeAt(pos + d) === 0x29;
}

function isCompletelyEnclosedInQuotes(trimmed: string): boolean {
  const n = trimmed.length;
  if (n < 2) return false;
  const first = trimmed.charCodeAt(0);
  const last = trimmed.charCodeAt(n - 1);

  if (first === 0x22 && last === 0x22) {
    for (let i = 1; i < n - 1; i++) {
      if (trimmed.charCodeAt(i) === 0x22) return false;
    }
    return true;
  }
  if (first === 0x27 && last === 0x27) {
    for (let i = 1; i < n - 1; i++) {
      if (trimmed.charCodeAt(i) === 0x27) return false;
    }
    return true;
  }
  if (first === 0x201c && last === 0x201d) {
    let depth = 0;
    for (let i = 0; i < n - 1; i++) {
      const ch = trimmed.charCodeAt(i);
      if (ch === 0x201c) depth++;
      else if (ch === 0x201d) {
        depth--;
        if (depth <= 0) return false;
      }
    }
    return depth === 1;
  }
  if (first === 0x2018 && last === 0x2019) {
    let depth = 0;
    for (let i = 0; i < n - 1; i++) {
      const ch = trimmed.charCodeAt(i);
      if (ch === 0x2018) depth++;
      else if (ch === 0x2019) {
        depth--;
        if (depth <= 0) return false;
      }
    }
    return depth === 1;
  }
  return false;
}

/**
 * Evaluates Stage 1 eligibility rules (`02` §4.6):
 * 1) >= 6 words (excluding masks & citation markers);
 * 2) not fully masked;
 * 3) at least one word with >= 3 LETTER code points;
 * 4) not under section `references`;
 * 5) not entirely enclosed in quotation marks.
 */
export function checkStage1Eligibility(
  rawText: string,
  maskedText: string,
  markers: readonly CitationMarker[],
  section: CanonicalSectionLabel,
  sentenceStartInWorkingCopy: number = 0,
): { readonly eligible: boolean; readonly wordCount: number } {
  const relativeExclusions: TextRangeLike[] = [];
  for (let mIdx = 0; mIdx < markers.length; mIdx++) {
    const m = markers[mIdx]!;
    relativeExclusions.push({
      start: m.start - sentenceStartInWorkingCopy,
      end: m.end - sentenceStartInWorkingCopy,
    });
  }
  const { wordCount, hasLongWord } = getWordSpanStats(
    maskedText,
    0,
    maskedText.length,
    relativeExclusions,
  );

  let hasNonMaskNonSpace = false;
  for (let i = 0; i < maskedText.length; i++) {
    const ch = maskedText.charCodeAt(i);
    if (!isSpace(ch) && !isMaskCode(ch)) {
      hasNonMaskNonSpace = true;
      break;
    }
  }

  let trimLeft = 0;
  while (trimLeft < rawText.length && isSpace(rawText.charCodeAt(trimLeft))) trimLeft++;
  let trimRight = rawText.length;
  while (trimRight > trimLeft && isSpace(rawText.charCodeAt(trimRight - 1))) trimRight--;
  const trimmedRaw = rawText.slice(trimLeft, trimRight);

  const eligible =
    wordCount >= 6 &&
    hasNonMaskNonSpace &&
    hasLongWord &&
    section !== "references" &&
    !isCompletelyEnclosedInQuotes(trimmedRaw);

  return { eligible, wordCount };
}

interface HardSegmentRange {
  readonly start: number;
  readonly end: number;
}

function collectMdListMarkerPrefixLen(text: string, lineStart: number, lineEnd: number): number {
  let sp = 0;
  while (lineStart + sp < lineEnd && isHorizontalSpaceCode(text.charCodeAt(lineStart + sp))) {
    sp++;
  }
  const p = lineStart + sp;
  if (p + 1 < lineEnd) {
    const ch = text.charCodeAt(p);
    if ((ch === 45 || ch === 42 || ch === 43) && text.charCodeAt(p + 1) === 32) {
      return p + 2 - lineStart;
    }
  }
  if (p < lineEnd && isDigit(text.charCodeAt(p))) {
    let d = 0;
    while (p + d < lineEnd && d < 4 && isDigit(text.charCodeAt(p + d))) {
      d++;
    }
    if (
      d >= 1 &&
      d <= 3 &&
      p + d + 1 < lineEnd &&
      text.charCodeAt(p + d) === 46 &&
      text.charCodeAt(p + d + 1) === 32
    ) {
      return p + d + 2 - lineStart;
    }
  }
  return 0;
}

function buildProseHardRanges(
  maskedText: string,
  format: SourceFormat,
  preMaskRes: PreMaskResult,
): readonly HardSegmentRange[] {
  const n = maskedText.length;
  // Sort and merge blockRegions + listItemStarts
  const blocked = [...preMaskRes.blockRegions].sort((a, b) => a.start - b.start);
  const blockMask = new Uint8Array(n);
  for (const r of blocked) {
    const s = Math.max(0, r.start);
    const e = Math.min(n, r.end);
    for (let k = s; k < e; k++) {
      blockMask[k] = 1;
    }
  }

  const cutSet = new Set<number>();
  for (const itemStart of preMaskRes.listItemStarts) {
    if (itemStart >= 0 && itemStart < n) {
      cutSet.add(itemStart);
    }
  }

  const ranges: HardSegmentRange[] = [];
  let cursor = 0;

  while (cursor < n) {
    if (blockMask[cursor] === 1) {
      cursor++;
      continue;
    }
    const segStart = cursor;
    let pos = cursor;

    while (pos < n && blockMask[pos] === 0) {
      if (pos > segStart && cutSet.has(pos)) {
        break;
      }
      const ch = maskedText.charCodeAt(pos);
      if (ch === 10 || ch === 13) {
        // Check paragraph break (`\n[ \t]*\n`) or Markdown list item on next line
        const afterFirstNl =
          ch === 13 && pos + 1 < n && maskedText.charCodeAt(pos + 1) === 10 ? pos + 2 : pos + 1;
        let look = afterFirstNl;
        while (look < n && blockMask[look] === 0 && isHorizontalSpaceCode(maskedText.charCodeAt(look))) {
          look++;
        }
        if (
          look < n &&
          blockMask[look] === 0 &&
          (maskedText.charCodeAt(look) === 10 || maskedText.charCodeAt(look) === 13)
        ) {
          break;
        }
        if (format === "md" && afterFirstNl < n && blockMask[afterFirstNl] === 0) {
          let lineEnd = afterFirstNl;
          while (
            lineEnd < n &&
            blockMask[lineEnd] === 0 &&
            maskedText.charCodeAt(lineEnd) !== 10 &&
            maskedText.charCodeAt(lineEnd) !== 13
          ) {
            lineEnd++;
          }
          if (collectMdListMarkerPrefixLen(maskedText, afterFirstNl, lineEnd) > 0) {
            ranges.push({ start: segStart, end: pos });
            cursor = afterFirstNl;
            pos = -1;
            break;
          }
        }
      }
      pos++;
    }

    if (pos === -1) {
      continue;
    }

    if (pos > segStart) {
      ranges.push({ start: segStart, end: pos });
    }
    cursor = pos;
    while (cursor < n && blockMask[cursor] === 0) {
      const c = maskedText.charCodeAt(cursor);
      if (isSpace(c) && (c === 10 || c === 13 || cursor > pos)) {
        cursor++;
      } else {
        break;
      }
    }
    if (cursor === pos && cutSet.has(pos)) {
      // Advance past cut point so next loop picks up cleanly after `\item[...]` mask
      while (cursor < n && blockMask[cursor] === 1) cursor++;
    }
  }

  return ranges;
}

function getSectionAtOffset(
  transitions: PreMaskResult["sectionTransitions"],
  offset: number,
): SectionState {
  let state: SectionState = { label: "unlabeled", subsection: null };
  for (const tr of transitions) {
    if (tr.offset <= offset) {
      state = tr.state;
    } else {
      break;
    }
  }
  return state;
}

/**
 * Segments `source` into ordered sentences using `02` §4 rules, attaches scanned
 * citation markers (`§5`), maps hierarchical section state (`§3.4`), computes
 * `sentenceHash`, `occurrenceIndex`, and Stage 1 eligibility (`§4.6`).
 */
export function segmentDocument(
  source: string,
  format: SourceFormat,
  options?: SegmentOptions,
): SegmentDocumentResult {
  const useDirectSource = options?.preMaskResult !== undefined;
  const normRes = useDirectSource ? null : norm(source);
  const workSource = normRes !== null ? normRes.text : source;

  const preMaskRes =
    options?.preMaskResult ??
    preMask(workSource, format, {
      ...(options?.frontMatterMath !== undefined ? { frontMatterMath: options.frontMatterMath } : {}),
      ...(options?.report !== undefined ? { report: options.report } : {}),
    });

  const masked = preMaskRes.maskedText;
  const n = masked.length;

  const allMarkers = scanCitations(masked, {
    ...options?.citationOptions,
    customCiteMacros: options?.customCiteMacros ?? preMaskRes.customCiteMacros,
  });

  // Build marker lookup sorted by `start`
  const markerByStart = new Map<number, CitationMarker>();
  for (const m of allMarkers) {
    markerByStart.set(m.start, m);
  }
  const insideMarkerMask = new Uint8Array(n);
  for (const m of allMarkers) {
    const s = Math.max(0, m.start);
    const e = Math.min(n, m.end);
    for (let k = s; k < e; k++) {
      insideMarkerMask[k] = 1;
    }
  }

  const hardRanges = buildProseHardRanges(masked, format, preMaskRes);
  const sentences: SegmentedSentence[] = [];
  const hashCounts = new Map<string, number>();

  const emitSentenceSpan = (segStart: number, segEnd: number): void => {
    let s = segStart;
    while (s < segEnd) {
      const ch = masked.charCodeAt(s);
      if (isSpace(ch) || isMaskCode(ch)) {
        s++;
      } else {
        break;
      }
    }
    let e = segEnd;
    while (e > s) {
      const ch = masked.charCodeAt(e - 1);
      if (isSpace(ch) || isMaskCode(ch)) {
        e--;
      } else {
        break;
      }
    }
    if (s >= e) return;

    const workMaskedSlice = masked.slice(s, e);
    const workRawSlice = workSource.slice(s, e);
    const rawStart = normRes !== null ? (normRes.map[s] ?? s) : s;
    const rawEnd = normRes !== null ? (normRes.map[e] ?? e) : e;
    const rawTextSlice = source.slice(rawStart, rawEnd);

    const sentMarkers: CitationMarker[] = [];
    for (const m of allMarkers) {
      if (m.start >= s && m.end <= e) {
        sentMarkers.push({
          ...m,
          start: m.start - s,
          end: m.end - s,
        });
      }
    }

    const secState = getSectionAtOffset(preMaskRes.sectionTransitions, s);

    // Filter preMask mathRegions / non-math maskedRegions relative to this sentence slice
    const relMath: { start: number; end: number; text: string }[] = [];
    for (const mr of preMaskRes.mathRegions) {
      if (mr.start >= s && mr.end <= e) {
        relMath.push({ start: mr.start - s, end: mr.end - s, text: mr.text });
      }
    }
    const relMasked: TextRangeLike[] = [];
    for (const r of preMaskRes.regions) {
      if (r.kind !== "inline_math" && r.kind !== "display_math" && r.end > s && r.start < e) {
        relMasked.push({
          start: Math.max(0, r.start - s),
          end: Math.min(e - s, r.end - s),
        });
      }
    }

    const normText = normSentence(workRawSlice, {
      format,
      markerRanges: sentMarkers,
      mathRegions: relMath,
      maskedRegions: relMasked,
      userMacros: preMaskRes.userMacros,
      customCiteMacros: preMaskRes.customCiteMacros,
    });
    const hash = sha256hex(normText);
    const prevOcc = hashCounts.get(hash) ?? 0;
    hashCounts.set(hash, prevOcc + 1);

    const { eligible, wordCount } = checkStage1Eligibility(
      workRawSlice,
      workMaskedSlice,
      sentMarkers,
      secState.label,
      0,
    );

    sentences.push({
      start: rawStart,
      end: rawEnd,
      rawText: rawTextSlice,
      maskedText: workMaskedSlice,
      markers: sentMarkers,
      section: secState.label,
      subsection: secState.subsection,
      normText,
      sentenceHash: hash,
      occurrenceIndex: prevOcc,
      eligible,
      wordCount,
    });
  };

  for (const hr of hardRanges) {
    let sentStart = hr.start;
    let i = hr.start;

    // Skip Markdown list prefix period (`1. `, etc.) from acting as a sentence-end candidate
    let mdListDotSkip = -1;
    if (format === "md") {
      let lineEnd = hr.start;
      while (lineEnd < hr.end && masked.charCodeAt(lineEnd) !== 10 && masked.charCodeAt(lineEnd) !== 13) {
        lineEnd++;
      }
      const pLen = collectMdListMarkerPrefixLen(masked, hr.start, lineEnd);
      if (pLen >= 3 && masked.charCodeAt(hr.start + pLen - 2) === 46) {
        mdListDotSkip = hr.start + pLen - 2;
      }
    }

    while (i < hr.end) {
      const cu = masked.charCodeAt(i);
      if (
        isMaskCode(cu) ||
        insideMarkerMask[i] === 1 ||
        i === mdListDotSkip ||
        !isPunctSent(cu)
      ) {
        i++;
        continue;
      }

      // Advance boundary `b` over closers -> attached markers -> closers (§4.2)
      let b = i + 1;
      while (b < hr.end && isCloser(masked.charCodeAt(b))) {
        b++;
      }
      while (b < hr.end) {
        const att = markerByStart.get(b);
        if (att !== undefined && att.end <= hr.end) {
          b = att.end;
          continue;
        }
        break;
      }
      while (b < hr.end && isCloser(masked.charCodeAt(b))) {
        b++;
      }

      // Candidate valid only if followed by SPACE, end of hard range/text, or start of mask
      const isValidFollower =
        b >= hr.end ||
        isSpace(masked.charCodeAt(b)) ||
        isMaskCode(masked.charCodeAt(b));
      if (!isValidFollower) {
        i++;
        continue;
      }

      // Find next item & next word after boundary (skipping spaces, masks, spaced numeric/docx markers, opening delims)
      let afterSpace = b;
      while (afterSpace < hr.end && (isSpace(masked.charCodeAt(afterSpace)) || isMaskCode(masked.charCodeAt(afterSpace)))) {
        afterSpace++;
      }

      let look = afterSpace;
      let spacedCitationEnd = -1;
      if (b < hr.end && isSpace(masked.charCodeAt(b))) {
        const spacedMarker = markerByStart.get(look);
        if (
          spacedMarker !== undefined &&
          spacedMarker.end <= hr.end &&
          (spacedMarker.rule === "numeric_bracket" || spacedMarker.rule === "docx_superscript")
        ) {
          spacedCitationEnd = spacedMarker.end;
          look = spacedMarker.end;
          while (look < hr.end && (isSpace(masked.charCodeAt(look)) || isMaskCode(masked.charCodeAt(look)))) {
            look++;
          }
        }
      }

      // Apply rejection rules 1–5 (§4.3–§4.4)
      let rejected = false;

      // Determine next word after `look` (for Class T, Rule 2 exception, Rule 4)
      const nextWordList = extractWordSpans(masked, look, Math.min(hr.end, look + 160));
      const nextWord = nextWordList[0];

      if (cu === 46) {
        // Rule 3: decimal (`DIGIT '.' DIGIT`)
        if (
          i > hr.start &&
          i + 1 < hr.end &&
          isDigit(masked.charCodeAt(i - 1)) &&
          isDigit(masked.charCodeAt(i + 1))
        ) {
          rejected = true;
        }

        if (!rejected) {
          // Lowercased token ending at `i`, including `.`
          let tokStart = i;
          while (tokStart > sentStart) {
            const cPrev = masked.charCodeAt(tokStart - 1);
            if (isSpace(cPrev) || isMaskCode(cPrev) || insideMarkerMask[tokStart - 1] === 1) {
              break;
            }
            tokStart--;
          }
          const rawTok = masked.slice(tokStart, i + 1);
          const cleanTok = stripLeadingOpenDelimiters(rawTok);
          const cleanLower = normLower(cleanTok);

          // Rule 1a: Class N
          if (CLASS_N_ABBREVS.has(cleanLower)) {
            rejected = true;
          }

          // Rule 1b: Class T
          if (!rejected && CLASS_T_ABBREVS.has(cleanLower)) {
            if (nextWord === undefined) {
              rejected = false;
            } else {
              const nwFirst = codePointAtSafe(nextWord.text, 0);
              const nwLetters = countLettersInString(nextWord.text);
              const nwFollowedByDot =
                nwLetters === 1 &&
                nextWord.end < hr.end &&
                masked.charCodeAt(nextWord.end) === 46;
              if (
                nwFirst.isUnpairedSurrogate ||
                !isUpper(nwFirst.cp) ||
                nwLetters < 2 ||
                nwFollowedByDot
              ) {
                rejected = true;
              }
            }
          }

          // Rule 2: Single uppercase initial + `.`
          if (!rejected && isSingleUpperInitialWithDot(cleanTok)) {
            const cleanTokOffset = tokStart + (rawTok.length - cleanTok.length);
            const prevWords = extractWordSpans(masked, sentStart, cleanTokOffset);
            const prevW = prevWords.length > 0 ? prevWords[prevWords.length - 1] : undefined;
            const prevLower = prevW !== undefined ? normLower(prevW.text) : "";
            const hasValidPreceder = INITIAL_TERMINAL_PRECEDERS.has(prevLower);
            let hasValidNext = false;
            if (nextWord !== undefined) {
              const nwFirst = codePointAtSafe(nextWord.text, 0);
              hasValidNext =
                !nwFirst.isUnpairedSurrogate &&
                isUpper(nwFirst.cp) &&
                countLettersInString(nextWord.text) >= 2;
            }
            if (!(hasValidPreceder && hasValidNext)) {
              rejected = true;
            }
          }
        }
      }

      // Rule 4: Lowercase continuation (applies to any PUNCT_SENT `.`, `?`, `!`)
      if (!rejected && nextWord !== undefined) {
        const nwFirst = codePointAtSafe(nextWord.text, 0);
        if (!nwFirst.isUnpairedSurrogate && isLower(nwFirst.cp)) {
          if (!matchesLowercaseBoundaryException(nextWord.text)) {
            rejected = true;
          }
        }
      }

      // Rule 5: Inline numbered list (`DIGIT{1,2})` immediately after boundary)
      if (!rejected && isInlineNumberedListTokenAt(masked, look, hr.end)) {
        rejected = true;
      }

      if (rejected) {
        i = b;
        continue;
      }

      const finalBoundary = spacedCitationEnd !== -1 ? spacedCitationEnd : b;
      emitSentenceSpan(sentStart, finalBoundary);
      sentStart = finalBoundary;
      i = finalBoundary;
    }

    if (sentStart < hr.end) {
      emitSentenceSpan(sentStart, hr.end);
    }
  }

  return {
    sentences,
    preMaskResult: preMaskRes,
    allMarkers,
    report: preMaskRes.report,
  };
}

/**
 * Computes `claimId` (`01` §3.1): first 32 lowercase hex characters of
 * `sha256hex(docId + "|" + sentenceHash + "|" + occurrenceIndex + "|" + clauseIndex)`.
 */
export function computeClaimId(
  docId: string,
  sentenceHash: string,
  occurrenceIndex: number,
  clauseIndex: number,
): string {
  return sha256hex(`${docId}|${sentenceHash}|${occurrenceIndex}|${clauseIndex}`).slice(0, 32);
}
