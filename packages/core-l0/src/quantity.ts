import { extractWordSpans, scanCitations, type WordSpan } from "./citations.js";
import type { SourceFormat } from "./mask.js";
import {
  type DocMetricCues,
  type MetricClass,
  classifyMetricClass,
  classifyUnitOnly,
  detectDocMetricCues,
} from "./metricClass.js";
import {
  codePointAtSafe,
  createSha256PrefixHasher,
  isBaseLetter,
  isDigit,
  normLower,
  sha256hex,
  type Sha256PrefixHasher,
} from "./norm.js";
import {
  type ParsedNumber,
  type PreparedInput,
  type TextRange,
  asciiLower,
  computeSigDigits,
  hasPercentageContext,
  isAsciiDigitCode,
  isWordCharBefore,
  matchDateEndAt,
  matchWordLowerAt,
  normalizeZero,
  parseFiniteNumberAt,
  parseNumberOrScientificAt,
  parseWordNumberAt,
  prepareInput,
  scaleParsedNumber,
  scaleWordNumber,
  skipSpaces,
  toRawSpan,
} from "./numberParser.js";
import { BM25_STOPWORDS, porterStem } from "./porter.js";
import {
  UNIT_WORDS,
  isKnownSuffixWordUnit,
  scanLeadingPrefixCurrency,
  scanPrefixUnit,
  scanSuffixUnitFast,
  type UnitFamily,
  type UnitMatch,
} from "./units.js";

export type { TextRange };

export type PComparator = "<" | "<=" | "=" | ">" | ">=";

export type TupleSource = "manuscript" | "lab_note" | "print_page";

export interface QuantTuple {
  tupleId: string;
  valueRaw: string;
  unitRaw: string;
  metricClass: MetricClass;
  pComparator: PComparator | null;
  valueNorm: number | null;
  valueLo: number | null;
  valueHi: number | null;
  sigDigits: number;
  unitCanon: string;
  keyLemmas: string[];
  section: string;
  source: TupleSource;
  span: TextRange;
}

/**
 * Exact 42 count nouns shared by Rule 9 word-number trigger (`02` §7.2) and
 * the deterministic triage baseline (`03` §3.4).
 */
export const COUNT_NOUNS: ReadonlySet<string> = new Set([
  "patients",
  "participants",
  "subjects",
  "people",
  "persons",
  "individuals",
  "cases",
  "controls",
  "studies",
  "trials",
  "samples",
  "cohorts",
  "groups",
  "sites",
  "centres",
  "centers",
  "countries",
  "hospitals",
  "schools",
  "children",
  "adults",
  "women",
  "men",
  "mice",
  "rats",
  "animals",
  "cells",
  "years",
  "months",
  "weeks",
  "days",
  "hours",
  "times",
  "doses",
  "events",
  "deaths",
  "items",
  "questions",
  "respondents",
  "experiments",
  "models",
  "datasets",
]);

export interface ExtractQuantitiesOptions {
  readonly docId?: string;
  readonly sentenceHash?: string;
  readonly occurrenceIndex?: number;
  readonly section?: string;
  readonly source?: TupleSource;
  readonly lang?: string;
  readonly format?: SourceFormat;
  /** Table column header + row label context (sets ±6 window & checks `M (SD)` header). */
  readonly tableHeader?: string;
  readonly rowLabel?: string;
  /** Precomputed citation spans in `text` to skip (if omitted, scanned automatically). */
  readonly citationSpans?: readonly TextRange[];
  /** Override automatic LaTeX macro substitution (`\\SI`, `\\num`, etc.). */
  readonly applyLatex?: boolean;
}

export interface QuantExtractionMeta {
  readonly tuples: readonly QuantTuple[];
  readonly metricFromUnitByTupleIndex: readonly boolean[];
}

const INTERVAL_CUES: ReadonlySet<string> = new Set([
  "mean",
  "median",
  "average",
  "estimate",
  "or",
  "hr",
  "rr",
  "irr",
  "ratio",
  "difference",
  "effect",
  "ci",
  "iqr",
]);

const MEAN_SD_CUES: ReadonlySet<string> = new Set(["mean", "sd"]);

const SLASH_UNIT_NUMERATORS: ReadonlySet<string> = new Set([
  "g",
  "mg",
  "ug",
  "μg",
  "ng",
  "mol",
  "mmol",
  "umol",
  "μmol",
  "nmol",
]);

const EMPTY_WORDS: readonly string[] = [];
const CITATION_PLACEHOLDER = "\u27e6c\u27e7";

export function computeTupleId(
  docId: string,
  sentenceHash: string,
  occurrenceIndex: number,
  tupleOrdinal: number,
  metricClass: MetricClass,
  valueRaw: string,
): string {
  return sha256hex(
    `${docId}|${sentenceHash}|${occurrenceIndex}|${tupleOrdinal}|${metricClass}|${valueRaw}`,
  ).slice(0, 32);
}

function parseRule4PValueAt(
  normText: string,
  normLowerText: string,
  rawSubText: string,
  normMap: readonly number[],
  pos: number,
  isEnglish: boolean,
): {
  comparator: PComparator;
  num: ParsedNumber;
  exprStartNorm: number;
  exprEndNorm: number;
} | null {
  const n = normText.length;
  if (pos >= n) {
    return null;
  }
  const ch = normLowerText.charCodeAt(pos);
  if (ch !== 112 /* 'p' */ || isWordCharBefore(normText, pos)) {
    return null;
  }

  let k = pos + 1;
  if (normLowerText.startsWith("-value", k) && !isWordCharAtBasic(normText, k + 6)) {
    k += 6;
  } else {
    const afterSp = skipSpaces(normText, k);
    if (normLowerText.startsWith("value", afterSp) && !isWordCharAtBasic(normText, afterSp + 5)) {
      k = afterSp + 5;
      const afterValSp = skipSpaces(normText, k);
      if (normLowerText.startsWith("of", afterValSp) && !isWordCharAtBasic(normText, afterValSp + 2)) {
        k = afterValSp + 2;
      }
    } else if (isWordCharAtBasic(normText, k)) {
      return null;
    }
  }

  k = skipSpaces(normText, k);
  if (k >= n) {
    return null;
  }

  let comparator: PComparator | null = null;
  const c0 = normText.charCodeAt(k);
  const c1 = k + 1 < n ? normText.charCodeAt(k + 1) : 0;
  if (c0 === 60 /* '<' */) {
    if (c1 === 61 /* '=' */) {
      comparator = "<=";
      k += 2;
    } else {
      comparator = "<";
      k += 1;
    }
  } else if (c0 === 0x2264 /* '≤' */) {
    comparator = "<=";
    k += 1;
  } else if (c0 === 62 /* '>' */) {
    if (c1 === 61 /* '=' */) {
      comparator = ">=";
      k += 2;
    } else {
      comparator = ">";
      k += 1;
    }
  } else if (c0 === 0x2265 /* '≥' */) {
    comparator = ">=";
    k += 1;
  } else if (c0 === 61 /* '=' */) {
    comparator = "=";
    k += 1;
  } else {
    return null;
  }

  k = skipSpaces(normText, k);
  const num = parseFiniteNumberAt(normText, rawSubText, normMap, k, isEnglish, true);
  if (num === null) {
    return null;
  }

  return {
    comparator,
    num,
    exprStartNorm: pos,
    exprEndNorm: num.endNorm,
  };
}

function isWordCharAtBasic(text: string, idx: number): boolean {
  if (idx < 0 || idx >= text.length) {
    return false;
  }
  const u = codePointAtSafe(text, idx);
  return isBaseLetter(u.cp) || isDigit(u.cp);
}

