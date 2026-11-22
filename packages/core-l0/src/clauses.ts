/**
 * Non-overlapping clause partitioner and claim-text builder
 * (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §6).
 *
 * Pure TypeScript using character-code scanning and UTF-16 slot tracking:
 * zero regular expressions, zero `.toLowerCase()`, zero `.normalize()`.
 */

import { countWords, extractWordSpans, type CitationMarker } from "./citations.js";
import type { TextRangeLike } from "./latex.js";
import { codePointAtSafe, isDigit, isLetter, isSpace, normLowerWithMap } from "./norm.js";

export const STRONG_BOUNDARIES: readonly string[] = [
  ";",
  ", but ",
  ", whereas ",
  ", while ",
  ", although ",
  ", though ",
  ", however, ",
  ", yet ",
  " but ",
  " whereas ",
];

export const RELATIVIZERS: ReadonlySet<string> = new Set([
  "which",
  "who",
  "whom",
  "whose",
  "that",
  "as",
  "where",
  "when",
]);

export const INNER_SPLITS: readonly string[] = [
  ", and ",
  ", but ",
  ", while ",
  ", whereas ",
  ", although ",
  " and ",
];

export const REPORTING_FRAMES: readonly string[] = [
  "as demonstrated by",
  "as described by",
  "as described in",
  "as reported by",
  "as reported in",
  "as shown by",
  "as shown in",
  "according to",
  "as found by",
  "as noted by",
  "see",
  "in",
];

export const LEADING_FRAMES: readonly string[] = [
  "previous studies have shown that",
  "in line with previous studies",
  "consistent with previous work",
  "consistent with prior work",
  "it has been reported that",
  "as described previously",
  "as previously reported",
  "as described elsewhere",
  "it has been shown that",
  "as reported previously",
  "as previously shown",
  "as shown previously",
  "as shown before",
];

export const LEAD_CONNECTORS: readonly string[] = [
  "furthermore",
  "in addition",
  "additionally",
  "therefore",
  "although",
  "moreover",
  "whereas",
  "however",
  "though",
  "while",
  "which",
  "thus",
  "also",
  "that",
  "with",
  "and",
  "but",
  "yet",
  "as",
];

// Longest-first order so multi-char connectors match before shorter ones; includes approved "however".
export const TRAIL_CONNECTORS: readonly string[] = [
  "although",
  "whereas",
  "however",
  "though",
  "while",
  "and",
  "but",
  "yet",
  "or",
];

export interface MarkerGroup {
  readonly start: number;
  readonly end: number;
  readonly markers: readonly CitationMarker[];
  readonly narrative: boolean;
}

export interface ClauseSplitTrace {
  readonly betweenStart: number;
  readonly betweenEnd: number;
  readonly betweenWordCount: number;
  readonly didSplit: boolean;
  readonly relativizerMatched: string | null;
  readonly splitOffset: number | null;
}

export interface PartitionedClause {
  readonly clauseIndex: number;
  readonly claimText: string;
  readonly span: TextRangeLike;
  readonly range: TextRangeLike;
  readonly groups: readonly MarkerGroup[];
  readonly markers: readonly CitationMarker[];
  readonly uncited: boolean;
}

export interface PartitionClausesWithTraceResult {
  readonly groups: readonly MarkerGroup[];
  readonly clauses: readonly PartitionedClause[];
  readonly splitTraces: readonly ClauseSplitTrace[];
}

function isGapOnlyGroupSeparators(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const ch = text.charCodeAt(i);
    if (!isSpace(ch) && ch !== 44 && ch !== 59) {
      return false;
    }
  }
  return true;
}

/**
 * Groups adjacent citation markers separated only by `SPACE`, `,` or `;` (`02` §6.1).
 * A group is `narrative` iff its first marker is `narrative`.
 */
