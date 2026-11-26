/**
 * B5 Manuscript Self-Consistency Engine: Deterministic & Incremental Pairing,
 * 3-Class Baseline, L1 Contract Check, and Prose/Table/Lab-Note Extraction
 * (`docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` §4).
 *
 * Tier B pure module (D-30): zero Firebase, DOM, network, Node I/O, clock,
 * unseeded randomness, platform case/normalization APIs, or regex usage.
 */

import { extractWordSpans, scanCitations, type WordSpan } from "./citations.js";
import { applyLatexSubstitutions } from "./latex.js";
import { preMask, type ExtractedTable, type SourceFormat } from "./mask.js";
import { codePointAtSafe, isDigit, isLetter, normLower, sha256hex } from "./norm.js";
import { prepareInput } from "./numberParser.js";
import { extractQuantities } from "./quantity.js";
import { matchCanonicalSectionLabel } from "./sections.js";
import { sameFamily } from "./units.js";
import type {
  Authority,
  B5CheckV1,
  B5Verdict,
  MetricClass,
  PComparator,
  QuantTuple,
  TextRange,
  TupleSource,
} from "@toulmin/schemas";

export type { Authority, B5CheckV1, B5Verdict, MetricClass, PComparator, QuantTuple, TextRange, TupleSource };

// ───────────────────────── Normative Constants (`03` §4.4–§4.5) ─────────────────────────

export const B5_JACCARD_SCALE = 1_000_000_000;
export const B5_JACCARD_MIN_FIXED = Math.floor(0.35 * B5_JACCARD_SCALE + 0.5);
export const B5_BASELINE_INCONSISTENT_JACCARD_FIXED = Math.floor(0.5 * B5_JACCARD_SCALE + 0.5);
export const B5_MAX_PARTNERS = 3;
export const B5_WINDOW_RADIUS_WORDS = 20;

export const ATTRITION_SINGLE_CUES: ReadonlySet<string> = new Set([
  "completed",
  "analysed",
  "analyzed",
  "follow-up",
  "excluded",
  "withdrew",
  "withdrawn",
  "discontinued",
  "per-protocol",
  "evaluable",
  "remaining",
]);

export const ATTRITION_MULTI_WORD_CUES: readonly (readonly string[])[] = [
  ["followed", "up"],
  ["lost", "to", "follow-up"],
];

export const ATTRITION_CUES: ReadonlySet<string> = new Set([
  ...ATTRITION_SINGLE_CUES,
  ...ATTRITION_MULTI_WORD_CUES.map((p) => p.join(" ")),
]);

// ───────────────────────── Public Interfaces ─────────────────────────

export type B5CheckVerdict = "DETERMINISTIC_CONSISTENT" | B5Verdict;
export type B5CheckProvenance = "DETERMINISTIC" | "ON_DEVICE";

export interface B5Tuple extends QuantTuple {
  readonly docId: string;
  readonly claimId: string | null;
  readonly sentenceHash: string;
  readonly occurrence: number;
  readonly windowText: string;
}

export interface B5CheckRecord {
  readonly pairKey: string;
  readonly tupleA: string;
  readonly tupleB: string;
  readonly verdict: B5CheckVerdict;
  readonly provenance: B5CheckProvenance;
  readonly checkedAt?: number;
}

export interface B5CandidatePair {
  readonly pairKey: string;
  readonly tupleA: string;
  readonly tupleB: string;
  readonly jaccardFixed: number;
  readonly sectionDistance: number;
}

export interface B5Index {
  readonly tuples: ReadonlyMap<string, B5Tuple>;
  readonly lemmaIndex: ReadonlyMap<string, ReadonlySet<string>>;
  readonly keptByTuple: ReadonlyMap<string, readonly B5CandidatePair[]>;
  readonly checks: ReadonlyMap<string, B5CheckRecord>;
}

export interface B5MutationBatch {
  readonly upsert?: readonly B5Tuple[];
  readonly remove?: readonly string[];
}

export interface B5PairingJob {
  readonly docId: string;
  readonly metricClass: Exclude<MetricClass, "other">;
  readonly affectedTupleIds: readonly string[];
}

export interface B5IncrementalResult {
  readonly index: B5Index;
  readonly jobs: readonly B5PairingJob[];
  readonly keptPairs: readonly B5CandidatePair[];
  readonly enqueuePairs: readonly B5CandidatePair[];
  readonly deletedOrphanPairKeys: readonly string[];
  readonly changedClaimIds: readonly string[];
  readonly changedPairKeys: readonly string[];
}

export interface B5EffectiveOutcome {
  readonly verdict: B5CheckVerdict | null;
  readonly baselineClass: B5Verdict | null;
  readonly showBadge: boolean;
  readonly badgeKind: "MANUSCRIPT_MISMATCH" | "LAB_NOTE_MISMATCH" | "NONE";
  readonly detailKind: "DIFFERENT_SUBSET" | "ADVISORY_ASSESSMENT" | "NONE";
}

export interface B5PartnerResolverResult {
  (claimId: string): readonly string[];
}

// ───────────────────────── Identity, Rounding & Similarity Helpers ─────────────────────────

function compareAscii(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function dedupeAndSort(values: Iterable<string>): string[] {
  const out = Array.from(new Set(values));
  out.sort(compareAscii);
  return out;
}

export function pairKeyOf(
  tupleIdA: string,
  tupleIdB: string,
): { readonly pairKey: string; readonly tupleA: string; readonly tupleB: string } {
  const [tupleA, tupleB] =
    compareAscii(tupleIdA, tupleIdB) <= 0 ? [tupleIdA, tupleIdB] : [tupleIdB, tupleIdA];
  return {
    pairKey: sha256hex(`${tupleA}|${tupleB}`),
    tupleA,
    tupleB,
  };
}

function splitRangeParts(lower: string): string[] {
  const toIdx = lower.indexOf(" to ");
  if (toIdx !== -1) {
    return [lower.slice(0, toIdx).trim(), lower.slice(toIdx + 4).trim()];
  }
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < lower.length; i += 1) {
    const ch = lower.charAt(i);
    if (ch === "\u2013" || ch === "\u2014") {
      const left = lower.slice(start, i).trim();
      if (left.length > 0) parts.push(left);
      start = i + 1;
    } else if (ch === "-" && i > start) {
      const prev = lower.charAt(i - 1);
      if (prev !== "e" && prev !== "^" && prev !== "-") {
        const left = lower.slice(start, i).trim();
        if (left.length > 0) parts.push(left);
        start = i + 1;
      }
    }
  }
  const tail = lower.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts.length > 0 ? parts : [lower];
}

function countDigitsAndStripSeparators(part: string): {
  readonly dotCount: number;
  readonly commaCount: number;
  readonly lastDot: number;
  readonly lastComma: number;
  readonly digitsOnly: string;
} {
  let dotCount = 0;
  let commaCount = 0;
  let lastDot = -1;
  let lastComma = -1;
  let digitsOnly = "";
  for (let i = 0; i < part.length; i += 1) {
    const cu = part.charCodeAt(i);
    if (cu >= 48 && cu <= 57) {
      digitsOnly += part.charAt(i);
    } else if (cu === 46 /* '.' */) {
      dotCount += 1;
      lastDot = i;
    } else if (cu === 44 /* ',' */) {
      commaCount += 1;
      lastComma = i;
    }
  }
  return { dotCount, commaCount, lastDot, lastComma, digitsOnly };
}