function isPureAsciiDigitToken(word: string): boolean {
  if (word.length === 0) {
    return false;
  }
  for (let i = 0; i < word.length; i++) {
    if (!isAsciiDigitCode(word.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function isSlashLiterDenominator(
  textLower: string,
  spans: readonly WordSpan[],
  idx: number,
): boolean {
  if (idx <= 0) {
    return false;
  }
  const cur = spans[idx]!;
  if (cur.text !== "l" || cur.start < 2 || textLower.charCodeAt(cur.start - 1) !== 47 /* '/' */) {
    return false;
  }
  const prev = spans[idx - 1]!;
  if (prev.end !== cur.start - 1) {
    return false;
  }
  let pStart = 0;
  while (pStart < prev.text.length && isAsciiDigitCode(prev.text.charCodeAt(pStart))) {
    pStart++;
  }
  const numUnit = pStart === 0 ? prev.text : prev.text.slice(pStart);
  return SLASH_UNIT_NUMERATORS.has(numUnit);
}

function buildWordMask(
  textLower: string,
  spans: readonly WordSpan[],
): { readonly hasLetterMask: Uint8Array; readonly anyLetter: boolean } {
  const hasLetterMask = new Uint8Array(spans.length);
  let anyLetter = false;
  for (let i = 0; i < spans.length; i++) {
    if (isPureAsciiDigitToken(spans[i]!.text)) {
      continue;
    }
    if (isSlashLiterDenominator(textLower, spans, i)) {
      // 2 marks `/L` denominator unit tokens so `keyLemmas` skips neighbor `/L` leaks.
      hasLetterMask[i] = 2;
      continue;
    }
    hasLetterMask[i] = 1;
    anyLetter = true;
  }
  return { hasLetterMask, anyLetter };
}

function buildProseWordSpans(
  normText: string,
  normLowerText: string,
  excludedSpans: readonly TextRange[],
): {
  readonly cleanedLower: string;
  readonly spans: WordSpan[];
  readonly hasLetterMask: Uint8Array;
  readonly anyLetterInDoc: boolean;
} {
  // Mask out excluded spans and `⟦c⟧` placeholders without altering offsets.
  let cleaned = normLowerText;
  const hasPlaceholder = normLowerText.includes(CITATION_PLACEHOLDER);
  if (excludedSpans.length > 0 || hasPlaceholder) {
    const chars: string[] = [];
    let last = 0;
    for (let sIdx = 0; sIdx < excludedSpans.length; sIdx++) {
      const span = excludedSpans[sIdx]!;
      const sStart = Math.max(last, span.start);
      const sEnd = Math.max(sStart, Math.min(normText.length, span.end));
      if (sStart > last) {
        chars.push(normLowerText.slice(last, sStart));
      }
      for (let q = sStart; q < sEnd; q++) {
        chars.push(" ");
      }
      last = sEnd;
    }
    if (last < normLowerText.length) {
      chars.push(normLowerText.slice(last));
    }
    cleaned = chars.join("");
    if (hasPlaceholder) {
      const outParts: string[] = [];
      let p = 0;
      while (p < cleaned.length) {
        const idx = cleaned.indexOf(CITATION_PLACEHOLDER, p);
        if (idx === -1) {
          outParts.push(p === 0 ? cleaned : cleaned.slice(p));
          break;
        }
        if (idx > p) {
          outParts.push(cleaned.slice(p, idx));
        }
        outParts.push("   ");
        p = idx + CITATION_PLACEHOLDER.length;
      }
      cleaned = outParts.join("");
    }
  }
  const spans = extractWordSpans(cleaned);
  const { hasLetterMask, anyLetter } = buildWordMask(cleaned, spans);
  return { cleanedLower: cleaned, spans, hasLetterMask, anyLetterInDoc: anyLetter };
}

interface WordWindowBounds {
  readonly nextHintIdx: number;
  readonly beforeStart: number;
  readonly beforeEnd: number;
  readonly afterIdx: number;
  readonly afterEnd: number;
  readonly hasContentLetter: boolean;
}

function locateWordWindow(
  wordSpans: readonly WordSpan[],
  hasLetterMask: Uint8Array,
  startNorm: number,
  endNorm: number,
  leftHintIdx: number,
  countPerSide: number,
): WordWindowBounds {
  const wsLen = wordSpans.length;
  let idx = leftHintIdx;
  while (idx < wsLen && wordSpans[idx]!.end <= startNorm) {
    idx++;
  }
  const beforeEnd = idx;
  const beforeStart = Math.max(0, beforeEnd - countPerSide);
  let afterIdx = idx;
  while (afterIdx < wsLen && wordSpans[afterIdx]!.start < endNorm) {
    afterIdx++;
  }
  const afterEnd = Math.min(wsLen, afterIdx + countPerSide);

  let hasContentLetter = false;
  for (let k = beforeStart; k < beforeEnd; k++) {
    if (hasLetterMask[k] === 1) {
      hasContentLetter = true;
      break;
    }
  }
  if (!hasContentLetter) {
    for (let k = afterIdx; k < afterEnd; k++) {
      if (hasLetterMask[k] === 1) {
        hasContentLetter = true;
        break;
      }
    }
  }

  return {
    nextHintIdx: beforeEnd,
    beforeStart,
    beforeEnd,
    afterIdx,
    afterEnd,
    hasContentLetter,
  };
}

function collectWindowWords(
  wordSpans: readonly WordSpan[],
  hasLetterMask: Uint8Array,
  win: WordWindowBounds,
): string[] {
  const words: string[] = [];
  for (let k = win.beforeStart; k < win.beforeEnd; k++) {
    if (hasLetterMask[k] !== 2) {
      words.push(wordSpans[k]!.text);
    }
  }
  for (let k = win.afterIdx; k < win.afterEnd; k++) {
    if (hasLetterMask[k] !== 2) {
      words.push(wordSpans[k]!.text);
    }
  }
  return words;
}

function containsMeanSdCue(
  words: readonly string[],
  windowTextLower: string,
  tableHeaderLower: string,
  tableWindowWords: readonly string[] | null,
): boolean {
  for (let i = 0; i < words.length; i++) {
    if (MEAN_SD_CUES.has(words[i]!)) {
      return true;
    }
  }
  if (tableWindowWords !== null) {
    for (let i = 0; i < tableWindowWords.length; i++) {
      if (MEAN_SD_CUES.has(tableWindowWords[i]!)) {
        return true;
      }
    }
  }
  const combined =
    tableHeaderLower.length > 0 ? windowTextLower + " " + tableHeaderLower : windowTextLower;
  return (
    combined.includes("s.d.") ||
    combined.includes("standard deviation") ||
    combined.includes("m (sd)") ||
    combined.includes("mean (sd)")
  );
}

function hasIntervalCueInWindow(
  wordSpans: readonly WordSpan[],
  beforeStart: number,
  beforeEnd: number,
): boolean {
  for (let i = beforeStart; i < beforeEnd; i++) {
    if (INTERVAL_CUES.has(wordSpans[i]!.text)) {
      return true;
    }
  }
  return false;
}

function isDigitPrefixedUnitToken(word: string): boolean {
  const len = word.length;
  if (len < 2 || !isAsciiDigitCode(word.charCodeAt(0))) {
    return false;
  }
  let dEnd = 1;
  while (dEnd < len && isAsciiDigitCode(word.charCodeAt(dEnd))) {
    dEnd++;
  }
  if (dEnd >= len) {
    return false;
  }
  const tail = word.slice(dEnd);
  if (dEnd === 4 && tail === "s") {
    return false;
  }
  return UNIT_WORDS.has(tail) || isKnownSuffixWordUnit(tail) || SLASH_UNIT_NUMERATORS.has(tail);
}

function stemKeyWord(w: string): string | null {
  if (
    w.length === 0 ||
    BM25_STOPWORDS.has(w) ||
    UNIT_WORDS.has(w) ||
    isKnownSuffixWordUnit(w) ||
    isDigitPrefixedUnitToken(w)
  ) {
    return null;
  }
  const stem = porterStem(w);
  return stem.length > 0 ? stem : null;
}

function getCachedWordStem(
  wordSpans: readonly WordSpan[],
  wordStemCache: (string | null | undefined)[],
  idx: number,
): string | null {
  let cached = wordStemCache[idx];
  if (cached !== undefined) {
    return cached;
  }
  cached = stemKeyWord(wordSpans[idx]!.text);
  wordStemCache[idx] = cached;
  return cached;
}

function appendUniqueStem(out: string[], seen: Set<string> | null, stem: string): Set<string> | null {
  if (out.length === 0) {
    out.push(stem);
    return seen;
  }
  if (out.length === 1) {
    if (out[0] !== stem) {
      out.push(stem);
    }
    return seen;
  }
  const activeSet = seen ?? new Set(out);
  if (!activeSet.has(stem)) {
    activeSet.add(stem);
    out.push(stem);
  }
  return activeSet;
}

/**
 * Single unified `keyLemmas` pipeline (`02` §7.6) used for both prose ±6 windows and table context.
 */
function computeKeyLemmas(
  wordSpans: readonly WordSpan[],
  hasLetterMask: Uint8Array,
  wordStemCache: (string | null | undefined)[],
  r1Start: number,
  r1End: number,
  r2Start: number,
  r2End: number,
  extraExcludedWord?: string,
): string[] {
  const out: string[] = [];
  let seen: Set<string> | null = null;

  const processRange = (startIdx: number, endIdx: number): void => {
    for (let k = startIdx; k < endIdx; k++) {
      if (hasLetterMask[k] !== 1) {
        continue;
      }
      if (extraExcludedWord !== undefined && wordSpans[k]!.text === extraExcludedWord) {
        continue;
      }
      const stem = getCachedWordStem(wordSpans, wordStemCache, k);
      if (stem !== null) {
        seen = appendUniqueStem(out, seen, stem);
      }
    }
  };

  processRange(r1Start, r1End);
  processRange(r2Start, r2End);

  // Ascending UTF-16 code-unit order (`02` §7.6 / §8.2).
  if (out.length > 1) {
    out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return out;
}

function tryReadCiOrIqrLabel(
  normText: string,
  normLowerText: string,
  startPos: number,
  requireConfOrLabel: boolean,
): { label: "ci" | "iqr" | "range"; afterLabelNorm: number } | null {
  let k = startPos;
  const n = normText.length;

  // Optional `95%` / `90%` / `99%` before `CI`.
  if (k < n && isAsciiDigitCode(normText.charCodeAt(k))) {
    let dEnd = k;
    while (dEnd < n && isAsciiDigitCode(normText.charCodeAt(dEnd))) {
      dEnd++;
    }
    let afterPct = dEnd;
    if (afterPct < n && normText.charCodeAt(afterPct) === 32) {
      afterPct++;
    }
    if (normText.charCodeAt(afterPct) === 37 /* '%' */) {
      afterPct++;
      k = skipSpaces(normText, afterPct);
      const ciEnd = matchWordLowerAt(normLowerText, k, "ci");
      if (ciEnd !== -1) {
        let after = skipSpaces(normText, ciEnd);
        if (after < n && (normText.charCodeAt(after) === 58 || normText.charCodeAt(after) === 61)) {
          after = skipSpaces(normText, after + 1);
        }
        return { label: "ci", afterLabelNorm: after };
      }
    }
    return null;
  }

  const readLabelTail = (afterWord: number, label: "ci" | "iqr" | "range") => {
    let after = skipSpaces(normText, afterWord);
    if (after < n && (normText.charCodeAt(after) === 58 || normText.charCodeAt(after) === 61)) {
      after = skipSpaces(normText, after + 1);
    }
    return { label, afterLabelNorm: after };
  };

  const ciEnd = matchWordLowerAt(normLowerText, k, "ci");
  if (ciEnd !== -1) {
    return readLabelTail(ciEnd, "ci");
  }

  if (requireConfOrLabel) {
    const iqrEnd = matchWordLowerAt(normLowerText, k, "iqr");
    if (iqrEnd !== -1) {
      return readLabelTail(iqrEnd, "iqr");
    }
    const rangeEnd = matchWordLowerAt(normLowerText, k, "range");
    if (rangeEnd !== -1) {
      return readLabelTail(rangeEnd, "range");
    }
  }

  return null;
}

function matchRangeSeparatorAt(
  normText: string,
  normLowerText: string,
  pos: number,
): number {
  const n = normText.length;
  const k = skipSpaces(normText, pos);
  if (k >= n) {
    return -1;
  }
  const ch = normText.charCodeAt(k);
  if (ch === 45 /* '-' */ || ch === 0x2013 /* '–' */ || ch === 44 /* ',' */) {
    return skipSpaces(normText, k + 1);
  }
  const toEnd = matchWordLowerAt(normLowerText, k, "to");
  if (toEnd !== -1 && toEnd > pos && k > pos) {
    return skipSpaces(normText, toEnd);
  }
  return -1;
}

function matchStrictRangeHyphenOrTo(
  normText: string,
  normLowerText: string,
  pos: number,
): number {
  const n = normText.length;
  const k = skipSpaces(normText, pos);
  if (k >= n) {
    return -1;
  }
  const ch = normText.charCodeAt(k);
  if (ch === 45 /* '-' */ || ch === 0x2013 /* '–' */) {
    return skipSpaces(normText, k + 1);
  }
  if (k > pos) {
    const toEnd = matchWordLowerAt(normLowerText, k, "to");
    if (toEnd !== -1) {
      const after = skipSpaces(normText, toEnd);
      if (after > toEnd) {
        return after;
      }
    }
  }
  return -1;
}

interface CombinedUnitInfo {
  readonly unitCanon: string;
  readonly unitRaw: string;
  readonly unitFamily: UnitFamily;
  readonly factor: number;
  readonly isSampleSizePrefix: boolean;
  readonly unitStartNorm: number;
  readonly unitEndNorm: number;
  readonly extraExcludedUnitWord: string | undefined;
}

const EMPTY_COMBINED_UNIT: CombinedUnitInfo = {
  unitCanon: "",
  unitRaw: "",
  unitFamily: "none",
  factor: 1,
  isSampleSizePrefix: false,
  unitStartNorm: -1,
  unitEndNorm: -1,
  extraExcludedUnitWord: undefined,
};

function resolveCombinedUnit(
  prep: PreparedInput,
  suffixUnit: UnitMatch | null,
  prefixUnit: UnitMatch | null,
): CombinedUnitInfo {
  if (suffixUnit !== null) {
    const rawSlice = prep.subText.slice(
      prep.normMap[suffixUnit.startNorm] ?? 0,
      prep.normMap[suffixUnit.endNorm] ?? prep.subText.length,
    );
    const keepSampleSize =
      suffixUnit.family === "count" && prefixUnit !== null && prefixUnit.isSampleSizePrefix;
    const isUnknown = suffixUnit.family === "unknown";
    return {
      unitCanon: suffixUnit.unitCanon,
      unitRaw: rawSlice,
      unitFamily: suffixUnit.family,
      factor: suffixUnit.factor,
      isSampleSizePrefix: keepSampleSize,
      unitStartNorm: keepSampleSize && prefixUnit !== null ? prefixUnit.startNorm : suffixUnit.startNorm,
      unitEndNorm: suffixUnit.endNorm,
      extraExcludedUnitWord: isUnknown ? undefined : asciiLower(rawSlice),
    };
  }
  if (prefixUnit !== null) {
    const rawSlice = prep.subText.slice(
      prep.normMap[prefixUnit.startNorm] ?? 0,
      prep.normMap[prefixUnit.endNorm] ?? prep.subText.length,
    );
    return {
      unitCanon: prefixUnit.unitCanon,
      unitRaw: rawSlice,
      unitFamily: prefixUnit.family,
      factor: prefixUnit.factor,
      isSampleSizePrefix: prefixUnit.isSampleSizePrefix,
      unitStartNorm: prefixUnit.startNorm,
      unitEndNorm: prefixUnit.endNorm,
      extraExcludedUnitWord: undefined,
    };
  }
  return EMPTY_COMBINED_UNIT;
}

function lowerBoundMap(map: readonly number[], target: number, maxOut: number): number {
  let lo = 0;
  let hi = maxOut;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((map[mid] ?? 0) < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function mapExcludedSpansToNorm(prep: PreparedInput, rawSpans: readonly TextRange[]): TextRange[] {
  if (rawSpans.length === 0) {
    return [];
  }
  const normLen = prep.normText.length;
  const subLen = prep.subText.length;
  const result: TextRange[] = [];

  for (let s = 0; s < rawSpans.length; s++) {
    const rs = rawSpans[s]!;
    let subStart = rs.start;
    let subEnd = rs.end;
    if (prep.latexMap !== null) {
      subStart = lowerBoundMap(prep.latexMap, rs.start, subLen);
      subEnd = lowerBoundMap(prep.latexMap, rs.end, subLen);
    }
    const nStart = lowerBoundMap(prep.normMap, subStart, normLen);
    const nEnd = lowerBoundMap(prep.normMap, subEnd, normLen);
    if (nEnd > nStart) {
      result.push({ start: nStart, end: nEnd });
    }
  }
  result.sort((a, b) => a.start - b.start || a.end - b.end);
  return result;
}

function isPlusMinusUnitCompatible(a: UnitMatch | null, b: UnitMatch | null): boolean {
  if (a === null || b === null) {
    return true;
  }
  return a.unitCanon === b.unitCanon && a.family !== "unknown";
}

function isRangeUnitCompatible(a: UnitMatch | null, b: UnitMatch | null): boolean {
  if (a === null) {
    return true;
  }
  if (b === null) {
    return false;
  }
  return a.unitCanon === b.unitCanon && a.family !== "unknown";
}

function isPointIntervalUnitCompatible(
  aSuf: UnitMatch | null,
  aPrefix: UnitMatch | null,
  bSuf: UnitMatch | null,
  cSuf: UnitMatch | null,
  postSuf: UnitMatch | null,
): boolean {
  if (!isRangeUnitCompatible(bSuf, cSuf)) {
    return false;
  }
  const boundSuf = postSuf ?? cSuf ?? bSuf;
  if (boundSuf === null) {
    return true;
  }
  if (boundSuf.family === "unknown") {
    return false;
  }
  if (aSuf !== null && (aSuf.family === "unknown" || aSuf.unitCanon !== boundSuf.unitCanon)) {
    return false;
  }
  if (aPrefix !== null && (aPrefix.family === "unknown" || aPrefix.unitCanon !== boundSuf.unitCanon)) {
    return false;
  }
  return true;
}

function overlapsExcludedSpan(
  spans: readonly TextRange[],
  startNorm: number,
  endNorm: number,
): boolean {
  const len = spans.length;
  if (len === 0 || endNorm <= startNorm) {
    return false;
  }
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid]!.end <= startNorm) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo < len && spans[lo]!.start < endNorm;
}

interface ScanRuntimeCtx {
  readonly prep: PreparedInput;
  readonly normText: string;
  readonly normLowerText: string;
  readonly cleanedLower: string;
  readonly n: number;
  readonly tupleIdHasher: Sha256PrefixHasher;
  readonly section: string;
  readonly source: TupleSource;
  readonly anyLetterInDoc: boolean;
  readonly wordSpans: readonly WordSpan[];
  readonly hasLetterMask: Uint8Array;
  readonly excludedNormSpans: readonly TextRange[];
  readonly tableWordSpans: readonly WordSpan[] | null;
  readonly tableLetterMask: Uint8Array | null;
  readonly tableStemCache: (string | null | undefined)[] | null;
  readonly tableWindowWords: readonly string[] | null;
  readonly tableHeaderLower: string;
  readonly tableCombinedLower: string;
  readonly sentenceHasPct: boolean;
  readonly sentenceHasTo: boolean;
  readonly sentenceHasAnd: boolean;
  readonly sentenceHasCiWord: boolean;
  readonly sentenceHasRangeSep: boolean;
  readonly cues: DocMetricCues;
  readonly wordStemCache: (string | null | undefined)[];
  readonly tuples: QuantTuple[];
  readonly metricFromUnitList: boolean[];
  wordHintIdx: number;
  seenPctBeforeCursor: boolean;
  lastConsumedEndNorm: number;
}

function commitTuple(
  ctx: ScanRuntimeCtx,
  valueRaw: string,
  unitMatch: CombinedUnitInfo,
  pComparator: PComparator | null,
  metricClass: MetricClass,
  metricFromUnit: boolean,
  valueNorm: number,
  valueLo: number,
  valueHi: number,
  sigDigits: number,
  spanStartNorm: number,
  spanEndNorm: number,
  keyLemmas: string[],
): void {
  if (!Number.isFinite(valueNorm) || !Number.isFinite(valueLo) || !Number.isFinite(valueHi)) {
    return;
  }
  const ordinal = ctx.tuples.length;
  ctx.tuples.push({
    tupleId: ctx.tupleIdHasher.digestHex32(`${ordinal}|${metricClass}|${valueRaw}`),
    valueRaw,
    unitRaw: unitMatch.unitRaw,
    metricClass,
    pComparator,
    valueNorm: normalizeZero(valueNorm),
    valueLo: normalizeZero(valueLo),
    valueHi: normalizeZero(valueHi),
    sigDigits,
    unitCanon: unitMatch.unitCanon,
    keyLemmas,
    section: ctx.section,
    source: ctx.source,
    span: toRawSpan(ctx.prep, spanStartNorm, spanEndNorm),
  });
  ctx.metricFromUnitList.push(metricFromUnit);
  if (spanEndNorm > ctx.lastConsumedEndNorm) {
    ctx.lastConsumedEndNorm = spanEndNorm;
  }
}

function pushTupleFromSpan(
  ctx: ScanRuntimeCtx,
  valueRaw: string,
  unitMatch: CombinedUnitInfo,
  isRule4PValue: boolean,
  pComparator: PComparator | null,
  valueNorm: number,
  valueLo: number,
  valueHi: number,
  sigDigits: number,
  spanStartNorm: number,
  spanEndNorm: number,
): void {
  if (
    ctx.tableWindowWords !== null &&
    ctx.tableWordSpans !== null &&
    ctx.tableLetterMask !== null &&
    ctx.tableStemCache !== null
  ) {
    const metric = classifyMetricClass({
      unitFamily: unitMatch.unitFamily,
      isRule4PValue,
      isSampleSizePrefix: unitMatch.isSampleSizePrefix,
      windowWordsLower: ctx.tableWindowWords,
      windowTextLower: ctx.tableCombinedLower,
      preNormalized: true,
    });
    const keyLemmas = computeKeyLemmas(
      ctx.tableWordSpans,
      ctx.tableLetterMask,
      ctx.tableStemCache,
      0,
      ctx.tableWordSpans.length,
      0,
      0,
      unitMatch.extraExcludedUnitWord,
    );
    commitTuple(
      ctx,
      valueRaw,
      unitMatch,
      pComparator,
      metric.metricClass,
      metric.metricFromUnit,
      valueNorm,
      valueLo,
      valueHi,
      sigDigits,
      spanStartNorm,
      spanEndNorm,
      keyLemmas,
    );
    return;
  }

  if (!ctx.anyLetterInDoc) {
    const metric = classifyUnitOnly(unitMatch.unitFamily, isRule4PValue, unitMatch.isSampleSizePrefix);
    commitTuple(
      ctx,
      valueRaw,
      unitMatch,
      pComparator,
      metric.metricClass,
      metric.metricFromUnit,
      valueNorm,
      valueLo,
      valueHi,
      sigDigits,
      spanStartNorm,
      spanEndNorm,
      [],
    );
    return;
  }

  const win = locateWordWindow(
    ctx.wordSpans,
    ctx.hasLetterMask,
    spanStartNorm,
    spanEndNorm,
    ctx.wordHintIdx,
    6,
  );
  ctx.wordHintIdx = win.nextHintIdx;

  let metric = classifyUnitOnly(unitMatch.unitFamily, isRule4PValue, unitMatch.isSampleSizePrefix);
  if (
    (ctx.cues.hasEffectCue || ctx.cues.hasSampleCue || ctx.cues.hasDoseCue) &&
    win.hasContentLetter
  ) {
    const wordsList = collectWindowWords(ctx.wordSpans, ctx.hasLetterMask, win);
    let windowTextForMetric = "";
    if (ctx.cues.hasEffectCue) {
      const wStartNorm =
        win.beforeStart < win.beforeEnd ? ctx.wordSpans[win.beforeStart]!.start : spanStartNorm;
      const wEndNorm =
        win.afterEnd > win.afterIdx ? ctx.wordSpans[win.afterEnd - 1]!.end : spanEndNorm;
      windowTextForMetric = ctx.cleanedLower.slice(wStartNorm, wEndNorm);
    }
    metric = classifyMetricClass({
      unitFamily: unitMatch.unitFamily,
      isRule4PValue,
      isSampleSizePrefix: unitMatch.isSampleSizePrefix,
      windowWordsLower: wordsList,
      windowTextLower: windowTextForMetric,
      preNormalized: true,
    });
  }

  const keyLemmas = computeKeyLemmas(
    ctx.wordSpans,
    ctx.hasLetterMask,
    ctx.wordStemCache,
    win.beforeStart,
    win.beforeEnd,
    win.afterIdx,
    win.afterEnd,
    unitMatch.extraExcludedUnitWord,
  );
  commitTuple(
    ctx,
    valueRaw,
    unitMatch,
    pComparator,
    metric.metricClass,
    metric.metricFromUnit,
    valueNorm,
    valueLo,
    valueHi,
    sigDigits,
    spanStartNorm,
    spanEndNorm,
    keyLemmas,
  );
}

interface IntervalBoundsMatch {
  readonly bNum: ParsedNumber;
  readonly bSuf: UnitMatch | null;
  readonly cNum: ParsedNumber;
  readonly cSuf: UnitMatch | null;
  readonly boundsEndNorm: number;
}

function parseIntervalBounds(
  ctx: ScanRuntimeCtx,
  bStartNorm: number,
  hasPct: boolean,
): IntervalBoundsMatch | null {
  const { normText, normLowerText, prep } = ctx;
  const bNum = parseFiniteNumberAt(
    normText,
    prep.subText,
    prep.normMap,
    bStartNorm,
    prep.isEnglish,
    true,
  );
  if (bNum === null) {
    return null;
  }
  const bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false);
  const sepAfterB = matchRangeSeparatorAt(
    normText,
    normLowerText,
    bSuf !== null ? bSuf.endNorm : bNum.endNorm,
  );
  if (sepAfterB === -1) {
    return null;
  }
  const cNum = parseFiniteNumberAt(
    normText,
    prep.subText,
    prep.normMap,
    sepAfterB,
    prep.isEnglish,
    true,
  );
  if (cNum === null) {
    return null;
  }
  const cSuf = scanSuffixUnitFast(normText, normLowerText, cNum.endNorm, hasPct, false);
  return {
    bNum,
    bSuf,
    cNum,
    cSuf,
    boundsEndNorm: cSuf !== null ? cSuf.endNorm : cNum.endNorm,
  };
}

function tryRule6FromTo(ctx: ScanRuntimeCtx, i: number): number {
  const { normText, normLowerText, prep } = ctx;
  const fromEnd = matchWordLowerAt(normLowerText, i, "from");
  if (fromEnd === -1) {
    return -1;
  }
  const aStart = skipSpaces(normText, fromEnd);
  if (aStart <= fromEnd) {
    return -1;
  }
  const aNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, aStart, prep.isEnglish, true);
  if (aNum === null) {
    return -1;
  }
  const hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct;
  const aSuf = scanSuffixUnitFast(
    normText,
    normLowerText,
    aNum.endNorm,
    hasPct,
    aNum.isYearIntCandidate,
  );
  const aAfterUnit = aSuf !== null ? aSuf.endNorm : aNum.endNorm;
  const spBeforeTo = skipSpaces(normText, aAfterUnit);
  const toEnd = spBeforeTo > aAfterUnit ? matchWordLowerAt(normLowerText, spBeforeTo, "to") : -1;
  if (toEnd === -1) {
    return -1;
  }
  const bStart = skipSpaces(normText, toEnd);
  if (bStart <= toEnd) {
    return -1;
  }
  const bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStart, prep.isEnglish, true);
  if (bNum === null) {
    return -1;
  }
  const bSuf = scanSuffixUnitFast(
    normText,
    normLowerText,
    bNum.endNorm,
    hasPct || aSuf?.family === "percent",
    bNum.isYearIntCandidate,
  );
  const bAfterUnit = bSuf !== null ? bSuf.endNorm : bNum.endNorm;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, i, bAfterUnit)) {
    return -1;
  }

  const effUnitA = resolveCombinedUnit(prep, aSuf ?? bSuf, null);
  const effUnitB = resolveCombinedUnit(prep, bSuf, null);

  if (!(aNum.isYearIntCandidate && effUnitA.unitFamily === "none")) {
    const valNormA = scaleParsedNumber(aNum, effUnitA.factor);
    pushTupleFromSpan(
      ctx,
      prep.subText.slice(aNum.rawStartSub, aNum.rawEndSub),
      effUnitA,
      false,
      null,
      valNormA,
      valNormA,
      valNormA,
      aNum.sigDigits,
      aStart,
      aAfterUnit,
    );
  }

  if (!(bNum.isYearIntCandidate && effUnitB.unitFamily === "none")) {
    const valNormB = scaleParsedNumber(bNum, effUnitB.factor);
    pushTupleFromSpan(
      ctx,
      prep.subText.slice(bNum.rawStartSub, bNum.rawEndSub),
      effUnitB,
      false,
      null,
      valNormB,
      valNormB,
      valNormB,
      bNum.sigDigits,
      bStart,
      bAfterUnit,
    );
  }

  return bAfterUnit;
}