export function groupMarkers(
  sentenceText: string,
  markers: readonly CitationMarker[],
): MarkerGroup[] {
  if (markers.length === 0) return [];
  const sorted = [...markers].sort((a, b) => a.start - b.start);
  const groups: MarkerGroup[] = [];

  let currentMarkers: CitationMarker[] = [sorted[0]!];
  let gStart = sorted[0]!.start;
  let gEnd = sorted[0]!.end;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (next.start >= gEnd && isGapOnlyGroupSeparators(sentenceText, gEnd, next.start)) {
      currentMarkers.push(next);
      gEnd = next.end;
    } else {
      groups.push({
        start: gStart,
        end: gEnd,
        markers: currentMarkers,
        narrative: currentMarkers[0]!.narrative,
      });
      currentMarkers = [next];
      gStart = next.start;
      gEnd = next.end;
    }
  }

  groups.push({
    start: gStart,
    end: gEnd,
    markers: currentMarkers,
    narrative: currentMarkers[0]!.narrative,
  });
  return groups;
}

interface SearchView {
  readonly searchStr: string;
  readonly origStartMap: readonly number[];
}

function buildSearchView(input: string): SearchView {
  const lowered = normLowerWithMap(input);
  const txt = lowered.text;
  let hasNonAsciiSpace = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt.charCodeAt(i);
    if (ch === 9 || ch === 10 || ch === 13) {
      hasNonAsciiSpace = true;
      break;
    }
  }

  if (!hasNonAsciiSpace) {
    return {
      searchStr: txt,
      origStartMap: lowered.map,
    };
  }

  const chars: string[] = [];
  for (let i = 0; i < txt.length; i++) {
    const ch = txt.charCodeAt(i);
    chars.push(isSpace(ch) ? " " : txt.charAt(i));
  }
  return {
    searchStr: chars.join(""),
    origStartMap: lowered.map,
  };
}

function buildProtectedMask(sentenceText: string, groups: readonly MarkerGroup[]): Uint8Array {
  const n = sentenceText.length;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (sentenceText.charCodeAt(i) === 0xe000) {
      mask[i] = 1;
    }
  }
  for (const g of groups) {
    const s = Math.max(0, g.start);
    const e = Math.min(n, g.end);
    for (let k = s; k < e; k++) {
      mask[k] = 1;
    }
  }
  return mask;
}

function isRangeOutsideProtectedMask(
  protectedMask: Uint8Array,
  rawStart: number,
  rawEnd: number,
): boolean {
  for (let i = rawStart; i < rawEnd; i++) {
    if (protectedMask[i] === 1) {
      return false;
    }
  }
  return true;
}

function isWordBoundaryInStr(s: string, index: number, isStart: boolean): boolean {
  if (isStart) {
    if (index <= 0) return true;
    const prev = codePointAtSafe(s, index - 1);
    return prev.isUnpairedSurrogate || (!isLetter(prev.cp, false) && !isDigit(prev.cp));
  }
  if (index >= s.length) return true;
  const next = codePointAtSafe(s, index);
  return next.isUnpairedSurrogate || (!isLetter(next.cp, false) && !isDigit(next.cp));
}

function findNextWholePhrase(haystack: string, phrase: string, from: number): number {
  let pos = Math.max(0, from);
  while (pos + phrase.length <= haystack.length) {
    const idx = haystack.indexOf(phrase, pos);
    if (idx === -1) return -1;
    if (
      isWordBoundaryInStr(haystack, idx, true) &&
      isWordBoundaryInStr(haystack, idx + phrase.length, false)
    ) {
      return idx;
    }
    pos = idx + 1;
  }
  return -1;
}