function countDigitsAfterIndex(text: string, idx: number): number {
  let count = 0;
  for (let i = idx + 1; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    if (cu >= 48 && cu <= 57) count += 1;
  }
  return count;
}

function parseSignedIntStrict(text: string): number | null {
  const s = text.trim();
  if (s.length === 0) return null;
  let idx = 0;
  if (s.charCodeAt(0) === 43 || s.charCodeAt(0) === 45) idx = 1;
  if (idx >= s.length) return null;
  for (let i = idx; i < s.length; i += 1) {
    const cu = s.charCodeAt(i);
    if (cu < 48 || cu > 57) return null;
  }
  const val = Number(s);
  return Number.isInteger(val) ? val : null;
}

function isValidSingleThousandsPrefix(s: string, sepIdx: number): boolean {
  let digitCount = 0;
  let firstDigit = 0;
  for (let i = 0; i < sepIdx; i += 1) {
    const cu = s.charCodeAt(i);
    if (cu >= 48 && cu <= 57) {
      if (digitCount === 0) firstDigit = cu;
      digitCount += 1;
    } else if (
      digitCount > 0 ||
      (cu !== 32 && cu !== 43 && cu !== 45 && cu !== 8722)
    ) {
      return false;
    }
  }
  return digitCount >= 1 && digitCount <= 3 && firstDigit !== 48;
}

function decimalsOfSingleLiteral(s: string, unscaledValueNorm?: number | null): number {
  let mantissaPart = s;
  let expShift = 0;

  // Match `× 10^k`, `x 10^k`, `* 10^k`, `· 10^k` (or `. 10^k` after mid-dot norm)
  const powIdx = s.indexOf("10^");
  if (powIdx > 0) {
    let opPos = powIdx - 1;
    while (opPos >= 0 && s.charCodeAt(opPos) === 32) opPos -= 1;
    const opCh = opPos >= 0 ? s.charAt(opPos) : "";
    if (
      opPos > 0 &&
      (opCh === "\u00d7" || opCh === "x" || opCh === "*" || opCh === "\u00b7" || opCh === ".")
    ) {
      const parsedExp = parseSignedIntStrict(s.slice(powIdx + 3));
      if (parsedExp !== null) {
        mantissaPart = s.slice(0, opPos).trim();
        expShift = parsedExp;
      }
    }
  } else {
    const eIdx = s.lastIndexOf("e");
    if (eIdx > 0 && eIdx + 1 < s.length) {
      const parsedExp = parseSignedIntStrict(s.slice(eIdx + 1));
      if (parsedExp !== null) {
        mantissaPart = s.slice(0, eIdx).trim();
        expShift = parsedExp;
      }
    }
  }

  const stats = countDigitsAndStripSeparators(mantissaPart);
  let decCount = 0;

  if (stats.dotCount > 0 && stats.commaCount > 0) {
    // Mixed separators (e.g. `1.234,5` or `1,234.5`): last separator is decimal
    const decSep = Math.max(stats.lastDot, stats.lastComma);
    decCount = countDigitsAfterIndex(mantissaPart, decSep);
  } else if (stats.dotCount > 0) {
    if (stats.dotCount >= 2) {
      // Multiple dots (`1.234.567`) are German thousands grouping, zero fraction digits
      decCount = 0;
    } else {
      const digitsAfter = countDigitsAfterIndex(mantissaPart, stats.lastDot);
      if (
        digitsAfter === 3 &&
        expShift === 0 &&
        isValidSingleThousandsPrefix(mantissaPart, stats.lastDot) &&
        unscaledValueNorm !== undefined &&
        unscaledValueNorm !== null &&
        Math.abs(unscaledValueNorm) >= 1000 &&
        stats.digitsOnly.length > 0 &&
        Math.abs(Math.abs(unscaledValueNorm) - Number(stats.digitsOnly)) <= 1e-6
      ) {
        decCount = 0;
      } else {
        decCount = digitsAfter;
      }
    }
  } else if (stats.commaCount > 0) {
    if (stats.commaCount >= 2) {
      decCount = 0;
    } else {
      const digitsAfter = countDigitsAfterIndex(mantissaPart, stats.lastComma);
      if (
        digitsAfter === 3 &&
        expShift === 0 &&
        isValidSingleThousandsPrefix(mantissaPart, stats.lastComma)
      ) {
        if (unscaledValueNorm !== undefined && unscaledValueNorm !== null) {
          decCount =
            Math.abs(unscaledValueNorm) >= 1000 &&
            stats.digitsOnly.length > 0 &&
            Math.abs(Math.abs(unscaledValueNorm) - Number(stats.digitsOnly)) <= 1e-6
              ? 0
              : 3;
        } else {
          decCount = 0;
        }
      } else {
        decCount = digitsAfter;
      }
    }
  }

  const effective = decCount - expShift;
  return effective > 0 ? effective : 0;
}

/**
 * Counts significant fraction digits after the decimal separator in `valueRaw`
 * (`03` §4.4: `decimals(valueRaw) = number of digits after the decimal separator, 0 if none`).
 */
export function decimalsOf(valueRaw: string, unscaledValueNorm?: number | null): number {
  const lower = normLower(valueRaw.trim());
  if (lower.length === 0) return 0;
  const parts = splitRangeParts(lower);
  if (parts.length === 1) {
    return decimalsOfSingleLiteral(parts[0]!, unscaledValueNorm);
  }
  let maxDec = 0;
  for (const p of parts) {
    const d = decimalsOfSingleLiteral(p, null);
    if (d > maxDec) maxDec = d;
  }
  return maxDec;
}

/**
 * Raw-to-canonical conversion factor (`02` §7.3 & `03` §4.4 `unitFactor(t)`).
 */
export function unitFactorOf(unitRaw: string, unitCanon: string): number {
  const rawLower = normLower(unitRaw.trim());
  switch (unitCanon) {
    case "mg":
      if (rawLower === "kg") return 1e6;
      if (rawLower === "g") return 1000;
      if (rawLower === "μg" || rawLower === "ug" || rawLower === "mcg") return 0.001;
      if (rawLower === "ng") return 1e-6;
      return 1;
    case "s":
      if (rawLower === "weeks" || rawLower === "week" || rawLower === "wk") return 604800;
      if (rawLower === "days" || rawLower === "day" || rawLower === "d") return 86400;
      if (
        rawLower === "hours" ||
        rawLower === "hour" ||
        rawLower === "hrs" ||
        rawLower === "hr" ||
        rawLower === "h"
      ) {
        return 3600;
      }
      if (rawLower === "minutes" || rawLower === "minute" || rawLower === "min") return 60;
      if (rawLower === "ms") return 0.001;
      return 1;
    case "month":
      if (
        rawLower === "years" ||
        rawLower === "year" ||
        rawLower === "yrs" ||
        rawLower === "yr" ||
        rawLower === "y"
      ) {
        return 12;
      }
      return 1;
    case "mg/L":
      if (rawLower === "g/dl") return 10000;
      if (rawLower === "mg/ml" || rawLower === "g/l") return 1000;
      if (rawLower === "mg/dl") return 10;
      if (rawLower === "μg/l" || rawLower === "ug/l" || rawLower === "ng/ml") return 0.001;
      return 1;
    case "mmol/L":
      if (rawLower === "mol/l") return 1000;
      if (rawLower === "μmol/l" || rawLower === "umol/l") return 0.001;
      if (rawLower === "nmol/l") return 1e-6;
      return 1;
    case "mg/kg":
      if (rawLower === "g/kg") return 1000;
      if (rawLower === "μg/kg" || rawLower === "ug/kg") return 0.001;
      return 1;
    default:
      return 1;
  }
}