function tryRule7Between(ctx: ScanRuntimeCtx, i: number): number {
  const { normText, normLowerText, prep } = ctx;
  const betEnd = matchWordLowerAt(normLowerText, i, "between");
  if (betEnd === -1) {
    return -1;
  }
  const aStart = skipSpaces(normText, betEnd);
  if (aStart <= betEnd) {
    return -1;
  }
  const aPrefix = scanLeadingPrefixCurrency(normText, normLowerText, aStart);
  let aNumStart = aStart;
  if (aPrefix !== null) {
    aNumStart = skipSpaces(normText, aPrefix.endNorm);
    if (aNumStart - aPrefix.endNorm > 1) {
      return -1;
    }
  }
  const aNum = parseFiniteNumberAt(
    normText,
    prep.subText,
    prep.normMap,
    aNumStart,
    prep.isEnglish,
    true,
    aPrefix !== null,
  );
  if (aNum === null) {
    return -1;
  }
  const hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct;
  const aSuf = scanSuffixUnitFast(
    normText,
    normLowerText,
    aNum.endNorm,
    hasPct,
    aNum.isYearIntCandidate,
  );
  if (aPrefix !== null && aSuf !== null && (aSuf.family === "unknown" || aPrefix.unitCanon !== aSuf.unitCanon)) {
    return -1;
  }
  const aAfterUnit = aSuf !== null ? aSuf.endNorm : aNum.endNorm;
  const spBeforeAnd = skipSpaces(normText, aAfterUnit);
  const andEnd = spBeforeAnd > aAfterUnit ? matchWordLowerAt(normLowerText, spBeforeAnd, "and") : -1;
  if (andEnd === -1) {
    return -1;
  }
  const bStart = skipSpaces(normText, andEnd);
  if (bStart <= andEnd) {
    return -1;
  }
  const bPrefix = scanLeadingPrefixCurrency(normText, normLowerText, bStart);
  let bNumStart = bStart;
  if (bPrefix !== null) {
    bNumStart = skipSpaces(normText, bPrefix.endNorm);
    if (bNumStart - bPrefix.endNorm > 1) {
      return -1;
    }
  }
  const bNum = parseFiniteNumberAt(
    normText,
    prep.subText,
    prep.normMap,
    bNumStart,
    prep.isEnglish,
    true,
    bPrefix !== null,
  );
  if (bNum === null) {
    return -1;
  }
  const bSuf = scanSuffixUnitFast(
    normText,
    normLowerText,
    bNum.endNorm,
    hasPct || aSuf?.family === "percent",
    bNum.isYearIntCandidate,
  );
  if (bPrefix !== null && bSuf !== null && (bSuf.family === "unknown" || bPrefix.unitCanon !== bSuf.unitCanon)) {
    return -1;
  }
  const effB = bSuf ?? bPrefix;
  if (aSuf !== null) {
    if (effB === null || effB.family === "unknown" || aSuf.unitCanon !== effB.unitCanon) {
      return -1;
    }
  } else if (aPrefix !== null && effB !== null) {
    if (effB.family === "unknown" || aPrefix.unitCanon !== effB.unitCanon) {
      return -1;
    }
  }
  const bAfterUnit = bSuf !== null ? bSuf.endNorm : bNum.endNorm;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, i, bAfterUnit)) {
    return -1;
  }
  const sharedSuf = bSuf ?? aSuf;
  const sharedPrefix = aPrefix ?? bPrefix;
  const unitA = resolveCombinedUnit(prep, aSuf ?? sharedSuf, sharedSuf === null ? sharedPrefix : null);
  const unitB = resolveCombinedUnit(prep, bSuf ?? sharedSuf, sharedSuf === null ? sharedPrefix : null);
  const valLo = scaleParsedNumber(aNum, unitA.factor);
  const valHi = scaleParsedNumber(bNum, unitB.factor);
  pushTupleFromSpan(
    ctx,
    prep.subText.slice(aNum.rawStartSub, bNum.rawEndSub),
    unitB,
    false,
    null,
    (valLo + valHi) / 2,
    valLo,
    valHi,
    Math.max(aNum.sigDigits, bNum.sigDigits),
    i,
    bAfterUnit,
  );
  return bAfterUnit;
}