function splitAtStrongBoundaries(
  sentenceText: string,
  groups: readonly MarkerGroup[],
): TextRangeLike[] {
  const n = sentenceText.length;
  if (n === 0) return [];
  const protectedMask = buildProtectedMask(sentenceText, groups);
  const view = buildSearchView(sentenceText);
  const s = view.searchStr;
  const spans: TextRangeLike[] = [];

  const nextHit = new Int32Array(STRONG_BOUNDARIES.length);
  nextHit.fill(-2);
  let notOnlyPos = findNextWholePhrase(s, "not only", 0);

  let rawSpanStart = 0;
  let currentSearchSpanStart = 0;
  let searchFrom = 0;

  while (searchFrom < s.length) {
    let bestSearchIdx = -1;
    let bestPat = "";

    for (let pi = 0; pi < STRONG_BOUNDARIES.length; pi++) {
      let hit = nextHit[pi]!;
      if (hit === -1) continue;
      const pat = STRONG_BOUNDARIES[pi]!;
      if (hit < searchFrom) {
        let probe = searchFrom;
        hit = -1;
        while (probe + pat.length <= s.length) {
          const cand = s.indexOf(pat, probe);
          if (cand === -1) break;
          const rStart = view.origStartMap[cand] ?? n;
          const rEnd = view.origStartMap[cand + pat.length] ?? n;
          if (isRangeOutsideProtectedMask(protectedMask, rStart, rEnd)) {
            hit = cand;
            break;
          }
          probe = cand + 1;
        }
        nextHit[pi] = hit;
      }
      if (hit !== -1 && (bestSearchIdx === -1 || hit < bestSearchIdx)) {
        bestSearchIdx = hit;
        bestPat = pat;
      }
    }

    if (bestSearchIdx === -1) break;

    const afterMatch = bestSearchIdx + bestPat.length;
    if (
      (bestPat === " but " || bestPat === ", but ") &&
      s.startsWith("also", afterMatch) &&
      isWordBoundaryInStr(s, afterMatch + 4, false)
    ) {
      if (notOnlyPos !== -1 && notOnlyPos < currentSearchSpanStart) {
        notOnlyPos = findNextWholePhrase(s, "not only", currentSearchSpanStart);
      }
      if (notOnlyPos !== -1 && notOnlyPos < bestSearchIdx) {
        searchFrom = afterMatch;
        continue;
      }
    }

    const rawCut = view.origStartMap[afterMatch] ?? n;
    spans.push({ start: rawSpanStart, end: rawCut });
    rawSpanStart = rawCut;
    currentSearchSpanStart = afterMatch;
    searchFrom = afterMatch;
  }

  if (rawSpanStart < n) {
    spans.push({ start: rawSpanStart, end: n });
  } else if (spans.length === 0) {
    spans.push({ start: 0, end: n });
  }
  return spans;
}

function findInnerSplitOffset(between: string): {
  readonly offset: number | null;
  readonly relativizer: string | null;
} {
  let leadTrim = 0;
  while (leadTrim < between.length) {
    const c = between.charCodeAt(leadTrim);
    if (c === 44 || isSpace(c)) {
      leadTrim++;
    } else {
      break;
    }
  }
  const leadWords = extractWordSpans(between, leadTrim, between.length);
  const fw = leadWords[0];
  if (fw === undefined) {
    return { offset: null, relativizer: null };
  }
  const fwLower = normLowerWithMap(fw.text).text;
  if (!RELATIVIZERS.has(fwLower)) {
    return { offset: null, relativizer: null };
  }

  const allWords = extractWordSpans(between, 0, between.length);
  if (allWords.length < 3) {
    return { offset: null, relativizer: fwLower };
  }
  const minRawOffset = allWords[2]!.start;

  const view = buildSearchView(between);
  const s = view.searchStr;
  let bestRawOffset: number | null = null;

  for (const pat of INNER_SPLITS) {
    let probe = 0;
    while (probe + pat.length <= s.length) {
      const hit = s.indexOf(pat, probe);
      if (hit === -1) break;
      const rawIdx = view.origStartMap[hit] ?? between.length;
      if (rawIdx >= minRawOffset) {
        if (bestRawOffset === null || rawIdx < bestRawOffset) {
          bestRawOffset = rawIdx;
        }
        break;
      }
      probe = hit + 1;
    }
  }

  return { offset: bestRawOffset, relativizer: fwLower };
}

interface DraftClause {
  range: TextRangeLike;
  groups: MarkerGroup[];
  uncited: boolean;
}

function isLeadingTrimCode(c: number): boolean {
  return isSpace(c) || c === 44 || c === 59 || c === 58;
}

function isTrailingTrimCode(c: number): boolean {
  return isSpace(c) || c === 44 || c === 59 || c === 58 || c === 46;
}

function isPunctBeforeSpaceTargetCode(c: number): boolean {
  return c === 44 || c === 59 || c === 58 || c === 46;
}

