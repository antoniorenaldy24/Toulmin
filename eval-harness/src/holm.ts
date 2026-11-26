/**
 * Tier B CF-1 Holm-Bonferroni Multiplicity Control & Task Authority (`eval-harness/src/holm.ts`)
 * (`docs/spec/04_AI_RUNTIME_PROMPTS_AND_L3.md` §6.6.6; `07` §4.2, §4.7).
 */

import {
  CF1_DELTA_MIN,
  CF1_HOLM_ALPHA,
  TASK_TIE_ORDER,
  checkAuthority,
  computeHolmAdjusted,
  type HolmAdjustedEntry,
  type HolmInputEntry,
} from "@toulmin/core-l0/gate";
import type { Authority, RoutingCf1Entry, Task } from "@toulmin/schemas";

export {
  CF1_DELTA_MIN,
  CF1_HOLM_ALPHA,
  TASK_TIE_ORDER,
  checkAuthority,
  computeHolmAdjusted,
  type HolmAdjustedEntry,
  type HolmInputEntry,
};

export const PROFILE_CF1_TASKS: Readonly<Record<"web_chrome_nano" | "android_aicore_stable", readonly Task[]>> = {
  web_chrome_nano: ["B1", "B2", "B3", "B5"],
  android_aicore_stable: ["B1", "B2", "B3", "B5", "O2"],
};

export interface Cf1TaskInput {
  readonly task: Task;
  readonly delta: number;
  readonly p: number;
  readonly power: number;
  readonly inconsistent_precision_l1?: number;
  readonly inconsistent_precision_baseline?: number;
}

export interface Cf1ProfileEvaluation {
  readonly profileId: string;
  readonly m: number;
  readonly holmOrder: readonly HolmAdjustedEntry[];
  readonly cf1: Partial<Record<Task, RoutingCf1Entry>>;
  readonly authority: Record<Task, Authority>;
}

/**
 * Evaluates all CF-1 tasks for a device profile with Holm-Bonferroni correction (`07` §4.2).
 */
export function evaluateCf1ProfileHolm(
  profileId: string,
  tasks: readonly Cf1TaskInput[]
): Cf1ProfileEvaluation {
  if (profileId === "web_chrome_nano" || profileId === "android_aicore_stable") {
    const required = PROFILE_CF1_TASKS[profileId];
    const providedSet = new Set(tasks.map((t) => t.task));
    for (const req of required) {
      if (!providedSet.has(req)) {
        throw new Error(`Missing CF-1 task "${req}" for profile "${profileId}"`);
      }
    }
    if (tasks.length !== required.length) {
      throw new Error(
        `Profile "${profileId}" expects exactly ${required.length} CF-1 tasks, received ${tasks.length}`
      );
    }
  }

  const seen = new Set<Task>();
  for (const t of tasks) {
    if (seen.has(t.task)) {
      throw new Error(`Duplicate CF-1 task "${t.task}"`);
    }
    seen.add(t.task);
  }

  const holmOrder = computeHolmAdjusted(
    tasks.map((t) => ({ task: t.task, p: t.p }))
  );
  const pHolmByTask = new Map<Task, number>();
  for (const adj of holmOrder) {
    pHolmByTask.set(adj.task, adj.p_holm);
  }

  const cf1: Partial<Record<Task, RoutingCf1Entry>> = {};
  for (const t of tasks) {
    const p_holm = pHolmByTask.get(t.task) ?? 1;
    cf1[t.task] = {
      delta: t.delta,
      p: t.p,
      p_holm,
      power: t.power,
      ...(t.inconsistent_precision_l1 !== undefined
        ? { inconsistent_precision_l1: t.inconsistent_precision_l1 }
        : {}),
      ...(t.inconsistent_precision_baseline !== undefined
        ? { inconsistent_precision_baseline: t.inconsistent_precision_baseline }
        : {}),
    };
  }

  const authority: Record<Task, Authority> = {
    B1: checkAuthority(cf1, "B1"),
    B2: checkAuthority(cf1, "B2"),
    B3: checkAuthority(cf1, "B3"),
    B5: checkAuthority(cf1, "B5"),
    O2: checkAuthority(cf1, "O2"),
  };

  return {
    profileId,
    m: tasks.length,
    holmOrder,
    cf1,
    authority,
  };
}
