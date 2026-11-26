/**
 * CF-1 Preregistration Power Analysis & Sensitivity Runner
 * (`eval-harness/src/power.ts`)
 * (`docs/spec/07_EVAL_SPIKES_AND_ACCEPTANCE.md` §4.2–§4.3, `AC-EVAL-06`).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gateGridKey } from "@toulmin/core-l0/gate";
import type { Task } from "@toulmin/schemas";
import { CF1_HOLM_ALPHA, PROFILE_CF1_TASKS } from "./holm.js";
import {
  POWER_SENSITIVITY_MULTIPLIERS,
  Pcg64Rng,
  SEED_PERMUTATION,
  SEED_POWER,
  pairedPermutationTest,
  simulateMcNemarPower,
  type PairedSystemItem,
} from "./stats.js";

export const POWER_TARGET_DELTAS = [0.10, 0.15, 0.20] as const;

export const PLANNED_CF1_SAMPLE_SIZES: Readonly<
  Record<Task, { readonly planned: number; readonly max: number }>
> = {
  B1: { planned: 60, max: 80 },
  B2: { planned: 60, max: 80 },
  B3: { planned: 60, max: 80 },
  B5: { planned: 40, max: 50 },
  O2: { planned: 30, max: 45 },
};

export interface PilotOutcomePair {
  readonly l1Correct: boolean;
  readonly baselineCorrect: boolean;
}

export interface B1PilotF1Item {
  readonly goldCount: number;
  readonly l1Predicted: number;
  readonly l1Matched: number;
  readonly basePredicted: number;
  readonly baseMatched: number;
}

export interface PilotStats {
  readonly pilotN: number;
  readonly baselineAccuracy: number;
  readonly l1Accuracy: number;
  readonly b: number;
  readonly c: number;
  readonly discordance: number;
}

export interface TaskPowerInput {
  readonly task: Task;
  readonly plannedN?: number;
  readonly pilotPairs?: readonly PilotOutcomePair[];
  readonly b1PilotItems?: readonly B1PilotF1Item[];
  readonly baselineAccuracy?: number;
  readonly discordance?: number;
}

export interface PowerMatrixCell {
  readonly delta: number;
  readonly multiplier: number;
  readonly effectiveDiscordance: number;
  readonly unadjustedPower: number;
  readonly holmWorstCasePower: number;
}

export type TaskPowerMethod = "paired_permutation" | "exact_mcnemar";

export interface TaskPowerSummary {
  readonly profileId: string;
  readonly task: Task;
  readonly powerMethod: TaskPowerMethod;
  readonly plannedN: number;
  readonly maxN: number;
  readonly m: number;
  readonly pilotBaselineAccuracy: number;
  readonly pilotDiscordance: number;
  readonly primaryPower: number;
  readonly recommendIncreaseN: boolean;
  readonly sensitivityChangesConclusion: boolean;
  readonly cells: readonly PowerMatrixCell[];
}

export interface PowerAnalysisReport {
  readonly seed: number;
  readonly replications: number;
  readonly permIterations: number;
  readonly statedExpectation: string;
  readonly profiles: Readonly<Record<string, readonly TaskPowerSummary[]>>;
}

interface B1ItemArm {
  readonly predicted: number;
  readonly matched: number;
  readonly gold: number;
}

function computeCorpusF1FromB1PilotBaseline(items: readonly B1PilotF1Item[]): number {
  let matched = 0;
  let predicted = 0;
  let gold = 0;
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]!;
    matched += it.baseMatched;
    predicted += it.basePredicted;
    gold += it.goldCount;
  }
  const p = predicted > 0 ? matched / predicted : 0;
  const r = gold > 0 ? matched / gold : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

function computeB1PilotDiscordance(items: readonly B1PilotF1Item[]): number {
  if (items.length === 0) return 0;
  let discordant = 0;
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]!;
    if (it.l1Matched !== it.baseMatched || it.l1Predicted !== it.basePredicted) {
      discordant += 1;
    }
  }
  return discordant / items.length;
}

function computeB1PermutedDeltaZeroAlloc(
  permuted: ReadonlyArray<PairedSystemItem<B1ItemArm, B1ItemArm>>
): number {
  let l1M = 0;
  let l1P = 0;
  let bM = 0;
  let bP = 0;
  let gTot = 0;
  for (let i = 0; i < permuted.length; i += 1) {
    const row = permuted[i]!;
    l1M += row.l1.matched;
    l1P += row.l1.predicted;
    bM += row.baseline.matched;
    bP += row.baseline.predicted;
    gTot += row.l1.gold;
  }
  const l1Pr = l1P > 0 ? l1M / l1P : 0;
  const l1Re = gTot > 0 ? l1M / gTot : 0;
  const f1L1 = l1Pr + l1Re > 0 ? (2 * l1Pr * l1Re) / (l1Pr + l1Re) : 0;
  const bPr = bP > 0 ? bM / bP : 0;
  const bRe = gTot > 0 ? bM / gTot : 0;
  const f1Base = bPr + bRe > 0 ? (2 * bPr * bRe) / (bPr + bRe) : 0;
  return f1L1 - f1Base;
}

function synthesizeB1PilotFromCounts(
  baselineAccuracy: number,
  discordance: number,
  pilotN: number = 100
): B1PilotF1Item[] {
  const clampedBase = Math.min(1, Math.max(0, baselineAccuracy));
  const clampedDisc = Math.min(1, Math.max(0, discordance));
  const out: B1PilotF1Item[] = [];
  const baseCorrCount = Math.round(clampedBase * pilotN);
  const discordantCount = Math.round(clampedDisc * pilotN);
  for (let i = 0; i < pilotN; i += 1) {
    const baseMatched = i < baseCorrCount ? 1 : 0;
    const l1Matched = i < discordantCount ? (baseMatched === 0 ? 1 : 0) : baseMatched;
    out.push({
      goldCount: 1,
      l1Predicted: 1,
      l1Matched,
      basePredicted: 1,
      baseMatched,
    });
  }
  return out;
}

interface CalibratedB1FlipProbs {
  readonly pGain: number;
  readonly pLoss: number;
}

/**
 * Solves `(pGain, pLoss)` analytically/via monotonic bisection over the pilot item distribution
 * so that expected `F1(L1) - F1(baseline)` equals `targetDelta` (capped only when `F1_max < targetDelta + F1_base`)
 * while respecting `effectiveDiscordance` (`07` §4.3).
 */