function tryStandaloneCi(ctx: ScanRuntimeCtx, i: number): number {
  const { normText, normLowerText, prep, n } = ctx;
  const ciHead = tryReadCiOrIqrLabel(normText, normLowerText, i, false);
  if (ciHead === null || ciHead.label !== "ci") {
    return -1;
  }
  let bScan = skipSpaces(normText, ciHead.afterLabelNorm);
  if (bScan >= n) {
    return -1;
  }
  let closeBracket = 0;
  const bStartCh = normText.charCodeAt(bScan);
  if (bStartCh === 91 /* '[' */) {
    closeBracket = 93;
    bScan = skipSpaces(normText, bScan + 1);
  } else if (bStartCh === 40 /* '(' */) {
    closeBracket = 41;
    bScan = skipSpaces(normText, bScan + 1);
  } else if (
    !isAsciiDigitCode(bStartCh) &&
    bStartCh !== 45 &&
    bStartCh !== 43 &&
    bStartCh !== 46
  ) {
    return -1;
  }
  const hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct;
  const bounds = parseIntervalBounds(ctx, bScan, hasPct);
  if (bounds === null || !isRangeUnitCompatible(bounds.bSuf, bounds.cSuf)) {
    return -1;
  }
  let exprEnd = bounds.boundsEndNorm;
  let postUnit: UnitMatch | null = null;
  if (closeBracket !== 0) {
    const closeIdx = skipSpaces(normText, exprEnd);
    if (closeIdx >= n || normText.charCodeAt(closeIdx) !== closeBracket) {
      return -1;
    }
    exprEnd = closeIdx + 1;
    postUnit = scanSuffixUnitFast(normText, normLowerText, exprEnd, hasPct, false);
    if (postUnit !== null) {
      exprEnd = postUnit.endNorm;
    }
  }
  if (overlapsExcludedSpan(ctx.excludedNormSpans, i, exprEnd)) {
    return -1;
  }
  let prefixUnit = scanPrefixUnit(normText, normLowerText, i, ctx.lastConsumedEndNorm);
  if (prefixUnit !== null && overlapsExcludedSpan(ctx.excludedNormSpans, prefixUnit.startNorm, i)) {
    prefixUnit = null;
  }
  const effSuf = postUnit ?? bounds.cSuf ?? bounds.bSuf;
  const unitMatch = resolveCombinedUnit(prep, effSuf, prefixUnit);
  const factorB = bounds.bSuf !== null ? bounds.bSuf.factor : unitMatch.factor;
  const factorC = bounds.cSuf !== null ? bounds.cSuf.factor : unitMatch.factor;
  const valLo = scaleParsedNumber(bounds.bNum, factorB);
  const valHi = scaleParsedNumber(bounds.cNum, factorC);
  const spanStart = prefixUnit !== null ? prefixUnit.startNorm : i;
  pushTupleFromSpan(
    ctx,
    prep.subText.slice(bounds.bNum.rawStartSub, bounds.cNum.rawEndSub),
    unitMatch,
    false,
    null,
    (valLo + valHi) / 2,
    valLo,
    valHi,
    Math.max(bounds.bNum.sigDigits, bounds.cNum.sigDigits),
    spanStart,
    exprEnd,
  );
  return exprEnd;
}

