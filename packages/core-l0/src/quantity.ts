import { applyLatexSubstitutions } from "./latex.js";
import type { SourceFormat } from "./mask.js";
import {
  DOSE_SINGLE_WORDS,
  EFFECT_SIZE_SINGLE_WORDS,
  SAMPLE_SIZE_SINGLE_WORDS,
  classifyMetricClass,
  classifyUnitOnly,
  type MetricClass,
} from "./metricClass.js";
import {
  codePointAtSafe,
  createSha256PrefixHasher,
  isBaseLetter,
  isDigit,
  isPunctuation,
  isSpace,
  lowercaseNormalized,
  norm,
  normLower,
  sha256hex,
  type Sha256PrefixHasher,
} from "./norm.js";
import { BM25_STOPWORDS, porterStem } from "./porter.js";
import { extractWordSpans, scanCitations, type WordSpan } from "./citations.js";
import {
  UNIT_WORDS,
  isKnownSuffixWordUnit,
  scanPrefixUnit,
  scanSuffixUnitFast,
  type UnitFamily,
  type UnitMatch,
} from "./units.js";

export interface TextRange {
  start: number;
  end: number;
}

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
  "datasets"
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

export interface ClaimNormOptions {
  readonly lang?: string;
  readonly format?: SourceFormat;
  readonly applyLatex?: boolean;
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
  "iqr"
]);

const MEAN_SD_CUES: ReadonlySet<string> = new Set([
  "mean",
  "sd"
]);

const WORD_UNITS_0_19: ReadonlyMap<string, number> = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19]
]);

const WORD_TENS: ReadonlyMap<string, number> = new Map([
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90]
]);

const FORBIDDEN_ONE_NEXT: ReadonlySet<string> = new Set([
  "of",
  "can",
  "or",
  "another",
  "hand",
  "way"
]);

const SUPERSCRIPT_CHAR_MAP: ReadonlyMap<number, string> = new Map([
  [0x207b, "-"],
  [0x207a, "+"],
  [0x2070, "0"],
  [0x00b9, "1"],
  [0x00b2, "2"],
  [0x00b3, "3"],
  [0x2074, "4"],
  [0x2075, "5"],
  [0x2076, "6"],
  [0x2077, "7"],
  [0x2078, "8"],
  [0x2079, "9"]
]);

const PERCENT_CONTEXT_WORDS: ReadonlySet<string> = new Set([
  "percent",
  "pct",
  "percentage",
  "pp"
]);

const CITATION_PLACEHOLDER = "\u27e6c\u27e7";

export function isEnglishLocale(lang: string | undefined): boolean {
  if (lang === undefined) {
    return true;
  }
  const trimmed = lang.trim();
  if (trimmed.length === 0) {
    return true;
  }
  let baseEnd = trimmed.length;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charCodeAt(i);
    if (ch === 45 /* '-' */ || ch === 95 /* '_' */) {
      baseEnd = i;
      break;
    }
  }
  return asciiLower(trimmed.slice(0, baseEnd)) === "en";
}

function asciiLower(s: string): string {
  let out = "";
  let changed = false;
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    if (cu >= 65 && cu <= 90) {
      if (!changed) {
        out = s.slice(0, i);
        changed = true;
      }
      out += String.fromCharCode(cu + 32);
    } else if (changed) {
      out += s.charAt(i);
    }
  }
  return changed ? out : s;
}

function isAsciiDigitCode(cu: number): boolean {
  return cu >= 48 && cu <= 57;
}

function isWordCharAt(text: string, idx: number): boolean {
  if (idx < 0 || idx >= text.length) {
    return false;
  }
  const u = codePointAtSafe(text, idx);
  return isBaseLetter(u.cp) || isDigit(u.cp);
}

function codePointBefore(text: string, endIdx: number): { cp: number; len: number } {
  const cu = text.charCodeAt(endIdx - 1);
  if (cu >= 0xdc00 && cu <= 0xdfff && endIdx >= 2) {
    const hi = text.charCodeAt(endIdx - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) {
      return { cp: ((hi - 0xd800) << 10) + (cu - 0xdc00) + 0x10000, len: 2 };
    }
  }
  return { cp: cu, len: 1 };
}

function isWordCharBefore(text: string, idx: number): boolean {
  if (idx <= 0) {
    return false;
  }
  const u = codePointBefore(text, idx);
  return isBaseLetter(u.cp) || isDigit(u.cp);
}

/**
 * Computes significant digits of the main number as written (`02` §7.2):
 * - Decimal strings (`48.0` -> 3; `0.045` -> 2; `1.20` -> 3): count from first non-zero digit to end.
 * - Integer strings (`1,200` -> 2; `48` -> 2): strip leading and trailing `'0'`, minimum 1.
 */
export function computeSigDigits(mantissaDigitsNormalized: string): number {
  const hasDecimal = mantissaDigitsNormalized.includes(".");
  if (hasDecimal) {
    let firstNonZeroSeen = false;
    let count = 0;
    for (let i = 0; i < mantissaDigitsNormalized.length; i++) {
      const cu = mantissaDigitsNormalized.charCodeAt(i);
      if (isAsciiDigitCode(cu)) {
        if (!firstNonZeroSeen) {
          if (cu !== 48) {
            firstNonZeroSeen = true;
            count = 1;
          }
        } else {
          count++;
        }
      }
    }
    return count > 0 ? count : 1;
  }

  let first = -1;
  let last = -1;
  for (let i = 0; i < mantissaDigitsNormalized.length; i++) {
    const cu = mantissaDigitsNormalized.charCodeAt(i);
    if (isAsciiDigitCode(cu) && cu !== 48) {
      if (first === -1) {
        first = i;
      }
      last = i;
    }
  }
  if (first === -1) {
    return 1;
  }
  let count = 0;
  for (let i = first; i <= last; i++) {
    if (isAsciiDigitCode(mantissaDigitsNormalized.charCodeAt(i))) {
      count++;
    }
  }
  return count > 0 ? count : 1;
}

/**
 * Formats an IEEE-754 finite double as its shortest round-trip decimal string (`01` §3.2):
 * always uses `.` as decimal separator, preserves `-` on negatives, and never emits `-0` or leading `+`.
 */
export function formatCanonicalDecimal(value: number): string {
  if (Object.is(value, -0) || value === 0) {
    return "0";
  }
  return String(value);
}

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

interface ParsedNumber {
  readonly startNorm: number;
  readonly endNorm: number;
  readonly value: number;
  readonly sigDigits: number;
  readonly mantissaNormalized: string;
  readonly expInt: number;
  readonly hasExponent: boolean;
  readonly hasDecimalSeparator: boolean;
  readonly isYearIntCandidate: boolean;
  readonly rawEndSub: number;
  readonly rawStartSub: number;
}

function factorPow10Exp(factor: number): number | null {
  switch (factor) {
    case 1:
      return 0;
    case 10:
      return 1;
    case 1e3:
      return 3;
    case 1e4:
      return 4;
    case 1e6:
      return 6;
    case 1e-3:
      return -3;
    case 1e-6:
      return -6;
    default:
      return null;
  }
}

function scaleDecimalMantissa(mantissaNormalized: string, baseExp: number, deltaExp: number): number {
  const totalExp = baseExp + deltaExp;
  const raw =
    totalExp === 0 ? Number(mantissaNormalized) : Number(`${mantissaNormalized}e${String(totalExp)}`);
  if (!Number.isFinite(raw)) {
    return raw;
  }
  return Object.is(raw, -0) || raw === 0 ? 0 : raw;
}

function scaleParsedNumber(num: ParsedNumber, factor: number): number {
  if (factor === 1) {
    return Object.is(num.value, -0) || num.value === 0 ? 0 : num.value;
  }
  const deltaExp = factorPow10Exp(factor);
  if (deltaExp !== null) {
    return scaleDecimalMantissa(num.mantissaNormalized, num.expInt, deltaExp);
  }
  const prod = num.value * factor;
  return !Number.isFinite(prod) ? prod : Object.is(prod, -0) || prod === 0 ? 0 : prod;
}

function scaleWordNumber(value: number, factor: number): number {
  if (factor === 1) {
    return Object.is(value, -0) || value === 0 ? 0 : value;
  }
  const deltaExp = factorPow10Exp(factor);
  if (deltaExp !== null) {
    return scaleDecimalMantissa(String(value), 0, deltaExp);
  }
  const prod = value * factor;
  return !Number.isFinite(prod) ? prod : Object.is(prod, -0) || prod === 0 ? 0 : prod;
}

