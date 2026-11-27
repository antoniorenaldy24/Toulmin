import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getRemoteConfig, type RemoteConfigTemplate } from "firebase-admin/remote-config";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import type { BudgetMessage } from "@toulmin/schemas";
import { REGION, SERVICE_ACCOUNTS } from "../common/config.js";
import { wrapAdminFirestore, type FirestoreLike } from "../common/counters.js";
import { defaultLogger, type SafeLogger } from "../common/log.js";
import { assertValidBudgetMessage } from "../common/validate.js";
import type { PoolOverrides } from "../quota/pools.js";

export interface RemoteConfigAdapter {
  getTemplate(): Promise<RemoteConfigTemplate>;
  publishTemplate(template: RemoteConfigTemplate): Promise<RemoteConfigTemplate>;
}

export interface OperatorNotifier {
  pageOnCall(budgetDisplayName: string, ratioRounded: string): Promise<void>;
  pageBothOperators(budgetDisplayName: string, ratioRounded: string): Promise<void>;
}

export interface BudgetBreakerDeps {
  readonly db: FirestoreLike;
  readonly remoteConfig: RemoteConfigAdapter;
  readonly notifier?: OperatorNotifier;
  readonly now?: () => number;
  readonly logger?: SafeLogger;
  readonly onStateMutated?: () => void;
}

export interface BudgetBreakerOutcome {
  readonly budgetDisplayName: string;
  readonly ratioRounded: string;
  readonly actionTaken: string;
}

function isEtagConflict(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const code = (err as { code?: unknown }).code;
  const codeStr = typeof code === "string" ? code.toLowerCase() : "";
  return (
    msg.includes("etag") ||
    msg.includes("412") ||
    msg.includes("precondition") ||
    msg.includes("aborted") ||
    codeStr.includes("etag") ||
    codeStr.includes("aborted") ||
    codeStr.includes("failed-precondition")
  );
}

/**
 * Updates Remote Config parameters with optimistic ETag concurrency control (up to 3 attempts).
 */
export async function updateRemoteConfigWithRetry(
  adapter: RemoteConfigAdapter,
  updates: Readonly<Record<string, string>>,
  maxAttempts = 3
): Promise<boolean> {
  const entries = Object.entries(updates);
  if (entries.length === 0) return false;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const template = await adapter.getTemplate();
    let changed = false;
    for (const [key, value] of entries) {
      const existing = template.parameters[key]?.defaultValue as { value?: string } | undefined;
      if (existing?.value !== value) {
        template.parameters[key] = {
          ...(template.parameters[key] ?? {}),
          defaultValue: { value },
        };
        changed = true;
      }
    }
    if (!changed) {
      return false;
    }
    try {
      await adapter.publishTemplate(template);
      return true;
    } catch (err) {
      lastError = err;
      if (!isEtagConflict(err) || attempt === maxAttempts) {
        throw err;
      }
    }
  }
  throw lastError;
}

function minLimit(existing: number | null | undefined, target: number | null | undefined): number {
  if (typeof target !== "number") {
    return typeof existing === "number" ? existing : 0;
  }
  return typeof existing === "number" ? Math.min(existing, target) : target;
}