function tryRule2Interval(
  ctx: ScanRuntimeCtx,
  aNum: ParsedNumber,
  aPrefix: UnitMatch | null,
  aSuf: UnitMatch | null,
  exprStartBase: number,
  nextAfterA: number,
  nextChAfterA: number,
): number {
  const { normText, normLowerText, prep, n } = ctx;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, nextAfterA, nextAfterA + 1)) {
    return -1;
  }
  const hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct;
  const isParenOrBracket = nextChAfterA === 40 /* '(' */ || nextChAfterA === 91 /* '[' */;
  let boundsSearchPos: number;
  let hasExplicitLabel: boolean;
  let closeCh = 0;

  if (isParenOrBracket) {
    closeCh = nextChAfterA === 40 ? 41 : 93;
    const innerStart = skipSpaces(normText, nextAfterA + 1);
    const labelMatch =
      nextChAfterA === 40 ? tryReadCiOrIqrLabel(normText, normLowerText, innerStart, true) : null;
    hasExplicitLabel = labelMatch !== null;
    boundsSearchPos = labelMatch !== null ? labelMatch.afterLabelNorm : innerStart;
  } else {
    const afterComma = skipSpaces(normText, nextAfterA + 1);
    const labelMatch = tryReadCiOrIqrLabel(normText, normLowerText, afterComma, false);
    if (labelMatch === null || labelMatch.label !== "ci") {
      return -1;
    }
    hasExplicitLabel = true;
    boundsSearchPos = labelMatch.afterLabelNorm;
  }

  const bounds = parseIntervalBounds(ctx, boundsSearchPos, hasPct);
  if (bounds === null) {
    return -1;
  }

  let finalEnd = bounds.boundsEndNorm;
  let postSuf: UnitMatch | null = null;
  if (isParenOrBracket) {
    const afterC = skipSpaces(normText, bounds.boundsEndNorm);
    if (afterC >= n || normText.charCodeAt(afterC) !== closeCh) {
      return -1;
    }
    const postCloseEnd = afterC + 1;
    if (closeCh === 93 && normText.charCodeAt(postCloseEnd) === 40) {
      return -1;
    }
    postSuf =
      aSuf === null ? scanSuffixUnitFast(normText, normLowerText, postCloseEnd, hasPct, false) : null;
    finalEnd = postSuf !== null ? postSuf.endNorm : postCloseEnd;
  }

  if (!isPointIntervalUnitCompatible(aSuf, aPrefix, bounds.bSuf, bounds.cSuf, postSuf)) {
    return -1;
  }
  if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) {
    return -1;
  }

  const unitMatch = resolveCombinedUnit(prep, aSuf ?? postSuf ?? bounds.cSuf ?? bounds.bSuf, aPrefix);
  const factorA = aSuf !== null ? aSuf.factor : unitMatch.factor;
  const factorB = bounds.bSuf !== null ? bounds.bSuf.factor : unitMatch.factor;
  const factorC = bounds.cSuf !== null ? bounds.cSuf.factor : unitMatch.factor;
  const valA = scaleParsedNumber(aNum, factorA);
  const valB = scaleParsedNumber(bounds.bNum, factorB);
  const valC = scaleParsedNumber(bounds.cNum, factorC);

  if (!hasExplicitLabel) {
    // Anchor bare 4-word interval cue window at `aNum.startNorm` so prefix units (`OR 0.8 (1.2-2.6)`) are inside it.
    const winCheck = locateWordWindow(
      ctx.wordSpans,
      ctx.hasLetterMask,
      aNum.startNorm,
      aNum.endNorm,
      ctx.wordHintIdx,
      4,
    );
    const bareAllowed =
      hasIntervalCueInWindow(ctx.wordSpans, winCheck.beforeStart, winCheck.beforeEnd) ||
      (valB <= valA && valA <= valC);
    if (!bareAllowed) {
      return -1;
    }
  }

  pushTupleFromSpan(
    ctx,
    prep.subText.slice(aNum.rawStartSub, aNum.rawEndSub),
    unitMatch,
    false,
    null,
    valA,
    valB,
    valC,
    aNum.sigDigits,
    exprStartBase,
    finalEnd,
  );
  return finalEnd;
}