export function canonicalizeB5Section(section: string): string {
  const trimmedLower = normLower(section.trim());
  if (trimmedLower.startsWith("lab:")) {
    return trimmedLower;
  }
  if (
    trimmedLower === "abstract" ||
    trimmedLower === "introduction" ||
    trimmedLower === "methods" ||
    trimmedLower === "results" ||
    trimmedLower === "discussion" ||
    trimmedLower === "limitations" ||
    trimmedLower === "conclusion" ||
    trimmedLower === "supplementary" ||
    trimmedLower === "references" ||
    trimmedLower === "unlabeled"
  ) {
    return trimmedLower;
  }
  return matchCanonicalSectionLabel(section, false) ?? "unlabeled";
}

export function sectionDistance(sectionA: string, sectionB: string): 0 | 1 | 2 {
  const a = canonicalizeB5Section(sectionA);
  const b = canonicalizeB5Section(sectionB);
  if (a === b) return 0;
  if (
    (a === "abstract" && (b === "results" || b === "conclusion")) ||
    (b === "abstract" && (a === "results" || a === "conclusion"))
  ) {
    return 1;
  }
  return 2;
}

export function jaccardScore(lemmasA: readonly string[], lemmasB: readonly string[]): number {
  if (lemmasA.length === 0 && lemmasB.length === 0) return 0;
  const setA = new Set(lemmasA);
  const setB = new Set(lemmasB);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function jaccardFixed(lemmasA: readonly string[], lemmasB: readonly string[]): number {
  return Math.floor(jaccardScore(lemmasA, lemmasB) * B5_JACCARD_SCALE + 0.5);
}

interface PInterval {
  readonly lo: number;
  readonly hi: number;
  readonly loClosed: boolean;
  readonly hiClosed: boolean;
}

function halfUlpDecimal(decimals: number): number {
  return Number(`5e${String(-decimals - 1)}`);
}

function buildPInterval(t: Pick<QuantTuple, "pComparator" | "valueNorm" | "valueRaw">): PInterval | null {
  if (t.valueNorm === null) return null;
  const v = t.valueNorm;
  const comp: PComparator = t.pComparator ?? "=";
  switch (comp) {
    case "<":
      return { lo: 0, hi: v, loClosed: true, hiClosed: false };
    case "<=":
      return { lo: 0, hi: v, loClosed: true, hiClosed: true };
    case ">":
      return { lo: v, hi: 1, loClosed: false, hiClosed: true };
    case ">=":
      return { lo: v, hi: 1, loClosed: true, hiClosed: true };
    case "=": {
      const tol = halfUlpDecimal(decimalsOf(t.valueRaw, v));
      return { lo: v - tol, hi: v + tol, loClosed: true, hiClosed: true };
    }
  }
}

export function pCompatible(
  a: Pick<QuantTuple, "pComparator" | "valueNorm" | "valueRaw">,
  b: Pick<QuantTuple, "pComparator" | "valueNorm" | "valueRaw">,
): boolean {
  const ia = buildPInterval(a);
  const ib = buildPInterval(b);
  if (ia === null || ib === null) return false;

  const eps = 1e-12 * Math.max(1, Math.abs(ia.hi), Math.abs(ib.hi), Math.abs(ia.lo), Math.abs(ib.lo));

  // Check lower of overlap vs upper of overlap
  let lo = ia.lo;
  let loClosed = ia.loClosed;
  if (Math.abs(ib.lo - ia.lo) <= eps) {
    loClosed = ia.loClosed && ib.loClosed;
  } else if (ib.lo > ia.lo) {
    lo = ib.lo;
    loClosed = ib.loClosed;
  }

  let hi = ia.hi;
  let hiClosed = ia.hiClosed;
  if (Math.abs(ib.hi - ia.hi) <= eps) {
    hiClosed = ia.hiClosed && ib.hiClosed;
  } else if (ib.hi < ia.hi) {
    hi = ib.hi;
    hiClosed = ib.hiClosed;
  }

  if (Math.abs(lo - hi) <= eps) {
    return loClosed && hiClosed;
  }
  return lo < hi;
}

export function consistentValues(
  a: Pick<QuantTuple, "metricClass" | "pComparator" | "valueNorm" | "valueRaw" | "unitRaw" | "unitCanon">,
  b: Pick<QuantTuple, "metricClass" | "pComparator" | "valueNorm" | "valueRaw" | "unitRaw" | "unitCanon">,
): boolean {
  if (a.valueNorm === null || b.valueNorm === null) return false;
  if (a.metricClass === "p_value" && b.metricClass === "p_value") {
    return pCompatible(a, b);
  }
  const facA = unitFactorOf(a.unitRaw, a.unitCanon);
  const facB = unitFactorOf(b.unitRaw, b.unitCanon);
  const tolA = halfUlpDecimal(decimalsOf(a.valueRaw, a.valueNorm / facA)) * facA;
  const tolB = halfUlpDecimal(decimalsOf(b.valueRaw, b.valueNorm / facB)) * facB;
  const tol = Math.max(tolA, tolB);
  const diff = Math.abs(a.valueNorm - b.valueNorm);
  const ulp = 1e-12 * Math.max(1, Math.abs(a.valueNorm), Math.abs(b.valueNorm), tol);
  return diff <= tol + ulp;
}

export function isCandidatePairEligible(a: B5Tuple, b: B5Tuple): boolean {
  if (a.docId !== b.docId) return false;
  if (a.tupleId === b.tupleId) return false;
  if (a.metricClass !== b.metricClass || a.metricClass === "other") return false;
  if (!sameFamily(a.unitCanon, b.unitCanon)) return false;
  if (
    a.sentenceHash === b.sentenceHash &&
    a.occurrence === b.occurrence &&
    a.source === b.source
  ) {
    return false;
  }
  if (a.valueNorm === null || b.valueNorm === null) return false;
  return jaccardFixed(a.keyLemmas, b.keyLemmas) >= B5_JACCARD_MIN_FIXED;
}

// ───────────────────────── Indexed Incremental Pairing (`03` §4.4) ─────────────────────────

function lemmaPostingKey(docId: string, metricClass: MetricClass, lemma: string): string {
  return `${docId}|${metricClass}|${lemma}`;
}

export function createB5Index(): B5Index {
  return {
    tuples: new Map<string, B5Tuple>(),
    lemmaIndex: new Map<string, ReadonlySet<string>>(),
    keptByTuple: new Map<string, readonly B5CandidatePair[]>(),
    checks: new Map<string, B5CheckRecord>(),
  };
}

export function queryLemmaCandidates(index: B5Index, tuple: B5Tuple): string[] {
  if (tuple.metricClass === "other" || tuple.keyLemmas.length === 0) {
    return [];
  }
  const matched = new Set<string>();
  for (const lemma of tuple.keyLemmas) {
    const posting = index.lemmaIndex.get(lemmaPostingKey(tuple.docId, tuple.metricClass, lemma));
    if (posting === undefined) continue;
    for (const candidateId of posting) {
      if (candidateId !== tuple.tupleId) {
        matched.add(candidateId);
      }
    }
  }
  return Array.from(matched).sort(compareAscii);
}

export function splitB5JobsByMetricClass(tuples: readonly B5Tuple[]): B5PairingJob[] {
  const buckets = new Map<string, { docId: string; metricClass: Exclude<MetricClass, "other">; ids: Set<string> }>();
  for (const t of tuples) {
    if (t.metricClass === "other") continue;
    const key = `${t.docId}|${t.metricClass}`;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { docId: t.docId, metricClass: t.metricClass, ids: new Set<string>() };
      buckets.set(key, bucket);
    }
    bucket.ids.add(t.tupleId);
  }
  const keys = Array.from(buckets.keys()).sort(compareAscii);
  return keys.map((k) => {
    const b = buckets.get(k)!;
    const affectedTupleIds = Array.from(b.ids).sort(compareAscii);
    return {
      docId: b.docId,
      metricClass: b.metricClass,
      affectedTupleIds,
    };
  });
}