function mergeMonotonicPoolReduction(
  current: PoolOverrides | undefined,
  target: PoolOverrides
): PoolOverrides {
  const nextAnon = { ...(current?.anon ?? {}) };
  if (typeof target.anon?.l2?.global === "number") {
    nextAnon.l2 = {
      ...(nextAnon.l2 ?? {}),
      global: minLimit(nextAnon.l2?.global, target.anon.l2.global),
    };
  }
  if (typeof target.anon?.alt?.global === "number") {
    nextAnon.alt = {
      ...(nextAnon.alt ?? {}),
      global: minLimit(nextAnon.alt?.global, target.anon.alt.global),
    };
  }

  const nextSample = { ...(current?.sample ?? {}) };
  if (typeof target.sample?.sampleRuns?.global === "number") {
    nextSample.sampleRuns = {
      ...(nextSample.sampleRuns ?? {}),
      global: minLimit(nextSample.sampleRuns?.global, target.sample.sampleRuns.global),
    };
  }

  const nextJudge = { ...(current?.judge ?? {}) };
  if (typeof target.judge?.l2?.global === "number") {
    nextJudge.l2 = {
      ...(nextJudge.l2 ?? {}),
      global: minLimit(nextJudge.l2?.global, target.judge.l2.global),
    };
  }
  if (typeof target.judge?.alt?.global === "number") {
    nextJudge.alt = {
      ...(nextJudge.alt ?? {}),
      global: minLimit(nextJudge.alt?.global, target.judge.alt.global),
    };
  }

  return {
    ...(current ?? {}),
    ...(Object.keys(nextAnon).length > 0 ? { anon: nextAnon } : {}),
    ...(Object.keys(nextSample).length > 0 ? { sample: nextSample } : {}),
    ...(Object.keys(nextJudge).length > 0 ? { judge: nextJudge } : {}),
  };
}

function defaultNotifier(logger: SafeLogger): OperatorNotifier {
  return {
    pageOnCall: async (budgetDisplayName, ratioRounded) => {
      logger.warn("operator.page_on_call", { budgetDisplayName, ratio: ratioRounded });
    },
    pageBothOperators: async (budgetDisplayName, ratioRounded) => {
      logger.error("operator.page_both", { budgetDisplayName, ratio: ratioRounded });
    },
  };
}