function tryRule2bMeanSd(
  ctx: ScanRuntimeCtx,
  aNum: ParsedNumber,
  aPrefix: UnitMatch | null,
  aSuf: UnitMatch | null,
  exprStartBase: number,
  nextAfterA: number,
): number {
  const { normText, normLowerText, prep, n } = ctx;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, nextAfterA, nextAfterA + 1)) {
    return -1;
  }
  const bStart = skipSpaces(normText, nextAfterA + 1);
  const bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStart, prep.isEnglish, false);
  if (bNum === null || bNum.value < 0) {
    return -1;
  }
  const hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct;
  const bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false);
  const afterB = skipSpaces(normText, bSuf !== null ? bSuf.endNorm : bNum.endNorm);
  if (afterB >= n || normText.charCodeAt(afterB) !== 41 /* ')' */) {
    return -1;
  }
  if (bSuf !== null && (aSuf === null || bSuf.family === "unknown" || bSuf.unitCanon !== aSuf.unitCanon)) {
    return -1;
  }
  const cmpA = aSuf !== null && bSuf !== null ? scaleParsedNumber(aNum, aSuf.factor) : aNum.value;
  const cmpB = aSuf !== null && bSuf !== null ? scaleParsedNumber(bNum, bSuf.factor) : bNum.value;
  if (cmpB >= cmpA) {
    return -1;
  }
  const postCloseEnd = afterB + 1;
  const postSuf =
    aSuf === null ? scanSuffixUnitFast(normText, normLowerText, postCloseEnd, hasPct, false) : null;
  const finalEnd = postSuf !== null ? postSuf.endNorm : postCloseEnd;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) {
    return -1;
  }
  const win = locateWordWindow(
    ctx.wordSpans,
    ctx.hasLetterMask,
    exprStartBase,
    finalEnd,
    ctx.wordHintIdx,
    6,
  );
  const winWords = win.hasContentLetter
    ? collectWindowWords(ctx.wordSpans, ctx.hasLetterMask, win)
    : EMPTY_WORDS;
  let localWindowLower = "";
  if (winWords.length > 0) {
    const wStartNorm =
      win.beforeStart < win.beforeEnd ? ctx.wordSpans[win.beforeStart]!.start : exprStartBase;
    const wEndNorm =
      win.afterEnd > win.afterIdx ? ctx.wordSpans[win.afterEnd - 1]!.end : finalEnd;
    localWindowLower = ctx.cleanedLower.slice(wStartNorm, wEndNorm);
  }
  if (!containsMeanSdCue(winWords, localWindowLower, ctx.tableHeaderLower, ctx.tableWindowWords)) {
    return -1;
  }
  const unitMatch = resolveCombinedUnit(prep, aSuf ?? postSuf, aPrefix);
  const valNorm = scaleParsedNumber(aNum, unitMatch.factor);
  pushTupleFromSpan(
    ctx,
    prep.subText.slice(aNum.rawStartSub, aNum.rawEndSub),
    unitMatch,
    false,
    null,
    valNorm,
    valNorm,
    valNorm,
    aNum.sigDigits,
    exprStartBase,
    finalEnd,
  );
  return finalEnd;
}

function tryRule3PlusMinus(
  ctx: ScanRuntimeCtx,
  aNum: ParsedNumber,
  aPrefix: UnitMatch | null,
  aSuf: UnitMatch | null,
  exprStartBase: number,
  nextAfterA: number,
): number {
  const { normText, normLowerText, prep } = ctx;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, nextAfterA, nextAfterA + 1)) {
    return -1;
  }
  let opEnd = -1;
  if (normText.charCodeAt(nextAfterA) === 0x00b1 /* '±' */) {
    opEnd = nextAfterA + 1;
  } else if (normText.startsWith("+/-", nextAfterA)) {
    opEnd = nextAfterA + 3;
  }
  if (opEnd === -1) {
    return -1;
  }
  const bStart = skipSpaces(normText, opEnd);
  const bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStart, prep.isEnglish, false);
  if (bNum === null) {
    return -1;
  }
  const hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct;
  const bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false);
  if (!isPlusMinusUnitCompatible(aSuf, bSuf)) {
    return -1;
  }
  const unitMatch = resolveCombinedUnit(prep, aSuf ?? bSuf, aPrefix);
  const factorB = bSuf !== null ? bSuf.factor : unitMatch.factor;
  const finalEnd = bSuf !== null ? bSuf.endNorm : bNum.endNorm;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) {
    return -1;
  }
  const aScaled = scaleParsedNumber(aNum, unitMatch.factor);
  const bScaled = scaleParsedNumber(bNum, factorB);
  pushTupleFromSpan(
    ctx,
    prep.subText.slice(aNum.rawStartSub, aNum.rawEndSub),
    unitMatch,
    false,
    null,
    aScaled,
    aScaled - bScaled,
    aScaled + bScaled,
    aNum.sigDigits,
    exprStartBase,
    finalEnd,
  );
  return finalEnd;
}

