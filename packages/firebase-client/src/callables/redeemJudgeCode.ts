/**
 * Typed `redeemJudgeCode` callable wrapper (`05` §3.0, §3.3, D-18).
 *
 * Configured with `CONSUMING` on the server, so the client MUST pass
 * `{ limitedUseAppCheckTokens: true }` and force-refresh the Firebase Auth ID
 * token (`getIdToken(true)`) on success. Never logs the judge code.
 */

import {
  httpsCallable,
  type Functions,
  type HttpsCallableOptions,
} from "firebase/functions";
import {
  validateRedeemJudgeCodeRequest,
  type RedeemJudgeCodeRequest,
  type RedeemJudgeCodeResponse,
} from "@toulmin/schemas";
import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import type { HttpsCallableFactory } from "./bibResolve.js";

export interface RedeemJudgeCodeCallDeps {
  readonly runtime?: FirebaseRuntime;
  readonly httpsCallable?: HttpsCallableFactory;
  readonly onRefreshIdToken?: () => Promise<unknown>;
}

export async function callRedeemJudgeCode(
  request: RedeemJudgeCodeRequest,
  deps?: RedeemJudgeCodeCallDeps
): Promise<RedeemJudgeCodeResponse> {
  const validation = validateRedeemJudgeCodeRequest(request);
  if (!validation.ok) {
    throw new Error(`Invalid redeemJudgeCode request: ${validation.errors.join("; ")}`);
  }

  const runtime = deps?.runtime ?? getDefaultRuntime();
  const makeCallable =
    deps?.httpsCallable ??
    (<Req, Res>(fn: Functions, name: string, opts?: HttpsCallableOptions) =>
      httpsCallable<Req, Res>(fn, name, opts));

  const fn = makeCallable<RedeemJudgeCodeRequest, RedeemJudgeCodeResponse>(
    runtime.functions,
    "redeemJudgeCode",
    { limitedUseAppCheckTokens: true }
  );
  const res = await fn(request);
  if (res.data.ok) {
    if (deps?.onRefreshIdToken) {
      await deps.onRefreshIdToken();
    } else {
      await runtime.refreshIdToken();
    }
  }
  return res.data;
}