export function splitB5JobInHalf(job: B5PairingJob): readonly [B5PairingJob, B5PairingJob] | null {
  if (job.affectedTupleIds.length <= 1) return null;
  const mid = Math.ceil(job.affectedTupleIds.length / 2);
  return [
    {
      docId: job.docId,
      metricClass: job.metricClass,
      affectedTupleIds: job.affectedTupleIds.slice(0, mid),
    },
    {
      docId: job.docId,
      metricClass: job.metricClass,
      affectedTupleIds: job.affectedTupleIds.slice(mid),
    },
  ];
}

function comparePairsCanonical(a: B5CandidatePair, b: B5CandidatePair): number {
  const cmpA = compareAscii(a.tupleA, b.tupleA);
  if (cmpA !== 0) return cmpA;
  return compareAscii(a.tupleB, b.tupleB);
}

function addTupleToLemmaIndex(lemmaIndex: Map<string, Set<string>>, tuple: B5Tuple): void {
  if (tuple.metricClass === "other") return;
  for (const lemma of tuple.keyLemmas) {
    const key = lemmaPostingKey(tuple.docId, tuple.metricClass, lemma);
    let set = lemmaIndex.get(key);
    if (set === undefined) {
      set = new Set<string>();
      lemmaIndex.set(key, set);
    }
    set.add(tuple.tupleId);
  }
}

function removeTupleFromLemmaIndex(lemmaIndex: Map<string, Set<string>>, tuple: B5Tuple): void {
  if (tuple.metricClass === "other") return;
  for (const lemma of tuple.keyLemmas) {
    const key = lemmaPostingKey(tuple.docId, tuple.metricClass, lemma);
    const set = lemmaIndex.get(key);
    if (set === undefined) continue;
    set.delete(tuple.tupleId);
    if (set.size === 0) {
      lemmaIndex.delete(key);
    }
  }
}

function cloneIndexMutable(index: B5Index): {
  tuples: Map<string, B5Tuple>;
  lemmaIndex: Map<string, Set<string>>;
  keptByTuple: Map<string, readonly B5CandidatePair[]>;
  checks: Map<string, B5CheckRecord>;
} {
  const tuples = new Map<string, B5Tuple>(index.tuples);
  const lemmaIndex = new Map<string, Set<string>>();
  for (const [k, set] of index.lemmaIndex) {
    lemmaIndex.set(k, new Set<string>(set));
  }
  const keptByTuple = new Map<string, readonly B5CandidatePair[]>();
  for (const [tid, list] of index.keptByTuple) {
    keptByTuple.set(tid, list);
  }
  const checks = new Map<string, B5CheckRecord>(index.checks);
  return { tuples, lemmaIndex, keptByTuple, checks };
}

function collectAllKeptPairsMap(keptByTuple: ReadonlyMap<string, readonly B5CandidatePair[]>): Map<string, B5CandidatePair> {
  const map = new Map<string, B5CandidatePair>();
  for (const list of keptByTuple.values()) {
    for (const pair of list) {
      if (!map.has(pair.pairKey)) {
        map.set(pair.pairKey, pair);
      }
    }
  }
  return map;
}