function tryRule7Range(
  ctx: ScanRuntimeCtx,
  aNum: ParsedNumber,
  aPrefix: UnitMatch | null,
  aSuf: UnitMatch | null,
  exprStartBase: number,
  afterANumAndUnit: number,
): number {
  const { normText, normLowerText, prep, n } = ctx;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, afterANumAndUnit, afterANumAndUnit + 1)) {
    return -1;
  }
  const bStart = matchStrictRangeHyphenOrTo(normText, normLowerText, afterANumAndUnit);
  if (bStart === -1) {
    return -1;
  }
  const bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStart, prep.isEnglish, true);
  if (bNum === null) {
    return -1;
  }
  const bSuf = scanSuffixUnitFast(
    normText,
    normLowerText,
    bNum.endNorm,
    ctx.seenPctBeforeCursor || ctx.sentenceHasPct || aSuf?.family === "percent",
    bNum.isYearIntCandidate,
  );
  const finalEnd = bSuf !== null ? bSuf.endNorm : bNum.endNorm;
  if (
    finalEnd < n &&
    normText.charCodeAt(finalEnd) === 45 &&
    finalEnd + 1 < n &&
    isAsciiDigitCode(normText.charCodeAt(finalEnd + 1))
  ) {
    return -1;
  }
  if (!isRangeUnitCompatible(aSuf, bSuf)) {
    return -1;
  }
  if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) {
    return -1;
  }
  const unitMatch = resolveCombinedUnit(prep, bSuf ?? aSuf, aPrefix);
  const factorA = aSuf !== null ? aSuf.factor : unitMatch.factor;
  const factorB = bSuf !== null ? bSuf.factor : unitMatch.factor;
  const valLo = scaleParsedNumber(aNum, factorA);
  const valHi = scaleParsedNumber(bNum, factorB);
  pushTupleFromSpan(
    ctx,
    prep.subText.slice(aNum.rawStartSub, bNum.rawEndSub),
    unitMatch,
    false,
    null,
    (valLo + valHi) / 2,
    valLo,
    valHi,
    Math.max(aNum.sigDigits, bNum.sigDigits),
    exprStartBase,
    finalEnd,
  );
  return finalEnd;
}

function tryRule9WordNumber(ctx: ScanRuntimeCtx, i: number): number {
  const { normText, normLowerText, prep, n } = ctx;
  const wn = parseWordNumberAt(normText, normLowerText, i);
  if (wn === null) {
    return -1;
  }
  if (wn.value < 0) {
    return wn.endNorm;
  }
  const suf = scanSuffixUnitFast(
    normText,
    normLowerText,
    wn.endNorm,
    ctx.seenPctBeforeCursor || ctx.sentenceHasPct,
    false,
  );
  if (suf !== null && suf.family !== "unknown") {
    if (overlapsExcludedSpan(ctx.excludedNormSpans, i, suf.endNorm)) {
      return -1;
    }
    const unitMatch = resolveCombinedUnit(prep, suf, null);
    const valNorm = scaleWordNumber(wn.value, unitMatch.factor);
    pushTupleFromSpan(
      ctx,
      prep.subText.slice(prep.normMap[i] ?? 0, prep.normMap[wn.endNorm] ?? prep.subText.length),
      unitMatch,
      false,
      null,
      valNorm,
      valNorm,
      valNorm,
      computeSigDigits(String(wn.value)),
      i,
      suf.endNorm,
    );
    return suf.endNorm;
  }

  const nextWordPos = skipSpaces(normText, wn.endNorm);
  let nextWordEnd = nextWordPos;
  while (nextWordEnd < n && isBaseLetter(normLowerText.charCodeAt(nextWordEnd))) {
    nextWordEnd++;
  }
  if (nextWordEnd > nextWordPos && !isDigit(normLowerText.charCodeAt(nextWordEnd))) {
    const nextWord = normLowerText.slice(nextWordPos, nextWordEnd);
    if (COUNT_NOUNS.has(nextWord)) {
      if (overlapsExcludedSpan(ctx.excludedNormSpans, i, nextWordEnd)) {
        return -1;
      }
      pushTupleFromSpan(
        ctx,
        prep.subText.slice(prep.normMap[i] ?? 0, prep.normMap[wn.endNorm] ?? prep.subText.length),
        EMPTY_COMBINED_UNIT,
        false,
        null,
        wn.value,
        wn.value,
        wn.value,
        computeSigDigits(String(wn.value)),
        i,
        wn.endNorm,
      );
      return wn.endNorm;
    }
  }
  return wn.endNorm;
}

/**
 * Extracts quantitative expressions (`QuantTuple[]`) and `metricFromUnit` flags (`02` §7, `03` §2.3, §4.1).
 * Pure, linear-time scanner with zero regexes and zero backtracking.
 */