const SINGLE_DIGIT_STRINGS: readonly string[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

function isThinSpaceSeparatorAt(
  normText: string,
  normIdx: number,
  rawSubText: string,
  normMap: readonly number[],
): boolean {
  if (normIdx >= normText.length || normText.charCodeAt(normIdx) !== 32) {
    return false;
  }
  const rawStart = normMap[normIdx];
  const rawEnd = normMap[normIdx + 1];
  if (rawStart === undefined || rawEnd === undefined || rawEnd <= rawStart) {
    return false;
  }
  for (let r = rawStart; r < rawEnd; r++) {
    const cu = rawSubText.charCodeAt(r);
    if (cu !== 0x2009 && cu !== 0x202f) {
      return false;
    }
  }
  return true;
}

function countDigitsAt(text: string, pos: number): number {
  let k = pos;
  while (k < text.length && isAsciiDigitCode(text.charCodeAt(k))) {
    k++;
  }
  return k - pos;
}

function makeOverflowNumber(
  pos: number,
  endPos: number,
  negative: boolean,
  rawSubText: string,
  normMap: readonly number[],
): ParsedNumber {
  return {
    startNorm: pos,
    endNorm: endPos,
    value: negative ? -Infinity : Infinity,
    sigDigits: 1,
    mantissaNormalized: "",
    expInt: 0,
    hasExponent: false,
    hasDecimalSeparator: false,
    isYearIntCandidate: false,
    rawStartSub: normMap[pos] ?? 0,
    rawEndSub: normMap[endPos] ?? rawSubText.length,
  };
}

function parsePlainNumberAt(
  normText: string,
  rawSubText: string,
  normMap: readonly number[],
  pos: number,
  isEnglish: boolean,
  allowSign: boolean,
): ParsedNumber | null {
  const n = normText.length;
  if (pos >= n) {
    return null;
  }

  // Exponents such as `R^2` / `x^-2` / `R².`: never treat the exponent as a standalone quantity.
  if (pos > 0 && normText.charCodeAt(pos - 1) === 94 /* '^' */) {
    return null;
  }
  if (
    pos >= 2 &&
    normText.charCodeAt(pos - 2) === 94 /* '^' */ &&
    (normText.charCodeAt(pos - 1) === 45 /* '-' */ || normText.charCodeAt(pos - 1) === 43 /* '+' */)
  ) {
    return null;
  }

  let cur = pos;
  let negative = false;
  const cu0 = normText.charCodeAt(cur);
  if (cu0 === 45 /* '-' */ || cu0 === 43 /* '+' */) {
    if (!allowSign) {
      return null;
    }
    if (cur > 0) {
      const prevCu = normText.charCodeAt(cur - 1);
      if (prevCu === 41 /* ')' */ || prevCu === 93 /* ']' */ || isWordCharBefore(normText, cur)) {
        return null;
      }
    }
    if (cur + 1 >= n) {
      return null;
    }
    const afterSign = normText.charCodeAt(cur + 1);
    const isLeadingDotDec =
      afterSign === 46 && cur + 2 < n && isAsciiDigitCode(normText.charCodeAt(cur + 2));
    if (!isAsciiDigitCode(afterSign) && !isLeadingDotDec) {
      return null;
    }
    negative = cu0 === 45;
    cur++;
  } else if (isWordCharBefore(normText, cur)) {
    return null;
  }

  // Rule 6: Leading `.` decimal (`.045`).
  if (normText.charCodeAt(cur) === 46 /* '.' */) {
    if (cur + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(cur + 1))) {
      return null;
    }
    if (cur > 0 && normText.charCodeAt(cur - 1) === 46) {
      return null;
    }
    const fracDigitsLen = countDigitsAt(normText, cur + 1);
    const fracEnd = cur + 1 + fracDigitsLen;
    // Reject multi-dot chains like `.1.1.1`.
    if (
      fracEnd + 1 < n &&
      normText.charCodeAt(fracEnd) === 46 &&
      isAsciiDigitCode(normText.charCodeAt(fracEnd + 1))
    ) {
      return null;
    }
    const fracStr = normText.slice(cur + 1, fracEnd);
    const canonStr = (negative ? "-" : "") + "0." + fracStr;
    const val = Number(canonStr);
    if (!Number.isFinite(val)) {
      return null;
    }
    return {
      startNorm: pos,
      endNorm: fracEnd,
      value: val,
      sigDigits: computeSigDigits("0." + fracStr),
      mantissaNormalized: canonStr,
      expInt: 0,
      hasExponent: false,
      hasDecimalSeparator: true,
      isYearIntCandidate: false,
      rawStartSub: normMap[pos] ?? 0,
      rawEndSub: normMap[fracEnd] ?? rawSubText.length,
    };
  }

  if (!isAsciiDigitCode(normText.charCodeAt(cur))) {
    return null;
  }

  const g0Len = countDigitsAt(normText, cur);
  const g0Start = cur;
  const g0End = cur + g0Len;

  // Fast path for clean 1–3 digit unsigned integers without `,`, `.`, or thin-space grouping.
  if (!negative && g0Len <= 3) {
    const nextCh = g0End < n ? normText.charCodeAt(g0End) : 0;
    if (
      nextCh !== 44 /* ',' */ &&
      nextCh !== 46 /* '.' */ &&
      (nextCh !== 32 || !isThinSpaceSeparatorAt(normText, g0End, rawSubText, normMap))
    ) {
      const d0 = normText.charCodeAt(g0Start) - 48;
      let fastVal = d0;
      let sig = 1;
      if (g0Len === 2) {
        const d1 = normText.charCodeAt(g0Start + 1) - 48;
        fastVal = d0 * 10 + d1;
        if (d0 !== 0) {
          sig = d1 !== 0 ? 2 : 1;
        }
      } else if (g0Len === 3) {
        const d1 = normText.charCodeAt(g0Start + 1) - 48;
        const d2 = normText.charCodeAt(g0Start + 2) - 48;
        fastVal = d0 * 100 + d1 * 10 + d2;
        if (d0 === 0) {
          sig = d1 !== 0 && d2 !== 0 ? 2 : 1;
        } else {
          sig = d2 !== 0 ? 3 : d1 !== 0 ? 2 : 1;
        }
      }
      return {
        startNorm: pos,
        endNorm: g0End,
        value: fastVal,
        sigDigits: sig,
        mantissaNormalized: g0Len === 1 ? SINGLE_DIGIT_STRINGS[d0]! : normText.slice(g0Start, g0End),
        expInt: 0,
        hasExponent: false,
        hasDecimalSeparator: false,
        isYearIntCandidate: false,
        rawStartSub: normMap[pos] ?? 0,
        rawEndSub: normMap[g0End] ?? rawSubText.length,
      };
    }
  }

  const g0Str = normText.slice(g0Start, g0End);

  let intClean = g0Str;
  let fracClean = "";
  let hasDecimal = false;
  let endPos = g0End;

  // Check comma thousands (`12,345` or `1,234,567`), thin-space thousands (`12\u2009345`),
  // dot thousands (`12.345` non-English), decimal comma (`0,45` non-English), or decimal dot.
  if (g0End < n) {
    const sep = normText.charCodeAt(g0End);

    if (sep === 44 /* ',' */) {
      let commaGroupCount = 0;
      let scan = g0End;
      let firstNonZeroGroup = -1;
      const canScanCommaThousands =
        g0Len <= 3 && (g0Str.charCodeAt(0) !== 48 || g0Len === 1);
      if (canScanCommaThousands) {
        while (
          scan + 3 < n &&
          normText.charCodeAt(scan) === 44 &&
          isAsciiDigitCode(normText.charCodeAt(scan + 1)) &&
          isAsciiDigitCode(normText.charCodeAt(scan + 2)) &&
          isAsciiDigitCode(normText.charCodeAt(scan + 3)) &&
          (scan + 4 >= n || !isAsciiDigitCode(normText.charCodeAt(scan + 4)))
        ) {
          if (
            firstNonZeroGroup === -1 &&
            (normText.charCodeAt(scan + 1) !== 48 ||
              normText.charCodeAt(scan + 2) !== 48 ||
              normText.charCodeAt(scan + 3) !== 48)
          ) {
            firstNonZeroGroup = commaGroupCount;
          }
          commaGroupCount++;
          scan += 4;
        }
      }

      const commaLooksLikeThousands =
        commaGroupCount > 0 &&
        g0Len <= 3 &&
        (g0Str.charCodeAt(0) !== 48 || (g0Len === 1 && commaGroupCount > 1)) &&
        (isEnglish ||
          commaGroupCount >= 2 ||
          (scan + 1 < n &&
            normText.charCodeAt(scan) === 46 &&
            isAsciiDigitCode(normText.charCodeAt(scan + 1))));

      if (commaLooksLikeThousands) {
        endPos = scan;
        if (
          endPos + 1 < n &&
          normText.charCodeAt(endPos) === 46 &&
          isAsciiDigitCode(normText.charCodeAt(endPos + 1))
        ) {
          const fLen = countDigitsAt(normText, endPos + 1);
          fracClean = normText.slice(endPos + 1, endPos + 1 + fLen);
          hasDecimal = true;
          endPos = endPos + 1 + fLen;
        }
        if (g0Str.charCodeAt(0) === 48) {
          if (firstNonZeroGroup === -1) {
            intClean = "0";
          } else {
            const nzBase = g0End + firstNonZeroGroup * 4;
            const lz =
              normText.charCodeAt(nzBase + 1) !== 48
                ? 0
                : normText.charCodeAt(nzBase + 2) !== 48
                  ? 1
                  : 2;
            const effDigits = (3 - lz) + (commaGroupCount - 1 - firstNonZeroGroup) * 3;
            if (effDigits > 309) {
              return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
            }
            intClean = normText.slice(nzBase + 1 + lz, nzBase + 4);
            let k = nzBase + 4;
            for (let g = firstNonZeroGroup + 1; g < commaGroupCount; g++) {
              intClean += normText.slice(k + 1, k + 4);
              k += 4;
            }
          }
        } else {
          if (g0Len + commaGroupCount * 3 > 309) {
            return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
          }
          intClean = g0Str;
          let k = g0End;
          for (let g = 0; g < commaGroupCount; g++) {
            intClean += normText.slice(k + 1, k + 4);
            k += 4;
          }
        }
      } else if (!isEnglish && g0End + 1 < n && isAsciiDigitCode(normText.charCodeAt(g0End + 1))) {
        // Non-English decimal comma (`0,45`, `1,5`, `12,345`).
        const fLen = countDigitsAt(normText, g0End + 1);
        fracClean = normText.slice(g0End + 1, g0End + 1 + fLen);
        hasDecimal = true;
        endPos = g0End + 1 + fLen;
      }
    } else if (
      sep === 32 &&
      g0Len <= 3 &&
      g0Str.charCodeAt(0) !== 48 &&
      isThinSpaceSeparatorAt(normText, g0End, rawSubText, normMap) &&
      g0End + 3 < n &&
      isAsciiDigitCode(normText.charCodeAt(g0End + 1)) &&
      isAsciiDigitCode(normText.charCodeAt(g0End + 2)) &&
      isAsciiDigitCode(normText.charCodeAt(g0End + 3)) &&
      (g0End + 4 >= n || !isAsciiDigitCode(normText.charCodeAt(g0End + 4)))
    ) {
      let scan = g0End;
      let thinGroupCount = 0;
      while (
        scan + 3 < n &&
        isThinSpaceSeparatorAt(normText, scan, rawSubText, normMap) &&
        isAsciiDigitCode(normText.charCodeAt(scan + 1)) &&
        isAsciiDigitCode(normText.charCodeAt(scan + 2)) &&
        isAsciiDigitCode(normText.charCodeAt(scan + 3)) &&
        (scan + 4 >= n || !isAsciiDigitCode(normText.charCodeAt(scan + 4)))
      ) {
        thinGroupCount++;
        scan += 4;
      }
      endPos = scan;
      if (endPos + 1 < n && isAsciiDigitCode(normText.charCodeAt(endPos + 1))) {
        const trailingSep = normText.charCodeAt(endPos);
        if (trailingSep === 46 || (!isEnglish && trailingSep === 44)) {
          const fLen = countDigitsAt(normText, endPos + 1);
          fracClean = normText.slice(endPos + 1, endPos + 1 + fLen);
          hasDecimal = true;
          endPos = endPos + 1 + fLen;
        }
      }
      if (g0Len + thinGroupCount * 3 > 309) {
        return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
      }
      intClean = g0Str;
      let k = g0End;
      for (let g = 0; g < thinGroupCount; g++) {
        intClean += normText.slice(k + 1, k + 4);
        k += 4;
      }
    } else if (sep === 46 /* '.' */) {
      if (g0End + 1 < n && isAsciiDigitCode(normText.charCodeAt(g0End + 1))) {
        // Non-English dot thousands: `.` + 3 digits + non-digit, integer part 1-3 digits not starting with `0`.
        let dotGroupCount = 0;
        if (!isEnglish && g0Len >= 1 && g0Len <= 3 && g0Str.charCodeAt(0) !== 48) {
          let scan = g0End;
          while (
            scan + 3 < n &&
            normText.charCodeAt(scan) === 46 &&
            isAsciiDigitCode(normText.charCodeAt(scan + 1)) &&
            isAsciiDigitCode(normText.charCodeAt(scan + 2)) &&
            isAsciiDigitCode(normText.charCodeAt(scan + 3)) &&
            (scan + 4 >= n || !isAsciiDigitCode(normText.charCodeAt(scan + 4)))
          ) {
            dotGroupCount++;
            scan += 4;
          }
          // Verify any next char isn't `.digit` of another invalid length (e.g. `1.234.5`).
          if (
            dotGroupCount > 0 &&
            scan + 1 < n &&
            normText.charCodeAt(scan) === 46 &&
            isAsciiDigitCode(normText.charCodeAt(scan + 1))
          ) {
            dotGroupCount = 0;
          }
        }

        if (dotGroupCount > 0) {
          endPos = g0End + dotGroupCount * 4;
          if (
            endPos + 1 < n &&
            normText.charCodeAt(endPos) === 44 &&
            isAsciiDigitCode(normText.charCodeAt(endPos + 1))
          ) {
            const fLen = countDigitsAt(normText, endPos + 1);
            fracClean = normText.slice(endPos + 1, endPos + 1 + fLen);
            hasDecimal = true;
            endPos = endPos + 1 + fLen;
          }
          if (g0Len + dotGroupCount * 3 > 309) {
            return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
          }
          intClean = g0Str;
          let k = g0End;
          for (let g = 0; g < dotGroupCount; g++) {
            intClean += normText.slice(k + 1, k + 4);
            k += 4;
          }
        } else {
          const fLen = countDigitsAt(normText, g0End + 1);
          const fEnd = g0End + 1 + fLen;
          // Reject multi-dot version/IP/chain runs like `1.1.1.1...`.
          if (
            fEnd + 1 < n &&
            normText.charCodeAt(fEnd) === 46 &&
            isAsciiDigitCode(normText.charCodeAt(fEnd + 1))
          ) {
            return null;
          }
          fracClean = normText.slice(g0End + 1, fEnd);
          hasDecimal = true;
          endPos = fEnd;
        }
      }
    }
  }

  let leadZeros = 0;
  while (leadZeros < intClean.length && intClean.charCodeAt(leadZeros) === 48) {
    leadZeros++;
  }
  if (intClean.length - leadZeros > 309) {
    return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
  }

  const unsignedMantissa = hasDecimal ? intClean + "." + fracClean : intClean;
  const signedMantissa = (negative ? "-" : "") + unsignedMantissa;
  const val = Number(signedMantissa);
  if (!Number.isFinite(val)) {
    return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
  }

  const isYearIntCandidate =
    !negative &&
    !hasDecimal &&
    g0Len === 4 &&
    endPos === g0End &&
    val >= 1900 &&
    val <= 2099;

  return {
    startNorm: pos,
    endNorm: endPos,
    value: val,
    sigDigits: computeSigDigits(unsignedMantissa),
    mantissaNormalized: signedMantissa,
    expInt: 0,
    hasExponent: false,
    hasDecimalSeparator: hasDecimal,
    isYearIntCandidate,
    rawStartSub: normMap[pos] ?? 0,
    rawEndSub: normMap[endPos] ?? rawSubText.length,
  };
}

