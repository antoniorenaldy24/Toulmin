/**
 * Tier B Evaluation Statistical Core (`eval-harness/src/stats.ts`)
 * (`docs/spec/04_AI_RUNTIME_PROMPTS_AND_L3.md` §6.6; `07` §1, §3.4, §3.6–§3.8, §4.2–§4.3).
 *
 * Implements Wilson 95% intervals, prevalence-adjusted precision & conservative bounds,
 * exact binomial tail & support-gate operating characteristic, exact one-sided McNemar,
 * PCG64 paired permutation & stratified bootstrap intervals, Cohen's kappa, and R1-E aggregation.
 */

import {
  DEFAULT_GATE_THRESHOLDS,
  WILSON_Z_95,
  evaluateGate,
  evaluateSupportGate,
  gateGridKey,
  wilson,
} from "@toulmin/core-l0/gate";
import type { ProbeLetter, RoutingCalibration } from "@toulmin/schemas";

export { WILSON_Z_95, gateGridKey, wilson };

// ───────────────────────── Normative Seeds (`07` §1) ─────────────────────────

export const SEED_KAPPA_SUBSAMPLE = 0x544c4d41;
export const SEED_KAPPA_RESUBSAMPLE = 0x544c4d42;
export const SEED_B2_SUBSAMPLE = 0x544c4d43;
export const SEED_BOOTSTRAP = 0x544c4d4e;
export const SEED_PERMUTATION = 0x544c4d50;
export const SEED_POWER = 0x544c4d51;
export const SEED_O2_BOOTSTRAP = 0x544c4d52;
export const SEED_GRID_BOOTSTRAP = 0x544c4d53;
export const SEED_FUZZ = 0x544c4d46;
export const SEED_PROPERTY = 0x544c4d47;

export const PREVALENCE_RATES = [0.08, 0.12, 0.18] as const;
export type PrevalenceRate = (typeof PREVALENCE_RATES)[number];

export const SUPPORT_OC_SAMPLE_SIZES = [16, 20, 24, 25, 30, 32, 40, 50] as const;
export const SUPPORT_OC_PRECISIONS = [0.85, 0.90, 0.95] as const;

// ───────────────────────── Deterministic PCG64 PRNG ─────────────────────────

const PCG_MULT = 6364136223846793005n;
const MASK_64 = (1n << 64n) - 1n;
const MASK_32 = 0xffffffffn;

export class Pcg64Rng {
  private state: bigint;
  private readonly inc: bigint;

  constructor(seed: number | bigint, streamSeq: number | bigint = 0xda3e39cb94b95bdbn) {
    this.inc = ((BigInt(streamSeq) << 1n) | 1n) & MASK_64;
    this.state = 0n;
    this.nextUint32();
    this.state = (this.state + (BigInt(seed) & MASK_64)) & MASK_64;
    this.nextUint32();
  }

  nextUint32(): number {
    const oldState = this.state;
    this.state = (oldState * PCG_MULT + this.inc) & MASK_64;
    const xorshifted = Number((((oldState >> 18n) ^ oldState) >> 27n) & MASK_32);
    const rot = Number((oldState >> 59n) & 31n);
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new Error(`Pcg64Rng.nextInt requires positive integer bound, got ${bound}`);
    }
    const uBound = BigInt(bound);
    const threshold = (1n << 32n) % uBound;
    while (true) {
      const r = BigInt(this.nextUint32());
      if (r >= threshold) {
        return Number(r % uBound);
      }
    }
  }

  nextBool(probTrue: number = 0.5): boolean {
    if (probTrue <= 0) return false;
    if (probTrue >= 1) return true;
    return this.nextFloat() < probTrue;
  }
}

// ───────────────────────── Helpers & Combinatorics ─────────────────────────

export type RunVerdict = ProbeLetter | "MISSING";

export function normalizeRunVerdict(v: RunVerdict): ProbeLetter {
  return v === "MISSING" ? "N" : v;
}

/**
 * Pair-level majority-of-3 (`04` §6.6.1, `07` §3.6). All three different -> `"N"`.
 */