export function solveB1FlipProbabilities(
  pilotItems: readonly B1PilotF1Item[],
  targetDelta: number,
  effectiveDiscordance?: number
): CalibratedB1FlipProbs {
  if (pilotItems.length === 0 || targetDelta <= 0) {
    return { pGain: 0, pLoss: 0 };
  }

  let baseM = 0;
  let baseP = 0;
  let goldTot = 0;
  let gainM = 0;
  let gainPDelta = 0;
  let improvableCount = 0;
  let lossM = 0;
  let lossPDelta = 0;
  let degradableCount = 0;

  for (let i = 0; i < pilotItems.length; i += 1) {
    const it = pilotItems[i]!;
    baseM += it.baseMatched;
    baseP += it.basePredicted;
    goldTot += it.goldCount;
    if (it.baseMatched < it.goldCount || it.basePredicted > it.goldCount) {
      improvableCount += 1;
      gainM += it.goldCount - it.baseMatched;
      gainPDelta += it.goldCount - it.basePredicted;
    } else if (it.baseMatched > 0) {
      degradableCount += 1;
      lossM += it.baseMatched;
      const degPred = Math.max(it.basePredicted, it.goldCount);
      lossPDelta += degPred - it.basePredicted;
    }
  }

  const baseF1 = baseP + goldTot > 0 ? (2 * baseM) / (baseP + goldTot) : 0;
  const evalExpectedDelta = (pg: number, pl: number): number => {
    const expM = baseM + pg * gainM - pl * lossM;
    const expP = baseP + pg * gainPDelta + pl * lossPDelta;
    const expF1 = expP + goldTot > 0 ? (2 * expM) / (expP + goldTot) : 0;
    return expF1 - baseF1;
  };

  const fImprov = improvableCount / pilotItems.length;
  const fDegrad = degradableCount / pilotItems.length;

  // Check if target discordance d_eff can jointly hit targetDelta and d_eff = pg*fImprov + pl*fDegrad
  if (effectiveDiscordance !== undefined && effectiveDiscordance > 0 && fImprov > 0 && fDegrad > 0) {
    const loGain = Math.max(0, (effectiveDiscordance - fDegrad) / fImprov);
    const hiGain = Math.min(1, effectiveDiscordance / fImprov);
    if (hiGain >= loGain) {
      const pLossFor = (pg: number): number =>
        Math.min(1, Math.max(0, (effectiveDiscordance - pg * fImprov) / fDegrad));
      const dLo = evalExpectedDelta(loGain, pLossFor(loGain));
      const dHi = evalExpectedDelta(hiGain, pLossFor(hiGain));
      if (dLo <= targetDelta && targetDelta <= dHi) {
        let lo = loGain;
        let hi = hiGain;
        for (let iter = 0; iter < 48; iter += 1) {
          const mid = 0.5 * (lo + hi);
          if (evalExpectedDelta(mid, pLossFor(mid)) < targetDelta) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        const optGain = 0.5 * (lo + hi);
        return { pGain: optGain, pLoss: pLossFor(optGain) };
      }
    }
  }

  // Fallback when d_eff is too small for targetDelta OR too large at high baseline:
  // First check max delta achievable with pLoss = 0, pGain = 1.0
  const maxDeltaNoLoss = evalExpectedDelta(1, 0);
  if (maxDeltaNoLoss <= targetDelta) {
    // Even flipping all non-perfect items gives <= targetDelta -> maximize gain with zero noise loss
    return { pGain: fImprov > 0 ? 1 : 0, pLoss: 0 };
  }

  if (effectiveDiscordance !== undefined && fImprov > 0 && fDegrad > 0 && effectiveDiscordance >= fImprov) {
    // High-discordance regime (d_eff >= fImprov): hold pGain = 1 and bisect pLoss in [0, 1]
    // so E[Delta] = targetDelta while simulated discordance stays as high toward d_eff as feasible.
    const minDeltaMaxLoss = evalExpectedDelta(1, 1);
    if (minDeltaMaxLoss >= targetDelta) {
      return { pGain: 1, pLoss: 1 };
    }
    let loLoss = 0;
    let hiLoss = 1;
    for (let iter = 0; iter < 48; iter += 1) {
      const mid = 0.5 * (loLoss + hiLoss);
      if (evalExpectedDelta(1, mid) > targetDelta) {
        loLoss = mid;
      } else {
        hiLoss = mid;
      }
    }
    return { pGain: 1, pLoss: 0.5 * (loLoss + hiLoss) };
  }

  // With pLoss = 0, bisect pGain in [0, 1] to achieve exact targetDelta
  let lo = 0;
  let hi = 1;
  for (let iter = 0; iter < 48; iter += 1) {
    const mid = 0.5 * (lo + hi);
    if (evalExpectedDelta(mid, 0) < targetDelta) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { pGain: 0.5 * (lo + hi), pLoss: 0 };
}

/**
 * Simulates B1 (IoU-F1) power by bootstrapping pilot items with repetition and flipping
 * improvable/degradable items with calibrated probabilities `(pGain, pLoss)` so `E[Δ] = targetDelta`,
 * then applying `pairedPermutationTest` with `B = 2,000` (`07` §4.2–§4.3, `AC-EVAL-06`).
 */
export function simulateB1PermutationPower(params: {
  readonly pilotItems: readonly B1PilotF1Item[];
  readonly n: number;
  readonly targetDelta: number;
  readonly effectiveDiscordance?: number;
  readonly alpha: number;
  readonly replications?: number;
  readonly permIterations?: number;
  readonly seed?: number;
}): number {
  const { pilotItems, n, targetDelta, alpha } = params;
  if (n <= 0 || pilotItems.length === 0) return 0;

  const reps = params.replications ?? 6000;
  const permIterations = params.permIterations ?? 2000;
  const rng = new Pcg64Rng(params.seed ?? SEED_POWER);
  const { pGain, pLoss } = solveB1FlipProbabilities(
    pilotItems,
    targetDelta,
    params.effectiveDiscordance
  );

  let rejections = 0;
  const pairedItems: PairedSystemItem<B1ItemArm, B1ItemArm>[] = new Array(n);

  for (let r = 0; r < reps; r += 1) {
    for (let i = 0; i < n; i += 1) {
      const src = pilotItems[rng.nextInt(pilotItems.length)]!;
      const isImprovable = src.baseMatched < src.goldCount || src.basePredicted > src.goldCount;
      let l1Matched = src.baseMatched;
      let l1Predicted = src.basePredicted;
      if (isImprovable) {
        if (rng.nextBool(pGain)) {
          l1Matched = src.goldCount;
          l1Predicted = src.goldCount;
        }
      } else if (src.baseMatched > 0 && rng.nextBool(pLoss)) {
        l1Matched = 0;
        l1Predicted = Math.max(src.basePredicted, src.goldCount);
      }
      pairedItems[i] = {
        l1: { predicted: l1Predicted, matched: l1Matched, gold: src.goldCount },
        baseline: { predicted: src.basePredicted, matched: src.baseMatched, gold: src.goldCount },
      };
    }

    const permRes = pairedPermutationTest<B1ItemArm, B1ItemArm>(
      pairedItems,
      computeB1PermutedDeltaZeroAlloc,
      { iterations: permIterations, seed: (SEED_PERMUTATION + r) >>> 0 }
    );
    if (permRes.pOneSided <= alpha) {
      rejections += 1;
    }
  }
  return rejections / reps;
}

export function computePilotStats(pairs: readonly PilotOutcomePair[]): PilotStats {
  const n = pairs.length;
  if (n === 0) {
    return { pilotN: 0, baselineAccuracy: 0, l1Accuracy: 0, b: 0, c: 0, discordance: 0 };
  }
  let baseCorr = 0;
  let l1Corr = 0;
  let b = 0;
  let c = 0;
  for (const p of pairs) {
    if (p.baselineCorrect) baseCorr += 1;
    if (p.l1Correct) l1Corr += 1;
    if (p.l1Correct && !p.baselineCorrect) b += 1;
    else if (!p.l1Correct && p.baselineCorrect) c += 1;
  }
  return {
    pilotN: n,
    baselineAccuracy: baseCorr / n,
    l1Accuracy: l1Corr / n,
    b,
    c,
    discordance: (b + c) / n,
  };
}

/**
 * Computes pre-registered power & discordance sensitivity tables across CF-1 tasks (`07` §4.3, `AC-EVAL-06`).
 * Uses bootstrap + `pairedPermutationTest` (B = 2,000) for `B1`, and exact one-sided McNemar simulation for `B2`, `B3`, `B5`, `O2`.
 */
export function analyzeCf1Power(input: {
  readonly profiles: Readonly<Record<string, readonly TaskPowerInput[]>>;
  readonly replications?: number;
  readonly permIterations?: number;
  readonly seed?: number;
}): PowerAnalysisReport {
  const reps = input.replications ?? 6000;
  const permIters = input.permIterations ?? 2000;
  const baseSeed = input.seed ?? SEED_POWER;
  const profilesOut: Record<string, TaskPowerSummary[]> = {};

  const profileIds = Object.keys(input.profiles).sort();
  let taskOffset = 0;

  for (const profileId of profileIds) {
    const taskInputs = input.profiles[profileId]!;
    const familyTasks =
      profileId === "web_chrome_nano" || profileId === "android_aicore_stable"
        ? PROFILE_CF1_TASKS[profileId]
        : taskInputs.map((t) => t.task);
    const m = familyTasks.length;
    const holmAlpha = CF1_HOLM_ALPHA / Math.max(1, m);
    const summaries: TaskPowerSummary[] = [];

    for (const tIn of taskInputs) {
      taskOffset += 1;
      const specBounds = PLANNED_CF1_SAMPLE_SIZES[tIn.task];
      const plannedN = tIn.plannedN ?? specBounds.planned;
      const pilotStats = tIn.pilotPairs !== undefined ? computePilotStats(tIn.pilotPairs) : null;
      const b1ItemsExplicit = tIn.b1PilotItems;

      const pilotBaseline =
        tIn.baselineAccuracy ??
        (b1ItemsExplicit !== undefined
          ? computeCorpusF1FromB1PilotBaseline(b1ItemsExplicit)
          : (pilotStats?.baselineAccuracy ?? 0));
      const pilotDiscordance =
        tIn.discordance ??
        (b1ItemsExplicit !== undefined
          ? computeB1PilotDiscordance(b1ItemsExplicit)
          : (pilotStats?.discordance ?? 0));

      const hasPilotSignal =
        tIn.baselineAccuracy !== undefined ||
        b1ItemsExplicit !== undefined ||
        pilotStats !== null;
      const effectivePilotBaseline = hasPilotSignal ? pilotBaseline : 0.6;
      const effectivePilotDiscordance = hasPilotSignal ? pilotDiscordance : 0.35;

      const powerMethod: TaskPowerMethod = tIn.task === "B1" ? "paired_permutation" : "exact_mcnemar";
      const b1Pilot =
        tIn.task === "B1"
          ? (b1ItemsExplicit ??
            synthesizeB1PilotFromCounts(effectivePilotBaseline, effectivePilotDiscordance))
          : null;

      const cells: PowerMatrixCell[] = [];
      let primaryPower = 0;
      const holmAtDelta015: number[] = [];

      for (const mult of POWER_SENSITIVITY_MULTIPLIERS) {
        const effectiveD = Math.min(1.0, Math.max(0.0, effectivePilotDiscordance * mult));
        for (const delta of POWER_TARGET_DELTAS) {
          const cellSeed =
            baseSeed + taskOffset * 1000 + Math.round(mult * 10) * 10 + Math.round(delta * 100);
          let unadj: number;
          let holm: number;

          if (b1Pilot !== null) {
            unadj = simulateB1PermutationPower({
              pilotItems: b1Pilot,
              n: plannedN,
              targetDelta: delta,
              effectiveDiscordance: effectiveD,
              alpha: CF1_HOLM_ALPHA,
              replications: reps,
              permIterations: permIters,
              seed: cellSeed,
            });
            holm = simulateB1PermutationPower({
              pilotItems: b1Pilot,
              n: plannedN,
              targetDelta: delta,
              effectiveDiscordance: effectiveD,
              alpha: holmAlpha,
              replications: reps,
              permIterations: permIters,
              seed: cellSeed + 1,
            });
          } else {
            unadj = simulateMcNemarPower({
              n: plannedN,
              discordance: effectiveD,
              targetDelta: delta,
              alpha: CF1_HOLM_ALPHA,
              replications: reps,
              seed: cellSeed,
            });
            holm = simulateMcNemarPower({
              n: plannedN,
              discordance: effectiveD,
              targetDelta: delta,
              alpha: holmAlpha,
              replications: reps,
              seed: cellSeed + 1,
            });
          }

          cells.push({
            delta,
            multiplier: mult,
            effectiveDiscordance: effectiveD,
            unadjustedPower: unadj,
            holmWorstCasePower: holm,
          });
          if (Math.abs(delta - 0.15) < 1e-9) {
            holmAtDelta015.push(holm);
            if (Math.abs(mult - 1.0) < 1e-9) {
              primaryPower = holm;
            }
          }
        }
      }

      const passFlags = holmAtDelta015.map((p) => gateGridKey(p) >= gateGridKey(0.60));
      const sensitivityChangesConclusion = passFlags.some((f) => f !== passFlags[0]);

      summaries.push({
        profileId,
        task: tIn.task,
        powerMethod,
        plannedN,
        maxN: specBounds.max,
        m,
        pilotBaselineAccuracy: pilotBaseline,
        pilotDiscordance,
        primaryPower,
        recommendIncreaseN: gateGridKey(primaryPower) < gateGridKey(0.60),
        sensitivityChangesConclusion,
        cells,
      });
    }

    profilesOut[profileId] = summaries;
  }

  return {
    seed: baseSeed,
    replications: reps,
    permIterations: permIters,
    statedExpectation:
      "With n = 40-50 (B5) and n = 30-45 (O2), a typical pilot discordance and Holm worst-case level of 0.10/m, B5 and O2 are expected to remain advisory.",
    profiles: profilesOut,
  };
}

export function formatPowerReportMarkdown(report: PowerAnalysisReport): string {
  const lines: string[] = [
    "# CF-1 Preregistration Power Analysis (`power.md`)",
    "",
    `- Seed: \`0x${report.seed.toString(16).toUpperCase()}\` (${report.replications} replications; B1 paired permutation B = ${report.permIterations})`,
    `- Stated expectation (\`07\` §4.2 / \`AC-EVAL-06\`): ${report.statedExpectation}`,
    "",
  ];

  for (const profileId of Object.keys(report.profiles).sort()) {
    const items = report.profiles[profileId]!;
    lines.push(`## Profile: \`${profileId}\``, "");
    for (const item of items) {
      lines.push(
        `### Task \`${item.task}\` (method = \`${item.powerMethod}\`, n = ${item.plannedN}, max = ${item.maxN}, m = ${item.m})`,
        "",
        `- Rough pilot estimates: baseline = ${item.pilotBaselineAccuracy.toFixed(3)}, discordance d = ${item.pilotDiscordance.toFixed(3)}`,
        `- Primary power (Delta = 0.15, alpha = 0.10/${item.m}, d x 1.0) = **${item.primaryPower.toFixed(3)}** (increase n before freeze recommended: \`${String(item.recommendIncreaseN)}\`)`,
        `- Sensitivity across d x {0.5, 1.0, 1.5} changes >= 0.60 conclusion: \`${String(item.sensitivityChangesConclusion)}\``,
        "",
        "| d multiplier | Effective d | Delta | Power (alpha = 0.10) | Power (alpha = 0.10/m) |",
        "|---:|---:|---:|---:|---:|"
      );
      for (const cell of item.cells) {
        lines.push(
          `| ${cell.multiplier.toFixed(1)}x | ${cell.effectiveDiscordance.toFixed(3)} | ${cell.delta.toFixed(2)} | ${cell.unadjustedPower.toFixed(3)} | ${cell.holmWorstCasePower.toFixed(3)} |`
        );
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

export function runPowerCli(argv: readonly string[]): number {
  let inputFile: string | undefined;
  let outFile: string | undefined;
  let jsonOutFile: string | undefined;
  let replications: number | undefined;
  let permIterations: number | undefined;
  let jsonFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--json") jsonFlag = true;
    else if (arg === "--input" && i + 1 < argv.length) inputFile = argv[++i]!;
    else if (arg === "--out" && i + 1 < argv.length) outFile = argv[++i]!;
    else if (arg === "--json-out" && i + 1 < argv.length) jsonOutFile = argv[++i]!;
    else if (arg === "--replications" && i + 1 < argv.length) {
      replications = Number(argv[++i]!);
    } else if (arg === "--perm-iterations" && i + 1 < argv.length) {
      permIterations = Number(argv[++i]!);
    } else {
      console.error(`Unknown or incomplete flag: ${arg}`);
      return 2;
    }
  }

  if (inputFile === undefined) {
    console.error("--input <pilot.json> is required");
    return 2;
  }

  try {
    const raw: unknown = JSON.parse(readFileSync(resolve(inputFile), "utf8"));
    const inputObj = raw as { profiles: Record<string, TaskPowerInput[]> };
    const report = analyzeCf1Power({
      profiles: inputObj.profiles,
      ...(replications !== undefined && Number.isInteger(replications) && replications > 0
        ? { replications }
        : {}),
      ...(permIterations !== undefined && Number.isInteger(permIterations) && permIterations > 0
        ? { permIterations }
        : {}),
    });
    const md = formatPowerReportMarkdown(report);
    if (outFile !== undefined) {
      const absOut = resolve(outFile);
      mkdirSync(dirname(absOut), { recursive: true });
      writeFileSync(absOut, md, "utf8");
    }
    if (jsonOutFile !== undefined) {
      const absJsonOut = resolve(jsonOutFile);
      mkdirSync(dirname(absJsonOut), { recursive: true });
      writeFileSync(absJsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    if (jsonFlag) console.log(JSON.stringify(report));
    else console.log(md);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jsonFlag) console.log(JSON.stringify({ ok: false, message: msg }));
    else console.error(msg);
    return 1;
  }
}

const entryArg = process.argv[1];
if (entryArg !== undefined && pathToFileURL(resolve(entryArg)).href === import.meta.url) {
  process.exit(runPowerCli(process.argv.slice(2)));
}