function parseExponentSuffix(
  normText: string,
  afterMantissa: number,
): { expInt: number; endNorm: number } | null {
  const n = normText.length;
  if (afterMantissa >= n) {
    return null;
  }

  // Form A: `e±b` / `E±b` directly attached (no trailing letters immediately after exponent digits).
  const ch = normText.charCodeAt(afterMantissa);
  if (ch === 101 /* 'e' */ || ch === 69 /* 'E' */) {
    let k = afterMantissa + 1;
    let expNeg = false;
    if (k < n && (normText.charCodeAt(k) === 45 || normText.charCodeAt(k) === 43)) {
      expNeg = normText.charCodeAt(k) === 45;
      k++;
    }
    if (k < n && isAsciiDigitCode(normText.charCodeAt(k))) {
      const dStart = k;
      while (k < n && isAsciiDigitCode(normText.charCodeAt(k))) {
        k++;
      }
      if (!isWordCharAt(normText, k)) {
        const expInt = Number((expNeg ? "-" : "") + normText.slice(dStart, k));
        if (Number.isInteger(expInt)) {
          return { expInt, endNorm: k };
        }
      }
    }
  }

  // Form B: ` × 10^b`, ` x 10^b`, ` · 10^b`, with optional `{...}` or Unicode superscripts.
  let k = afterMantissa;
  while (k < n && normText.charCodeAt(k) === 32) {
    k++;
  }
  if (k >= n) {
    return null;
  }
  const op = normText.charCodeAt(k);
  if (op === 0x00d7 /* '×' */ || op === 120 /* 'x' */ || op === 88 /* 'X' */ || op === 0x00b7 /* '·' */) {
    k++;
    while (k < n && normText.charCodeAt(k) === 32) {
      k++;
    }
    if (k + 2 <= n && normText.charCodeAt(k) === 49 && normText.charCodeAt(k + 1) === 48) {
      k += 2;
      while (k < n && normText.charCodeAt(k) === 32) {
        k++;
      }
      if (k < n && normText.charCodeAt(k) === 94 /* '^' */) {
        k++;
        const hasBrace = k < n && normText.charCodeAt(k) === 123 /* '{' */;
        if (hasBrace) {
          k++;
        }
        let expNeg = false;
        if (k < n && (normText.charCodeAt(k) === 45 || normText.charCodeAt(k) === 43)) {
          expNeg = normText.charCodeAt(k) === 45;
          k++;
        }
        const dStart = k;
        while (k < n && isAsciiDigitCode(normText.charCodeAt(k))) {
          k++;
        }
        if (k > dStart) {
          const expStr = normText.slice(dStart, k);
          if (hasBrace) {
            if (k >= n || normText.charCodeAt(k) !== 125 /* '}' */) {
              return null;
            }
            k++;
          }
          if (!isWordCharAt(normText, k)) {
            const expInt = Number((expNeg ? "-" : "") + expStr);
            if (Number.isInteger(expInt)) {
              return { expInt, endNorm: k };
            }
          }
        }
      } else {
        // Unicode superscript exponent, e.g. `10⁻³`.
        let supStr = "";
        let supIdx = k;
        while (supIdx < n) {
          const mapped = SUPERSCRIPT_CHAR_MAP.get(normText.charCodeAt(supIdx));
          if (mapped === undefined) {
            break;
          }
          supStr += mapped;
          supIdx++;
        }
        if (supStr.length > 0 && !isWordCharAt(normText, supIdx)) {
          const expInt = Number(supStr);
          if (Number.isInteger(expInt)) {
            return { expInt, endNorm: supIdx };
          }
        }
      }
    }
  }

  return null;
}

