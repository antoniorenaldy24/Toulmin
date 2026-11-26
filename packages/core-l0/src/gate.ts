/**
 * Tier B Gate, Support Gate, Holm-Bonferroni Authority Checker, Wilson 95% CI,
 * and Client `routing_table -> PolicySnapshot` Validator
 * (`docs/spec/04_AI_RUNTIME_PROMPTS_AND_L3.md` §6.5–§6.6; `07` §3.7–§3.8, §4.2).
 *
 * Tier B pure module (D-30): zero Firebase, DOM, network, Node I/O, clock,
 * unseeded randomness, platform case/normalization APIs, or regular expressions.
 */

import {
  BUNDLED_ROUTING_TABLE,
  TASKS,
  validateRoutingTable,
  type Authority,
  type PolicySnapshot,
  type ProfilePolicy,
  type RoutingCalibration,
  type RoutingCf1Entry,
  type RoutingGateConfig,
  type RoutingProfileEntry,
  type RoutingTable,
  type Task,
} from "@toulmin/schemas";

export const WILSON_Z_95 = 1.959964;
export const GATE_GRID_SCALE = 1_000_000_000;
export const CF1_DELTA_MIN = 0.10;
export const CF1_HOLM_ALPHA = 0.10;

export const DEFAULT_GATE_THRESHOLDS: RoutingGateConfig = {
  precision_min: 0.70,
  wilson_lb_min: 0.50,
  stability_min: 0.60,
  pp_pairs_min: 15,
  support_wilson_lb_min: 0.80,
  ps_pairs_min: 16,
};

export const TASK_TIE_ORDER: readonly Task[] = ["B1", "B2", "B3", "B5", "O2"];

export const PATH_A_ALLOWED_PROFILES: ReadonlySet<string> = new Set([
  "web_chrome_nano",
  "android_aicore_stable",
]);

export const PROFILE_CF1_FAMILIES: Readonly<Record<string, readonly Task[]>> = {
  web_chrome_nano: ["B1", "B2", "B3", "B5"],
  android_aicore_stable: ["B1", "B2", "B3", "B5", "O2"],
};

export type GateFailureCode = "P_HAT" | "WILSON_LB" | "STABILITY" | "PP_PAIRS";
export type SupportGateFailureCode = "WILSON_LB_S" | "PS_PAIRS";

export interface GateEvaluationResult {
  readonly pathA: boolean;
  readonly failed: readonly GateFailureCode[];
}

export interface SupportGateEvaluationResult {
  readonly authoritative: boolean;
  readonly failed: readonly SupportGateFailureCode[];
}

export interface PathAGateInput {
  readonly p_hat: number;
  readonly wilson_lb: number;
  readonly stability: number;
  readonly pp_pairs: number;
  readonly tp_pairs?: number;
}

export interface SupportGateMetricsInput {
  readonly ps_pairs: number;
  readonly ts_pairs?: number;
  readonly wilson_lb_s?: number;
}

export type SupportGateInput =
  | SupportGateMetricsInput
  | { readonly support: SupportGateMetricsInput };

export interface HolmInputEntry {
  readonly task: Task;
  readonly p: number;
}

export interface HolmAdjustedEntry {
  readonly task: Task;
  readonly p: number;
  readonly p_holm: number;
  readonly rank: number;
}

export type PolicyValidationIssueCode =
  | "INVALID_ROUTING_TABLE"
  | "FREEZE_MISMATCH"
  | "ROUTING_GATE_MISMATCH"
  | "AUTHORITY_MISMATCH"
  | "UNCALIBRATED_VARIANT";

export interface PolicyValidationIssue {
  readonly code: PolicyValidationIssueCode;
  readonly profileId?: string;
  readonly task?: Task;
}

export interface ResolvePolicyOptions {
  readonly deviceProfile: string;
  readonly embeddedTierAHash: string | null;
  readonly expectedReasoningWordCap?: number;
  readonly expectedSchemaId?: string;
  readonly b4CountsAsReview?: boolean;
}

export interface ResolvedRoutingPolicy {
  readonly accepted: boolean;
  readonly effectiveTable: RoutingTable;
  readonly policy: PolicySnapshot;
  readonly issues: readonly PolicyValidationIssue[];
}

const CONSERVATIVE_LOCAL_PROFILE: ProfilePolicy = {
  path: "B",
  authority: {
    B1: "advisory",
    B2: "advisory",
    B3: "advisory",
    B5: "advisory",
    O2: "advisory",
  },
  supportVerdicts: "advisory",
  calibratedVariant: {
    schemaId: "",
    reasoningCap: 0,
  },
};