export function applyB5IncrementalUpdate(
  prevIndex: B5Index,
  batch: B5MutationBatch,
): B5IncrementalResult {
  const upserts = batch.upsert ?? [];
  const removals = batch.remove ?? [];

  const next = cloneIndexMutable(prevIndex);
  const affectedIds = new Set<string>();

  const seedPreMutationPartners = (tid: string): void => {
    const existing = prevIndex.tuples.get(tid);
    if (existing !== undefined) {
      for (const cid of queryLemmaCandidates(prevIndex, existing)) {
        affectedIds.add(cid);
      }
    }
    const prevKept = prevIndex.keptByTuple.get(tid);
    if (prevKept !== undefined) {
      for (const p of prevKept) {
        affectedIds.add(p.tupleA === tid ? p.tupleB : p.tupleA);
      }
    }
  };

  for (const rid of removals) {
    affectedIds.add(rid);
    seedPreMutationPartners(rid);
  }
  for (const u of upserts) {
    affectedIds.add(u.tupleId);
    seedPreMutationPartners(u.tupleId);
  }

  for (const rid of removals) {
    const old = next.tuples.get(rid);
    if (old !== undefined) {
      removeTupleFromLemmaIndex(next.lemmaIndex, old);
      next.tuples.delete(rid);
    }
    next.keptByTuple.delete(rid);
  }

  for (const u of upserts) {
    const old = next.tuples.get(u.tupleId);
    if (old !== undefined) {
      removeTupleFromLemmaIndex(next.lemmaIndex, old);
    }
    next.tuples.set(u.tupleId, u);
    addTupleToLemmaIndex(next.lemmaIndex, u);
  }

  const reusedIds = new Set<string>();
  for (const u of upserts) {
    if (prevIndex.tuples.has(u.tupleId)) {
      reusedIds.add(u.tupleId);
    }
  }

  // Orphan & reused-tuple check cleanup for `b5_checks` (`03` §4.4):
  // Clearing prior DETERMINISTIC checks touching reusedIds ensures any pair that became
  // non-eligible or divergent is never left behind as a stale DETERMINISTIC_CONSISTENT row;
  // still-consistent pairs are immediately recomputed in the job loop below.
  const deletedOrphanPairKeys: string[] = [];
  for (const [pk, chk] of Array.from(next.checks.entries())) {
    if (!next.tuples.has(chk.tupleA) || !next.tuples.has(chk.tupleB)) {
      next.checks.delete(pk);
      deletedOrphanPairKeys.push(pk);
    } else if (
      chk.provenance === "DETERMINISTIC" &&
      (reusedIds.has(chk.tupleA) || reusedIds.has(chk.tupleB))
    ) {
      next.checks.delete(pk);
    }
  }
  deletedOrphanPairKeys.sort(compareAscii);

  // Also include post-mutation candidate partners of every upserted tuple
  const postIndexView: B5Index = {
    tuples: next.tuples,
    lemmaIndex: next.lemmaIndex,
    keptByTuple: next.keptByTuple,
    checks: next.checks,
  };
  for (const u of upserts) {
    for (const cid of queryLemmaCandidates(postIndexView, u)) {
      affectedIds.add(cid);
    }
  }

  const activeAffectedTuples: B5Tuple[] = [];
  for (const tid of affectedIds) {
    const t = next.tuples.get(tid);
    if (t !== undefined) {
      activeAffectedTuples.push(t);
    }
  }

  const jobs = splitB5JobsByMetricClass(activeAffectedTuples);

  const lemmaSetCache = new Map<string, ReadonlySet<string>>();
  const canonSectionCache = new Map<string, string>();
  const tolCache = new Map<string, number>();

  const getLemmaSet = (t: B5Tuple): ReadonlySet<string> => {
    let s = lemmaSetCache.get(t.tupleId);
    if (s === undefined) {
      s = new Set(t.keyLemmas);
      lemmaSetCache.set(t.tupleId, s);
    }
    return s;
  };
  const getCanonSection = (t: B5Tuple): string => {
    let sec = canonSectionCache.get(t.tupleId);
    if (sec === undefined) {
      sec = canonicalizeB5Section(t.section);
      canonSectionCache.set(t.tupleId, sec);
    }
    return sec;
  };
  const getTol = (t: B5Tuple): number => {
    let tol = tolCache.get(t.tupleId);
    if (tol === undefined) {
      const fac = unitFactorOf(t.unitRaw, t.unitCanon);
      tol = halfUlpDecimal(decimalsOf(t.valueRaw, t.valueNorm! / fac)) * fac;
      tolCache.set(t.tupleId, tol);
    }
    return tol;
  };

  for (const job of jobs) {
    for (const tid of job.affectedTupleIds) {
      const tupleT = next.tuples.get(tid);
      if (tupleT === undefined || tupleT.metricClass === "other" || tupleT.valueNorm === null) {
        next.keptByTuple.set(tid, []);
        continue;
      }

      const setT = getLemmaSet(tupleT);
      const secT = getCanonSection(tupleT);
      const tolT = tupleT.metricClass === "p_value" ? 0 : getTol(tupleT);
      const tReused = reusedIds.has(tid);

      const candidateIds = queryLemmaCandidates(postIndexView, tupleT);
      const divergentRaw: {
        readonly tupleA: string;
        readonly tupleB: string;
        readonly jaccardFixed: number;
        readonly sectionDistance: number;
      }[] = [];

      for (const cid of candidateIds) {
        const tupleX = next.tuples.get(cid);
        if (tupleX === undefined || tupleX.valueNorm === null) continue;
        if (tupleT.docId !== tupleX.docId || tupleT.metricClass !== tupleX.metricClass) continue;
        if (!sameFamily(tupleT.unitCanon, tupleX.unitCanon)) continue;
        if (
          tupleT.sentenceHash === tupleX.sentenceHash &&
          tupleT.occurrence === tupleX.occurrence &&
          tupleT.source === tupleX.source
        ) {
          continue;
        }

        const setX = getLemmaSet(tupleX);
        let inter = 0;
        for (const item of setT) {
          if (setX.has(item)) inter += 1;
        }
        const union = setT.size + setX.size - inter;
        const jFixed = union === 0 ? 0 : Math.floor((inter / union) * B5_JACCARD_SCALE + 0.5);
        if (jFixed < B5_JACCARD_MIN_FIXED) continue;

        const isConsistent =
          tupleT.metricClass === "p_value"
            ? pCompatible(tupleT, tupleX)
            : (() => {
                const tol = Math.max(tolT, getTol(tupleX));
                const diff = Math.abs(tupleT.valueNorm - tupleX.valueNorm);
                const ulp = 1e-12 * Math.max(1, Math.abs(tupleT.valueNorm), Math.abs(tupleX.valueNorm), tol);
                return diff <= tol + ulp;
              })();

        const [tupleA, tupleB] =
          compareAscii(tupleT.tupleId, tupleX.tupleId) <= 0
            ? [tupleT.tupleId, tupleX.tupleId]
            : [tupleX.tupleId, tupleT.tupleId];

        if (isConsistent) {
          const pairKey = sha256hex(`${tupleA}|${tupleB}`);
          next.checks.set(pairKey, {
            pairKey,
            tupleA,
            tupleB,
            verdict: "DETERMINISTIC_CONSISTENT",
            provenance: "DETERMINISTIC",
          });
          continue;
        }

        if (next.checks.size > 0 && (tReused || reusedIds.has(cid))) {
          const staleKey = sha256hex(`${tupleA}|${tupleB}`);
          const existingChk = next.checks.get(staleKey);
          if (existingChk !== undefined && existingChk.provenance === "DETERMINISTIC") {
            next.checks.delete(staleKey);
          }
        }

        const secX = getCanonSection(tupleX);
        const sDist: 0 | 1 | 2 =
          secT === secX
            ? 0
            : (secT === "abstract" && (secX === "results" || secX === "conclusion")) ||
                (secX === "abstract" && (secT === "results" || secT === "conclusion"))
              ? 1
              : 2;

        divergentRaw.push({
          tupleA,
          tupleB,
          jaccardFixed: jFixed,
          sectionDistance: sDist,
        });
      }

      divergentRaw.sort((a, b) => {
        if (a.jaccardFixed !== b.jaccardFixed) return b.jaccardFixed - a.jaccardFixed;
        if (a.sectionDistance !== b.sectionDistance) return a.sectionDistance - b.sectionDistance;
        const cmpA = compareAscii(a.tupleA, b.tupleA);
        if (cmpA !== 0) return cmpA;
        return compareAscii(a.tupleB, b.tupleB);
      });

      const top3: B5CandidatePair[] = divergentRaw.slice(0, B5_MAX_PARTNERS).map((raw) => ({
        pairKey: sha256hex(`${raw.tupleA}|${raw.tupleB}`),
        tupleA: raw.tupleA,
        tupleB: raw.tupleB,
        jaccardFixed: raw.jaccardFixed,
        sectionDistance: raw.sectionDistance,
      }));
      next.keptByTuple.set(tid, top3);
    }
  }

  const finalIndex: B5Index = {
    tuples: next.tuples,
    lemmaIndex: next.lemmaIndex,
    keptByTuple: next.keptByTuple,
    checks: next.checks,
  };

  const prevKeptMap = collectAllKeptPairsMap(prevIndex.keptByTuple);
  const nextKeptMap = collectAllKeptPairsMap(finalIndex.keptByTuple);

  const keptPairs = Array.from(nextKeptMap.values()).sort(comparePairsCanonical);
  const enqueuePairs = keptPairs.filter((p) => !finalIndex.checks.has(p.pairKey));

  const allPairKeys = new Set<string>([
    ...prevKeptMap.keys(),
    ...nextKeptMap.keys(),
    ...prevIndex.checks.keys(),
    ...finalIndex.checks.keys(),
  ]);

  const changedPairKeys: string[] = [];
  const changedClaimSet = new Set<string>();

  for (const pk of allPairKeys) {
    const wasKept = prevKeptMap.has(pk);
    const isKept = nextKeptMap.has(pk);
    const prevChk = prevIndex.checks.get(pk);
    const nextChk = finalIndex.checks.get(pk);

    let pairChanged =
      wasKept !== isKept ||
      prevChk?.verdict !== nextChk?.verdict ||
      prevChk?.provenance !== nextChk?.provenance;

    if (!pairChanged && wasKept && isKept) {
      const prevPair = prevKeptMap.get(pk)!;
      const nextPair = nextKeptMap.get(pk)!;
      if (reusedIds.has(prevPair.tupleA) || reusedIds.has(prevPair.tupleB)) {
        if (prevPair.sectionDistance !== nextPair.sectionDistance) {
          pairChanged = true;
        } else {
          const prevA = prevIndex.tuples.get(prevPair.tupleA);
          const prevB = prevIndex.tuples.get(prevPair.tupleB);
          const nextA = finalIndex.tuples.get(nextPair.tupleA);
          const nextB = finalIndex.tuples.get(nextPair.tupleB);
          if (
            prevA !== undefined &&
            prevB !== undefined &&
            nextA !== undefined &&
            nextB !== undefined &&
            classifyB5Baseline(prevA, prevB) !== classifyB5Baseline(nextA, nextB)
          ) {
            pairChanged = true;
          }
        }
      }
    }

    if (pairChanged) {
      changedPairKeys.push(pk);
      const refPair = nextKeptMap.get(pk) ?? prevKeptMap.get(pk) ?? nextChk ?? prevChk;
      if (refPair !== undefined) {
        const tA = finalIndex.tuples.get(refPair.tupleA) ?? prevIndex.tuples.get(refPair.tupleA);
        const tB = finalIndex.tuples.get(refPair.tupleB) ?? prevIndex.tuples.get(refPair.tupleB);
        if (tA !== undefined && tA.claimId !== null) changedClaimSet.add(tA.claimId);
        if (tB !== undefined && tB.claimId !== null) changedClaimSet.add(tB.claimId);
      }
    }
  }

  changedPairKeys.sort(compareAscii);
  const changedClaimIds = dedupeAndSort(changedClaimSet);

  return {
    index: finalIndex,
    jobs,
    keptPairs,
    enqueuePairs,
    deletedOrphanPairKeys,
    changedClaimIds,
    changedPairKeys,
  };
}