export function majorityOf3(v1: RunVerdict, v2: RunVerdict, v3: RunVerdict): ProbeLetter {
  const n1 = normalizeRunVerdict(v1);
  const n2 = normalizeRunVerdict(v2);
  const n3 = normalizeRunVerdict(v3);
  if (n1 === n2 || n1 === n3) {
    return n1;
  }
  if (n2 === n3) {
    return n2;
  }
  return "N";
}

/**
 * Hyndman-Fan / NumPy linear percentile type-7 interpolation (`q` in `[0, 1]`).
 */
export function percentileType7(values: readonly number[], q: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (q <= 0) return sorted[0]!;
  if (q >= 1) return sorted[sorted.length - 1]!;
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const frac = h - lo;
  return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
}

const LOG_FACT_CACHE: number[] = [0];

function logFactorial(n: number): number {
  while (LOG_FACT_CACHE.length <= n) {
    const idx = LOG_FACT_CACHE.length;
    LOG_FACT_CACHE.push(LOG_FACT_CACHE[idx - 1]! + Math.log(idx));
  }
  return LOG_FACT_CACHE[n]!;
}

export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  const logCoef = logFactorial(n) - logFactorial(k) - logFactorial(n - k);
  return Math.exp(logCoef + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

export function exactBinomialTail(kMin: number, n: number, p: number): number {
  if (n <= 0) return 1;
  if (kMin <= 0) return 1;
  if (kMin > n) return 0;
  let sum = 0;
  for (let k = kMin; k <= n; k += 1) {
    sum += binomialPmf(k, n, p);
  }
  return Math.min(1, Math.max(0, sum));
}

// ───────────────────────── Prevalence-Adjusted Precision ─────────────────────────

export interface PrevalenceAdjustedValue {
  readonly point: number | null;
  readonly lb: number;
}

export interface PrevalenceSummary {
  readonly tpr: number;
  readonly tprLb: number;
  readonly fpr: number;
  readonly fprUb: number;
  readonly adjusted: Readonly<Record<"0.08" | "0.12" | "0.18", PrevalenceAdjustedValue>>;
}

export function prevalenceAdjustedFromRates(
  tpr: number,
  tprLb: number,
  fpr: number,
  fprUb: number,
  pi: number
): PrevalenceAdjustedValue {
  const denom = tpr * pi + fpr * (1 - pi);
  const point = denom === 0 ? null : (tpr * pi) / denom;
  const lbDenom = tprLb * pi + fprUb * (1 - pi);
  const lb = lbDenom === 0 ? 0 : (tprLb * pi) / lbDenom;
  return { point, lb };
}

/**
 * Computes prevalence-adjusted precision & conservative Wilson lower bound (`04` §6.6.3, `07` §3.6).
 */
export function computePrevalenceSummary(
  tpPairs: number,
  fpTotal: number,
  nPos: number = 50,
  nNeg: number = 100
): PrevalenceSummary {
  const tpr = nPos > 0 ? tpPairs / nPos : 0;
  const tprCi = wilson(tpPairs, nPos);
  const tprLb = tprCi !== null ? tprCi[0] : 0;

  const fpr = nNeg > 0 ? fpTotal / nNeg : 0;
  const fprCi = wilson(fpTotal, nNeg);
  const fprUb = fprCi !== null ? fprCi[1] : 1;

  const adj08 = prevalenceAdjustedFromRates(tpr, tprLb, fpr, fprUb, 0.08);
  const adj12 = prevalenceAdjustedFromRates(tpr, tprLb, fpr, fprUb, 0.12);
  const adj18 = prevalenceAdjustedFromRates(tpr, tprLb, fpr, fprUb, 0.18);

  return {
    tpr,
    tprLb,
    fpr,
    fprUb,
    adjusted: {
      "0.08": adj08,
      "0.12": adj12,
      "0.18": adj18,
    },
  };
}

/**
 * Point precision from a fixed `(TPR / FPR)` likelihood ratio and prevalence `π` (`07` §3.8).
 */
export function prevalencePrecisionFromLikelihoodRatio(lrPlus: number, pi: number): number {
  const num = lrPlus * pi;
  const den = num + (1 - pi);
  return den === 0 ? 0 : num / den;
}

// ───────────────────────── Support Gate Operating Characteristic ─────────────────────────

export interface SupportGateOcRow {
  readonly psPairs: number;
  readonly minTsPairs: number;
  readonly errorsAllowed: number;
  readonly wilsonLbAtMin: number;
  readonly passProbByPrecision: Readonly<Record<string, number>>;
}

export function minimumPassingSupportCount(
  n: number,
  lbThreshold: number = DEFAULT_GATE_THRESHOLDS.support_wilson_lb_min
): number | null {
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  const targetKey = gateGridKey(lbThreshold);
  for (let k = 1; k <= n; k += 1) {
    const ci = wilson(k, n);
    if (ci !== null && gateGridKey(ci[0]) >= targetKey) {
      return k;
    }
  }
  return null;
}

/**
 * Reproduces the 8-row exact binomial support-gate operating characteristic (`04` §6.6.4, `07` §3.7).
 */
export function supportGateOperatingCharacteristic(
  sampleSizes: readonly number[] = SUPPORT_OC_SAMPLE_SIZES,
  truePrecisions: readonly number[] = SUPPORT_OC_PRECISIONS
): SupportGateOcRow[] {
  const rows: SupportGateOcRow[] = [];
  for (const n of sampleSizes) {
    const kMin = minimumPassingSupportCount(n);
    if (kMin === null) {
      continue;
    }
    const ci = wilson(kMin, n)!;
    const passProbByPrecision: Record<string, number> = {};
    for (const p of truePrecisions) {
      passProbByPrecision[p.toFixed(2)] = exactBinomialTail(kMin, n, p);
    }
    rows.push({
      psPairs: n,
      minTsPairs: kMin,
      errorsAllowed: n - kMin,
      wilsonLbAtMin: ci[0],
      passProbByPrecision,
    });
  }
  return rows;
}

// ───────────────────────── Exact McNemar & Paired Permutation ─────────────────────────

/**
 * Exact one-sided McNemar test (`07` §4.2):
 * `b` = items where L1 correct and baseline wrong; `c` = baseline correct and L1 wrong.
 */
export function exactOneSidedMcNemar(b: number, c: number): number {
  if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) {
    throw new Error(`exactOneSidedMcNemar expects non-negative integers, got (${b}, ${c})`);
  }
  const n = b + c;
  if (n === 0) {
    return 1.0;
  }
  return exactBinomialTail(b, n, 0.5);
}

