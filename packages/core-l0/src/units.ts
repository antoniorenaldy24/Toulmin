import { codePointAtSafe, isBaseLetter, isDigit, isSpace, normLower } from "./norm.js";
import { BM25_STOPWORDS } from "./porter.js";

export type UnitFamily =
  | "percent"
  | "percentage_points"
  | "count"
  | "mass"
  | "mass_concentration"
  | "molar_concentration"
  | "dose_per_body_mass"
  | "time_short"
  | "time_long"
  | "currency_usd"
  | "currency_eur"
  | "currency_gbp"
  | "currency_idr"
  | "ratio_or"
  | "ratio_hr"
  | "ratio_rr"
  | "ratio_irr"
  | "none"
  | "unknown";

export interface UnitMatch {
  readonly family: UnitFamily;
  readonly unitCanon: string;
  /** Factor to convert a number in this raw unit into `unitCanon`. */
  readonly factor: number;
  /** UTF-16 start offset inside `normText`. */
  readonly startNorm: number;
  /** UTF-16 end offset inside `normText`. */
  readonly endNorm: number;
  readonly isSampleSizePrefix: boolean;
  readonly isRatioPrefix: boolean;
}

interface SuffixUnitSpec {
  readonly variant: string;
  readonly family: UnitFamily;
  readonly unitCanon: string;
  readonly factor: number;
  readonly requiresPctContext?: boolean;
  readonly isSymbol?: boolean;
}

const CANON_TO_FAMILY: ReadonlyMap<string, UnitFamily> = new Map([
  ["%", "percent"],
  ["pp", "percentage_points"],
  ["count", "count"],
  ["mg", "mass"],
  ["mg/L", "mass_concentration"],
  ["mmol/L", "molar_concentration"],
  ["mg/kg", "dose_per_body_mass"],
  ["s", "time_short"],
  ["month", "time_long"],
  ["usd", "currency_usd"],
  ["eur", "currency_eur"],
  ["gbp", "currency_gbp"],
  ["idr", "currency_idr"],
  ["ratio:or", "ratio_or"],
  ["ratio:hr", "ratio_hr"],
  ["ratio:rr", "ratio_rr"],
  ["ratio:irr", "ratio_irr"],
  ["", "none"]
]);

