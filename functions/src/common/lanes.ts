import { HttpsError } from "firebase-functions/v2/https";
import type { GlobalStateCache } from "./counters.js";

export interface CallerAuthContext {
  readonly uid: string;
  readonly token: Record<string, unknown>;
}

export interface JudgeLaneValidator {
  isActiveJudge(auth: CallerAuthContext | undefined): Promise<boolean>;
}

/**
 * Checks `/global/state` (60 s cache) and refuses with `unavailable: HARD_STOP` while `hardStop = true` (`05` §3.0 rule 5).
 */
export async function assertNotHardStopped(stateCache: GlobalStateCache): Promise<void> {
  const state = await stateCache.get();
  if (state.hardStop) {
    throw new HttpsError("unavailable", "HARD_STOP");
  }
}

/**
 * Refuses active judge callers on public lanes with `failed-precondition: USE_JUDGE_LANE` (`05` §3.0 rule 6).
 */
export async function assertPublicLane(
  auth: CallerAuthContext | undefined,
  judgeValidator: JudgeLaneValidator
): Promise<void> {
  if (await judgeValidator.isActiveJudge(auth)) {
    throw new HttpsError("failed-precondition", "USE_JUDGE_LANE");
  }
}

/**
 * Refuses callers lacking an active judge claim on judge lanes (`05` §3.0 rule 6).
 */
export async function assertJudgeLane(
  auth: CallerAuthContext | undefined,
  judgeValidator: JudgeLaneValidator
): Promise<void> {
  if (!auth) {
    throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
  }
  const active = await judgeValidator.isActiveJudge(auth);
  if (!active) {
    throw new HttpsError("permission-denied", "JUDGE_ACCESS_REQUIRED");
  }
}