export function recomputeB5Full(
  tuples: readonly B5Tuple[],
  preservedOnDeviceChecks?: readonly B5CheckRecord[],
): B5IncrementalResult {
  const ordered = [...tuples].sort((a, b) => compareAscii(a.tupleId, b.tupleId));
  let base = createB5Index();
  if (preservedOnDeviceChecks !== undefined && preservedOnDeviceChecks.length > 0) {
    const checks = new Map<string, B5CheckRecord>();
    for (const c of preservedOnDeviceChecks) {
      if (c.provenance === "ON_DEVICE") {
        checks.set(c.pairKey, c);
      }
    }
    base = { ...base, checks };
  }
  return applyB5IncrementalUpdate(base, { upsert: ordered });
}

export function recordB5L1Check(
  index: B5Index,
  tupleIdA: string,
  tupleIdB: string,
  decoded: B5CheckV1,
  checkedAt?: number,
): {
  readonly index: B5Index;
  readonly record: B5CheckRecord;
  readonly changedClaimIds: readonly string[];
} {
  const { pairKey, tupleA, tupleB } = pairKeyOf(tupleIdA, tupleIdB);
  const checkedVerdict = checkL1B5Output(decoded);
  const record: B5CheckRecord = {
    pairKey,
    tupleA,
    tupleB,
    verdict: checkedVerdict,
    provenance: "ON_DEVICE",
    ...(checkedAt !== undefined ? { checkedAt } : {}),
  };

  const prev = index.checks.get(pairKey);
  const checks = new Map<string, B5CheckRecord>(index.checks);
  checks.set(pairKey, record);

  const changedClaimSet = new Set<string>();
  if (prev?.verdict !== record.verdict || prev?.provenance !== record.provenance) {
    const tA = index.tuples.get(tupleA);
    const tB = index.tuples.get(tupleB);
    if (tA !== undefined && tA.claimId !== null) changedClaimSet.add(tA.claimId);
    if (tB !== undefined && tB.claimId !== null) changedClaimSet.add(tB.claimId);
  }

  return {
    index: { ...index, checks },
    record,
    changedClaimIds: dedupeAndSort(changedClaimSet),
  };
}

// ───────────────────────── 3-Class Baseline & L1 Outcome (`03` §4.5–§4.6) ─────────────────────────

function isCueWordChar(cp: number, prevIsLetter: boolean, curCharCode: number, nextCharCode: number | undefined): boolean {
  if (curCharCode === 45 /* '-' */) {
    if (nextCharCode === undefined) return false;
    const nextIsAlpha =
      (nextCharCode >= 97 && nextCharCode <= 122) ||
      isLetter(nextCharCode, false) ||
      isDigit(nextCharCode);
    return prevIsLetter && nextIsAlpha;
  }
  return isLetter(cp, prevIsLetter) || isDigit(cp);
}

function tokenizeAttritionWords(windowText: string): string[] {
  const prep = prepareInput(windowText, { applyLatex: true });
  const text = prep.normLowerText;
  const n = text.length;
  const words: string[] = [];

  let i = 0;
  while (i < n) {
    const u = codePointAtSafe(text, i);
    const startsLetter = isLetter(u.cp, false);
    if (!startsLetter && !isDigit(u.cp)) {
      i += u.len;
      continue;
    }
    const start = i;
    i += u.len;
    let prevIsLetter = startsLetter;
    while (i < n) {
      const cu = text.charCodeAt(i);
      const nextCu = i + 1 < n ? text.charCodeAt(i + 1) : undefined;
      if (cu === 45) {
        if (isCueWordChar(45, prevIsLetter, 45, nextCu)) {
          i += 1;
          prevIsLetter = true;
          continue;
        }
        break;
      }
      const curU = codePointAtSafe(text, i);
      const curIsLetter = isLetter(curU.cp, prevIsLetter);
      if (curIsLetter || isDigit(curU.cp)) {
        i += curU.len;
        prevIsLetter = curIsLetter;
      } else {
        break;
      }
    }
    words.push(text.slice(start, i));
  }
  return words;
}

export function containsAttritionCue(windowText: string): boolean {
  const words = tokenizeAttritionWords(windowText);
  for (let i = 0; i < words.length; i += 1) {
    if (ATTRITION_SINGLE_CUES.has(words[i]!)) {
      return true;
    }
    for (const phrase of ATTRITION_MULTI_WORD_CUES) {
      if (i + phrase.length <= words.length) {
        let matched = true;
        for (let j = 0; j < phrase.length; j += 1) {
          if (words[i + j] !== phrase[j]) {
            matched = false;
            break;
          }
        }
        if (matched) return true;
      }
    }
  }
  return false;
}

export function classifyB5Baseline(a: B5Tuple, b: B5Tuple): B5Verdict {
  if (consistentValues(a, b)) {
    return "DIFFERENT_QUANTITY";
  }

  // Rule 1: CONSISTENT_DIFFERENT_SUBSET iff metricClass ∈ {sample_size, count}
  // and the smaller value's window contains an attrition cue (`03` §4.5).
  if (
    a.metricClass === b.metricClass &&
    (a.metricClass === "sample_size" || a.metricClass === "count") &&
    a.valueNorm !== null &&
    b.valueNorm !== null &&
    a.valueNorm !== b.valueNorm
  ) {
    const smaller = a.valueNorm < b.valueNorm ? a : b;
    if (containsAttritionCue(smaller.windowText)) {
      return "CONSISTENT_DIFFERENT_SUBSET";
    }
  }

  // Rule 2: INCONSISTENT iff divergent ∧ jaccard >= 0.5 ∧ sectionDistance <= 1
  if (
    jaccardFixed(a.keyLemmas, b.keyLemmas) >= B5_BASELINE_INCONSISTENT_JACCARD_FIXED &&
    sectionDistance(a.section, b.section) <= 1
  ) {
    return "INCONSISTENT";
  }

  // Rule 3: DIFFERENT_QUANTITY otherwise
  return "DIFFERENT_QUANTITY";
}