// Suffix unit table from `02` §7.3, sorted descending by variant length so compound units
// (e.g. `mg/kg`, `mg/dl`, `percentage points`) always win over shorter prefixes.
const SUFFIX_UNIT_SPECS: readonly SuffixUnitSpec[] = [
  { variant: "percentage points", family: "percentage_points", unitCanon: "pp", factor: 1 },
  { variant: "percentage point", family: "percentage_points", unitCanon: "pp", factor: 1 },
  { variant: "participants", family: "count", unitCanon: "count", factor: 1 },
  { variant: "respondents", family: "count", unitCanon: "count", factor: 1 },
  { variant: "individuals", family: "count", unitCanon: "count", factor: 1 },
  { variant: "per cent", family: "percent", unitCanon: "%", factor: 1 },
  { variant: "patients", family: "count", unitCanon: "count", factor: 1 },
  { variant: "subjects", family: "count", unitCanon: "count", factor: 1 },
  { variant: "children", family: "count", unitCanon: "count", factor: 1 },
  { variant: "students", family: "count", unitCanon: "count", factor: 1 },
  { variant: "percent", family: "percent", unitCanon: "%", factor: 1 },
  { variant: "seconds", family: "time_short", unitCanon: "s", factor: 1 },
  { variant: "minutes", family: "time_short", unitCanon: "s", factor: 60 },
  { variant: "infants", family: "count", unitCanon: "count", factor: 1 },
  { variant: "animals", family: "count", unitCanon: "count", factor: 1 },
  { variant: "samples", family: "count", unitCanon: "count", factor: 1 },
  { variant: "dollars", family: "currency_usd", unitCanon: "usd", factor: 1 },
  { variant: "points", family: "percentage_points", unitCanon: "pp", factor: 1, requiresPctContext: true },
  { variant: "people", family: "count", unitCanon: "count", factor: 1 },
  { variant: "adults", family: "count", unitCanon: "count", factor: 1 },
  { variant: "second", family: "time_short", unitCanon: "s", factor: 1 },
  { variant: "minute", family: "time_short", unitCanon: "s", factor: 60 },
  { variant: "months", family: "time_long", unitCanon: "month", factor: 1 },
  { variant: "mmol/l", family: "molar_concentration", unitCanon: "mmol/L", factor: 1 },
  { variant: "μmol/l", family: "molar_concentration", unitCanon: "mmol/L", factor: 0.001 },
  { variant: "umol/l", family: "molar_concentration", unitCanon: "mmol/L", factor: 0.001 },
  { variant: "nmol/l", family: "molar_concentration", unitCanon: "mmol/L", factor: 1e-6 },
  { variant: "mg/kg", family: "dose_per_body_mass", unitCanon: "mg/kg", factor: 1 },
  { variant: "μg/kg", family: "dose_per_body_mass", unitCanon: "mg/kg", factor: 0.001 },
  { variant: "ug/kg", family: "dose_per_body_mass", unitCanon: "mg/kg", factor: 0.001 },
  { variant: "mg/ml", family: "mass_concentration", unitCanon: "mg/L", factor: 1000 },
  { variant: "mg/dl", family: "mass_concentration", unitCanon: "mg/L", factor: 10 },
  { variant: "μg/ml", family: "mass_concentration", unitCanon: "mg/L", factor: 1 },
  { variant: "ug/ml", family: "mass_concentration", unitCanon: "mg/L", factor: 1 },
  { variant: "ng/ml", family: "mass_concentration", unitCanon: "mg/L", factor: 0.001 },
  { variant: "mol/l", family: "molar_concentration", unitCanon: "mmol/L", factor: 1000 },
  { variant: "month", family: "time_long", unitCanon: "month", factor: 1 },
  { variant: "years", family: "time_long", unitCanon: "month", factor: 12 },
  { variant: "weeks", family: "time_short", unitCanon: "s", factor: 604800 },
  { variant: "hours", family: "time_short", unitCanon: "s", factor: 3600 },
  { variant: "euros", family: "currency_eur", unitCanon: "eur", factor: 1 },
  { variant: "women", family: "count", unitCanon: "count", factor: 1 },
  { variant: "cases", family: "count", unitCanon: "count", factor: 1 },
  { variant: "mg/l", family: "mass_concentration", unitCanon: "mg/L", factor: 1 },
  { variant: "g/dl", family: "mass_concentration", unitCanon: "mg/L", factor: 10000 },
  { variant: "μg/l", family: "mass_concentration", unitCanon: "mg/L", factor: 0.001 },
  { variant: "ug/l", family: "mass_concentration", unitCanon: "mg/L", factor: 0.001 },
  { variant: "g/kg", family: "dose_per_body_mass", unitCanon: "mg/kg", factor: 1000 },
  { variant: "year", family: "time_long", unitCanon: "month", factor: 12 },
  { variant: "week", family: "time_short", unitCanon: "s", factor: 604800 },
  { variant: "hour", family: "time_short", unitCanon: "s", factor: 3600 },
  { variant: "days", family: "time_short", unitCanon: "s", factor: 86400 },
  { variant: "mice", family: "count", unitCanon: "count", factor: 1 },
  { variant: "rats", family: "count", unitCanon: "count", factor: 1 },
  { variant: "eyes", family: "count", unitCanon: "count", factor: 1 },
  { variant: "g/l", family: "mass_concentration", unitCanon: "mg/L", factor: 1000 },
  { variant: "mcg", family: "mass", unitCanon: "mg", factor: 0.001 },
  { variant: "sec", family: "time_short", unitCanon: "s", factor: 1 },
  { variant: "min", family: "time_short", unitCanon: "s", factor: 60 },
  { variant: "hrs", family: "time_short", unitCanon: "s", factor: 3600 },
  { variant: "day", family: "time_short", unitCanon: "s", factor: 86400 },
  { variant: "yrs", family: "time_long", unitCanon: "month", factor: 12 },
  { variant: "pct", family: "percent", unitCanon: "%", factor: 1 },
  { variant: "men", family: "count", unitCanon: "count", factor: 1 },
  { variant: "usd", family: "currency_usd", unitCanon: "usd", factor: 1 },
  { variant: "eur", family: "currency_eur", unitCanon: "eur", factor: 1 },
  { variant: "gbp", family: "currency_gbp", unitCanon: "gbp", factor: 1 },
  { variant: "idr", family: "currency_idr", unitCanon: "idr", factor: 1 },
  { variant: "mg", family: "mass", unitCanon: "mg", factor: 1 },
  { variant: "kg", family: "mass", unitCanon: "mg", factor: 1e6 },
  { variant: "μg", family: "mass", unitCanon: "mg", factor: 0.001 },
  { variant: "ug", family: "mass", unitCanon: "mg", factor: 0.001 },
  { variant: "ng", family: "mass", unitCanon: "mg", factor: 1e-6 },
  { variant: "ms", family: "time_short", unitCanon: "s", factor: 0.001 },
  { variant: "hr", family: "time_short", unitCanon: "s", factor: 3600 },
  { variant: "wk", family: "time_short", unitCanon: "s", factor: 604800 },
  { variant: "mo", family: "time_long", unitCanon: "month", factor: 1 },
  { variant: "yr", family: "time_long", unitCanon: "month", factor: 12 },
  { variant: "pp", family: "percentage_points", unitCanon: "pp", factor: 1 },
  { variant: "rp", family: "currency_idr", unitCanon: "idr", factor: 1 },
  { variant: "g", family: "mass", unitCanon: "mg", factor: 1000 },
  { variant: "s", family: "time_short", unitCanon: "s", factor: 1 },
  { variant: "h", family: "time_short", unitCanon: "s", factor: 3600 },
  { variant: "d", family: "time_short", unitCanon: "s", factor: 86400 },
  { variant: "y", family: "time_long", unitCanon: "month", factor: 12 },
  { variant: "%", family: "percent", unitCanon: "%", factor: 1, isSymbol: true },
  { variant: "$", family: "currency_usd", unitCanon: "usd", factor: 1, isSymbol: true },
  { variant: "€", family: "currency_eur", unitCanon: "eur", factor: 1, isSymbol: true },
  { variant: "£", family: "currency_gbp", unitCanon: "gbp", factor: 1, isSymbol: true }
];