export interface PairedSystemItem<L, B> {
  readonly l1: L;
  readonly baseline: B;
}

export interface PairedPermutationResult {
  readonly deltaObs: number;
  readonly pOneSided: number;
  readonly iterations: number;
  readonly seed: number;
}

/**
 * Paired randomization / permutation test (`07` §4.2, B = 2,000, PCG64 `SEED_PERMUTATION`).
 */
export function pairedPermutationTest<L, B>(
  items: ReadonlyArray<PairedSystemItem<L, B>>,
  computeDelta: (permuted: ReadonlyArray<PairedSystemItem<L, B>>) => number,
  options?: { readonly iterations?: number; readonly seed?: number }
): PairedPermutationResult {
  const iterations = options?.iterations ?? 2000;
  const seed = options?.seed ?? SEED_PERMUTATION;
  const rng = new Pcg64Rng(seed);
  const deltaObs = computeDelta(items);

  let exceedCount = 0;
  const work: PairedSystemItem<L, B>[] = new Array(items.length);

  for (let r = 0; r < iterations; r += 1) {
    for (let j = 0; j < items.length; j += 1) {
      const orig = items[j]!;
      if (rng.nextBool(0.5)) {
        work[j] = { l1: orig.baseline as unknown as L, baseline: orig.l1 as unknown as B };
      } else {
        work[j] = orig;
      }
    }
    const deltaStar = computeDelta(work);
    if (deltaStar >= deltaObs) {
      exceedCount += 1;
    }
  }

  return {
    deltaObs,
    pOneSided: (1 + exceedCount) / (iterations + 1),
    iterations,
    seed,
  };
}

// ───────────────────────── R1-E Aggregation & Stratified Bootstrap ─────────────────────────

export interface R1EPairObservation {
  readonly pairId: string;
  readonly gold: ProbeLetter;
  readonly runs: readonly [RunVerdict, RunVerdict, RunVerdict];
}