function buildWindowLowerCodes(
  codes: Uint16Array,
  from: number,
  to: number,
): {
  readonly lowered: string;
  readonly slotIdxForLowerChar: number[];
} {
  let allAscii = true;
  for (let i = from; i < to; i++) {
    if (codes[i]! >= 128) {
      allAscii = false;
      break;
    }
  }

  if (allAscii) {
    const len = to - from;
    const outCodes = new Uint16Array(len);
    const map = new Array<number>(len + 1);
    for (let k = 0; k < len; k++) {
      let c = codes[from + k]!;
      if (isSpace(c)) {
        c = 32;
      } else if (c >= 65 && c <= 90) {
        c += 32;
      }
      outCodes[k] = c;
      map[k] = from + k;
    }
    map[len] = to;
    return {
      lowered: String.fromCharCode(...outCodes),
      slotIdxForLowerChar: map,
    };
  }

  const rawChars: string[] = [];
  for (let i = from; i < to; i++) {
    const c = codes[i]!;
    rawChars.push(isSpace(c) ? " " : String.fromCharCode(c));
  }
  const res = normLowerWithMap(rawChars.join(""));
  const map: number[] = [];
  for (let i = 0; i < res.map.length; i++) {
    map.push(from + res.map[i]!);
  }
  return { lowered: res.text, slotIdxForLowerChar: map };
}

function buildPrefixLowerCodes(
  codes: Uint16Array,
  startIdx: number,
  endIdx: number,
  maxSlots: number,
): {
  readonly lowered: string;
  readonly slotIdxForLowerChar: number[];
} {
  return buildWindowLowerCodes(codes, startIdx, Math.min(endIdx, startIdx + maxSlots));
}

function buildSuffixLowerCodes(
  codes: Uint16Array,
  startIdx: number,
  endIdx: number,
  maxSlots: number,
): {
  readonly lowered: string;
  readonly slotIdxForLowerChar: number[];
} {
  return buildWindowLowerCodes(codes, Math.max(startIdx, endIdx - maxSlots), endIdx);
}

function isCodeWordChar(code: number): boolean {
  return isLetter(code, false) || isDigit(code);
}

function codesToString(codes: Uint16Array, startIdx: number, endIdx: number): string {
  const total = endIdx - startIdx;
  if (total <= 0) return "";
  if (total <= 4096) {
    return String.fromCharCode(...codes.subarray(startIdx, endIdx));
  }
  const chunks: string[] = [];
  for (let i = startIdx; i < endIdx; i += 4096) {
    const sliceEnd = Math.min(endIdx, i + 4096);
    chunks.push(String.fromCharCode(...codes.subarray(i, sliceEnd)));
  }
  return chunks.join("");
}

function advanceLeadingTrimCode(codes: Uint16Array, startIdx: number, endIdx: number): number {
  let idx = startIdx;
  while (idx < endIdx && isLeadingTrimCode(codes[idx]!)) {
    idx++;
  }
  return idx;
}