const SUFFIX_VARIANTS_BY_FIRST_CHAR: ReadonlyMap<string, readonly SuffixUnitSpec[]> = (() => {
  const map = new Map<string, SuffixUnitSpec[]>();
  for (const spec of SUFFIX_UNIT_SPECS) {
    const first = spec.variant.charAt(0);
    const list = map.get(first);
    if (list !== undefined) {
      list.push(spec);
    } else {
      map.set(first, [spec]);
    }
  }
  return map;
})();

/**
 * Multi-character unit words and compound unit components excluded from `keyLemmas` (`02` §7.6).
 * Includes single-letter unit tokens when they appear only as unambiguous unit labels.
 */
export const UNIT_WORDS: ReadonlySet<string> = new Set([
  "percent",
  "cent",
  "pct",
  "pp",
  "percentage",
  "point",
  "points",
  "participants",
  "patients",
  "subjects",
  "people",
  "individuals",
  "respondents",
  "children",
  "adults",
  "women",
  "men",
  "infants",
  "students",
  "cases",
  "animals",
  "mice",
  "rats",
  "samples",
  "eyes",
  "mg",
  "kg",
  "mcg",
  "ug",
  "ng",
  "ml",
  "dl",
  "mmol",
  "mol",
  "umol",
  "nmol",
  "μg",
  "μmol",
  "ms",
  "sec",
  "second",
  "seconds",
  "min",
  "minute",
  "minutes",
  "hr",
  "hrs",
  "hour",
  "hours",
  "day",
  "days",
  "wk",
  "week",
  "weeks",
  "month",
  "months",
  "mo",
  "year",
  "years",
  "yr",
  "yrs",
  "usd",
  "dollars",
  "eur",
  "euros",
  "gbp",
  "idr",
  "rp"
]);

const KNOWN_SUFFIX_WORD_UNITS: ReadonlySet<string> = new Set(
  SUFFIX_UNIT_SPECS.filter((s) => s.isSymbol !== true && s.variant !== "points").map((s) => s.variant)
);

export function isKnownSuffixWordUnit(word: string): boolean {
  return KNOWN_SUFFIX_WORD_UNITS.has(normLower(word));
}

