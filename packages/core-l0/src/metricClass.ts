import { isBaseLetter, isDigit, normLower } from "./norm.js";
import type { UnitFamily } from "./units.js";

export type MetricClass =
  | "sample_size"
  | "percentage"
  | "effect_size"
  | "p_value"
  | "duration"
  | "dose"
  | "concentration"
  | "currency"
  | "count"
  | "ratio"
  | "other";

export interface MetricClassInput {
  readonly unitFamily: UnitFamily;
  readonly isRule4PValue: boolean;
  readonly isSampleSizePrefix: boolean;
  readonly windowWordsLower: readonly string[];
  readonly windowTextLower: string;
  readonly preNormalized?: boolean;
}

export interface MetricClassification {
  readonly metricClass: MetricClass;
  /** `true` iff class was decided by unit family or Rule 4 (`03` §2.3). */
  readonly metricFromUnit: boolean;
}

export const EFFECT_SIZE_SINGLE_WORDS: ReadonlySet<string> = new Set([
  "beta",
  "β",
  "correlation",
  "auc",
  "smd",
  "md"
]);

export const SAMPLE_SIZE_SINGLE_WORDS: ReadonlySet<string> = new Set([
  "enrolled",
  "recruited",
  "randomized",
  "randomised",
  "included",
  "total",
  "cohort"
]);

export const DOSE_SINGLE_WORDS: ReadonlySet<string> = new Set([
  "dose",
  "dosage",
  "administered",
  "given"
]);

function isWordCharAsciiOrLetter(text: string, idx: number): boolean {
  if (idx < 0 || idx >= text.length) {
    return false;
  }
  const code = text.charCodeAt(idx);
  return isBaseLetter(code) || isDigit(code);
}

function containsWholeToken(haystackLower: string, needleLower: string): boolean {
  let pos = 0;
  while (pos <= haystackLower.length - needleLower.length) {
    const found = haystackLower.indexOf(needleLower, pos);
    if (found === -1) {
      return false;
    }
    const leftOk = !isWordCharAsciiOrLetter(haystackLower, found - 1);
    const rightIdx = found + needleLower.length;
    const rightOk = !isWordCharAsciiOrLetter(haystackLower, rightIdx);
    if (leftOk && rightOk) {
      return true;
    }
    pos = found + 1;
  }
  return false;
}

function containsRequals(haystackLower: string): boolean {
  let pos = 0;
  while (pos < haystackLower.length) {
    const found = haystackLower.indexOf("r", pos);
    if (found === -1) {
      return false;
    }
    if (!isWordCharAsciiOrLetter(haystackLower, found - 1)) {
      let j = found + 1;
      while (j < haystackLower.length && haystackLower.charCodeAt(j) === 32) {
        j++;
      }
      if (j < haystackLower.length && haystackLower.charCodeAt(j) === 61 /* '=' */) {
        return true;
      }
    }
    pos = found + 1;
  }
  return false;
}

function hasAdjacentWords(wordsLower: readonly string[], w0: string, w1: string): boolean {
  for (let i = 0; i + 1 < wordsLower.length; i++) {
    if (wordsLower[i] === w0 && wordsLower[i + 1] === w1) {
      return true;
    }
  }
  return false;
}

function hasEffectSizeCue(wordsLower: readonly string[], textLower: string): boolean {
  for (let i = 0; i < wordsLower.length; i++) {
    if (EFFECT_SIZE_SINGLE_WORDS.has(wordsLower[i]!)) {
      return true;
    }
  }
  if (hasAdjacentWords(wordsLower, "effect", "size")) {
    return true;
  }
  if (textLower.length === 0 || textLower.includes("cohen")) {
    if (
      textLower.length > 0 &&
      (containsWholeToken(textLower, "cohen's d") || containsWholeToken(textLower, "cohen\u2019s d"))
    ) {
      return true;
    }
    if (
      hasAdjacentWords(wordsLower, "cohen", "d") ||
      hasAdjacentWords(wordsLower, "cohen's", "d") ||
      hasAdjacentWords(wordsLower, "cohen\u2019s", "d")
    ) {
      return true;
    }
    for (let i = 0; i + 2 < wordsLower.length; i++) {
      if (wordsLower[i] === "cohen" && wordsLower[i + 1] === "s" && wordsLower[i + 2] === "d") {
        return true;
      }
    }
  }
  if (textLower.includes("=") && containsRequals(textLower)) {
    return true;
  }
  if (
    (textLower.includes("r^2") && containsWholeToken(textLower, "r^2")) ||
    (textLower.includes("r\u00b2") && containsWholeToken(textLower, "r\u00b2"))
  ) {
    return true;
  }
  return false;
}

function hasSampleSizeCue(wordsLower: readonly string[]): boolean {
  for (let i = 0; i < wordsLower.length; i++) {
    if (SAMPLE_SIZE_SINGLE_WORDS.has(wordsLower[i]!)) {
      return true;
    }
  }
  return hasAdjacentWords(wordsLower, "sample", "size");
}

function hasDoseCue(wordsLower: readonly string[]): boolean {
  for (let i = 0; i < wordsLower.length; i++) {
    if (DOSE_SINGLE_WORDS.has(wordsLower[i]!)) {
      return true;
    }
  }
  return false;
}