export function extractQuantitiesWithMeta(
  text: string,
  options?: ExtractQuantitiesOptions,
): QuantExtractionMeta {
  const prep = prepareInput(text, {
    ...(options?.lang !== undefined ? { lang: options.lang } : {}),
    ...(options?.format !== undefined ? { format: options.format } : {}),
    ...(options?.applyLatex !== undefined ? { applyLatex: options.applyLatex } : {}),
  });
  const normText = prep.normText;
  const normLowerText = prep.normLowerText;
  const n = normText.length;

  const docId = options?.docId ?? "";
  const section = options?.section ?? "unlabeled";
  const source: TupleSource = options?.source ?? "manuscript";
  const occurrenceIndex = options?.occurrenceIndex ?? 0;
  const sentenceHash = options?.sentenceHash ?? sha256hex(normLowerText);

  let rawCitationSpans: readonly TextRange[];
  if (options?.citationSpans !== undefined) {
    rawCitationSpans = options.citationSpans;
  } else if (text.includes("[") || text.includes("(") || text.includes("\\")) {
    rawCitationSpans = scanCitations(text).map((m) => ({
      start: m.start,
      end: m.end,
    }));
  } else {
    rawCitationSpans = [];
  }
  const excludedNormSpans = mapExcludedSpansToNorm(prep, rawCitationSpans);
  const {
    cleanedLower,
    spans: wordSpans,
    hasLetterMask,
    anyLetterInDoc,
  } = buildProseWordSpans(normText, normLowerText, excludedNormSpans);

  let tableWordSpans: readonly WordSpan[] | null = null;
  let tableLetterMask: Uint8Array | null = null;
  let tableStemCache: (string | null | undefined)[] | null = null;
  let tableWindowWords: readonly string[] | null = null;
  let tableHeaderLower = "";
  let tableCombinedLower = "";
  if (options?.tableHeader !== undefined || options?.rowLabel !== undefined) {
    const hdrLower = normLower(options?.tableHeader ?? "");
    const rowLower = normLower(options?.rowLabel ?? "");
    tableHeaderLower = hdrLower;
    tableCombinedLower =
      hdrLower.length > 0 && rowLower.length > 0 ? hdrLower + " " + rowLower : hdrLower + rowLower;
    const tblSpans = extractWordSpans(tableCombinedLower);
    const tblMaskRes = buildWordMask(tableCombinedLower, tblSpans);
    const filteredTbl: string[] = [];
    for (let t = 0; t < tblSpans.length; t++) {
      if (tblMaskRes.hasLetterMask[t] !== 2) {
        filteredTbl.push(tblSpans[t]!.text);
      }
    }
    tableWordSpans = tblSpans;
    tableLetterMask = tblMaskRes.hasLetterMask;
    tableStemCache = new Array<string | null | undefined>(tblSpans.length);
    tableWindowWords = filteredTbl;
  }

  const cues = detectDocMetricCues(
    cleanedLower,
    wordSpans,
    hasLetterMask,
    tableWindowWords,
    tableCombinedLower,
  );
  const sentenceHasPct = hasPercentageContext(cleanedLower, tableCombinedLower);

  let sentenceHasTo = false;
  let sentenceHasAnd = false;
  let sentenceHasCiWord = false;
  for (let w = 0; w < wordSpans.length; w++) {
    if (hasLetterMask[w] !== 1) {
      continue;
    }
    const word = wordSpans[w]!.text;
    if (word === "to") {
      sentenceHasTo = true;
    } else if (word === "and") {
      sentenceHasAnd = true;
    } else if (word === "ci") {
      sentenceHasCiWord = true;
    }
    if (sentenceHasTo && sentenceHasAnd && sentenceHasCiWord) {
      break;
    }
  }
  const sentenceHasRangeSep =
    sentenceHasTo ||
    normText.includes("-") ||
    normText.includes("\u2013") ||
    normText.includes(",");

  const ctx: ScanRuntimeCtx = {
    prep,
    normText,
    normLowerText,
    cleanedLower,
    n,
    tupleIdHasher: createSha256PrefixHasher(`${docId}|${sentenceHash}|${occurrenceIndex}|`),
    section,
    source,
    anyLetterInDoc,
    wordSpans,
    hasLetterMask,
    excludedNormSpans,
    tableWordSpans,
    tableLetterMask,
    tableStemCache,
    tableWindowWords,
    tableHeaderLower,
    tableCombinedLower,
    sentenceHasPct,
    sentenceHasTo,
    sentenceHasAnd,
    sentenceHasCiWord,
    sentenceHasRangeSep,
    cues,
    wordStemCache: new Array<string | null | undefined>(wordSpans.length),
    tuples: [],
    metricFromUnitList: [],
    wordHintIdx: 0,
    seenPctBeforeCursor: false,
    lastConsumedEndNorm: 0,
  };

  let exclIdx = 0;
  let i = 0;

  while (i < n) {
    while (exclIdx < excludedNormSpans.length && excludedNormSpans[exclIdx]!.end <= i) {
      exclIdx++;
    }
    if (
      exclIdx < excludedNormSpans.length &&
      i >= excludedNormSpans[exclIdx]!.start &&
      i < excludedNormSpans[exclIdx]!.end
    ) {
      i = excludedNormSpans[exclIdx]!.end;
      continue;
    }

    const cu = normText.charCodeAt(i);
    if (
      cu === 32 ||
      cu === 10 ||
      cu === 44 ||
      cu === 59 ||
      cu === 58 ||
      cu === 40 ||
      cu === 41 ||
      cu === 91 ||
      cu === 93
    ) {
      i++;
      continue;
    }
    if (cu === 0x27e6 && normText.startsWith(CITATION_PLACEHOLDER, i)) {
      i += CITATION_PLACEHOLDER.length;
      continue;
    }
    if (cu === 37 /* '%' */) {
      ctx.seenPctBeforeCursor = true;
      i++;
      continue;
    }

    if (cu === 46 && (i + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(i + 1)))) {
      while (
        i < n &&
        normText.charCodeAt(i) === 46 &&
        (i + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(i + 1)))
      ) {
        i++;
      }
      continue;
    }

    // Rule 4: p-value (`p < 0.05`, `P<0.001`, `p-value <= 0.05`).
    const lowerCu = normLowerText.charCodeAt(i);
    if (lowerCu === 112 /* 'p' */) {
      const pMatch = parseRule4PValueAt(normText, normLowerText, prep.subText, prep.normMap, i, prep.isEnglish);
      if (
        pMatch !== null &&
        !overlapsExcludedSpan(excludedNormSpans, pMatch.exprStartNorm, pMatch.exprEndNorm)
      ) {
        const pVal = normalizeZero(pMatch.num.value);
        pushTupleFromSpan(
          ctx,
          prep.subText.slice(pMatch.num.rawStartSub, pMatch.num.rawEndSub),
          EMPTY_COMBINED_UNIT,
          true,
          pMatch.comparator,
          pVal,
          pVal,
          pVal,
          pMatch.num.sigDigits,
          pMatch.exprStartNorm,
          pMatch.exprEndNorm,
        );
        i = pMatch.exprEndNorm;
        continue;
      }
    }

    // Rule 6: `from a to b`
    if (sentenceHasTo && lowerCu === 102 /* 'f' */ && !isWordCharBefore(normText, i)) {
      const nextFrom = tryRule6FromTo(ctx, i);
      if (nextFrom !== -1) {
        i = nextFrom;
        continue;
      }
    }

    // Rule 7 (`between a and b`)
    if (sentenceHasAnd && lowerCu === 98 /* 'b' */ && !isWordCharBefore(normText, i)) {
      const nextBet = tryRule7Between(ctx, i);
      if (nextBet !== -1) {
        i = nextBet;
        continue;
      }
    }

    // Standalone `95% CI b-c` / `95% CI b to c` / `95% CI [b, c]` (suppressing spurious `95%` tuple).
    if (
      sentenceHasPct &&
      sentenceHasCiWord &&
      sentenceHasRangeSep &&
      isAsciiDigitCode(cu) &&
      !isWordCharBefore(normText, i)
    ) {
      const nextCi = tryStandaloneCi(ctx, i);
      if (nextCi !== -1) {
        i = nextCi;
        continue;
      }
    }

    // Rule 5: Dates (`YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY/MM/DD`).
    if (isAsciiDigitCode(cu)) {
      const dateEnd = matchDateEndAt(normText, i);
      if (dateEnd !== -1) {
        i = dateEnd;
        continue;
      }
    }

    // Rules 1, 2, 2b, 3, 7, 8: Numeric value expression.
    const tryConsumeNumericExpr = (
      numPos: number,
      prePrefix: UnitMatch | null,
    ): number => {
      const aNum = parseNumberOrScientificAt(
        normText,
        prep.subText,
        prep.normMap,
        numPos,
        prep.isEnglish,
        prePrefix === null,
        prePrefix !== null,
      );
      if (aNum === null) {
        return -1;
      }
      if (!Number.isFinite(aNum.value)) {
        ctx.lastConsumedEndNorm = aNum.endNorm;
        return aNum.endNorm;
      }
      let aPrefix =
        prePrefix ?? scanPrefixUnit(normText, normLowerText, numPos, ctx.lastConsumedEndNorm);
      if (aPrefix !== null && overlapsExcludedSpan(excludedNormSpans, aPrefix.startNorm, numPos)) {
        aPrefix = null;
      }
      const aSuf = scanSuffixUnitFast(
        normText,
        normLowerText,
        aNum.endNorm,
        ctx.seenPctBeforeCursor || sentenceHasPct,
        aNum.isYearIntCandidate,
      );
      if (aSuf?.family === "percent") {
        ctx.seenPctBeforeCursor = true;
      }
      const afterANumAndUnit = aSuf !== null ? aSuf.endNorm : aNum.endNorm;
      const exprStartBase = aPrefix !== null ? aPrefix.startNorm : numPos;
      const nextAfterA = skipSpaces(normText, afterANumAndUnit);
      const nextChAfterA = nextAfterA < n ? normText.charCodeAt(nextAfterA) : 0;

      if (nextChAfterA === 40 /* '(' */ || nextChAfterA === 91 /* '[' */ || nextChAfterA === 44 /* ',' */) {
        const nextR2 = tryRule2Interval(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA, nextChAfterA);
        if (nextR2 !== -1) {
          return nextR2;
        }
      }
      if (nextChAfterA === 40 /* '(' */) {
        const nextR2b = tryRule2bMeanSd(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA);
        if (nextR2b !== -1) {
          return nextR2b;
        }
      }
      if (nextChAfterA === 0x00b1 /* '±' */ || nextChAfterA === 43 /* '+' */) {
        const nextR3 = tryRule3PlusMinus(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA);
        if (nextR3 !== -1) {
          return nextR3;
        }
      }
      if (
        nextChAfterA === 45 /* '-' */ ||
        nextChAfterA === 0x2013 /* '–' */ ||
        (nextAfterA > afterANumAndUnit && (nextChAfterA === 116 || nextChAfterA === 84))
      ) {
        const nextR7 = tryRule7Range(ctx, aNum, aPrefix, aSuf, exprStartBase, afterANumAndUnit);
        if (nextR7 !== -1) {
          return nextR7;
        }
      }

      // Rule 8: Single number (skipping unitless year-like integers 1900..2099).
      const unitMatch = resolveCombinedUnit(prep, aSuf, aPrefix);
      if (
        !(aNum.isYearIntCandidate && unitMatch.unitFamily === "none") &&
        !overlapsExcludedSpan(excludedNormSpans, exprStartBase, afterANumAndUnit)
      ) {
        const valNorm = scaleParsedNumber(aNum, unitMatch.factor);
        pushTupleFromSpan(
          ctx,
          prep.subText.slice(aNum.rawStartSub, aNum.rawEndSub),
          unitMatch,
          false,
          null,
          valNorm,
          valNorm,
          valNorm,
          aNum.sigDigits,
          exprStartBase,
          afterANumAndUnit,
        );
      }
      return afterANumAndUnit;
    };

    if (isAsciiDigitCode(cu) || cu === 45 || cu === 43 || cu === 46) {
      const nextNum = tryConsumeNumericExpr(i, null);
      if (nextNum !== -1) {
        i = nextNum;
        continue;
      }
    }

    // Rule 9: Word numbers when next word is a §7.3 unit or a COUNT_NOUNS word,
    // plus unspaced letter prefix currencies (`Rp5000`, `USD10`, `EUR5`).
    const firstCp = cu < 0x80 ? cu : codePointAtSafe(normText, i).cp;
    if (isBaseLetter(firstCp)) {
      const nextR9 = tryRule9WordNumber(ctx, i);
      if (nextR9 !== -1) {
        i = nextR9;
        continue;
      }

      const leadCur = scanLeadingPrefixCurrency(normText, normLowerText, i);
      if (
        leadCur !== null &&
        leadCur.endNorm < n &&
        isAsciiDigitCode(normText.charCodeAt(leadCur.endNorm))
      ) {
        const nextCurNum = tryConsumeNumericExpr(leadCur.endNorm, leadCur);
        if (nextCurNum !== -1) {
          i = nextCurNum;
          continue;
        }
      }

      while (i < n) {
        const u = codePointAtSafe(normText, i);
        if (isBaseLetter(u.cp) || isDigit(u.cp)) {
          i += u.len;
        } else {
          break;
        }
      }
      continue;
    }

    if (isAsciiDigitCode(cu)) {
      while (i < n) {
        const chRun = normText.charCodeAt(i);
        if (isAsciiDigitCode(chRun) || chRun === 46) {
          i++;
        } else {
          break;
        }
      }
      continue;
    }

    const stepLen = cu < 0x80 ? 1 : codePointAtSafe(normText, i).len;
    i += stepLen;
  }

  return {
    tuples: ctx.tuples,
    metricFromUnitByTupleIndex: ctx.metricFromUnitList,
  };
}

export function extractQuantities(
  text: string,
  options?: ExtractQuantitiesOptions,
): QuantTuple[] {
  return [...extractQuantitiesWithMeta(text, options).tuples];
}