function cleanClauseSlice(
  sentenceText: string,
  range: TextRangeLike,
  groups: readonly MarkerGroup[],
): { readonly claimText: string; readonly span: TextRangeLike } {
  const rStart = range.start;
  const rEnd = range.end;
  const sliceLen = Math.max(0, rEnd - rStart);
  if (sliceLen === 0) {
    return {
      claimText: "",
      span: { start: rStart, end: rStart },
    };
  }

  const sortedGroups = groups.length <= 1 ? groups : [...groups].sort((a, b) => a.start - b.start);

  // Build deletion intervals inside [rStart, rEnd)
  const deletions: { start: number; end: number }[] = [];
  for (const g of sortedGroups) {
    let delStart = Math.max(rStart, g.start);
    const delEnd = Math.min(rEnd, g.end);

    if (g.narrative) {
      let frameEnd = delStart;
      while (frameEnd > rStart && isSpace(sentenceText.charCodeAt(frameEnd - 1))) {
        frameEnd--;
      }
      if (frameEnd > rStart) {
        const windowStart = Math.max(rStart, frameEnd - 64);
        const prefixSlice = sentenceText.slice(windowStart, frameEnd);
        const lowInfo = buildSearchView(prefixSlice);
        const lowStr = lowInfo.searchStr;
        for (const frame of REPORTING_FRAMES) {
          if (lowStr.endsWith(frame)) {
            const matchIdxInLow = lowStr.length - frame.length;
            const rawOffsetInPrefix = lowInfo.origStartMap[matchIdxInLow] ?? prefixSlice.length;
            const rawCandidateStart = windowStart + rawOffsetInPrefix;
            const leftBoundaryOk =
              matchIdxInLow > 0
                ? isWordBoundaryInStr(lowStr, matchIdxInLow, true)
                : rawCandidateStart === rStart || isWordBoundaryInStr(sentenceText, rawCandidateStart, true);
            if (leftBoundaryOk) {
              delStart = rawCandidateStart;
              break;
            }
          }
        }
      }
    }
    deletions.push({ start: delStart, end: delEnd });
  }

  const codes = new Uint16Array(sliceLen);
  const origs = new Int32Array(sliceLen);

  // Pass 1 + Cleanup (a) fused: omit deletions & MASK_CHAR (`U+E000`), delete spaces before deleted markers
  let wA = 0;
  let delIdx = 0;
  let pendingMarkerTag = false;
  let pos = rStart;

  while (pos < rEnd) {
    while (delIdx < deletions.length && deletions[delIdx]!.end <= pos) {
      delIdx++;
    }
    const activeDel = delIdx < deletions.length ? deletions[delIdx]! : undefined;
    if (activeDel !== undefined && pos >= activeDel.start && pos < activeDel.end) {
      pendingMarkerTag = true;
      pos = activeDel.end;
      delIdx++;
      continue;
    }
    const cu = sentenceText.charCodeAt(pos);
    if (cu === 0xe000) {
      pos++;
      continue;
    }
    if (pendingMarkerTag) {
      while (wA > 0 && isSpace(codes[wA - 1]!)) {
        wA--;
      }
      pendingMarkerTag = false;
    }
    codes[wA] = cu;
    origs[wA] = pos;
    wA++;
    pos++;
  }
  if (pendingMarkerTag) {
    while (wA > 0 && isSpace(codes[wA - 1]!)) {
      wA--;
    }
  }

  // Cleanup (b) in-place: delete pairs of commas enclosing only spaces
  let wB = 0;
  let bi = 0;
  while (bi < wA) {
    const cu = codes[bi]!;
    if (cu === 44) {
      let look = bi + 1;
      while (look < wA && isSpace(codes[look]!)) {
        look++;
      }
      if (look < wA && codes[look]! === 44) {
        bi = look + 1;
        continue;
      }
    }
    codes[wB] = cu;
    origs[wB] = origs[bi]!;
    wB++;
    bi++;
  }

  // Cleanup (c) in-place: delete every space immediately before ",", ";", ":" or "."
  let wC = 0;
  for (let ci = 0; ci < wB; ci++) {
    const cu = codes[ci]!;
    if (isPunctBeforeSpaceTargetCode(cu)) {
      while (wC > 0 && isSpace(codes[wC - 1]!)) {
        wC--;
      }
    }
    codes[wC] = cu;
    origs[wC] = origs[ci]!;
    wC++;
  }

  // Cleanup (d): delete leading characters in SPACE U {",", ";", ":"}
  let endIdx = wC;
  let startIdx = advanceLeadingTrimCode(codes, 0, endIdx);

  // Strip a LEADING_FRAME at start (+ optional ","), then repeat (d)
  if (startIdx < endIdx) {
    const { lowered, slotIdxForLowerChar } = buildPrefixLowerCodes(codes, startIdx, endIdx, 64);
    for (const frame of LEADING_FRAMES) {
      if (lowered.startsWith(frame) && isWordBoundaryInStr(lowered, frame.length, false)) {
        let dropTo = slotIdxForLowerChar[frame.length] ?? endIdx;
        if (dropTo < endIdx && codes[dropTo]! === 44) {
          dropTo++;
        }
        startIdx = advanceLeadingTrimCode(codes, dropTo, endIdx);
        break;
      }
    }
  }

  // Repeat at most 3 times: strip one LEAD_CONNECTOR at start (+ optional ","), then repeat (d)
  for (let iter = 0; iter < 3 && startIdx < endIdx; iter++) {
    const { lowered, slotIdxForLowerChar } = buildPrefixLowerCodes(codes, startIdx, endIdx, 32);
    let stripped = false;
    for (const conn of LEAD_CONNECTORS) {
      if (lowered.startsWith(conn) && isWordBoundaryInStr(lowered, conn.length, false)) {
        let dropTo = slotIdxForLowerChar[conn.length] ?? endIdx;
        if (dropTo < endIdx && codes[dropTo]! === 44) {
          dropTo++;
        }
        startIdx = advanceLeadingTrimCode(codes, dropTo, endIdx);
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }

  // Approved Item 3 Step 4 trailing cleanup:
  // repeat at most 2 times: trim trailing SPACE and ",;:.", then strip one whole-word TRAIL_CONNECTOR;
  // then trim trailing SPACE and ",;:."
  const trimTrailingEnd = (): void => {
    while (endIdx > startIdx && isTrailingTrimCode(codes[endIdx - 1]!)) {
      endIdx--;
    }
  };

  for (let iter = 0; iter < 2; iter++) {
    trimTrailingEnd();
    if (startIdx >= endIdx) break;
    const { lowered, slotIdxForLowerChar } = buildSuffixLowerCodes(codes, startIdx, endIdx, 24);
    let stripped = false;
    for (const conn of TRAIL_CONNECTORS) {
      if (lowered.endsWith(conn)) {
        const startCharIdx = lowered.length - conn.length;
        const startSlotIdx = slotIdxForLowerChar[startCharIdx] ?? startIdx;
        const precededByBoundary =
          startSlotIdx === startIdx ||
          (startSlotIdx >= 2 && codes[startSlotIdx - 1]! >= 0xdc00 && codes[startSlotIdx - 1]! <= 0xdfff
            ? !isSlotSurrogateWordChar(codes, startSlotIdx - 2)
            : !isCodeWordChar(codes[startSlotIdx - 1]!));
        if (precededByBoundary) {
          endIdx = startSlotIdx;
          stripped = true;
          break;
        }
      }
    }
    if (!stripped) break;
  }
  trimTrailingEnd();

  // Trim leading/trailing spaces and collapse internal whitespace runs to single U+0020 in-place
  while (startIdx < endIdx && isSpace(codes[startIdx]!)) {
    startIdx++;
  }
  while (endIdx > startIdx && isSpace(codes[endIdx - 1]!)) {
    endIdx--;
  }

  if (startIdx >= endIdx) {
    return {
      claimText: "",
      span: { start: range.start, end: range.start },
    };
  }

  const spanStartOrig = origs[startIdx]!;
  const spanEndOrig = origs[endIdx - 1]! + 1;

  let outW = startIdx;
  let inSpace = false;
  for (let i = startIdx; i < endIdx; i++) {
    const cu = codes[i]!;
    if (isSpace(cu)) {
      if (!inSpace) {
        codes[outW++] = 32;
        inSpace = true;
      }
    } else {
      codes[outW++] = cu;
      inSpace = false;
    }
  }

  const claimText = codesToString(codes, startIdx, outW);
  return {
    claimText,
    span: { start: spanStartOrig, end: spanEndOrig },
  };
}

function isSlotSurrogateWordChar(codes: Uint16Array, highIdx: number): boolean {
  const hi = codes[highIdx]!;
  const lo = codes[highIdx + 1]!;
  if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) {
    const cp = 0x10000 + (((hi - 0xd800) << 10) | (lo - 0xdc00));
    return isLetter(cp, false) || isDigit(cp);
  }
  return false;
}

function isShortUncitedClause(sentenceText: string, c: DraftClause): boolean {
  if (!c.uncited) return false;
  const rawWc = countWords(sentenceText, c.range.start, c.range.end);
  if (rawWc < 4) {
    return true;
  }
  if (rawWc >= 17) {
    return false;
  }
  const cleaned = cleanClauseSlice(sentenceText, c.range, c.groups);
  return countWords(cleaned.claimText) < 4;
}

function mergeShortUncited(sentenceText: string, clauses: DraftClause[]): DraftClause[] {
  if (clauses.length <= 1) return clauses;

  const head = clauses[0]!;
  let nextIdx = 1;
  while (nextIdx < clauses.length && isShortUncitedClause(sentenceText, head)) {
    const next = clauses[nextIdx]!;
    head.range = { start: head.range.start, end: next.range.end };
    for (const g of next.groups) {
      head.groups.push(g);
    }
    head.uncited = next.uncited;
    nextIdx++;
  }

  const merged: DraftClause[] = [head];
  for (let idx = nextIdx; idx < clauses.length; idx++) {
    const c = clauses[idx]!;
    if (isShortUncitedClause(sentenceText, c)) {
      const prev = merged[merged.length - 1]!;
      prev.range = { start: prev.range.start, end: c.range.end };
      continue;
    }
    merged.push(c);
  }
  return merged;
}

/**
 * Partitions a single sentence and exposes Step 2 intermediate split trace counts (`AC-L0-24`).
 */
export function partitionClausesWithTrace(
  sentenceText: string,
  markers: readonly CitationMarker[],
): PartitionClausesWithTraceResult {
  const groups = groupMarkers(sentenceText, markers);
  const strongSpans = splitAtStrongBoundaries(sentenceText, groups);

  let drafts: DraftClause[] = [];
  const splitTraces: ClauseSplitTrace[] = [];
  let gCursor = 0;

  for (const pSpan of strongSpans) {
    while (gCursor < groups.length && groups[gCursor]!.end <= pSpan.start) {
      gCursor++;
    }
    const spanGroups: MarkerGroup[] = [];
    while (gCursor < groups.length && groups[gCursor]!.end <= pSpan.end) {
      if (groups[gCursor]!.start >= pSpan.start) {
        spanGroups.push(groups[gCursor]!);
      }
      gCursor++;
    }

    if (spanGroups.length === 0) {
      drafts.push({ range: pSpan, groups: [], uncited: true });
      continue;
    }

    const pieceRanges: TextRangeLike[] = [];
    let openStart = pSpan.start;

    for (let j = 1; j < spanGroups.length; j++) {
      const a = spanGroups[j - 1]!;
      const b = spanGroups[j]!;
      const between = sentenceText.slice(a.end, b.start);
      const wc = countWords(sentenceText, a.end, b.start);

      let didSplit = false;
      let relMatched: string | null = null;
      let splitOffset: number | null = null;

      if (!a.narrative && !b.narrative && wc >= 4) {
        let x = a.end;
        const innerRes = findInnerSplitOffset(between);
        relMatched = innerRes.relativizer;
        if (innerRes.offset !== null) {
          x = a.end + innerRes.offset;
        }
        didSplit = true;
        splitOffset = x;
        pieceRanges.push({ start: openStart, end: x });
        openStart = x;
      }

      splitTraces.push({
        betweenStart: a.end,
        betweenEnd: b.start,
        betweenWordCount: wc,
        didSplit,
        relativizerMatched: relMatched,
        splitOffset,
      });
    }

    pieceRanges.push({ start: openStart, end: pSpan.end });

    let pgCursor = 0;
    for (const pr of pieceRanges) {
      const pieceGroups: MarkerGroup[] = [];
      while (pgCursor < spanGroups.length && spanGroups[pgCursor]!.end <= pr.end) {
        if (spanGroups[pgCursor]!.start >= pr.start) {
          pieceGroups.push(spanGroups[pgCursor]!);
        }
        pgCursor++;
      }
      drafts.push({
        range: pr,
        groups: pieceGroups,
        uncited: pieceGroups.length === 0,
      });
    }
  }

  drafts = mergeShortUncited(sentenceText, drafts);

  const clauses: PartitionedClause[] = [];
  for (let idx = 0; idx < drafts.length; idx++) {
    const d = drafts[idx]!;
    const cleaned = cleanClauseSlice(sentenceText, d.range, d.groups);
    const flattenedMarkers: CitationMarker[] = [];
    for (const g of d.groups) {
      for (const m of g.markers) {
        flattenedMarkers.push(m);
      }
    }
    clauses.push({
      clauseIndex: idx,
      claimText: cleaned.claimText,
      span: cleaned.span,
      range: d.range,
      groups: d.groups,
      markers: flattenedMarkers,
      uncited: d.uncited,
    });
  }

  return { groups, clauses, splitTraces };
}

/**
 * Runs the non-overlapping clause partitioner (`02` §6.2) on `sentenceText` with `markers`.
 */
export function partitionClauses(
  sentenceText: string,
  markers: readonly CitationMarker[],
): PartitionedClause[] {
  return [...partitionClausesWithTrace(sentenceText, markers).clauses];
}