function isRatioFamily(family: UnitFamily): boolean {
  return (
    family === "ratio_or" ||
    family === "ratio_hr" ||
    family === "ratio_rr" ||
    family === "ratio_irr"
  );
}

function isCurrencyFamily(family: UnitFamily): boolean {
  return (
    family === "currency_usd" ||
    family === "currency_eur" ||
    family === "currency_gbp" ||
    family === "currency_idr"
  );
}

const MC_P_VALUE: MetricClassification = { metricClass: "p_value", metricFromUnit: true };
const MC_EFFECT_UNIT: MetricClassification = { metricClass: "effect_size", metricFromUnit: true };
const MC_EFFECT_CUE: MetricClassification = { metricClass: "effect_size", metricFromUnit: false };
const MC_SAMPLE_SIZE: MetricClassification = { metricClass: "sample_size", metricFromUnit: false };
const MC_PERCENTAGE: MetricClassification = { metricClass: "percentage", metricFromUnit: false };
const MC_DURATION: MetricClassification = { metricClass: "duration", metricFromUnit: true };
const MC_DOSE: MetricClassification = { metricClass: "dose", metricFromUnit: false };
const MC_CONCENTRATION: MetricClassification = { metricClass: "concentration", metricFromUnit: true };
const MC_CURRENCY: MetricClassification = { metricClass: "currency", metricFromUnit: true };
const MC_COUNT: MetricClassification = { metricClass: "count", metricFromUnit: false };
const MC_OTHER: MetricClassification = { metricClass: "other", metricFromUnit: false };

/**
 * Fast zero-allocation classification when the ±6 window contains no cue keywords.
 */
export function classifyUnitOnly(
  unitFamily: UnitFamily,
  isRule4PValue: boolean,
  isSampleSizePrefix: boolean,
): MetricClassification {
  if (isRule4PValue) {
    return MC_P_VALUE;
  }
  if (isRatioFamily(unitFamily)) {
    return MC_EFFECT_UNIT;
  }
  if (unitFamily === "count" && isSampleSizePrefix) {
    return MC_SAMPLE_SIZE;
  }
  if (unitFamily === "percent") {
    return MC_PERCENTAGE;
  }
  if (unitFamily === "time_short" || unitFamily === "time_long") {
    return MC_DURATION;
  }
  if (unitFamily === "mass_concentration" || unitFamily === "molar_concentration") {
    return MC_CONCENTRATION;
  }
  if (isCurrencyFamily(unitFamily)) {
    return MC_CURRENCY;
  }
  if (unitFamily === "count") {
    return MC_COUNT;
  }
  return MC_OTHER;
}

/**
 * Classifies a quantitative expression by `02` §7.4 first-match priority order
 * and computes `metricFromUnit` per `03` §2.3.
 */
export function classifyMetricClass(input: MetricClassInput): MetricClassification {
  const { unitFamily, isRule4PValue, isSampleSizePrefix, windowWordsLower } = input;

  // 1. p_value
  if (isRule4PValue) {
    return MC_P_VALUE;
  }

  // 2. effect_size
  if (isRatioFamily(unitFamily)) {
    return MC_EFFECT_UNIT;
  }
  if (windowWordsLower.length > 0 || input.windowTextLower.length > 0) {
    const textLower =
      input.preNormalized === true ? input.windowTextLower : normLower(input.windowTextLower);
    if (hasEffectSizeCue(windowWordsLower, textLower)) {
      return MC_EFFECT_CUE;
    }
  }

  // 3. sample_size
  if (
    (unitFamily === "count" && isSampleSizePrefix) ||
    (unitFamily !== "percent" && windowWordsLower.length > 0 && hasSampleSizeCue(windowWordsLower))
  ) {
    return MC_SAMPLE_SIZE;
  }

  // 4. percentage
  if (unitFamily === "percent") {
    return MC_PERCENTAGE;
  }

  // 5. duration
  if (unitFamily === "time_short" || unitFamily === "time_long") {
    return MC_DURATION;
  }

  // 6. dose
  if (
    (unitFamily === "mass" || unitFamily === "dose_per_body_mass") &&
    windowWordsLower.length > 0 &&
    hasDoseCue(windowWordsLower)
  ) {
    return MC_DOSE;
  }

  // 7. concentration
  if (unitFamily === "mass_concentration" || unitFamily === "molar_concentration") {
    return MC_CONCENTRATION;
  }

  // 8. currency
  if (isCurrencyFamily(unitFamily)) {
    return MC_CURRENCY;
  }

  // 9. count
  if (unitFamily === "count") {
    return MC_COUNT;
  }

  // 10. ratio (reachable via fallback or direct helpers; unit-decided)
  // 11. other
  return MC_OTHER;
}

export function isMetricFromUnitClass(
  metricClass: MetricClass,
  decidedByRatioFamily: boolean = false,
): boolean {
  switch (metricClass) {
    case "p_value":
    case "duration":
    case "concentration":
    case "currency":
    case "ratio":
      return true;
    case "effect_size":
      return decidedByRatioFamily;
    case "sample_size":
    case "percentage":
    case "dose":
    case "count":
    case "other":
      return false;
  }
}