export interface R1EMetricsSummary {
  readonly nPairs: number;
  readonly totalCalls: number;
  readonly missingCalls: number;
  readonly pairsWithMissingRun: number;
  readonly missingRate: number;
  readonly resultValid: boolean;
  readonly ppPairs: number;
  readonly tpPairs: number;
  readonly fpS: number;
  readonly fpN: number;
  readonly pHat: number;
  readonly wilsonCi95: [number, number];
  readonly wilsonLb: number;
  readonly stability: number;
  readonly stabilityCi95: [number, number];
  readonly recall: number;
  readonly fcrS: number;
  readonly fcrN: number;
  readonly prevalence: PrevalenceSummary;
  readonly support: {
    readonly pHatS: number;
    readonly wilsonCi95S: [number, number];
    readonly wilsonLbS: number;
    readonly psPairs: number;
    readonly tsPairs: number;
    readonly fsrC: number;
    readonly fsrN: number;
  };
  readonly perCall: {
    readonly pHatCallC: number;
    readonly pHatCallCCi95: [number, number];
    readonly pHatCallS: number;
    readonly pHatCallSCi95: [number, number];
  };
  readonly confusionMatrix: Readonly<Record<ProbeLetter, Readonly<Record<ProbeLetter, number>>>>;
  readonly gateResult: ReturnType<typeof evaluateGate>;
  readonly supportGateResult: ReturnType<typeof evaluateSupportGate>;
}

/**
 * Stratified cluster bootstrap 95% interval for stability `S_p` (`07` §3.6, B = 2,000, `SEED_BOOTSTRAP`).
 */
export function stratifiedBootstrapStabilityCI(
  pairs: readonly R1EPairObservation[],
  options?: { readonly iterations?: number; readonly seed?: number }
): [number, number] {
  if (pairs.length === 0) {
    return [0, 0];
  }
  const iterations = options?.iterations ?? 2000;
  const seed = options?.seed ?? SEED_BOOTSTRAP;
  const rng = new Pcg64Rng(seed);

  const byStratum: Record<ProbeLetter, boolean[]> = {
    S: [],
    C: [],
    N: [],
  };
  for (const p of pairs) {
    const stable =
      normalizeRunVerdict(p.runs[0]) === normalizeRunVerdict(p.runs[1]) &&
      normalizeRunVerdict(p.runs[1]) === normalizeRunVerdict(p.runs[2]);
    byStratum[p.gold].push(stable);
  }

  const strata = [byStratum.S, byStratum.C, byStratum.N].filter((s) => s.length > 0);
  const total = pairs.length;
  const samples: number[] = [];

  for (let b = 0; b < iterations; b += 1) {
    let stableSum = 0;
    for (const s of strata) {
      const m = s.length;
      for (let i = 0; i < m; i += 1) {
        if (s[rng.nextInt(m)]) {
          stableSum += 1;
        }
      }
    }
    samples.push(stableSum / total);
  }

  return [percentileType7(samples, 0.025), percentileType7(samples, 0.975)];
}

/**
 * Cluster bootstrap 95% interval over pairs for per-call precision (`07` §3.6, B = 2,000, `SEED_BOOTSTRAP`).
 */
export function clusterBootstrapPerCallPrecisionCI(
  pairs: readonly R1EPairObservation[],
  targetLabel: "C" | "S",
  options?: { readonly iterations?: number; readonly seed?: number }
): [number, number] {
  if (pairs.length === 0) {
    return [0, 0];
  }
  const iterations = options?.iterations ?? 2000;
  const seed = options?.seed ?? SEED_BOOTSTRAP;
  const rng = new Pcg64Rng(seed);

  const pairCounts = pairs.map((pair) => {
    let pred = 0;
    let correct = 0;
    for (const r of pair.runs) {
      if (normalizeRunVerdict(r) === targetLabel) {
        pred += 1;
        if (pair.gold === targetLabel) {
          correct += 1;
        }
      }
    }
    return { pred, correct };
  });

  const n = pairCounts.length;
  const samples: number[] = [];
  for (let b = 0; b < iterations; b += 1) {
    let predSum = 0;
    let corrSum = 0;
    for (let i = 0; i < n; i += 1) {
      const c = pairCounts[rng.nextInt(n)]!;
      predSum += c.pred;
      corrSum += c.correct;
    }
    samples.push(predSum > 0 ? corrSum / predSum : 0);
  }

  return [percentileType7(samples, 0.025), percentileType7(samples, 0.975)];
}