/**
 * Transitive integer comparison key (`floor(x * 1e9 + 0.5)`) so all platforms
 * decide threshold boundaries identically (`04` §6.6.1, `07` §3.7).
 */
export function gateGridKey(x: number): number {
  return Math.floor(x * GATE_GRID_SCALE + 0.5);
}

function gteGrid(lhs: number, rhs: number): boolean {
  if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) {
    return false;
  }
  return gateGridKey(lhs) >= gateGridKey(rhs);
}

function lteGrid(lhs: number, rhs: number): boolean {
  if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) {
    return false;
  }
  return gateGridKey(lhs) <= gateGridKey(rhs);
}

/**
 * Wilson score confidence interval `[lb, ub]` for `k` successes in `n` trials (`04` §6.6.5, `07` §3.8).
 * Returns `null` when `n <= 0` or inputs are out of range.
 */
export function wilson(
  k: number,
  n: number,
  z: number = WILSON_Z_95
): [number, number] | null {
  if (
    !Number.isFinite(k) ||
    !Number.isFinite(n) ||
    !Number.isFinite(z) ||
    n <= 0 ||
    k < 0 ||
    k > n ||
    z < 0
  ) {
    return null;
  }
  const pHat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (pHat + z2 / (2 * n)) / denom;
  const radical = Math.sqrt((pHat * (1 - pHat)) / n + z2 / (4 * n * n));
  const half = (z * radical) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/**
 * Evaluates the Path A contradiction gate (`04` §6.6, `07` §3.7).
 */
export function evaluateGate(
  calibration: PathAGateInput | RoutingCalibration,
  thresholds: RoutingGateConfig = DEFAULT_GATE_THRESHOLDS
): GateEvaluationResult {
  const failed: GateFailureCode[] = [];
  const validPpInt = Number.isInteger(calibration.pp_pairs) && calibration.pp_pairs >= 0;

  let pHatPass = validPpInt && calibration.pp_pairs > 0 && gteGrid(calibration.p_hat, thresholds.precision_min);
  let wilsonLbPass = validPpInt && calibration.pp_pairs > 0 && gteGrid(calibration.wilson_lb, thresholds.wilson_lb_min);

  if (calibration.tp_pairs !== undefined) {
    const validTp =
      validPpInt &&
      calibration.pp_pairs > 0 &&
      Number.isInteger(calibration.tp_pairs) &&
      calibration.tp_pairs >= 0 &&
      calibration.tp_pairs <= calibration.pp_pairs;
    if (!validTp) {
      pHatPass = false;
      wilsonLbPass = false;
    } else {
      const calcPHat = calibration.tp_pairs / calibration.pp_pairs;
      const calcCi = wilson(calibration.tp_pairs, calibration.pp_pairs);
      if (!gteGrid(calcPHat, thresholds.precision_min)) {
        pHatPass = false;
      }
      if (calcCi === null || !gteGrid(calcCi[0], thresholds.wilson_lb_min)) {
        wilsonLbPass = false;
      }
    }
  }

  if (!pHatPass) {
    failed.push("P_HAT");
  }
  if (!wilsonLbPass) {
    failed.push("WILSON_LB");
  }
  if (!gteGrid(calibration.stability, thresholds.stability_min)) {
    failed.push("STABILITY");
  }
  if (!validPpInt || calibration.pp_pairs < thresholds.pp_pairs_min) {
    failed.push("PP_PAIRS");
  }

  return {
    pathA: failed.length === 0,
    failed,
  };
}

/**
 * Evaluates the support-verdict authority gate (`04` §6.6, `07` §3.7).
 * Note floor is 16 because `wilson(15, 15)[0] = 0.7961 < 0.80`.
 */
export function evaluateSupportGate(
  input: SupportGateInput,
  thresholds: RoutingGateConfig = DEFAULT_GATE_THRESHOLDS
): SupportGateEvaluationResult {
  const support = "support" in input ? input.support : input;
  const failed: SupportGateFailureCode[] = [];
  const validPsInt = Number.isInteger(support.ps_pairs) && support.ps_pairs >= 0;

  let computedLb: number | null | undefined = undefined;
  if (support.ts_pairs !== undefined) {
    if (
      validPsInt &&
      support.ps_pairs > 0 &&
      Number.isInteger(support.ts_pairs) &&
      support.ts_pairs >= 0 &&
      support.ts_pairs <= support.ps_pairs
    ) {
      const ci = wilson(support.ts_pairs, support.ps_pairs);
      computedLb = ci !== null ? ci[0] : null;
    } else {
      computedLb = null;
    }
  }

  let effectiveLb: number | null = null;
  const hasProvidedLb = support.wilson_lb_s !== undefined && Number.isFinite(support.wilson_lb_s);
  if (computedLb === null) {
    effectiveLb = null;
  } else if (computedLb !== undefined && hasProvidedLb) {
    effectiveLb = Math.min(computedLb, support.wilson_lb_s!);
  } else if (computedLb !== undefined) {
    effectiveLb = computedLb;
  } else if (hasProvidedLb) {
    effectiveLb = support.wilson_lb_s!;
  }

  if (
    !validPsInt ||
    support.ps_pairs <= 0 ||
    effectiveLb === null ||
    !gteGrid(effectiveLb, thresholds.support_wilson_lb_min)
  ) {
    failed.push("WILSON_LB_S");
  }

  if (!validPsInt || support.ps_pairs < thresholds.ps_pairs_min) {
    failed.push("PS_PAIRS");
  }

  return {
    authoritative: failed.length === 0,
    failed,
  };
}

function taskOrderIndex(task: Task): number {
  const idx = TASK_TIE_ORDER.indexOf(task);
  return idx === -1 ? TASK_TIE_ORDER.length : idx;
}

/**
 * Computes Holm-Bonferroni step-down adjusted p-values (`04` §6.6.6, `07` §4.2).
 * Ties break deterministically by task order `B1, B2, B3, B5, O2`.
 */
export function computeHolmAdjusted(entries: readonly HolmInputEntry[]): HolmAdjustedEntry[] {
  if (entries.length === 0) {
    return [];
  }
  const sorted = [...entries].sort((a, b) => {
    const ka = gateGridKey(a.p);
    const kb = gateGridKey(b.p);
    if (ka !== kb) {
      return a.p - b.p;
    }
    return taskOrderIndex(a.task) - taskOrderIndex(b.task);
  });

  const m = sorted.length;
  const out: HolmAdjustedEntry[] = [];
  let runningMax = 0;

  for (let idx = 0; idx < m; idx += 1) {
    const item = sorted[idx]!;
    const pClamped = Number.isFinite(item.p) ? Math.max(0, Math.min(1, item.p)) : 1;
    const rawAdj = Math.min(1, (m - idx) * pClamped);
    runningMax = Math.max(runningMax, rawAdj);
    out.push({
      task: item.task,
      p: item.p,
      p_holm: Math.min(1, runningMax),
      rank: idx + 1,
    });
  }

  return out;
}

/**
 * Evaluates CF-1 task authority for `task` (`04` §6.5.3 & §6.6, `07` §4.2 & §4.7).
 */
export function checkAuthority(
  cf1: Partial<Record<Task, RoutingCf1Entry>> | null | undefined,
  task: Task
): Authority {
  if (cf1 === null || cf1 === undefined) {
    return "advisory";
  }
  const entry = cf1[task];
  if (entry === undefined) {
    return "advisory";
  }
  if (!gteGrid(entry.delta, CF1_DELTA_MIN)) {
    return "advisory";
  }

  // Recompute Holm across all tasks present in `cf1` with finite `p` to catch stale/under-adjusted `p_holm`.
  const presentForHolm: HolmInputEntry[] = [];
  for (const t of TASK_TIE_ORDER) {
    const e = cf1[t];
    if (e !== undefined && Number.isFinite(e.p)) {
      presentForHolm.push({ task: t, p: e.p });
    }
  }
  const holmMap = new Map<Task, number>();
  for (const adj of computeHolmAdjusted(presentForHolm)) {
    holmMap.set(adj.task, adj.p_holm);
  }
  const recomputed = holmMap.get(task);
  const effectivePHolm =
    recomputed !== undefined ? Math.max(entry.p_holm, recomputed) : entry.p_holm;

  if (!lteGrid(effectivePHolm, CF1_HOLM_ALPHA)) {
    return "advisory";
  }

  if (task === "B5") {
    const l1Prec = entry.inconsistent_precision_l1;
    const basePrec = entry.inconsistent_precision_baseline;
    if (
      l1Prec === undefined ||
      basePrec === undefined ||
      !Number.isFinite(l1Prec) ||
      !Number.isFinite(basePrec) ||
      gateGridKey(l1Prec) <= 0 ||
      !gteGrid(l1Prec, basePrec)
    ) {
      return "advisory";
    }
  }

  return "authoritative";
}

export function gateConfigMatchesDefault(gate: RoutingGateConfig): boolean {
  return (
    gateGridKey(gate.precision_min) === gateGridKey(DEFAULT_GATE_THRESHOLDS.precision_min) &&
    gateGridKey(gate.wilson_lb_min) === gateGridKey(DEFAULT_GATE_THRESHOLDS.wilson_lb_min) &&
    gateGridKey(gate.stability_min) === gateGridKey(DEFAULT_GATE_THRESHOLDS.stability_min) &&
    gate.pp_pairs_min === DEFAULT_GATE_THRESHOLDS.pp_pairs_min &&
    gateGridKey(gate.support_wilson_lb_min) ===
      gateGridKey(DEFAULT_GATE_THRESHOLDS.support_wilson_lb_min) &&
    gate.ps_pairs_min === DEFAULT_GATE_THRESHOLDS.ps_pairs_min
  );
}

export function expectedSchemaIdForCap(reasoningWordCap: number): string | null {
  if (reasoningWordCap === 40) return "VerdictV1";
  if (reasoningWordCap === 30) return "VerdictV1_cap30";
  return null;
}

export function isValidCalibratedVariant(
  variant: { readonly schemaId: string; readonly reasoningCap: number } | null | undefined
): boolean {
  if (variant === null || variant === undefined) {
    return false;
  }
  return (
    (variant.schemaId === "VerdictV1" && variant.reasoningCap === 40) ||
    (variant.schemaId === "VerdictV1_cap30" && variant.reasoningCap === 30)
  );
}

function isStrictlyConservativeBundledTable(table: RoutingTable): boolean {
  if (table.freeze !== null || !gateConfigMatchesDefault(table.gate)) {
    return false;
  }
  for (const profileId of Object.keys(table.profiles)) {
    const entry = table.profiles[profileId];
    if (entry === undefined) {
      continue;
    }
    if (
      entry.path !== "B" ||
      entry.contradicts.surface === "HINT_THEN_CLOUD" ||
      entry.supportVerdicts !== "advisory" ||
      entry.calibratedVariant !== null ||
      entry.calibration !== null
    ) {
      return false;
    }
    for (const task of TASKS) {
      if (entry.authority[task] !== "advisory") {
        return false;
      }
    }
  }
  return true;
}

function withMissingBundledProfiles(table: RoutingTable): RoutingTable {
  const mergedProfiles: Record<string, RoutingProfileEntry> = {};
  for (const baseId of Object.keys(BUNDLED_ROUTING_TABLE.profiles)) {
    const baseEntry = BUNDLED_ROUTING_TABLE.profiles[baseId];
    if (baseEntry !== undefined) {
      mergedProfiles[baseId] = baseEntry;
    }
  }
  for (const profileId of Object.keys(table.profiles)) {
    const entry = table.profiles[profileId];
    if (entry !== undefined) {
      mergedProfiles[profileId] = entry;
    }
  }
  return {
    ...table,
    profiles: mergedProfiles,
  };
}

function buildPolicyProfilesFromTable(
  table: RoutingTable,
  options: ResolvePolicyOptions,
  issues: PolicyValidationIssue[]
): Record<string, ProfilePolicy> {
  const out: Record<string, ProfilePolicy> = {};
  const expectedCap = options.expectedReasoningWordCap ?? 40;
  const expectedSchema = options.expectedSchemaId ?? expectedSchemaIdForCap(expectedCap);
  const kappaOk = table.kappa_ok === true;
  const gateThresholdsOk = gateConfigMatchesDefault(table.gate);

  for (const profileId of Object.keys(table.profiles)) {
    const entry: RoutingProfileEntry | undefined = table.profiles[profileId];
    if (entry === undefined) {
      continue;
    }

    const variantMatches =
      expectedSchema !== null &&
      entry.calibratedVariant !== null &&
      isValidCalibratedVariant(entry.calibratedVariant) &&
      entry.calibratedVariant.reasoningCap === expectedCap &&
      entry.calibratedVariant.schemaId === expectedSchema;

    if (!variantMatches) {
      if (
        entry.path === "A" ||
        entry.supportVerdicts === "authoritative" ||
        TASKS.some((t) => entry.authority[t] === "authoritative")
      ) {
        issues.push({ code: "UNCALIBRATED_VARIANT", profileId });
      }
      out[profileId] = CONSERVATIVE_LOCAL_PROFILE;
      continue;
    }

    let resolvedPath: "A" | "B" = entry.path;
    if (entry.path === "A") {
      const gateOk =
        gateThresholdsOk &&
        PATH_A_ALLOWED_PROFILES.has(profileId) &&
        kappaOk &&
        entry.calibration !== null &&
        evaluateGate(entry.calibration, DEFAULT_GATE_THRESHOLDS).pathA;
      if (!gateOk) {
        resolvedPath = "B";
        issues.push({ code: "ROUTING_GATE_MISMATCH", profileId });
      }
    }

    const resolvedAuthority: Record<Task, Authority> = {
      B1: "advisory",
      B2: "advisory",
      B3: "advisory",
      B5: "advisory",
      O2: "advisory",
    };

    const allowedCf1Tasks = PROFILE_CF1_FAMILIES[profileId];
    const hasCompleteCf1Family =
      allowedCf1Tasks !== undefined &&
      entry.cf1 !== null &&
      allowedCf1Tasks.every((reqTask) => {
        const cf1Item = entry.cf1?.[reqTask];
        return cf1Item !== undefined && Number.isFinite(cf1Item.p);
      });

    for (const task of TASKS) {
      const claimed = entry.authority[task];
      if (claimed === "authoritative") {
        const taskAllowed =
          allowedCf1Tasks !== undefined &&
          allowedCf1Tasks.includes(task) &&
          hasCompleteCf1Family;
        const checked = taskAllowed ? checkAuthority(entry.cf1, task) : "advisory";
        if (checked === "authoritative") {
          resolvedAuthority[task] = "authoritative";
        } else {
          issues.push({ code: "AUTHORITY_MISMATCH", profileId, task });
        }
      }
    }

    let resolvedSupport: Authority = "advisory";
    if (entry.supportVerdicts === "authoritative") {
      const supportOk =
        gateThresholdsOk &&
        kappaOk &&
        entry.calibration !== null &&
        evaluateSupportGate(entry.calibration.support, DEFAULT_GATE_THRESHOLDS).authoritative;
      if (supportOk) {
        resolvedSupport = "authoritative";
      } else {
        issues.push({ code: "AUTHORITY_MISMATCH", profileId });
      }
    }

    out[profileId] = {
      path: resolvedPath,
      authority: resolvedAuthority,
      supportVerdicts: resolvedSupport,
      calibratedVariant: {
        schemaId: entry.calibratedVariant!.schemaId,
        reasoningCap: entry.calibratedVariant!.reasoningCap,
      },
    };
  }

  return out;
}

/**
 * Client-side routing_table validation & PolicySnapshot projection (`04` §6.5.3).
 * Refuses invalid schemas or freeze mismatches (reverting to `BUNDLED_ROUTING_TABLE`),
 * enforces normative thresholds (`DEFAULT_GATE_THRESHOLDS`) regardless of `table.gate`,
 * fills missing bundled default profiles, downgrades unverified Path A / task authority /
 * support verdicts to advisory/Path B, and leaves unknown profiles to `CONSERVATIVE_PROFILE`.
 */
export function resolvePolicyFromRoutingTable(
  rawTable: unknown,
  options: ResolvePolicyOptions
): ResolvedRoutingPolicy {
  const issues: PolicyValidationIssue[] = [];
  const validated = validateRoutingTable(rawTable);

  if (!validated.ok || validated.value === undefined) {
    issues.push({ code: "INVALID_ROUTING_TABLE" });
    const bundled = BUNDLED_ROUTING_TABLE;
    return {
      accepted: false,
      effectiveTable: bundled,
      policy: {
        deviceProfile: options.deviceProfile,
        profiles: buildPolicyProfilesFromTable(bundled, options, issues),
        b4CountsAsReview: options.b4CountsAsReview ?? true,
      },
      issues,
    };
  }

  const table = validated.value;
  const conservativeBundled =
    table.version === "bundled" && isStrictlyConservativeBundledTable(table);

  if (!conservativeBundled) {
    const freezeMatches =
      table.freeze !== null &&
      options.embeddedTierAHash !== null &&
      table.freeze.tier_a_hash === options.embeddedTierAHash;
    if (!freezeMatches) {
      issues.push({ code: "FREEZE_MISMATCH" });
      const bundled = BUNDLED_ROUTING_TABLE;
      return {
        accepted: false,
        effectiveTable: bundled,
        policy: {
          deviceProfile: options.deviceProfile,
          profiles: buildPolicyProfilesFromTable(bundled, options, issues),
          b4CountsAsReview: options.b4CountsAsReview ?? true,
        },
        issues,
      };
    }
  }

  const effectiveTable = withMissingBundledProfiles(table);
  const profiles = buildPolicyProfilesFromTable(effectiveTable, options, issues);
  return {
    accepted: true,
    effectiveTable,
    policy: {
      deviceProfile: options.deviceProfile,
      profiles,
      b4CountsAsReview: options.b4CountsAsReview ?? true,
    },
    issues,
  };
}
