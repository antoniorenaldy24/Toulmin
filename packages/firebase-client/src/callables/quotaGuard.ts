/**
 * Typed `quotaGuard` callable wrapper (`05` §3.0, §3.4, D-18).
 *
 * Configured with `CONSUMING` on the server, so the client MUST pass
 * `{ limitedUseAppCheckTokens: true }`.
 */

import {
  httpsCallable,
  type Functions,
  type HttpsCallableOptions,
} from "firebase/functions";
import {
  validateQuotaGuardRequest,
  type QuotaGuardRequest,
  type QuotaGuardResponse,
} from "@toulmin/schemas";
import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import type { HttpsCallableFactory } from "./bibResolve.js";

export interface QuotaGuardCallDeps {
  readonly runtime?: FirebaseRuntime;
  readonly httpsCallable?: HttpsCallableFactory;
}

export async function callQuotaGuard(
  request: QuotaGuardRequest,
  deps?: QuotaGuardCallDeps
): Promise<QuotaGuardResponse> {
  const validation = validateQuotaGuardRequest(request);
  if (!validation.ok) {
    throw new Error(`Invalid quotaGuard request: ${validation.errors.join("; ")}`);
  }

  const runtime = deps?.runtime ?? getDefaultRuntime();
  const makeCallable =
    deps?.httpsCallable ??
    (<Req, Res>(fn: Functions, name: string, opts?: HttpsCallableOptions) =>
      httpsCallable<Req, Res>(fn, name, opts));

  const fn = makeCallable<QuotaGuardRequest, QuotaGuardResponse>(
    runtime.functions,
    "quotaGuard",
    { limitedUseAppCheckTokens: true }
  );
  const res = await fn(request);
  return res.data;
}