/**
 * Resolves either a canonical unit string (`"%"`, `"mg/L"`, `"unknown:..."`, `""`) or a
 * raw unit spelling (`"pp"`, `"g"`, `"months"`) to its `UnitFamily`.
 */
export function unitFamilyOf(unitCanonOrRaw: string): UnitFamily {
  const direct = CANON_TO_FAMILY.get(unitCanonOrRaw);
  if (direct !== undefined) {
    return direct;
  }
  if (unitCanonOrRaw.startsWith("unknown:")) {
    return "unknown";
  }
  const lower = normLower(unitCanonOrRaw);
  const directLower = CANON_TO_FAMILY.get(lower);
  if (directLower !== undefined) {
    return directLower;
  }
  if (lower.startsWith("unknown:")) {
    return "unknown";
  }
  if (lower === "us$") {
    return "currency_usd";
  }
  if (lower === "or" || lower === "odds ratio") {
    return "ratio_or";
  }
  if (lower === "hazard ratio" || unitCanonOrRaw === "HR") {
    return "ratio_hr";
  }
  if (lower === "hr") {
    // Disambiguate trailing unit `"hr"` (time) from uppercase `"HR"` (ratio).
    return "time_short";
  }
  if (lower === "rr" || lower === "risk ratio" || lower === "relative risk") {
    return "ratio_rr";
  }
  if (lower === "irr") {
    return "ratio_irr";
  }
  for (const spec of SUFFIX_UNIT_SPECS) {
    if (spec.variant === lower) {
      return spec.family;
    }
  }
  return "unknown";
}

/**
 * Unit family compatibility check (`02` §7.5, `03` §4.4):
 * - `sameFamily("%", "") === false`
 * - `sameFamily("pp", "%") === false`
 * - `sameFamily("unknown:...", ...)` is ALWAYS `false`
 * - `time_short` and `time_long` never pair
 * - `ratio:or`, `ratio:hr`, `ratio:rr`, `ratio:irr` are distinct families
 * - currency families `usd`, `eur`, `gbp`, `idr` are distinct
 */
export function sameFamily(unitA: string, unitB: string): boolean {
  const fa = unitFamilyOf(unitA);
  const fb = unitFamilyOf(unitB);
  if (fa === "unknown" || fb === "unknown") {
    return false;
  }
  return fa === fb;
}

function isWordBoundaryChar(text: string, idx: number): boolean {
  if (idx < 0 || idx >= text.length) {
    return false;
  }
  const u = codePointAtSafe(text, idx);
  return isBaseLetter(u.cp) || isDigit(u.cp);
}

function isBoundaryBefore(text: string, start: number): boolean {
  if (start <= 0) {
    return true;
  }
  const u = codePointAtPrev(text, start);
  return !isBaseLetter(u.cp) && !isDigit(u.cp);
}

function codePointAtPrev(text: string, endIdx: number): { cp: number; len: number } {
  const cu = text.charCodeAt(endIdx - 1);
  if (cu >= 0xdc00 && cu <= 0xdfff && endIdx >= 2) {
    const hi = text.charCodeAt(endIdx - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) {
      const cp = ((hi - 0xd800) << 10) + (cu - 0xdc00) + 0x10000;
      return { cp, len: 2 };
    }
  }
  return { cp: cu, len: 1 };
}

function isValidSuffixBoundary(text: string, afterEnd: number, isSymbol: boolean): boolean {
  if (afterEnd >= text.length) {
    return true;
  }
  if (isSymbol) {
    return !isDigit(text.charCodeAt(afterEnd));
  }
  if (isWordBoundaryChar(text, afterEnd)) {
    return false;
  }
  // Prevent partial match on an unmapped compound slash unit like `5 g/mol`.
  if (text.charCodeAt(afterEnd) === 47) {
    return false;
  }
  return true;
}

export interface SuffixScanOptions {
  readonly hasPercentageContext?: boolean;
  /** True when the preceding number is a 4-digit year-like integer (`1900..2099`) without decimal point. */
  readonly isFourDigitDecadeBase?: boolean;
}

/**
 * Scans for a unit immediately after a number in normalized (`norm()`) text (`02` §7.3)
 * without allocating an options bag.
 */