/**
 * Computes full R1-E benchmark metrics (`04` §6.6, `07` §3.6–§3.7).
 */
export function computeR1EMetrics(
  pairs: readonly R1EPairObservation[],
  options?: { readonly bootstrapIterations?: number; readonly seed?: number }
): R1EMetricsSummary {
  const nPairs = pairs.length;
  const totalCalls = nPairs * 3;
  let missingCalls = 0;
  let pairsWithMissingRun = 0;

  let ppPairs = 0;
  let tpPairs = 0;
  let fpS = 0;
  let fpN = 0;
  let stableCount = 0;

  let psPairs = 0;
  let tsPairs = 0;
  let fsSCountOnC = 0;
  let fsSCountOnN = 0;

  let callPredC = 0;
  let callCorrectC = 0;
  let callPredS = 0;
  let callCorrectS = 0;

  let goldS = 0;
  let goldC = 0;
  let goldN = 0;

  const confusion: Record<ProbeLetter, Record<ProbeLetter, number>> = {
    S: { S: 0, C: 0, N: 0 },
    C: { S: 0, C: 0, N: 0 },
    N: { S: 0, C: 0, N: 0 },
  };

  for (const pair of pairs) {
    if (pair.gold === "S") goldS += 1;
    else if (pair.gold === "C") goldC += 1;
    else goldN += 1;

    let pairHasMissing = false;
    for (const r of pair.runs) {
      if (r === "MISSING") {
        missingCalls += 1;
        pairHasMissing = true;
      }
      const norm = normalizeRunVerdict(r);
      if (norm === "C") {
        callPredC += 1;
        if (pair.gold === "C") callCorrectC += 1;
      } else if (norm === "S") {
        callPredS += 1;
        if (pair.gold === "S") callCorrectS += 1;
      }
    }
    if (pairHasMissing) {
      pairsWithMissingRun += 1;
    }

    const r0 = normalizeRunVerdict(pair.runs[0]);
    const r1 = normalizeRunVerdict(pair.runs[1]);
    const r2 = normalizeRunVerdict(pair.runs[2]);
    if (r0 === r1 && r1 === r2) {
      stableCount += 1;
    }

    const maj = majorityOf3(r0, r1, r2);
    confusion[pair.gold][maj] += 1;

    if (maj === "C") {
      ppPairs += 1;
      if (pair.gold === "C") tpPairs += 1;
      else if (pair.gold === "S") fpS += 1;
      else fpN += 1;
    } else if (maj === "S") {
      psPairs += 1;
      if (pair.gold === "S") tsPairs += 1;
      else if (pair.gold === "C") fsSCountOnC += 1;
      else fsSCountOnN += 1;
    }
  }

  const missingRate = totalCalls > 0 ? missingCalls / totalCalls : 0;
  const resultValid = totalCalls > 0 && gateGridKey(missingRate) <= gateGridKey(0.02);

  const pHat = ppPairs > 0 ? tpPairs / ppPairs : 0;
  const wilsonCi95: [number, number] = wilson(tpPairs, ppPairs) ?? [0, 0];
  const wilsonLb = wilsonCi95[0];
  const stability = nPairs > 0 ? stableCount / nPairs : 0;
  const stabilityCi95 = stratifiedBootstrapStabilityCI(pairs, {
    ...(options?.bootstrapIterations !== undefined
      ? { iterations: options.bootstrapIterations }
      : {}),
    ...(options?.seed !== undefined ? { seed: options.seed } : {}),
  });

  const recall = goldC > 0 ? tpPairs / goldC : 0;
  const fcrS = goldS > 0 ? fpS / goldS : 0;
  const fcrN = goldN > 0 ? fpN / goldN : 0;

  const prevalence = computePrevalenceSummary(tpPairs, fpS + fpN, goldC, goldS + goldN);

  const pHatS = psPairs > 0 ? tsPairs / psPairs : 0;
  const wilsonCi95S: [number, number] = wilson(tsPairs, psPairs) ?? [0, 0];
  const wilsonLbS = wilsonCi95S[0];
  const fsrC = goldC > 0 ? fsSCountOnC / goldC : 0;
  const fsrN = goldN > 0 ? fsSCountOnN / goldN : 0;

  const gateResult = evaluateGate({
    p_hat: pHat,
    wilson_lb: wilsonLb,
    stability,
    pp_pairs: ppPairs,
    tp_pairs: tpPairs,
  });
  const supportGateResult = evaluateSupportGate({
    ps_pairs: psPairs,
    ts_pairs: tsPairs,
    wilson_lb_s: wilsonLbS,
  });

  return {
    nPairs,
    totalCalls,
    missingCalls,
    pairsWithMissingRun,
    missingRate,
    resultValid,
    ppPairs,
    tpPairs,
    fpS,
    fpN,
    pHat,
    wilsonCi95,
    wilsonLb,
    stability,
    stabilityCi95,
    recall,
    fcrS,
    fcrN,
    prevalence,
    support: {
      pHatS,
      wilsonCi95S,
      wilsonLbS,
      psPairs,
      tsPairs,
      fsrC,
      fsrN,
    },
    perCall: {
      pHatCallC: callPredC > 0 ? callCorrectC / callPredC : 0,
      pHatCallCCi95: clusterBootstrapPerCallPrecisionCI(pairs, "C", {
        ...(options?.bootstrapIterations !== undefined
          ? { iterations: options.bootstrapIterations }
          : {}),
        ...(options?.seed !== undefined ? { seed: options.seed } : {}),
      }),
      pHatCallS: callPredS > 0 ? callCorrectS / callPredS : 0,
      pHatCallSCi95: clusterBootstrapPerCallPrecisionCI(pairs, "S", {
        ...(options?.bootstrapIterations !== undefined
          ? { iterations: options.bootstrapIterations }
          : {}),
        ...(options?.seed !== undefined ? { seed: options.seed } : {}),
      }),
    },
    confusionMatrix: confusion,
    gateResult,
    supportGateResult,
  };
}