function parseNumberOrScientificAt(
  normText: string,
  rawSubText: string,
  normMap: readonly number[],
  pos: number,
  isEnglish: boolean,
  allowSign: boolean,
): ParsedNumber | null {
  const base = parsePlainNumberAt(normText, rawSubText, normMap, pos, isEnglish, allowSign);
  if (base === null) {
    return null;
  }
  const chAfter = base.endNorm < normText.length ? normText.charCodeAt(base.endNorm) : 0;
  if (
    chAfter !== 101 &&
    chAfter !== 69 &&
    chAfter !== 32 &&
    chAfter !== 0x00d7 &&
    chAfter !== 120 &&
    chAfter !== 88 &&
    chAfter !== 0x00b7
  ) {
    return base;
  }
  const exp = parseExponentSuffix(normText, base.endNorm);
  if (exp === null) {
    return base;
  }
  if (!Number.isFinite(base.value)) {
    return {
      startNorm: base.startNorm,
      endNorm: exp.endNorm,
      value: base.value,
      sigDigits: 1,
      mantissaNormalized: "",
      expInt: 0,
      hasExponent: true,
      hasDecimalSeparator: false,
      isYearIntCandidate: false,
      rawStartSub: base.rawStartSub,
      rawEndSub: normMap[exp.endNorm] ?? rawSubText.length,
    };
  }
  const sciVal = Number(base.mantissaNormalized + "e" + String(exp.expInt));
  if (!Number.isFinite(sciVal)) {
    const isNeg = base.value < 0 || base.mantissaNormalized.startsWith("-");
    return makeOverflowNumber(base.startNorm, exp.endNorm, isNeg, rawSubText, normMap);
  }
  return {
    startNorm: base.startNorm,
    endNorm: exp.endNorm,
    value: sciVal,
    sigDigits: base.sigDigits,
    mantissaNormalized: base.mantissaNormalized,
    expInt: exp.expInt,
    hasExponent: true,
    hasDecimalSeparator: base.hasDecimalSeparator,
    isYearIntCandidate: false,
    rawStartSub: base.rawStartSub,
    rawEndSub: normMap[exp.endNorm] ?? rawSubText.length,
  };
}

function parseFiniteNumberAt(
  normText: string,
  rawSubText: string,
  normMap: readonly number[],
  pos: number,
  isEnglish: boolean,
  allowSign: boolean,
): ParsedNumber | null {
  const num = parseNumberOrScientificAt(normText, rawSubText, normMap, pos, isEnglish, allowSign);
  return num !== null && Number.isFinite(num.value) ? num : null;
}

/**
 * Checks Rule 5 ISO/slash dates (`YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY/MM/DD`)
 * and returns the end offset if matched, or `-1`.
 */
function matchDateEndAt(normText: string, pos: number): number {
  const n = normText.length;
  if (pos >= n || !isAsciiDigitCode(normText.charCodeAt(pos)) || isWordCharBefore(normText, pos)) {
    return -1;
  }
  const len0 = countDigitsAt(normText, pos);
  if (len0 !== 1 && len0 !== 2 && len0 !== 4) {
    return -1;
  }
  const sepIdx = pos + len0;
  if (sepIdx >= n) {
    return -1;
  }
  const sep = normText.charCodeAt(sepIdx);
  if (sep !== 45 /* '-' */ && sep !== 47 /* '/' */) {
    return -1;
  }
  const p1 = sepIdx + 1;
  const len1 = countDigitsAt(normText, p1);
  if (len1 !== 1 && len1 !== 2) {
    return -1;
  }
  const sep2Idx = p1 + len1;
  if (sep2Idx >= n || normText.charCodeAt(sep2Idx) !== sep) {
    return -1;
  }
  const p2 = sep2Idx + 1;
  const len2 = countDigitsAt(normText, p2);
  const end = p2 + len2;
  if (isWordCharAt(normText, end) || (end < n && normText.charCodeAt(end) === sep)) {
    return -1;
  }

  const v0 = Number(normText.slice(pos, pos + len0));
  const v1 = Number(normText.slice(p1, p1 + len1));
  const v2 = Number(normText.slice(p2, p2 + len2));

  if (len0 === 4 && len1 === 2 && len2 === 2) {
    // YYYY-MM-DD or YYYY/MM/DD
    if (v0 >= 1800 && v0 <= 2199 && v1 >= 1 && v1 <= 12 && v2 >= 1 && v2 <= 31) {
      return end;
    }
    return -1;
  }
  if (sep === 47 /* '/' */ && (len0 === 1 || len0 === 2) && (len1 === 1 || len1 === 2) && len2 === 4) {
    // DD/MM/YYYY or MM/DD/YYYY
    if (v2 >= 1800 && v2 <= 2199 && v0 >= 1 && v0 <= 31 && v1 >= 1 && v1 <= 31) {
      return end;
    }
  }
  if (sep === 47 && len0 === 4 && (len1 === 1 || len1 === 2) && (len2 === 1 || len2 === 2)) {
    if (v0 >= 1800 && v0 <= 2199 && v1 >= 1 && v1 <= 12 && v2 >= 1 && v2 <= 31) {
      return end;
    }
  }
  return -1;
}

function skipSpaces(text: string, idx: number, limit: number = text.length): number {
  let k = idx;
  while (k < limit && text.charCodeAt(k) === 32) {
    k++;
  }
  return k;
}