export function scanSuffixUnitFast(
  normText: string,
  normLowerText: string,
  afterNumPos: number,
  hasPercentageContext: boolean,
  isFourDigitDecadeBase: boolean,
): UnitMatch | null {
  const n = normText.length;
  if (afterNumPos >= n) {
    return null;
  }

  let unitPos = afterNumPos;
  let hadSpace = false;
  while (unitPos < n && normText.charCodeAt(unitPos) === 32) {
    hadSpace = true;
    unitPos++;
  }
  if (unitPos >= n) {
    return null;
  }

  // Fast-exit when next non-space token starts with an ASCII digit.
  const ch0 = normText.charCodeAt(unitPos);
  if (ch0 >= 48 && ch0 <= 57) {
    return null;
  }

  // Degree symbol (`°`, `°C`, `°F`, `℃`, `℉`) may follow with 0 or 1 space.
  if (ch0 === 0x00b0) {
    let degEnd = unitPos + 1;
    if (degEnd < n) {
      const nextLower = normLowerText.charCodeAt(degEnd);
      if ((nextLower === 99 || nextLower === 102) && !isWordBoundaryChar(normText, degEnd + 1)) {
        degEnd++;
      }
    }
    return {
      family: "unknown",
      unitCanon: "unknown:" + normLowerText.slice(unitPos, degEnd),
      factor: 1,
      startNorm: unitPos,
      endNorm: degEnd,
      isSampleSizePrefix: false,
      isRatioPrefix: false,
    };
  }
  if (ch0 === 0x2103 || ch0 === 0x2109) {
    return {
      family: "unknown",
      unitCanon: "unknown:" + normLowerText.slice(unitPos, unitPos + 1),
      factor: 1,
      startNorm: unitPos,
      endNorm: unitPos + 1,
      isSampleSizePrefix: false,
      isRatioPrefix: false,
    };
  }

  // Guard decade forms such as "1990s" from matching either `s` (seconds) or `unknown:s`.
  if (
    !hadSpace &&
    isFourDigitDecadeBase &&
    normLowerText.charCodeAt(afterNumPos) === 115 &&
    !isWordBoundaryChar(normText, afterNumPos + 1) &&
    normText.charCodeAt(afterNumPos + 1) !== 47
  ) {
    return null;
  }

  const lowerFirst = normLowerText.charAt(unitPos);
  const candidates = SUFFIX_VARIANTS_BY_FIRST_CHAR.get(lowerFirst);
  if (candidates !== undefined) {
    for (let i = 0; i < candidates.length; i++) {
      const spec = candidates[i]!;
      if (spec.requiresPctContext === true && !hasPercentageContext) {
        continue;
      }
      // Guard decade forms such as "1990s" from matching `s` (seconds).
      if (spec.variant === "s" && !hadSpace && isFourDigitDecadeBase) {
        continue;
      }
      const vLen = spec.variant.length;
      if (unitPos + vLen <= n && normLowerText.startsWith(spec.variant, unitPos)) {
        if (isValidSuffixBoundary(normText, unitPos + vLen, spec.isSymbol === true)) {
          return {
            family: spec.family,
            unitCanon: spec.unitCanon,
            factor: spec.factor,
            startNorm: unitPos,
            endNorm: unitPos + vLen,
            isSampleSizePrefix: false,
            isRatioPrefix: false,
          };
        }
      }
    }
  }

  // Row 13 unknown unit: LETTER run of <= 12 chars *directly* after the number (0 spaces),
  // not a stopword, bounded on the right.
  if (!hadSpace) {
    let runEnd = afterNumPos;
    let letterCount = 0;
    while (runEnd < n) {
      const u = codePointAtSafe(normText, runEnd);
      if (isBaseLetter(u.cp)) {
        letterCount++;
        runEnd += u.len;
        if (letterCount > 12) {
          return null;
        }
      } else {
        break;
      }
    }
    if (letterCount >= 1 && !isWordBoundaryChar(normText, runEnd) && normText.charCodeAt(runEnd) !== 47) {
      const lowerRun = normLowerText.slice(afterNumPos, runEnd);
      if (lowerRun.length > 0 && !BM25_STOPWORDS.has(lowerRun)) {
        return {
          family: "unknown",
          unitCanon: "unknown:" + lowerRun,
          factor: 1,
          startNorm: afterNumPos,
          endNorm: runEnd,
          isSampleSizePrefix: false,
          isRatioPrefix: false,
        };
      }
    }
  }

  return null;
}