export function createBudgetBreakerHandler(
  deps: BudgetBreakerDeps
): (payload: unknown) => Promise<BudgetBreakerOutcome> {
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger ?? defaultLogger;
  const notifier = deps.notifier ?? defaultNotifier(logger);

  return async (payload: unknown): Promise<BudgetBreakerOutcome> => {
    const msg: BudgetMessage = assertValidBudgetMessage(payload);
    const ratio = msg.costAmount / msg.budgetAmount;
    const ratioRounded = ratio.toFixed(2);
    const budget = msg.budgetDisplayName;
    const currentNow = now();

    let actionTaken = "none";
    const rcUpdates: Record<string, string> = {};
    let setKillSwitch = false;
    let setHardStop = false;
    let poolTarget: PoolOverrides | null = null;
    let notifyOnCall = false;
    let notifyBoth = false;

    if (budget === "gross") {
      if (ratio >= 1.0) {
        setKillSwitch = true;
        setHardStop = true;
        rcUpdates["kill_switch_cloud"] = "true";
        notifyOnCall = true;
        actionTaken = "gross_100_hard_stop";
      } else if (ratio >= 0.8) {
        setKillSwitch = true;
        rcUpdates["kill_switch_cloud"] = "true";
        notifyOnCall = true;
        actionTaken = "gross_80_kill_switch";
      } else if (ratio >= 0.5) {
        notifyOnCall = true;
        actionTaken = "gross_50_alert";
      }
    } else if (budget === "ai-logic") {
      if (ratio >= 0.9) {
        poolTarget = {
          anon: { l2: { global: 0 }, alt: { global: 0 } },
          sample: { sampleRuns: { global: 0 } },
          judge: { l2: { global: 300 }, alt: { global: 50 } },
        };
        rcUpdates["sample_pool_global"] = "0";
        rcUpdates["kill_switch_cloud"] = "true";
        setKillSwitch = true;
        notifyBoth = true;
        actionTaken = "ai_logic_90_halve_judge_kill_switch";
      } else if (ratio >= 0.75) {
        poolTarget = {
          anon: { l2: { global: 0 }, alt: { global: 0 } },
          sample: { sampleRuns: { global: 0 } },
        };
        rcUpdates["sample_pool_global"] = "0";
        notifyBoth = true;
        actionTaken = "ai_logic_75_zero_sample_preserve_judge";
      } else if (ratio >= 0.5) {
        poolTarget = {
          anon: { l2: { global: 0 }, alt: { global: 0 } },
          sample: { sampleRuns: { global: 10 } },
        };
        rcUpdates["sample_pool_global"] = "10";
        notifyOnCall = true;
        actionTaken = "ai_logic_50_zero_public_halve_sample";
      } else if (ratio >= 0.25) {
        poolTarget = {
          anon: { l2: { global: 20 }, alt: { global: 10 } },
        };
        rcUpdates["sample_pool_global"] = "20";
        notifyOnCall = true;
        actionTaken = "ai_logic_25_halve_public";
      }
    } else if (budget === "uncapped") {
      if (ratio >= 1.0) {
        setHardStop = true;
        notifyOnCall = true;
        actionTaken = "uncapped_100_hard_stop";
      } else if (ratio >= 0.5) {
        notifyOnCall = true;
        actionTaken = ratio >= 0.8 ? "uncapped_80_alert" : "uncapped_50_alert";
      }
    }

    if (setKillSwitch || setHardStop || poolTarget !== null) {
      const stateRef = deps.db.doc("global/state");
      await deps.db.runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        const existing = snap.exists ? (snap.data() ?? {}) : {};
        const next: Record<string, unknown> = {};

        if (setKillSwitch) {
          next["killSwitch"] = true;
          if (existing["killSwitch"] !== true || typeof existing["killSwitchAt"] !== "number") {
            next["killSwitchAt"] = currentNow;
          }
        }
        if (setHardStop) {
          next["hardStop"] = true;
        }
        if (poolTarget !== null) {
          const existingPools =
            typeof existing["pools"] === "object" && existing["pools"] !== null
              ? (existing["pools"] as PoolOverrides)
              : undefined;
          const merged = mergeMonotonicPoolReduction(existingPools, poolTarget);
          next["pools"] = merged;

          // Keep Remote Config sample_pool_global consistent with monotonic pool reduction
          const effectiveSample = merged.sample?.sampleRuns?.global;
          if (effectiveSample !== undefined && rcUpdates["sample_pool_global"] !== undefined) {
            rcUpdates["sample_pool_global"] = String(effectiveSample);
          }
        }

        tx.set(stateRef, next, { merge: true });
      });
      deps.onStateMutated?.();
    }

    if (Object.keys(rcUpdates).length > 0) {
      await updateRemoteConfigWithRetry(deps.remoteConfig, rcUpdates, 3);
    }

    if (notifyBoth) {
      await notifier.pageBothOperators(budget, ratioRounded);
    } else if (notifyOnCall) {
      await notifier.pageOnCall(budget, ratioRounded);
    }

    logger.info("budgetBreaker.processed", {
      budgetDisplayName: budget,
      ratio: ratioRounded,
      actionTaken,
    });

    return {
      budgetDisplayName: budget,
      ratioRounded,
      actionTaken,
    };
  };
}

let cachedDefaultHandler: ((payload: unknown) => Promise<BudgetBreakerOutcome>) | null = null;

function getDefaultHandler(): (payload: unknown) => Promise<BudgetBreakerOutcome> {
  if (cachedDefaultHandler) return cachedDefaultHandler;
  const app = getApps().length > 0 ? getApp() : initializeApp();
  const db = wrapAdminFirestore(getFirestore(app));
  const rc = getRemoteConfig(app);
  cachedDefaultHandler = createBudgetBreakerHandler({
    db,
    remoteConfig: {
      getTemplate: () => rc.getTemplate(),
      publishTemplate: (template) => rc.publishTemplate(template),
    },
  });
  return cachedDefaultHandler;
}

export const budgetBreaker = onMessagePublished(
  {
    topic: "billing-alerts",
    region: REGION,
    maxInstances: 1,
    concurrency: 1,
    memory: "512MiB",
    cpu: 1,
    timeoutSeconds: 300,
    serviceAccount: SERVICE_ACCOUNTS.ops,
  },
  async (event) => {
    const payload = event.data.message.json;
    await getDefaultHandler()(payload);
  }
);