function matchWordLowerAt(normLowerText: string, idx: number, wordLower: string): number {
  if (!normLowerText.startsWith(wordLower, idx)) {
    return -1;
  }
  const end = idx + wordLower.length;
  if (isWordCharBefore(normLowerText, idx) || isWordCharAt(normLowerText, end)) {
    return -1;
  }
  return end;
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
  if (normLowerText.startsWith("-value", k) && !isWordCharAt(normText, k + 6)) {
    k += 6;
  } else {
    const afterSp = skipSpaces(normText, k);
    if (normLowerText.startsWith("value", afterSp) && !isWordCharAt(normText, afterSp + 5)) {
      k = afterSp + 5;
      const afterValSp = skipSpaces(normText, k);
      if (normLowerText.startsWith("of", afterValSp) && !isWordCharAt(normText, afterValSp + 2)) {
        k = afterValSp + 2;
      }
    } else if (isWordCharAt(normText, k)) {
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

const EMPTY_WORDS: readonly string[] = [];

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

function buildNormalizedWordSpans(
  normText: string,
  normLowerText: string,
  excludedSpans: readonly TextRange[],
): { readonly spans: WordSpan[]; readonly hasLetterMask: Uint8Array; readonly anyLetterInDoc: boolean } {
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
  const hasLetterMask = new Uint8Array(spans.length);
  let anyLetterInDoc = false;
  for (let i = 0; i < spans.length; i++) {
    if (isPureAsciiDigitToken(spans[i]!.text)) {
      continue;
    }
    if (isSlashLiterDenominator(normLowerText, spans, i)) {
      // 2 marks `/L` denominator unit tokens so `keyLemmas` skips neighbor `/L` leaks.
      hasLetterMask[i] = 2;
      continue;
    }
    hasLetterMask[i] = 1;
    anyLetterInDoc = true;
  }
  return { spans, hasLetterMask, anyLetterInDoc };
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

function getWindowWords(
  wordSpans: readonly WordSpan[],
  hasLetterMask: Uint8Array,
  exprStartNorm: number,
  exprEndNorm: number,
  leftHintIdx: number,
  countPerSide: number,
): {
  readonly nextHintIdx: number;
  readonly words: readonly string[];
  readonly beforeCount: number;
  readonly windowStartNorm: number;
  readonly windowEndNorm: number;
} {
  let idx = leftHintIdx;
  while (idx < wordSpans.length && wordSpans[idx]!.end <= exprStartNorm) {
    idx++;
  }
  const beforeEnd = idx;
  const beforeStart = Math.max(0, beforeEnd - countPerSide);
  let afterIdx = idx;
  while (afterIdx < wordSpans.length && wordSpans[afterIdx]!.start < exprEndNorm) {
    afterIdx++;
  }
  const afterEnd = Math.min(wordSpans.length, afterIdx + countPerSide);

  let anyLetter = false;
  for (let i = beforeStart; i < beforeEnd; i++) {
    if (hasLetterMask[i] === 1) {
      anyLetter = true;
      break;
    }
  }
  if (!anyLetter) {
    for (let i = afterIdx; i < afterEnd; i++) {
      if (hasLetterMask[i] === 1) {
        anyLetter = true;
        break;
      }
    }
  }

  const windowStartNorm = beforeStart < beforeEnd ? wordSpans[beforeStart]!.start : exprStartNorm;
  const windowEndNorm = afterEnd > afterIdx ? wordSpans[afterEnd - 1]!.end : exprEndNorm;
  if (!anyLetter) {
    return {
      nextHintIdx: beforeEnd,
      words: EMPTY_WORDS,
      beforeCount: 0,
      windowStartNorm,
      windowEndNorm,
    };
  }

  const words: string[] = [];
  for (let i = beforeStart; i < beforeEnd; i++) {
    if (hasLetterMask[i] !== 2) {
      words.push(wordSpans[i]!.text);
    }
  }
  const beforeCount = words.length;
  for (let i = afterIdx; i < afterEnd; i++) {
    if (hasLetterMask[i] !== 2) {
      words.push(wordSpans[i]!.text);
    }
  }

  return {
    nextHintIdx: beforeEnd,
    words,
    beforeCount,
    windowStartNorm,
    windowEndNorm,
  };
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

function hasIntervalCueIn4Words(words: readonly string[], beforeCount: number): boolean {
  const start = Math.max(0, beforeCount - 4);
  for (let i = start; i < beforeCount; i++) {
    if (INTERVAL_CUES.has(words[i]!)) {
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

function computeKeyLemmas(
  words: readonly string[],
  extraExcludedWord?: string,
): string[] {
  if (words.length === 0) {
    return [];
  }
  let seen: Set<string> | null = null;
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w.length === 0 || isPureAsciiDigitToken(w) || isDigitPrefixedUnitToken(w)) {
      continue;
    }
    if (BM25_STOPWORDS.has(w) || UNIT_WORDS.has(w) || isKnownSuffixWordUnit(w)) {
      continue;
    }
    if (extraExcludedWord !== undefined && w === extraExcludedWord) {
      continue;
    }
    const stem = porterStem(w);
    if (stem.length === 0) {
      continue;
    }
    if (out.length === 0) {
      out.push(stem);
    } else if (out.length === 1) {
      if (out[0] !== stem) {
        out.push(stem);
      }
    } else {
      if (seen === null) {
        seen = new Set(out);
      }
      if (!seen.has(stem)) {
        seen.add(stem);
        out.push(stem);
      }
    }
  }
  // Ascending UTF-16 code-unit order (`02` §7.6 / §8.2).
  if (out.length > 1) {
    out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return out;
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
  const w = wordSpans[idx]!.text;
  if (
    w.length === 0 ||
    BM25_STOPWORDS.has(w) ||
    UNIT_WORDS.has(w) ||
    isKnownSuffixWordUnit(w) ||
    isDigitPrefixedUnitToken(w)
  ) {
    cached = null;
  } else {
    const stem = porterStem(w);
    cached = stem.length > 0 ? stem : null;
  }
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

function computeWindowKeyLemmasFast(
  wordSpans: readonly WordSpan[],
  hasLetterMask: Uint8Array,
  wordStemCache: (string | null | undefined)[],
  beforeStart: number,
  beforeEnd: number,
  afterIdx: number,
  afterEnd: number,
  extraExcludedWord?: string,
): string[] {
  const out: string[] = [];
  let seen: Set<string> | null = null;

  for (let k = beforeStart; k < beforeEnd; k++) {
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
  for (let k = afterIdx; k < afterEnd; k++) {
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

  if (out.length > 1) {
    out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return out;
}

interface ParsedWordNumber {
  readonly value: number;
  readonly endNorm: number;
}

function parseWordNumberAt(
  normText: string,
  normLowerText: string,
  pos: number,
): ParsedWordNumber | null {
  if (isWordCharBefore(normText, pos)) {
    return null;
  }
  const n = normText.length;
  let wEnd = pos;
  while (wEnd < n && isBaseLetter(normLowerText.charCodeAt(wEnd))) {
    wEnd++;
  }
  if (wEnd === pos || isDigit(normLowerText.charCodeAt(wEnd))) {
    return null;
  }

  const w0 = normLowerText.slice(pos, wEnd);

  // Forbidden `"no one"` and `"one {of,can,or,another,hand,way}"` phrases never produce values.
  if (w0 === "no") {
    const nextPos = skipSpaces(normText, wEnd);
    const afterOne = matchWordLowerAt(normLowerText, nextPos, "one");
    if (afterOne !== -1) {
      return { value: -1, endNorm: afterOne };
    }
    return null;
  }

  if (w0 === "one") {
    const nextPos = skipSpaces(normText, wEnd);
    let nEnd = nextPos;
    while (nEnd < n && isBaseLetter(normLowerText.charCodeAt(nEnd))) {
      nEnd++;
    }
    if (nEnd > nextPos) {
      const nextWord = normLowerText.slice(nextPos, nEnd);
      if (FORBIDDEN_ONE_NEXT.has(nextWord)) {
        return { value: -1, endNorm: nEnd };
      }
    }
  }

  // Try compound tens + unit (`forty-eight`, `twenty one`) or small number.
  let value: number | undefined = WORD_UNITS_0_19.get(w0);
  let curEnd = wEnd;

  if (value === undefined) {
    const tensVal = WORD_TENS.get(w0);
    if (tensVal !== undefined) {
      value = tensVal;
      if (curEnd < n && (normText.charCodeAt(curEnd) === 45 || normText.charCodeAt(curEnd) === 32)) {
        let uEnd = curEnd + 1;
        while (uEnd < n && isBaseLetter(normLowerText.charCodeAt(uEnd))) {
          uEnd++;
        }
        if (uEnd > curEnd + 1 && !isDigit(normLowerText.charCodeAt(uEnd))) {
          const uWord = normLowerText.slice(curEnd + 1, uEnd);
          const uVal = WORD_UNITS_0_19.get(uWord);
          if (uVal !== undefined && uVal >= 1 && uVal <= 9) {
            value += uVal;
            curEnd = uEnd;
          }
        }
      }
    } else if (w0 === "hundred") {
      value = 100;
    } else if (w0 === "thousand") {
      value = 1000;
    }
  }

  if (value === undefined) {
    return null;
  }

  // Optional `hundred` / `thousand` multiplier after `one`..`ninety-nine`.
  if (value >= 1 && value <= 99) {
    const afterSp = skipSpaces(normText, curEnd);
    const hEnd = matchWordLowerAt(normLowerText, afterSp, "hundred");
    if (hEnd !== -1) {
      value *= 100;
      curEnd = hEnd;
    }
    const afterSp2 = skipSpaces(normText, curEnd);
    const tEnd = matchWordLowerAt(normLowerText, afterSp2, "thousand");
    if (tEnd !== -1) {
      value *= 1000;
      curEnd = tEnd;
    }
  }

  return { value, endNorm: curEnd };
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

  const ciEnd = matchWordLowerAt(normLowerText, k, "ci");
  if (ciEnd !== -1) {
    let after = skipSpaces(normText, ciEnd);
    if (after < n && (normText.charCodeAt(after) === 58 || normText.charCodeAt(after) === 61)) {
      after = skipSpaces(normText, after + 1);
    }
    return { label: "ci", afterLabelNorm: after };
  }

  if (requireConfOrLabel) {
    const iqrEnd = matchWordLowerAt(normLowerText, k, "iqr");
    if (iqrEnd !== -1) {
      let after = skipSpaces(normText, iqrEnd);
      if (after < n && (normText.charCodeAt(after) === 58 || normText.charCodeAt(after) === 61)) {
        after = skipSpaces(normText, after + 1);
      }
      return { label: "iqr", afterLabelNorm: after };
    }
    const rangeEnd = matchWordLowerAt(normLowerText, k, "range");
    if (rangeEnd !== -1) {
      let after = skipSpaces(normText, rangeEnd);
      if (after < n && (normText.charCodeAt(after) === 58 || normText.charCodeAt(after) === 61)) {
        after = skipSpaces(normText, after + 1);
      }
      return { label: "range", afterLabelNorm: after };
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

interface PreparedInput {
  readonly rawText: string;
  readonly subText: string;
  readonly latexMap: readonly number[] | null;
  readonly normText: string;
  readonly normLowerText: string;
  readonly normMap: readonly number[];
  readonly isEnglish: boolean;
  readonly isCleanIdentityMap: boolean;
}

function prepareInput(
  text: string,
  options?: {
    readonly lang?: string;
    readonly format?: SourceFormat;
    readonly applyLatex?: boolean;
  },
): PreparedInput {
  const shouldLatex =
    options?.applyLatex === true ||
    options?.format === "latex" ||
    options?.format === "md" ||
    text.includes("\\");

  let subText = text;
  let latexMap: readonly number[] | null = null;
  if (shouldLatex && text.includes("\\")) {
    const latexRes = applyLatexSubstitutions(text);
    subText = latexRes.text;
    latexMap = latexRes.map;
  }

  const normRes = norm(subText);
  const normText = normRes.text;
  const normMap = normRes.map;
  const normLowerText = lowercaseNormalized(normText);
  return {
    rawText: text,
    subText,
    latexMap,
    normText,
    normLowerText,
    normMap,
    isEnglish: isEnglishLocale(options?.lang),
    isCleanIdentityMap: latexMap === null && normText === subText,
  };
}

function toRawSpan(prep: PreparedInput, startNorm: number, endNorm: number): TextRange {
  if (prep.isCleanIdentityMap) {
    return { start: startNorm, end: endNorm };
  }
  const subStart = prep.normMap[startNorm] ?? 0;
  const subEnd = prep.normMap[endNorm] ?? prep.subText.length;
  if (prep.latexMap === null) {
    return { start: subStart, end: subEnd };
  }
  const rawStart = prep.latexMap[subStart] ?? 0;
  const rawEnd = prep.latexMap[subEnd] ?? prep.rawText.length;
  return { start: rawStart, end: Math.max(rawStart, rawEnd) };
}

const EMPTY_COMBINED_UNIT = {
  unitCanon: "",
  unitRaw: "",
  unitFamily: "none" as UnitFamily,
  factor: 1,
  isSampleSizePrefix: false,
  unitStartNorm: -1,
  unitEndNorm: -1,
  extraExcludedUnitWord: undefined as string | undefined,
};

function resolveCombinedUnit(
  prep: PreparedInput,
  suffixUnit: UnitMatch | null,
  prefixUnit: UnitMatch | null,
): {
  readonly unitCanon: string;
  readonly unitRaw: string;
  readonly unitFamily: UnitFamily;
  readonly factor: number;
  readonly isSampleSizePrefix: boolean;
  readonly unitStartNorm: number;
  readonly unitEndNorm: number;
  readonly extraExcludedUnitWord: string | undefined;
} {
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

function mapExcludedSpansToNorm(
  prep: PreparedInput,
  rawSpans: readonly TextRange[],
): TextRange[] {
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
      // Binary search monotone latexMap.
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
  readonly n: number;
  readonly tupleIdHasher: Sha256PrefixHasher;
  readonly section: string;
  readonly source: TupleSource;
  readonly anyLetterInDoc: boolean;
  readonly wordSpans: readonly WordSpan[];
  readonly hasLetterMask: Uint8Array;
  readonly excludedNormSpans: readonly TextRange[];
  readonly tableWindowWords: readonly string[] | null;
  readonly tableHeaderLower: string;
  readonly tableCombinedLower: string;
  readonly sentenceHasPct: boolean;
  readonly sentenceHasTo: boolean;
  readonly sentenceHasAnd: boolean;
  readonly sentenceHasCiWord: boolean;
  readonly sentenceHasRangeSep: boolean;
  readonly sentenceHasEffectCue: boolean;
  readonly sentenceHasSampleCue: boolean;
  readonly sentenceHasDoseCue: boolean;
  readonly wordStemCache: (string | null | undefined)[];
  readonly tuples: QuantTuple[];
  readonly metricFromUnitList: boolean[];
  wordHintIdx: number;
  seenPctBeforeCursor: boolean;
  lastConsumedEndNorm: number;
}

type CombinedUnitInfo = ReturnType<typeof resolveCombinedUnit>;

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
    valueNorm,
    valueLo,
    valueHi,
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

function pushTupleRecord(
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
  windowWordsLower: readonly string[],
  windowTextLower: string,
): void {
  const metric = classifyMetricClass({
    unitFamily: unitMatch.unitFamily,
    isRule4PValue,
    isSampleSizePrefix: unitMatch.isSampleSizePrefix,
    windowWordsLower,
    windowTextLower,
    preNormalized: true,
  });

  const keyLemmas =
    windowWordsLower.length > 0
      ? computeKeyLemmas(windowWordsLower, unitMatch.extraExcludedUnitWord)
      : [];
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
  if (ctx.tableWindowWords !== null) {
    pushTupleRecord(
      ctx,
      valueRaw,
      unitMatch,
      isRule4PValue,
      pComparator,
      valueNorm,
      valueLo,
      valueHi,
      sigDigits,
      spanStartNorm,
      spanEndNorm,
      ctx.tableWindowWords,
      ctx.tableCombinedLower,
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

  const ws = ctx.wordSpans;
  const wsLen = ws.length;
  let idx = ctx.wordHintIdx;
  while (idx < wsLen && ws[idx]!.end <= spanStartNorm) {
    idx++;
  }
  ctx.wordHintIdx = idx;
  const beforeEnd = idx;
  const beforeStart = Math.max(0, beforeEnd - 6);
  let afterIdx = idx;
  while (afterIdx < wsLen && ws[afterIdx]!.start < spanEndNorm) {
    afterIdx++;
  }
  const afterEnd = Math.min(wsLen, afterIdx + 6);

  let metric = classifyUnitOnly(unitMatch.unitFamily, isRule4PValue, unitMatch.isSampleSizePrefix);
  if (ctx.sentenceHasEffectCue || ctx.sentenceHasSampleCue || ctx.sentenceHasDoseCue) {
    let hasContentLetter = false;
    for (let k = beforeStart; k < beforeEnd; k++) {
      if (ctx.hasLetterMask[k] === 1) {
        hasContentLetter = true;
        break;
      }
    }
    if (!hasContentLetter) {
      for (let k = afterIdx; k < afterEnd; k++) {
        if (ctx.hasLetterMask[k] === 1) {
          hasContentLetter = true;
          break;
        }
      }
    }
    if (hasContentLetter) {
      const wordsList: string[] = [];
      for (let k = beforeStart; k < beforeEnd; k++) {
        if (ctx.hasLetterMask[k] !== 2) {
          wordsList.push(ws[k]!.text);
        }
      }
      for (let k = afterIdx; k < afterEnd; k++) {
        if (ctx.hasLetterMask[k] !== 2) {
          wordsList.push(ws[k]!.text);
        }
      }
      let windowTextForMetric = "";
      if (ctx.sentenceHasEffectCue) {
        const wStartNorm = beforeStart < beforeEnd ? ws[beforeStart]!.start : spanStartNorm;
        const wEndNorm = afterEnd > afterIdx ? ws[afterEnd - 1]!.end : spanEndNorm;
        windowTextForMetric = ctx.normLowerText.slice(wStartNorm, wEndNorm);
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
  }
  const keyLemmas = computeWindowKeyLemmasFast(
    ws,
    ctx.hasLetterMask,
    ctx.wordStemCache,
    beforeStart,
    beforeEnd,
    afterIdx,
    afterEnd,
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

  const effASuf = aSuf ?? bSuf;
  const effUnitA = resolveCombinedUnit(prep, effASuf, null);
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
  const spBeforeAnd = skipSpaces(normText, aAfterUnit);
  const andEnd = spBeforeAnd > aAfterUnit ? matchWordLowerAt(normLowerText, spBeforeAnd, "and") : -1;
  if (andEnd === -1) {
    return -1;
  }
  const bStart = skipSpaces(normText, andEnd);
  if (bStart <= andEnd) {
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
  if (!isRangeUnitCompatible(aSuf, bSuf)) {
    return -1;
  }
  const bAfterUnit = bSuf !== null ? bSuf.endNorm : bNum.endNorm;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, i, bAfterUnit)) {
    return -1;
  }
  const sharedSuf = bSuf ?? aSuf;
  const unitA = resolveCombinedUnit(prep, aSuf ?? sharedSuf, null);
  const unitB = resolveCombinedUnit(prep, bSuf ?? sharedSuf, null);
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
  const bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bScan, prep.isEnglish, true);
  if (bNum === null) {
    return -1;
  }
  const hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct;
  const bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false);
  const sepAfterB = matchRangeSeparatorAt(normText, normLowerText, bSuf !== null ? bSuf.endNorm : bNum.endNorm);
  if (sepAfterB === -1) {
    return -1;
  }
  const cNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, sepAfterB, prep.isEnglish, true);
  if (cNum === null) {
    return -1;
  }
  const cSuf = scanSuffixUnitFast(normText, normLowerText, cNum.endNorm, hasPct, false);
  if (!isRangeUnitCompatible(bSuf, cSuf)) {
    return -1;
  }
  let exprEnd = cSuf !== null ? cSuf.endNorm : cNum.endNorm;
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
  const effSuf = postUnit ?? cSuf ?? bSuf;
  const unitMatch = resolveCombinedUnit(prep, effSuf, prefixUnit);
  const factorB = bSuf !== null ? bSuf.factor : unitMatch.factor;
  const factorC = cSuf !== null ? cSuf.factor : unitMatch.factor;
  const valLo = scaleParsedNumber(bNum, factorB);
  const valHi = scaleParsedNumber(cNum, factorC);
  const spanStart = prefixUnit !== null ? prefixUnit.startNorm : i;
  pushTupleFromSpan(
    ctx,
    prep.subText.slice(bNum.rawStartSub, cNum.rawEndSub),
    unitMatch,
    false,
    null,
    (valLo + valHi) / 2,
    valLo,
    valHi,
    Math.max(bNum.sigDigits, cNum.sigDigits),
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
  if (nextChAfterA === 40 /* '(' */ || nextChAfterA === 91 /* '[' */) {
    const closeCh = nextChAfterA === 40 ? 41 : 93;
    const innerStart = skipSpaces(normText, nextAfterA + 1);
    const labelMatch =
      nextChAfterA === 40 ? tryReadCiOrIqrLabel(normText, normLowerText, innerStart, true) : null;
    const bSearchPos = labelMatch !== null ? labelMatch.afterLabelNorm : innerStart;
    const bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bSearchPos, prep.isEnglish, true);
    if (bNum === null) {
      return -1;
    }
    const bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false);
    const sepAfterB = matchRangeSeparatorAt(normText, normLowerText, bSuf !== null ? bSuf.endNorm : bNum.endNorm);
    if (sepAfterB === -1) {
      return -1;
    }
    const cNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, sepAfterB, prep.isEnglish, true);
    if (cNum === null) {
      return -1;
    }
    const cSuf = scanSuffixUnitFast(normText, normLowerText, cNum.endNorm, hasPct, false);
    const afterC = skipSpaces(normText, cSuf !== null ? cSuf.endNorm : cNum.endNorm);
    if (afterC >= n || normText.charCodeAt(afterC) !== closeCh) {
      return -1;
    }
    const postCloseEnd = afterC + 1;
    if (closeCh === 93 && normText.charCodeAt(postCloseEnd) === 40) {
      return -1;
    }
    const postSuf =
      aSuf === null ? scanSuffixUnitFast(normText, normLowerText, postCloseEnd, hasPct, false) : null;
    if (!isPointIntervalUnitCompatible(aSuf, aPrefix, bSuf, cSuf, postSuf)) {
      return -1;
    }
    const unitMatch = resolveCombinedUnit(prep, aSuf ?? postSuf ?? cSuf ?? bSuf, aPrefix);
    const factorA = aSuf !== null ? aSuf.factor : unitMatch.factor;
    const factorB = bSuf !== null ? bSuf.factor : unitMatch.factor;
    const factorC = cSuf !== null ? cSuf.factor : unitMatch.factor;
    const valA = scaleParsedNumber(aNum, factorA);
    const valB = scaleParsedNumber(bNum, factorB);
    const valC = scaleParsedNumber(cNum, factorC);

    let bareAllowed = labelMatch !== null;
    if (!bareAllowed) {
      const winCheck = getWindowWords(
        ctx.wordSpans,
        ctx.hasLetterMask,
        aNum.startNorm,
        aNum.endNorm,
        ctx.wordHintIdx,
        4,
      );
      bareAllowed =
        hasIntervalCueIn4Words(winCheck.words, winCheck.beforeCount) ||
        (valB <= valA && valA <= valC);
    }
    if (!bareAllowed) {
      return -1;
    }
    const finalEnd = postSuf !== null ? postSuf.endNorm : postCloseEnd;
    if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) {
      return -1;
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

  const afterComma = skipSpaces(normText, nextAfterA + 1);
  const labelMatch = tryReadCiOrIqrLabel(normText, normLowerText, afterComma, false);
  if (labelMatch === null || labelMatch.label !== "ci") {
    return -1;
  }
  const bNum = parseFiniteNumberAt(
    normText,
    prep.subText,
    prep.normMap,
    labelMatch.afterLabelNorm,
    prep.isEnglish,
    true,
  );
  if (bNum === null) {
    return -1;
  }
  const bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false);
  const sepAfterB = matchRangeSeparatorAt(normText, normLowerText, bSuf !== null ? bSuf.endNorm : bNum.endNorm);
  if (sepAfterB === -1) {
    return -1;
  }
  const cNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, sepAfterB, prep.isEnglish, true);
  if (cNum === null) {
    return -1;
  }
  const cSuf = scanSuffixUnitFast(normText, normLowerText, cNum.endNorm, hasPct, false);
  if (!isPointIntervalUnitCompatible(aSuf, aPrefix, bSuf, cSuf, null)) {
    return -1;
  }
  const finalEnd = cSuf !== null ? cSuf.endNorm : cNum.endNorm;
  if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) {
    return -1;
  }
  const unitMatch = resolveCombinedUnit(prep, aSuf ?? cSuf ?? bSuf, aPrefix);
  const factorA = aSuf !== null ? aSuf.factor : unitMatch.factor;
  const factorB = bSuf !== null ? bSuf.factor : unitMatch.factor;
  const factorC = cSuf !== null ? cSuf.factor : unitMatch.factor;
  pushTupleFromSpan(
    ctx,
    prep.subText.slice(aNum.rawStartSub, aNum.rawEndSub),
    unitMatch,
    false,
    null,
    scaleParsedNumber(aNum, factorA),
    scaleParsedNumber(bNum, factorB),
    scaleParsedNumber(cNum, factorC),
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
  const win = getWindowWords(
    ctx.wordSpans,
    ctx.hasLetterMask,
    exprStartBase,
    finalEnd,
    ctx.wordHintIdx,
    6,
  );
  const localWindowLower =
    win.words.length > 0 ? normLowerText.slice(win.windowStartNorm, win.windowEndNorm) : "";
  if (
    !containsMeanSdCue(win.words, localWindowLower, ctx.tableHeaderLower, ctx.tableWindowWords)
  ) {
    return -1;
  }
  ctx.wordHintIdx = win.nextHintIdx;
  const unitMatch = resolveCombinedUnit(prep, aSuf ?? postSuf, aPrefix);
  const valNorm = scaleParsedNumber(aNum, unitMatch.factor);
  pushTupleRecord(
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
    ctx.tableWindowWords ?? win.words,
    ctx.tableWindowWords !== null ? ctx.tableCombinedLower : localWindowLower,
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
  const { spans: wordSpans, hasLetterMask, anyLetterInDoc } = buildNormalizedWordSpans(
    normText,
    normLowerText,
    excludedNormSpans,
  );

  let tableWindowWords: readonly string[] | null = null;
  let tableHeaderLower = "";
  let tableCombinedLower = "";
  if (options?.tableHeader !== undefined || options?.rowLabel !== undefined) {
    const hdrLower = normLower(options?.tableHeader ?? "");
    const rowLower = normLower(options?.rowLabel ?? "");
    tableHeaderLower = hdrLower;
    tableCombinedLower = hdrLower.length > 0 && rowLower.length > 0 ? hdrLower + " " + rowLower : hdrLower + rowLower;
    const tblSpans = extractWordSpans(tableCombinedLower);
    const filteredTbl: string[] = [];
    for (let t = 0; t < tblSpans.length; t++) {
      if (!isSlashLiterDenominator(tableCombinedLower, tblSpans, t)) {
        filteredTbl.push(tblSpans[t]!.text);
      }
    }
    tableWindowWords = filteredTbl;
  }

  let sentenceHasPct =
    tableCombinedLower.includes("%") ||
    (tableWindowWords !== null && tableWindowWords.some((w) => PERCENT_CONTEXT_WORDS.has(w)));
  let sentenceHasTo = false;
  let sentenceHasAnd = false;
  let sentenceHasCiWord = false;
  let sentenceHasEffectCue =
    normLowerText.includes("=") ||
    normLowerText.includes("r^2") ||
    normLowerText.includes("r\u00b2") ||
    tableCombinedLower.includes("=") ||
    tableCombinedLower.includes("r^2") ||
    tableCombinedLower.includes("r\u00b2");
  let sentenceHasSampleCue = false;
  let sentenceHasDoseCue = false;

  if (tableWindowWords !== null) {
    for (let wIdx = 0; wIdx < tableWindowWords.length; wIdx++) {
      const w = tableWindowWords[wIdx]!;
      if (EFFECT_SIZE_SINGLE_WORDS.has(w) || w === "effect" || w === "cohen" || w === "cohen's" || w === "cohen\u2019s") {
        sentenceHasEffectCue = true;
      }
      if (SAMPLE_SIZE_SINGLE_WORDS.has(w) || w === "sample") {
        sentenceHasSampleCue = true;
      }
      if (DOSE_SINGLE_WORDS.has(w)) {
        sentenceHasDoseCue = true;
      }
    }
  }

  for (let w = 0; w < wordSpans.length; w++) {
    if (hasLetterMask[w] !== 1) {
      continue;
    }
    const word = wordSpans[w]!.text;
    if (!sentenceHasPct && PERCENT_CONTEXT_WORDS.has(word)) {
      sentenceHasPct = true;
    }
    if (word === "to") {
      sentenceHasTo = true;
    } else if (word === "and") {
      sentenceHasAnd = true;
    } else if (word === "ci") {
      sentenceHasCiWord = true;
    }
    if (EFFECT_SIZE_SINGLE_WORDS.has(word) || word === "effect" || word === "cohen" || word === "cohen's" || word === "cohen\u2019s") {
      sentenceHasEffectCue = true;
    }
    if (SAMPLE_SIZE_SINGLE_WORDS.has(word) || word === "sample") {
      sentenceHasSampleCue = true;
    }
    if (DOSE_SINGLE_WORDS.has(word)) {
      sentenceHasDoseCue = true;
    }
  }
  if (!sentenceHasPct && normText.includes("%")) {
    sentenceHasPct = true;
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
    n,
    tupleIdHasher: createSha256PrefixHasher(`${docId}|${sentenceHash}|${occurrenceIndex}|`),
    section,
    source,
    anyLetterInDoc,
    wordSpans,
    hasLetterMask,
    excludedNormSpans,
    tableWindowWords,
    tableHeaderLower,
    tableCombinedLower,
    sentenceHasPct,
    sentenceHasTo,
    sentenceHasAnd,
    sentenceHasCiWord,
    sentenceHasRangeSep,
    sentenceHasEffectCue,
    sentenceHasSampleCue,
    sentenceHasDoseCue,
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
    // Advance excluded citation span pointer.
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

    // Fast skip over contiguous runs of dots that cannot start a number.
    if (cu === 46 && (i + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(i + 1)))) {
      while (i < n && normText.charCodeAt(i) === 46 && (i + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(i + 1)))) {
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
        pushTupleFromSpan(
          ctx,
          prep.subText.slice(pMatch.num.rawStartSub, pMatch.num.rawEndSub),
          EMPTY_COMBINED_UNIT,
          true,
          pMatch.comparator,
          pMatch.num.value,
          pMatch.num.value,
          pMatch.num.value,
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
    const aNum =
      isAsciiDigitCode(cu) || cu === 45 || cu === 43 || cu === 46
        ? parseNumberOrScientificAt(normText, prep.subText, prep.normMap, i, prep.isEnglish, true)
        : null;
    if (aNum !== null) {
      if (!Number.isFinite(aNum.value)) {
        ctx.lastConsumedEndNorm = aNum.endNorm;
        i = aNum.endNorm;
        continue;
      }
      let aPrefix = scanPrefixUnit(normText, normLowerText, i, ctx.lastConsumedEndNorm);
      if (aPrefix !== null && overlapsExcludedSpan(excludedNormSpans, aPrefix.startNorm, i)) {
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
      const exprStartBase = aPrefix !== null ? aPrefix.startNorm : i;
      const nextAfterA = skipSpaces(normText, afterANumAndUnit);
      const nextChAfterA = nextAfterA < n ? normText.charCodeAt(nextAfterA) : 0;

      if (nextChAfterA === 40 /* '(' */ || nextChAfterA === 91 /* '[' */ || nextChAfterA === 44 /* ',' */) {
        const nextR2 = tryRule2Interval(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA, nextChAfterA);
        if (nextR2 !== -1) {
          i = nextR2;
          continue;
        }
      }
      if (nextChAfterA === 40 /* '(' */) {
        const nextR2b = tryRule2bMeanSd(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA);
        if (nextR2b !== -1) {
          i = nextR2b;
          continue;
        }
      }
      if (nextChAfterA === 0x00b1 /* '±' */ || nextChAfterA === 43 /* '+' */) {
        const nextR3 = tryRule3PlusMinus(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA);
        if (nextR3 !== -1) {
          i = nextR3;
          continue;
        }
      }
      if (
        nextChAfterA === 45 /* '-' */ ||
        nextChAfterA === 0x2013 /* '–' */ ||
        (nextAfterA > afterANumAndUnit && (nextChAfterA === 116 || nextChAfterA === 84))
      ) {
        const nextR7 = tryRule7Range(ctx, aNum, aPrefix, aSuf, exprStartBase, afterANumAndUnit);
        if (nextR7 !== -1) {
          i = nextR7;
          continue;
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
      i = afterANumAndUnit;
      continue;
    }

    // Rule 9: Word numbers when next word is a §7.3 unit or a COUNT_NOUNS word.
    const firstCp = cu < 0x80 ? cu : codePointAtSafe(normText, i).cp;
    if (isBaseLetter(firstCp)) {
      const nextR9 = tryRule9WordNumber(ctx, i);
      if (nextR9 !== -1) {
        i = nextR9;
        continue;
      }

      // Skip entire `[LETTER/DIGIT]` identifier in O(length) — numbers cannot start inside identifiers (`p53`).
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

    // Advance by one UTF-16 code point (skip contiguous digits that failed parsing, e.g., huge/multi-dot).
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

interface NumberReplacement {
  readonly startNorm: number;
  readonly endNorm: number;
  readonly token: string;
}

function scanNumberTokensForClaim(prep: PreparedInput): NumberReplacement[] {
  const { normText, normLowerText, isEnglish } = prep;
  const n = normText.length;
  const hasPercentageContext = normText.includes("%") || normLowerText.includes("percent");
  const out: NumberReplacement[] = [];
  let lastClaimTokEnd = 0;
  let i = 0;

  while (i < n) {
    const cu = normText.charCodeAt(i);
    if (cu === 46 && (i + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(i + 1)))) {
      while (i < n && normText.charCodeAt(i) === 46 && (i + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(i + 1)))) {
        i++;
      }
      continue;
    }

    const dateEnd = isAsciiDigitCode(cu) ? matchDateEndAt(normText, i) : -1;
    if (dateEnd !== -1) {
      i = dateEnd;
      continue;
    }

    const num =
      isAsciiDigitCode(cu) || cu === 45 || cu === 43 || cu === 46
        ? parseNumberOrScientificAt(normText, prep.subText, prep.normMap, i, isEnglish, true)
        : null;
    if (num !== null) {
      if (!Number.isFinite(num.value)) {
        lastClaimTokEnd = num.endNorm;
        i = num.endNorm;
        continue;
      }
      const suf = scanSuffixUnitFast(
        normText,
        normLowerText,
        num.endNorm,
        hasPercentageContext,
        num.isYearIntCandidate,
      );
      // Prefix currency symbols (`$`, `US$`, `€`, `£`, `Rp`, etc.) become part of `⟨v:...⟩`;
      // `n =` and ratio acronyms keep outside tokens untouched (`n = ⟨v:...⟩`).
      const prefix = suf === null ? scanPrefixUnit(normText, normLowerText, i, lastClaimTokEnd) : null;
      const effPrefix =
        prefix !== null && !prefix.isSampleSizePrefix && !prefix.isRatioPrefix ? prefix : null;

      let startNorm = i;
      let endNorm = num.endNorm;
      let unitStr = "";
      let factor = 1;

      if (suf !== null) {
        endNorm = suf.endNorm;
        factor = suf.factor;
        if (suf.family === "unknown") {
          unitStr = prep.subText.slice(
            prep.normMap[suf.startNorm] ?? 0,
            prep.normMap[suf.endNorm] ?? prep.subText.length,
          );
        } else {
          unitStr = suf.unitCanon;
        }
      } else if (effPrefix !== null) {
        startNorm = effPrefix.startNorm;
        factor = effPrefix.factor;
        unitStr = effPrefix.unitCanon;
      }

      const scaled = scaleParsedNumber(num, factor);
      if (!Number.isFinite(scaled)) {
        lastClaimTokEnd = endNorm;
        i = endNorm;
        continue;
      }
      const canonVal = formatCanonicalDecimal(scaled);
      out.push({
        startNorm,
        endNorm,
        token: `\u27e8v:${canonVal}${unitStr}\u27e9`,
      });
      lastClaimTokEnd = endNorm;
      i = endNorm;
      continue;
    }

    const firstCp = cu < 0x80 ? cu : codePointAtSafe(normText, i).cp;
    if (isBaseLetter(firstCp)) {
      while (i < n) {
        const c = normText.charCodeAt(i);
        if (c < 0x80) {
          if (isBaseLetter(c) || isAsciiDigitCode(c)) {
            i++;
          } else {
            break;
          }
        } else {
          const u = codePointAtSafe(normText, i);
          if (isBaseLetter(u.cp) || isDigit(u.cp)) {
            i += u.len;
          } else {
            break;
          }
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

    i += cu < 0x80 ? 1 : codePointAtSafe(normText, i).len;
  }

  return out;
}

/**
 * Token-based claim canonicalization (`01` §3.2):
 * 1. Replaces every recognized number (plus optional attached/prefix unit) by `⟨v:<canon><unit>⟩`;
 * 2. Lowercases remaining text with `normLower`;
 * 3. Keeps `<`, `≤`, `>`, `≥`, `=`, `±` as separate tokens (`<=` -> `≤`, `>=` -> `≥`);
 * 4. Deletes all other Unicode category `P` punctuation outside atomic `⟨v:…⟩` tokens;
 * 5. Collapses whitespace runs to one U+0020 space and trims.
 */
export function normalizedClaim(claimText: string, options?: ClaimNormOptions): string {
  const prep = prepareInput(claimText, options);
  const normLowerText = prep.normLowerText;
  const n = normLowerText.length;
  const replacements = scanNumberTokensForClaim(prep);

  const outParts: string[] = [];
  let hasEmitted = false;
  let needSpace = false;

  const appendCleanedRange = (startIdx: number, endIdx: number): void => {
    let idx = startIdx;
    while (idx < endIdx) {
      const cu = normLowerText.charCodeAt(idx);
      if (cu < 0x80) {
        if ((cu >= 97 && cu <= 122) || (cu >= 48 && cu <= 57)) {
          const runStart = idx;
          idx += 1;
          while (idx < endIdx) {
            const c = normLowerText.charCodeAt(idx);
            if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
              idx += 1;
            } else {
              break;
            }
          }
          if (needSpace && hasEmitted) {
            outParts.push(" ");
          }
          outParts.push(normLowerText.slice(runStart, idx));
          hasEmitted = true;
          needSpace = false;
          continue;
        }
        if (cu === 32 || cu === 10 || cu === 9 || cu === 13) {
          if (hasEmitted) {
            needSpace = true;
          }
          idx += 1;
          continue;
        }
        if (cu === 60 /* '<' */) {
          if (idx + 1 < endIdx && normLowerText.charCodeAt(idx + 1) === 61 /* '=' */) {
            outParts.push(hasEmitted ? " \u2264" : "\u2264");
            idx += 2;
          } else {
            outParts.push(hasEmitted ? " <" : "<");
            idx += 1;
          }
          hasEmitted = true;
          needSpace = true;
          continue;
        }
        if (cu === 62 /* '>' */) {
          if (idx + 1 < endIdx && normLowerText.charCodeAt(idx + 1) === 61 /* '=' */) {
            outParts.push(hasEmitted ? " \u2265" : "\u2265");
            idx += 2;
          } else {
            outParts.push(hasEmitted ? " >" : ">");
            idx += 1;
          }
          hasEmitted = true;
          needSpace = true;
          continue;
        }
        if (cu === 61 /* '=' */) {
          outParts.push(hasEmitted ? " =" : "=");
          hasEmitted = true;
          needSpace = true;
          idx += 1;
          continue;
        }
        if (!isPunctuation(cu)) {
          if (isSpace(cu)) {
            if (hasEmitted) {
              needSpace = true;
            }
          } else {
            if (needSpace && hasEmitted) {
              outParts.push(" ");
            }
            outParts.push(normLowerText.charAt(idx));
            hasEmitted = true;
            needSpace = false;
          }
        }
        idx += 1;
        continue;
      }

      if (cu === 0x2264 || cu === 0x2265 || cu === 0x00b1 /* '±' */) {
        outParts.push(hasEmitted ? ` ${normLowerText.charAt(idx)}` : normLowerText.charAt(idx));
        hasEmitted = true;
        needSpace = true;
        idx += 1;
        continue;
      }

      const u = codePointAtSafe(normLowerText, idx);
      if (!isPunctuation(u.cp)) {
        if (isSpace(u.cp)) {
          if (hasEmitted) {
            needSpace = true;
          }
        } else {
          if (needSpace && hasEmitted) {
            outParts.push(" ");
          }
          outParts.push(normLowerText.slice(idx, idx + u.len));
          hasEmitted = true;
          needSpace = false;
        }
      }
      idx += u.len;
    }
  };

  let cursor = 0;
  for (let r = 0; r < replacements.length; r++) {
    const rep = replacements[r]!;
    if (rep.startNorm > cursor) {
      appendCleanedRange(cursor, rep.startNorm);
    }
    if (needSpace && hasEmitted) {
      outParts.push(" ");
    }
    outParts.push(rep.token);
    hasEmitted = true;
    needSpace = false;
    cursor = rep.endNorm;
  }
  if (cursor < n) {
    appendCleanedRange(cursor, n);
  }

  return outParts.join("");
}

export function normalizedClaimHash(claimText: string, options?: ClaimNormOptions): string {
  return sha256hex(normalizedClaim(claimText, options));
}