/**
 * Scans for a unit immediately after a number in normalized (`norm()`) text (`02` §7.3).
 * `normLowerText` MUST have the same UTF-16 length as `normText`.
 */
export function scanSuffixUnit(
  normText: string,
  normLowerText: string,
  afterNumPos: number,
  options?: SuffixScanOptions,
): UnitMatch | null {
  return scanSuffixUnitFast(
    normText,
    normLowerText,
    afterNumPos,
    options?.hasPercentageContext === true,
    options?.isFourDigitDecadeBase === true,
  );
}

interface PrefixCurrencySpec {
  readonly prefixLower: string;
  readonly family: UnitFamily;
  readonly unitCanon: string;
  readonly isWord: boolean;
}

const PREFIX_CURRENCIES: readonly PrefixCurrencySpec[] = [
  { prefixLower: "us$", family: "currency_usd", unitCanon: "usd", isWord: true },
  { prefixLower: "usd", family: "currency_usd", unitCanon: "usd", isWord: true },
  { prefixLower: "eur", family: "currency_eur", unitCanon: "eur", isWord: true },
  { prefixLower: "gbp", family: "currency_gbp", unitCanon: "gbp", isWord: true },
  { prefixLower: "idr", family: "currency_idr", unitCanon: "idr", isWord: true },
  { prefixLower: "rp", family: "currency_idr", unitCanon: "idr", isWord: true },
  { prefixLower: "$", family: "currency_usd", unitCanon: "usd", isWord: false },
  { prefixLower: "€", family: "currency_eur", unitCanon: "eur", isWord: false },
  { prefixLower: "£", family: "currency_gbp", unitCanon: "gbp", isWord: false }
];

interface PrefixRatioSpec {
  readonly label: string;
  readonly caseSensitive: boolean;
  readonly family: UnitFamily;
  readonly unitCanon: string;
}

const PREFIX_RATIOS: readonly PrefixRatioSpec[] = [
  { label: "relative risk", caseSensitive: false, family: "ratio_rr", unitCanon: "ratio:rr" },
  { label: "hazard ratio", caseSensitive: false, family: "ratio_hr", unitCanon: "ratio:hr" },
  { label: "odds ratio", caseSensitive: false, family: "ratio_or", unitCanon: "ratio:or" },
  { label: "risk ratio", caseSensitive: false, family: "ratio_rr", unitCanon: "ratio:rr" },
  { label: "IRR", caseSensitive: true, family: "ratio_irr", unitCanon: "ratio:irr" },
  { label: "OR", caseSensitive: true, family: "ratio_or", unitCanon: "ratio:or" },
  { label: "HR", caseSensitive: true, family: "ratio_hr", unitCanon: "ratio:hr" },
  { label: "RR", caseSensitive: true, family: "ratio_rr", unitCanon: "ratio:rr" }
];

const RATIO_CONNECTORS: readonly string[] = ["=", ":", ",", "of", "was", "is"];

/**
 * Scans immediately before `numStartNorm` for prefix units:
 * - currencies (`$`, `US$`, `USD`, `€`, `EUR`, `£`, `GBP`, `Rp`, `IDR`),
 * - sample size prefix (`n =`, `N =`),
 * - ratio prefix labels (`OR`, `odds ratio`, `HR`, `hazard ratio`, `RR`, `risk ratio`, `relative risk`, `IRR`).
 */
