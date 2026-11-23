import { applyLatexSubstitutions } from "./latex.js";
import type { SourceFormat } from "./mask.js";
import { codePointAtSafe, isBaseLetter, isDigit, lowercaseNormalized, norm } from "./norm.js";

export interface TextRange {
  start: number;
  end: number;
}

export interface PrepareInputOptions {
  readonly lang?: string;
  readonly format?: SourceFormat;
  readonly applyLatex?: boolean;
}

export interface PreparedInput {
  readonly rawText: string;
  readonly subText: string;
  readonly latexMap: readonly number[] | null;
  readonly normText: string;
  readonly normLowerText: string;
  readonly normMap: readonly number[];
  readonly isEnglish: boolean;
  readonly isCleanIdentityMap: boolean;
}

export interface ParsedNumber {
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

export interface ParsedWordNumber {
  readonly value: number;
  readonly endNorm: number;
}

const SINGLE_DIGIT_STRINGS: readonly string[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

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
  ["nineteen", 19],
]);

const WORD_TENS: ReadonlyMap<string, number> = new Map([
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

const FORBIDDEN_ONE_NEXT: ReadonlySet<string> = new Set([
  "of",
  "can",
  "or",
  "another",
  "hand",
  "way",
]);

const SUPERSCRIPT_DIGIT_MAP: ReadonlyMap<number, number> = new Map([
  [0x2070, 0],
  [0x00b9, 1],
  [0x00b2, 2],
  [0x00b3, 3],
  [0x2074, 4],
  [0x2075, 5],
  [0x2076, 6],
  [0x2077, 7],
  [0x2078, 8],
  [0x2079, 9],
]);

export function asciiLower(s: string): string {
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

export function isAsciiDigitCode(cu: number): boolean {
  return cu >= 48 && cu <= 57;
}

export function isWordCharAt(text: string, idx: number): boolean {
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

export function isWordCharBefore(text: string, idx: number): boolean {
  if (idx <= 0) {
    return false;
  }
  const u = codePointBefore(text, idx);
  return isBaseLetter(u.cp) || isDigit(u.cp);
}

export function skipSpaces(text: string, idx: number, limit: number = text.length): number {
  let k = idx;
  while (k < limit && text.charCodeAt(k) === 32) {
    k++;
  }
  return k;
}

export function matchWordLowerAt(normLowerText: string, idx: number, wordLower: string): number {
  if (!normLowerText.startsWith(wordLower, idx)) {
    return -1;
  }
  const end = idx + wordLower.length;
  if (isWordCharBefore(normLowerText, idx) || isWordCharAt(normLowerText, end)) {
    return -1;
  }
  return end;
}

export function normalizeZero(value: number): number {
  return Object.is(value, -0) || value === 0 ? 0 : value;
}

/**
 * Runs optional LaTeX substitution followed by Unicode 15.1 `norm()` and index-aligned lowercasing.
 * Explicit `options.applyLatex === false` always skips LaTeX substitution.
 */
export function prepareInput(text: string, options?: PrepareInputOptions): PreparedInput {
  const shouldLatex = options?.applyLatex !== false && text.includes("\\");

  let subText = text;
  let latexMap: readonly number[] | null = null;
  if (shouldLatex) {
    const latexRes = applyLatexSubstitutions(text);
    subText = latexRes.text;
    latexMap = latexRes.map;
  }

  const normRes = norm(subText);
  const normText = normRes.text;
  const normMap = normRes.map;
  // Use index-preserving lowercaseNormalized so normLowerText UTF-16 offsets match normText 1:1.
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

export function toRawSpan(prep: PreparedInput, startNorm: number, endNorm: number): TextRange {
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
  return Number.isFinite(raw) ? normalizeZero(raw) : raw;
}

export function scaleParsedNumber(num: ParsedNumber, factor: number): number {
  if (factor === 1) {
    return Number.isFinite(num.value) ? normalizeZero(num.value) : num.value;
  }
  const deltaExp = factorPow10Exp(factor);
  if (deltaExp !== null) {
    return scaleDecimalMantissa(num.mantissaNormalized, num.expInt, deltaExp);
  }
  const prod = num.value * factor;
  return Number.isFinite(prod) ? normalizeZero(prod) : prod;
}

export function scaleWordNumber(value: number, factor: number): number {
  if (factor === 1) {
    return normalizeZero(value);
  }
  const deltaExp = factorPow10Exp(factor);
  if (deltaExp !== null) {
    return scaleDecimalMantissa(String(value), 0, deltaExp);
  }
  const prod = value * factor;
  return Number.isFinite(prod) ? normalizeZero(prod) : prod;
}

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

interface ThousandsScanResult {
  readonly groupCount: number;
  readonly endScan: number;
  readonly firstNonZeroGroup: number;
}

function isThousandsSepAt(
  normText: string,
  rawSubText: string,
  normMap: readonly number[],
  idx: number,
  sepCode: number,
  checkThinSpace: boolean,
): boolean {
  if (normText.charCodeAt(idx) !== sepCode) {
    return false;
  }
  return !checkThinSpace || isThinSpaceSeparatorAt(normText, idx, rawSubText, normMap);
}

function scanThousandsGroups(
  normText: string,
  rawSubText: string,
  normMap: readonly number[],
  startIdx: number,
  sepCode: number,
  checkThinSpace: boolean,
): ThousandsScanResult {
  const n = normText.length;
  let scan = startIdx;
  let groupCount = 0;
  let firstNonZeroGroup = -1;
  while (
    scan + 3 < n &&
    isThousandsSepAt(normText, rawSubText, normMap, scan, sepCode, checkThinSpace) &&
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
      firstNonZeroGroup = groupCount;
    }
    groupCount++;
    scan += 4;
  }
  return { groupCount, endScan: scan, firstNonZeroGroup };
}

function buildThousandsIntClean(
  normText: string,
  g0Str: string,
  g0Len: number,
  g0End: number,
  scanRes: ThousandsScanResult,
): string | null {
  if (g0Str.charCodeAt(0) === 48) {
    if (scanRes.firstNonZeroGroup === -1) {
      return "0";
    }
    const nzBase = g0End + scanRes.firstNonZeroGroup * 4;
    const lz =
      normText.charCodeAt(nzBase + 1) !== 48
        ? 0
        : normText.charCodeAt(nzBase + 2) !== 48
          ? 1
          : 2;
    const effDigits = (3 - lz) + (scanRes.groupCount - 1 - scanRes.firstNonZeroGroup) * 3;
    if (effDigits > 309) {
      return null;
    }
    let out = normText.slice(nzBase + 1 + lz, nzBase + 4);
    let k = nzBase + 4;
    for (let g = scanRes.firstNonZeroGroup + 1; g < scanRes.groupCount; g++) {
      out += normText.slice(k + 1, k + 4);
      k += 4;
    }
    return out;
  }

  if (g0Len + scanRes.groupCount * 3 > 309) {
    return null;
  }
  let out = g0Str;
  let k = g0End;
  for (let g = 0; g < scanRes.groupCount; g++) {
    out += normText.slice(k + 1, k + 4);
    k += 4;
  }
  return out;
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

  if (g0End < n) {
    const sep = normText.charCodeAt(g0End);

    if (sep === 44 /* ',' */) {
      const canScanCommaThousands =
        g0Len <= 3 && (g0Str.charCodeAt(0) !== 48 || g0Len === 1);
      const commaRes = canScanCommaThousands
        ? scanThousandsGroups(normText, rawSubText, normMap, g0End, 44, false)
        : { groupCount: 0, endScan: g0End, firstNonZeroGroup: -1 };

      const commaLooksLikeThousands =
        commaRes.groupCount > 0 &&
        g0Len <= 3 &&
        (g0Str.charCodeAt(0) !== 48 || (g0Len === 1 && commaRes.groupCount > 1)) &&
        (isEnglish ||
          commaRes.groupCount >= 2 ||
          (commaRes.endScan + 1 < n &&
            normText.charCodeAt(commaRes.endScan) === 46 &&
            isAsciiDigitCode(normText.charCodeAt(commaRes.endScan + 1))));

      if (commaLooksLikeThousands) {
        endPos = commaRes.endScan;
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
        const built = buildThousandsIntClean(normText, g0Str, g0Len, g0End, commaRes);
        if (built === null) {
          return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
        }
        intClean = built;
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
      isThinSpaceSeparatorAt(normText, g0End, rawSubText, normMap)
    ) {
      const thinRes = scanThousandsGroups(normText, rawSubText, normMap, g0End, 32, true);
      if (thinRes.groupCount > 0) {
        endPos = thinRes.endScan;
        if (endPos + 1 < n && isAsciiDigitCode(normText.charCodeAt(endPos + 1))) {
          const trailingSep = normText.charCodeAt(endPos);
          if (trailingSep === 46 || (!isEnglish && trailingSep === 44)) {
            const fLen = countDigitsAt(normText, endPos + 1);
            fracClean = normText.slice(endPos + 1, endPos + 1 + fLen);
            hasDecimal = true;
            endPos = endPos + 1 + fLen;
          }
        }
        const built = buildThousandsIntClean(normText, g0Str, g0Len, g0End, thinRes);
        if (built === null) {
          return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
        }
        intClean = built;
      }
    } else if (sep === 46 /* '.' */ && g0End + 1 < n && isAsciiDigitCode(normText.charCodeAt(g0End + 1))) {
      let dotRes: ThousandsScanResult | null = null;
      let dotGroupCount = 0;
      if (!isEnglish && g0Len >= 1 && g0Len <= 3 && g0Str.charCodeAt(0) !== 48) {
        dotRes = scanThousandsGroups(normText, rawSubText, normMap, g0End, 46, false);
        dotGroupCount = dotRes.groupCount;
        // Reject invalid follow-up `.digit` length (e.g. `1.234.5`).
        if (
          dotGroupCount > 0 &&
          dotRes.endScan + 1 < n &&
          normText.charCodeAt(dotRes.endScan) === 46 &&
          isAsciiDigitCode(normText.charCodeAt(dotRes.endScan + 1))
        ) {
          dotGroupCount = 0;
        }
      }

      if (dotGroupCount > 0 && dotRes !== null) {
        endPos = dotRes.endScan;
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
        const built = buildThousandsIntClean(normText, g0Str, g0Len, g0End, dotRes);
        if (built === null) {
          return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap);
        }
        intClean = built;
      } else {
        const fLen = countDigitsAt(normText, g0End + 1);
        const fEnd = g0End + 1 + fLen;
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

/**
 * Parses an unsigned ASCII digit run in `[dStart, dEnd)` into a finite integer exponent,
 * clamping magnitudes of `> 6` non-leading-zero digits (incl. `>= 309`-digit exponents) to
 * `±1_000_000` so `Number(mantissa + "e" + expInt)` cleanly overflows or underflows without
 * falling back to the bare mantissa.
 */
function clampExponentDigits(
  normText: string,
  dStart: number,
  dEnd: number,
  expNeg: boolean,
): number {
  let nz = dStart;
  while (nz < dEnd && normText.charCodeAt(nz) === 48) {
    nz++;
  }
  if (nz === dEnd) {
    return 0;
  }
  if (dEnd - nz > 6) {
    return expNeg ? -1_000_000 : 1_000_000;
  }
  const mag = Number(normText.slice(nz, dEnd));
  return expNeg ? -mag : mag;
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
    const dStart = k;
    while (k < n && isAsciiDigitCode(normText.charCodeAt(k))) {
      k++;
    }
    if (k > dStart && !isWordCharAt(normText, k)) {
      return { expInt: clampExponentDigits(normText, dStart, k, expNeg), endNorm: k };
    }
  }

  // Form B: ` × 10^b`, ` x 10^b`, ` · 10^b`, with optional `{...}` or Unicode superscripts.
  let k = skipSpaces(normText, afterMantissa);
  if (k >= n) {
    return null;
  }
  const op = normText.charCodeAt(k);
  if (op === 0x00d7 /* '×' */ || op === 120 /* 'x' */ || op === 88 /* 'X' */ || op === 0x00b7 /* '·' */) {
    k = skipSpaces(normText, k + 1);
    if (k + 2 <= n && normText.charCodeAt(k) === 49 && normText.charCodeAt(k + 1) === 48) {
      k = skipSpaces(normText, k + 2);
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
          const dEnd = k;
          if (hasBrace) {
            if (k >= n || normText.charCodeAt(k) !== 125 /* '}' */) {
              return null;
            }
            k++;
          }
          if (!isWordCharAt(normText, k)) {
            return { expInt: clampExponentDigits(normText, dStart, dEnd, expNeg), endNorm: k };
          }
        }
      } else {
        // Unicode superscript exponent, e.g. `10⁻³`.
        let supIdx = k;
        let expNeg = false;
        if (supIdx < n) {
          const sCh = normText.charCodeAt(supIdx);
          if (sCh === 0x207b /* '⁻' */ || sCh === 0x207a /* '⁺' */) {
            expNeg = sCh === 0x207b;
            supIdx++;
          }
        }
        let digitCount = 0;
        let nonZeroSeen = false;
        let sigDigitsCount = 0;
        let mag = 0;
        while (supIdx < n) {
          const d = SUPERSCRIPT_DIGIT_MAP.get(normText.charCodeAt(supIdx));
          if (d === undefined) {
            break;
          }
          digitCount++;
          if (d !== 0 || nonZeroSeen) {
            nonZeroSeen = true;
            sigDigitsCount++;
            if (sigDigitsCount <= 6) {
              mag = mag * 10 + d;
            }
          }
          supIdx++;
        }
        const trailCu = supIdx < n ? normText.charCodeAt(supIdx) : 0;
        if (
          digitCount > 0 &&
          trailCu !== 0x207b &&
          trailCu !== 0x207a &&
          !isWordCharAt(normText, supIdx)
        ) {
          const clampedMag = sigDigitsCount > 6 ? 1_000_000 : mag;
          const expInt = clampedMag === 0 ? 0 : expNeg ? -clampedMag : clampedMag;
          return { expInt, endNorm: supIdx };
        }
      }
    }
  }

  return null;
}

export function parseNumberOrScientificAt(
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
    value: normalizeZero(sciVal),
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

export function parseFiniteNumberAt(
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
export function matchDateEndAt(normText: string, pos: number): number {
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
    if (v0 >= 1800 && v0 <= 2199 && v1 >= 1 && v1 <= 12 && v2 >= 1 && v2 <= 31) {
      return end;
    }
    return -1;
  }
  if (sep === 47 /* '/' */ && (len0 === 1 || len0 === 2) && (len1 === 1 || len1 === 2) && len2 === 4) {
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

export function parseWordNumberAt(
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

function isBaseLetterBefore(text: string, idx: number): boolean {
  if (idx <= 0) {
    return false;
  }
  return isBaseLetter(codePointBefore(text, idx).cp);
}

function hasPercentageContextInText(textLower: string): boolean {
  if (textLower.includes("%")) {
    return true;
  }
  const n = textLower.length;
  let pos = textLower.indexOf("p");
  while (pos !== -1) {
    // Allow an ASCII digit directly before the unit (e.g. `10pct`), but reject inside words (`super`, `apply`).
    if (!isBaseLetterBefore(textLower, pos)) {
      const next = pos + 1 < n ? textLower.charCodeAt(pos + 1) : 0;
      if (next === 112 /* 'p' */) {
        if (!isWordCharAt(textLower, pos + 2)) {
          return true;
        }
      } else if (next === 99 /* 'c' */) {
        if (textLower.startsWith("pct", pos) && !isWordCharAt(textLower, pos + 3)) {
          return true;
        }
      } else if (next === 101 /* 'e' */) {
        if (textLower.startsWith("percent", pos)) {
          if (!isWordCharAt(textLower, pos + 7)) {
            return true;
          }
          if (textLower.startsWith("percentage", pos) && !isWordCharAt(textLower, pos + 10)) {
            return true;
          }
        } else if (textLower.startsWith("per", pos) && !isWordCharAt(textLower, pos + 3)) {
          let sp = pos + 3;
          while (sp < n && (textLower.charCodeAt(sp) === 32 || textLower.charCodeAt(sp) === 10)) {
            sp++;
          }
          if (sp > pos + 3 && matchWordLowerAt(textLower, sp, "cent") !== -1) {
            return true;
          }
        }
      }
    }
    pos = textLower.indexOf("p", pos + 1);
  }
  return false;
}

/**
 * Shared percentage-context detector for both `extractQuantities` and `normalizedClaim` (`02` §7.3):
 * recognizes `%`, whole-word `percent`, `pct`, `percentage`, `pp`, and two-word `per cent`.
 */
export function hasPercentageContext(primaryLower: string, secondaryLower?: string): boolean {
  if (hasPercentageContextInText(primaryLower)) {
    return true;
  }
  return secondaryLower !== undefined && secondaryLower.length > 0 && hasPercentageContextInText(secondaryLower);
}