/**
 * Tier B consistency check on L1 `B5CheckV1` output (`03` §4.6):
 * `s3_verdict = INCONSISTENT` with `s2_same_population = false` becomes `DIFFERENT_QUANTITY`.
 */
export function checkL1B5Output(decoded: B5CheckV1): B5Verdict {
  if (decoded.s3_verdict === "INCONSISTENT" && !decoded.s2_same_population) {
    return "DIFFERENT_QUANTITY";
  }
  return decoded.s3_verdict;
}

export function resolveEffectiveB5Outcome(
  a: B5Tuple,
  b: B5Tuple,
  checkRecord: B5CheckRecord | undefined,
  authority: Authority,
): B5EffectiveOutcome {
  const isLabNote = a.source === "lab_note" || b.source === "lab_note";
  const badgeKind: "MANUSCRIPT_MISMATCH" | "LAB_NOTE_MISMATCH" = isLabNote
    ? "LAB_NOTE_MISMATCH"
    : "MANUSCRIPT_MISMATCH";

  if (checkRecord !== undefined && checkRecord.verdict === "DETERMINISTIC_CONSISTENT") {
    return {
      verdict: "DETERMINISTIC_CONSISTENT",
      baselineClass: null,
      showBadge: false,
      badgeKind: "NONE",
      detailKind: "NONE",
    };
  }

  if (authority === "authoritative") {
    const verdict = checkRecord?.verdict ?? null;
    if (verdict === "INCONSISTENT") {
      return {
        verdict,
        baselineClass: null,
        showBadge: true,
        badgeKind,
        detailKind: "NONE",
      };
    }
    if (verdict === "CONSISTENT_DIFFERENT_SUBSET") {
      return {
        verdict,
        baselineClass: null,
        showBadge: false,
        badgeKind: "NONE",
        detailKind: "DIFFERENT_SUBSET",
      };
    }
    return {
      verdict,
      baselineClass: null,
      showBadge: false,
      badgeKind: "NONE",
      detailKind: "NONE",
    };
  }

  // Advisory authority: badge appears iff the deterministic 3-class baseline says INCONSISTENT
  const baselineClass = classifyB5Baseline(a, b);
  const showBadge = baselineClass === "INCONSISTENT";
  return {
    verdict: checkRecord?.verdict ?? null,
    baselineClass,
    showBadge,
    badgeKind: showBadge ? badgeKind : "NONE",
    detailKind: checkRecord !== undefined ? "ADVISORY_ASSESSMENT" : "NONE",
  };
}

export function computeB5InconsistentWith(
  index: B5Index,
  claimId: string,
  authority: Authority,
): string[] {
  const partners = new Set<string>();
  const keptMap = collectAllKeptPairsMap(index.keptByTuple);

  for (const pair of keptMap.values()) {
    const tA = index.tuples.get(pair.tupleA);
    const tB = index.tuples.get(pair.tupleB);
    if (tA === undefined || tB === undefined) continue;
    if (tA.claimId !== claimId && tB.claimId !== claimId) continue;
    const otherClaimId = tA.claimId === claimId ? tB.claimId : tA.claimId;
    if (otherClaimId === null || otherClaimId === claimId) continue;

    const outcome = resolveEffectiveB5Outcome(tA, tB, index.checks.get(pair.pairKey), authority);
    if (outcome.showBadge) {
      partners.add(otherClaimId);
    }
  }
  return dedupeAndSort(partners);
}

export function createB5PartnerResolver(index: B5Index, authority: Authority): B5PartnerResolverResult {
  return (claimId: string): readonly string[] => computeB5InconsistentWith(index, claimId, authority);
}

// ───────────────────────── Prose, Table & Lab-Note Extraction (`03` §4.1–§4.2) ─────────────────────────

function normalizePromptTextForB5(text: string, format?: SourceFormat): string {
  let out = text;
  if (out.includes("$") || (format === "latex" && (out.includes("\\(") || out.includes("\\[")))) {
    const masked = preMask(out, format ?? "md");
    if (masked.mathRegions.length > 0) {
      const sorted = [...masked.mathRegions].sort((a, b) => a.start - b.start);
      let rebuilt = "";
      let cursor = 0;
      for (const mr of sorted) {
        if (mr.start < cursor) continue;
        rebuilt += out.slice(cursor, mr.start);
        rebuilt += mr.text;
        cursor = mr.end;
      }
      rebuilt += out.slice(cursor);
      out = rebuilt;
    }
  }
  if (out.includes("\\")) {
    out = applyLatexSubstitutions(out).text;
  }
  return out;
}

function extractWindowTextFromWordSpans(
  text: string,
  wordSpans: readonly WordSpan[],
  span: TextRange,
  radiusWords: number,
): string {
  if (wordSpans.length === 0) return text.slice(span.start, span.end).trim() || text.trim();

  let lo = 0;
  let hi = wordSpans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (wordSpans[mid]!.end <= span.start) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  let firstOverlap: number;
  let lastOverlap: number;
  if (lo < wordSpans.length && wordSpans[lo]!.start < span.end) {
    firstOverlap = lo;
    lastOverlap = lo;
    while (lastOverlap + 1 < wordSpans.length && wordSpans[lastOverlap + 1]!.start < span.end) {
      lastOverlap += 1;
    }
  } else {
    firstOverlap = Math.max(0, lo - 1);
    lastOverlap = firstOverlap;
  }

  const startWord = Math.max(0, firstOverlap - radiusWords);
  const endWord = Math.min(wordSpans.length - 1, lastOverlap + radiusWords);
  const sliceStart = Math.min(wordSpans[startWord]!.start, span.start);
  const sliceEnd = Math.max(wordSpans[endWord]!.end, span.end);
  return text.slice(sliceStart, sliceEnd).trim();
}

export function extractWindowText(
  text: string,
  span: TextRange,
  radiusWords: number = B5_WINDOW_RADIUS_WORDS,
): string {
  return extractWindowTextFromWordSpans(text, extractWordSpans(text), span, radiusWords);
}

export interface ExtractProseB5Input {
  readonly docId: string;
  readonly claimId: string | null;
  readonly text: string;
  readonly section: string;
  readonly sentenceHash?: string;
  readonly occurrence?: number;
  readonly source?: TupleSource;
  readonly lang?: string;
  readonly format?: SourceFormat;
  readonly citationSpans?: readonly TextRange[];
}