export function scanPrefixUnit(
  normText: string,
  normLowerText: string,
  numStartNorm: number,
  minBoundNorm: number = 0,
): UnitMatch | null {
  if (numStartNorm <= minBoundNorm) {
    return null;
  }

  // Skip whitespace right before number.
  let endBeforeWs = numStartNorm;
  let spacesCount = 0;
  while (endBeforeWs > minBoundNorm && normText.charCodeAt(endBeforeWs - 1) === 32) {
    spacesCount++;
    endBeforeWs--;
  }
  if (endBeforeWs <= minBoundNorm) {
    return null;
  }

  // 1. Prefix currency (at most 1 space or 0 spaces between symbol/code and number)
  const prevLowerCode = normLowerText.charCodeAt(endBeforeWs - 1);
  if (
    spacesCount <= 1 &&
    (prevLowerCode === 36 /* '$' */ ||
      prevLowerCode === 0x20ac /* '€' */ ||
      prevLowerCode === 0x00a3 /* '£' */ ||
      prevLowerCode === 100 /* 'd' */ ||
      prevLowerCode === 114 /* 'r' */ ||
      prevLowerCode === 112 /* 'p' */)
  ) {
    for (let i = 0; i < PREFIX_CURRENCIES.length; i++) {
      const c = PREFIX_CURRENCIES[i]!;
      const pLen = c.prefixLower.length;
      const start = endBeforeWs - pLen;
      if (start < minBoundNorm) {
        continue;
      }
      if (normLowerText.startsWith(c.prefixLower, start)) {
        if (!c.isWord || isBoundaryBefore(normText, start)) {
          return {
            family: c.family,
            unitCanon: c.unitCanon,
            factor: 1,
            startNorm: start,
            endNorm: endBeforeWs,
            isSampleSizePrefix: false,
            isRatioPrefix: false,
          };
        }
      }
    }
  }

  // 2. Prefix `n =` / `N =`
  if (prevLowerCode === 61 /* '=' */) {
    let p = endBeforeWs - 1;
    while (p > minBoundNorm && normText.charCodeAt(p - 1) === 32) {
      p--;
    }
    if (p > minBoundNorm) {
      const chN = normText.charCodeAt(p - 1);
      if ((chN === 110 || chN === 78) && isBoundaryBefore(normText, p - 1)) {
        return {
          family: "count",
          unitCanon: "count",
          factor: 1,
          startNorm: p - 1,
          endNorm: endBeforeWs,
          isSampleSizePrefix: true,
          isRatioPrefix: false,
        };
      }
    }
  }

  // 3. Ratio prefix (`OR`, `HR`, `RR`, `IRR`, `odds ratio`, etc.) with optional connector (`=`, `:`, `,`, `of`, `was`, `is`)
  if (
    spacesCount <= 2 &&
    (prevLowerCode === 61 ||
      prevLowerCode === 58 ||
      prevLowerCode === 44 ||
      prevLowerCode === 114 ||
      prevLowerCode === 111 ||
      prevLowerCode === 107 ||
      prevLowerCode === 102 ||
      prevLowerCode === 115)
  ) {
    let labelEnd = endBeforeWs;
    const chLast = normText.charCodeAt(labelEnd - 1);
    if (chLast === 61 || chLast === 58 || chLast === 44) {
      labelEnd--;
      while (labelEnd > minBoundNorm && normText.charCodeAt(labelEnd - 1) === 32) {
        labelEnd--;
      }
    } else {
      for (const conn of RATIO_CONNECTORS) {
        if (conn.length > 1 && labelEnd - conn.length >= minBoundNorm) {
          const cStart = labelEnd - conn.length;
          if (normLowerText.startsWith(conn, cStart) && isBoundaryBefore(normText, cStart)) {
            labelEnd = cStart;
            while (labelEnd > minBoundNorm && normText.charCodeAt(labelEnd - 1) === 32) {
              labelEnd--;
            }
            break;
          }
        }
      }
    }

    for (let i = 0; i < PREFIX_RATIOS.length; i++) {
      const r = PREFIX_RATIOS[i]!;
      const lLen = r.label.length;
      const lStart = labelEnd - lLen;
      if (lStart < minBoundNorm) {
        continue;
      }
      const matches = r.caseSensitive
        ? normText.startsWith(r.label, lStart)
        : normLowerText.startsWith(r.label, lStart);
      if (matches && isBoundaryBefore(normText, lStart)) {
        return {
          family: r.family,
          unitCanon: r.unitCanon,
          factor: 1,
          startNorm: lStart,
          endNorm: labelEnd,
          isSampleSizePrefix: false,
          isRatioPrefix: true,
        };
      }
    }
  }

  return null;
}

/**
 * Resolves trailing/leading ASCII spaces around punctuation check if needed.
 */
export function isNormSpaceChar(code: number): boolean {
  return isSpace(code);
}