export function buildRoutingCalibration(
  summary: R1EMetricsSummary,
  meta: {
    readonly samplingMode: "browser_default" | "generation_config";
    readonly bm25_min_cov: number;
    readonly measured_on: string;
    readonly measured_at: string;
    readonly prompt_version: string;
    readonly reasoning_word_cap: number;
    readonly runs_per_pair?: number;
  }
): RoutingCalibration {
  return {
    p_hat: summary.pHat,
    wilson_ci95: summary.wilsonCi95,
    wilson_lb: summary.wilsonLb,
    stability: summary.stability,
    stability_ci95: summary.stabilityCi95,
    pp_pairs: summary.ppPairs,
    tp_pairs: summary.tpPairs,
    recall: summary.recall,
    fcr_s: summary.fcrS,
    fcr_n: summary.fcrN,
    prevalence_adjusted: {
      "0.08": summary.prevalence.adjusted["0.08"].point ?? 0,
      "0.12": summary.prevalence.adjusted["0.12"].point ?? 0,
      "0.18": summary.prevalence.adjusted["0.18"].point ?? 0,
    },
    prevalence_adjusted_lb: {
      "0.08": summary.prevalence.adjusted["0.08"].lb,
      "0.12": summary.prevalence.adjusted["0.12"].lb,
      "0.18": summary.prevalence.adjusted["0.18"].lb,
    },
    support: {
      p_hat_s: summary.support.pHatS,
      wilson_lb_s: summary.support.wilsonLbS,
      ps_pairs: summary.support.psPairs,
      ts_pairs: summary.support.tsPairs,
      fsr_c: summary.support.fsrC,
      fsr_n: summary.support.fsrN,
    },
    per_call: {
      p_hat_call_c: summary.perCall.pHatCallC,
      p_hat_call_s: summary.perCall.pHatCallS,
    },
    n_pairs: summary.nPairs,
    runs_per_pair: meta.runs_per_pair ?? 3,
    samplingMode: meta.samplingMode,
    bm25_min_cov: meta.bm25_min_cov,
    measured_on: meta.measured_on,
    measured_at: meta.measured_at,
    prompt_version: meta.prompt_version,
    reasoning_word_cap: meta.reasoning_word_cap,
  };
}