export function extractProseB5Tuples(input: ExtractProseB5Input): B5Tuple[] {
  const promptText = normalizePromptTextForB5(input.text, input.format);
  const useRawCitationSpans = promptText === input.text;

  const sentenceHash =
    input.sentenceHash ??
    sha256hex(
      prepareInput(promptText, {
        ...(input.lang !== undefined ? { lang: input.lang } : {}),
        ...(input.format !== undefined ? { format: input.format } : {}),
      }).normLowerText,
    );
  const occurrence = input.occurrence ?? 0;

  const citationSpans =
    useRawCitationSpans && input.citationSpans !== undefined
      ? input.citationSpans
      : promptText.includes("[") || promptText.includes("(") || promptText.includes("\\")
        ? scanCitations(promptText).map((m) => ({ start: m.start, end: m.end }))
        : [];

  const tuples = extractQuantities(promptText, {
    docId: input.docId,
    sentenceHash,
    occurrenceIndex: occurrence,
    section: input.section,
    source: input.source ?? "manuscript",
    citationSpans,
    applyLatex: false,
    ...(input.lang !== undefined ? { lang: input.lang } : {}),
    ...(input.format !== undefined ? { format: input.format } : {}),
  });

  if (tuples.length === 0) return [];
  const wordSpans = extractWordSpans(promptText);
  return tuples.map((t) => ({
    ...t,
    docId: input.docId,
    claimId: input.claimId,
    sentenceHash,
    occurrence,
    windowText: extractWindowTextFromWordSpans(promptText, wordSpans, t.span, B5_WINDOW_RADIUS_WORDS),
  }));
}

export interface ExtractTableB5Input {
  readonly docId: string;
  readonly table: ExtractedTable;
  readonly tableIndex?: number;
  readonly lang?: string;
  readonly source?: TupleSource;
}

const NUMBER_WORD_TRIGGERS: ReadonlySet<string> = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "billion",
]);

function cellMayContainQuantity(cellText: string): boolean {
  const n = cellText.length;
  for (let i = 0; i < n; i += 1) {
    const cu = cellText.charCodeAt(i);
    if ((cu >= 48 && cu <= 57) || cu === 92 /* '\\' */ || cu >= 0x80) {
      return true;
    }
  }
  // Pure ASCII with no digits or backslashes: check only lowercase ASCII word runs against number words.
  let word = "";
  for (let i = 0; i < n; i += 1) {
    const cu = cellText.charCodeAt(i);
    const isLowerAscii = cu >= 97 && cu <= 122;
    const isUpperAscii = cu >= 65 && cu <= 90;
    if (isLowerAscii || isUpperAscii) {
      word += isUpperAscii ? String.fromCharCode(cu + 32) : cellText.charAt(i);
    } else if (word.length > 0) {
      if (NUMBER_WORD_TRIGGERS.has(word)) return true;
      word = "";
    }
  }
  return word.length > 0 && NUMBER_WORD_TRIGGERS.has(word);
}

function countSpacesAndHyphens(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    if (cu === 32 || cu === 45) count += 1;
  }
  return count;
}

export function extractTableB5Tuples(input: ExtractTableB5Input): B5Tuple[] {
  const { docId, table } = input;
  const tableIdx = input.tableIndex ?? 0;
  const section = table.section.label;
  const source = input.source ?? "manuscript";
  const tableFormat: SourceFormat = table.sourceKind === "latex_tabular" ? "latex" : "md";
  const headersNorm = table.headers.map((h) => normalizePromptTextForB5(h, tableFormat));
  const headersTrimmed = headersNorm.map((h) => h.trim());
  const headerLowers = headersNorm.map((h) => normLower(h));
  const out: B5Tuple[] = [];

  for (let r = 0; r < table.rows.length; r += 1) {
    const row = table.rows[r]!;
    const rawRowLabel = row[0] ?? "";
    const rowLabel = normalizePromptTextForB5(rawRowLabel, tableFormat);
    const rowLabelTrimmed = rowLabel.trim();
    const rowLabelLower = normLower(rowLabel);
    for (let c = 0; c < row.length; c += 1) {
      const rawCellText = row[c] ?? "";
      if (rawCellText.trim().length === 0 || !cellMayContainQuantity(rawCellText)) continue;
      const cellText = normalizePromptTextForB5(rawCellText, tableFormat);
      const cellTrimmed = cellText.trim();
      if (cellTrimmed.length === 0) continue;

      const tableHeader = headersNorm[c] ?? "";
      const tableHeaderTrimmed = headersTrimmed[c] ?? "";
      const tableHeaderLower = headerLowers[c] ?? "";
      const cellRowLabel = c > 0 ? rowLabel : "";
      const cellRowLabelTrimmed = c > 0 ? rowLabelTrimmed : "";
      const cellRowLabelLower = c > 0 ? rowLabelLower : "";
      const cellSentenceHash = sha256hex(
        `table:${String(tableIdx)}|r:${String(r)}|c:${String(c)}|${tableHeaderLower}|${cellRowLabelLower}|${normLower(cellText)}`,
      );
      const cellOccurrence = r * Math.max(1, table.headers.length, row.length) + c;

      const cellTuples = extractQuantities(cellText, {
        docId,
        sentenceHash: cellSentenceHash,
        occurrenceIndex: cellOccurrence,
        section,
        source,
        tableHeader,
        rowLabel: cellRowLabel,
        citationSpans: [],
        applyLatex: false,
        ...(input.lang !== undefined ? { lang: input.lang } : {}),
      });
      if (cellTuples.length === 0) continue;

      let fullCellWindow = cellTrimmed;
      if (tableHeaderTrimmed.length > 0) {
        fullCellWindow = `${tableHeaderTrimmed} \u2014 ${fullCellWindow}`;
      }
      if (cellRowLabelTrimmed.length > 0) {
        fullCellWindow = `${cellRowLabelTrimmed} \u2014 ${fullCellWindow}`;
      }
      const fastWindow =
        countSpacesAndHyphens(fullCellWindow) <= B5_WINDOW_RADIUS_WORDS
          ? fullCellWindow
          : null;
      const cellWordSpans = fastWindow === null ? extractWordSpans(fullCellWindow) : null;

      for (const t of cellTuples) {
        out.push({
          ...t,
          docId,
          claimId: null,
          sentenceHash: cellSentenceHash,
          occurrence: cellOccurrence,
          windowText:
            fastWindow !== null
              ? fastWindow
              : extractWindowTextFromWordSpans(
                  fullCellWindow,
                  cellWordSpans!,
                  { start: 0, end: fullCellWindow.length },
                  B5_WINDOW_RADIUS_WORDS,
                ),
        });
      }
    }
  }
  return out;
}

export function extractDocumentTablesB5Tuples(
  sourceText: string,
  format: SourceFormat,
  docId: string,
  lang?: string,
): B5Tuple[] {
  const masked = preMask(sourceText, format);
  const out: B5Tuple[] = [];
  for (let i = 0; i < masked.tables.length; i += 1) {
    const tbl = masked.tables[i]!;
    const extracted = extractTableB5Tuples({
      docId,
      table: tbl,
      tableIndex: i,
      ...(lang !== undefined ? { lang } : {}),
    });
    for (const t of extracted) {
      out.push(t);
    }
  }
  return out;
}

export interface ExtractLabNoteB5Input {
  readonly docId: string;
  readonly ocrText: string;
  readonly photoSha256: string;
  readonly occurrence?: number;
  readonly lang?: string;
}

export function extractLabNoteB5Tuples(input: ExtractLabNoteB5Input): B5Tuple[] {
  const section = `lab:${input.photoSha256.slice(0, 12)}`;
  return extractProseB5Tuples({
    docId: input.docId,
    claimId: null,
    text: input.ocrText,
    section,
    source: "lab_note",
    ...(input.occurrence !== undefined ? { occurrence: input.occurrence } : {}),
    ...(input.lang !== undefined ? { lang: input.lang } : {}),
  });
}
