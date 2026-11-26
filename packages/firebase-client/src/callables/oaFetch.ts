/**
 * Typed `oaFetch` / `oaFetchJudge` callable wrapper (`05` §3.0, §3.2).
 *
 * Uses standard App Check tokens (NOT `limitedUseAppCheckTokens`), strictly
 * validates `{ refId }` with `validateOaFetchRequest`, and routes by `runtime.isJudge()`.
 */

import {
  httpsCallable,
  type Functions,
  type HttpsCallableOptions,
} from "firebase/functions";
import {
  validateOaFetchRequest,
  type OaFetchRequest,
  type OaFetchResponse,
} from "@toulmin/schemas";
import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import type { HttpsCallableFactory } from "./bibResolve.js";

export interface OaFetchCallDeps {
  readonly runtime?: FirebaseRuntime;
  readonly httpsCallable?: HttpsCallableFactory;
  readonly isJudge?: boolean;
}

export async function callOaFetch(
  request: OaFetchRequest,
  deps?: OaFetchCallDeps
): Promise<OaFetchResponse> {
  const validation = validateOaFetchRequest(request);
  if (!validation.ok) {
    throw new Error(`Invalid oaFetch request: ${validation.errors.join("; ")}`);
  }

  const runtime = deps?.runtime ?? getDefaultRuntime();
  const judge = deps?.isJudge ?? (await runtime.isJudge());
  const callableName = judge ? "oaFetchJudge" : "oaFetch";
  const makeCallable =
    deps?.httpsCallable ??
    (<Req, Res>(fn: Functions, name: string, opts?: HttpsCallableOptions) =>
      httpsCallable<Req, Res>(fn, name, opts));

  // Standard App Check token only (`05` §3.0).
  const fn = makeCallable<OaFetchRequest, OaFetchResponse>(runtime.functions, callableName);
  const res = await fn(request);
  return res.data;
}