// ───────────────────────── Cohen's Kappa & Power Simulation ─────────────────────────

export interface CohensKappaResult {
  readonly kappa: number;
  readonly observedAgreement: number;
  readonly chanceAgreement: number;
  readonly ci95: [number, number];
  readonly n: number;
}

function pointKappa(labels1: readonly string[], labels2: readonly string[]): {
  kappa: number;
  po: number;
  pe: number;
} {
  const n = labels1.length;
  if (n === 0) {
    return { kappa: 0, po: 0, pe: 1 };
  }
  const categories = Array.from(new Set([...labels1, ...labels2]));
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let agree = 0;

  for (let i = 0; i < n; i += 1) {
    const a = labels1[i]!;
    const b = labels2[i]!;
    if (a === b) agree += 1;
    rowTotals.set(a, (rowTotals.get(a) ?? 0) + 1);
    colTotals.set(b, (colTotals.get(b) ?? 0) + 1);
  }

  const po = agree / n;
  let pe = 0;
  for (const cat of categories) {
    const r = rowTotals.get(cat) ?? 0;
    const c = colTotals.get(cat) ?? 0;
    pe += (r * c) / (n * n);
  }
  const kappa = pe >= 1 ? (po >= 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return { kappa, po, pe };
}

/**
 * Computes Cohen's kappa and its 2,000-bootstrap 95% percentile CI (`07` §3.4).
 */
export function cohensKappa(
  annotator1: readonly string[],
  annotator2: readonly string[],
  options?: { readonly bootstrapIterations?: number; readonly seed?: number }
): CohensKappaResult {
  if (annotator1.length !== annotator2.length) {
    throw new Error(
      `cohensKappa requires equal length arrays (${annotator1.length} vs ${annotator2.length})`
    );
  }
  const n = annotator1.length;
  const { kappa, po, pe } = pointKappa(annotator1, annotator2);
  if (n === 0) {
    return { kappa: 0, observedAgreement: 0, chanceAgreement: 1, ci95: [0, 0], n: 0 };
  }

  const iterations = options?.bootstrapIterations ?? 2000;
  const seed = options?.seed ?? SEED_BOOTSTRAP;
  const rng = new Pcg64Rng(seed);
  const samples: number[] = [];

  for (let b = 0; b < iterations; b += 1) {
    const r1: string[] = new Array(n);
    const r2: string[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const idx = rng.nextInt(n);
      r1[i] = annotator1[idx]!;
      r2[i] = annotator2[idx]!;
    }
    samples.push(pointKappa(r1, r2).kappa);
  }

  return {
    kappa,
    observedAgreement: po,
    chanceAgreement: pe,
    ci95: [percentileType7(samples, 0.025), percentileType7(samples, 0.975)],
    n,
  };
}

export const POWER_SENSITIVITY_MULTIPLIERS = [0.5, 1.0, 1.5] as const;

/**
 * Simulates one-sided exact McNemar power (`07` §4.3, 6,000 replications, `SEED_POWER`).
 */
export function simulateMcNemarPower(params: {
  readonly n: number;
  readonly discordance: number;
  readonly targetDelta: number;
  readonly alpha: number;
  readonly replications?: number;
  readonly seed?: number;
}): number {
  const { n, discordance, targetDelta, alpha } = params;
  const d = Math.max(0, Math.min(1, discordance));
  if (n <= 0 || d === 0) {
    return 0;
  }
  const reps = params.replications ?? 6000;
  const rng = new Pcg64Rng(params.seed ?? SEED_POWER);
  const q = Math.max(0, Math.min(1, 0.5 + targetDelta / (2 * d)));

  let rejections = 0;
  for (let r = 0; r < reps; r += 1) {
    let b = 0;
    let c = 0;
    for (let i = 0; i < n; i += 1) {
      if (rng.nextBool(d)) {
        if (rng.nextBool(q)) {
          b += 1;
        } else {
          c += 1;
        }
      }
    }
    if (exactOneSidedMcNemar(b, c) <= alpha) {
      rejections += 1;
    }
  }
  return rejections / reps;
}
