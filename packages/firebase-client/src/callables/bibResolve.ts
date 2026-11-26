/**
 * Typed `bibResolve` / `bibResolveJudge` callable wrapper (`05` §3.0, §3.1).
 *
 * Uses standard App Check tokens (NOT `limitedUseAppCheckTokens`), validates
 * requests with `validateBibResolveRequest`, and routes by `runtime.isJudge()`.
 */

import {
  httpsCallable,
  type Functions,
  type HttpsCallable,
  type HttpsCallableOptions,
} from "firebase/functions";
import {
  isValidDoi,
  validateBibResolveRequest,
  type BibResolveRequest,
  type BibResolveResponse,
} from "@toulmin/schemas";
import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import { normalizeDoi, type DoiResolverHook, type ResolvedAlternativeDoi } from "../l2/adjudicate.js";

export type HttpsCallableFactory = <Req = unknown, Res = unknown>(
  functions: Functions,
  name: string,
  options?: HttpsCallableOptions
) => HttpsCallable<Req, Res>;

export interface BibResolveCallDeps {
  readonly runtime?: FirebaseRuntime;
  readonly httpsCallable?: HttpsCallableFactory;
  readonly isJudge?: boolean;
}

export async function callBibResolve(
  request: BibResolveRequest,
  deps?: BibResolveCallDeps
): Promise<BibResolveResponse> {
  const validation = validateBibResolveRequest(request);
  if (!validation.ok) {
    throw new Error(`Invalid bibResolve request: ${validation.errors.join("; ")}`);
  }

  const runtime = deps?.runtime ?? getDefaultRuntime();
  const judge = deps?.isJudge ?? (await runtime.isJudge());
  const callableName = judge ? "bibResolveJudge" : "bibResolve";
  const makeCallable =
    deps?.httpsCallable ??
    (<Req, Res>(fn: Functions, name: string, opts?: HttpsCallableOptions) =>
      httpsCallable<Req, Res>(fn, name, opts));

  // Standard App Check token only (`05` §3.0).
  const fn = makeCallable<BibResolveRequest, BibResolveResponse>(
    runtime.functions,
    callableName
  );
  const res = await fn(request);
  return res.data;
}

export function createBibResolveDoiResolver(
  deps?: BibResolveCallDeps
): DoiResolverHook {
  return async (dois: readonly string[]) => {
    const uniqueDois = Array.from(
      new Set(dois.map(normalizeDoi).filter((d) => isValidDoi(d)))
    );
    const out = new Map<string, ResolvedAlternativeDoi>();
    if (uniqueDois.length === 0) {
      return out;
    }

    const req: BibResolveRequest = {
      items: uniqueDois.map((doi, idx) => ({
        key: `alt_${idx}`,
        doi,
      })),
      doiOnly: true,
    };

    try {
      const resp = await callBibResolve(req, deps);
      for (const item of resp.results) {
        if (item.status === "RESOLVED" && item.doi) {
          const normalized = normalizeDoi(item.doi);
          if (isValidDoi(normalized)) {
            out.set(normalized, {
              doi: normalized,
              title: item.title,
            });
          }
        }
      }
    } catch {
      // Unresolved or failed lookups discard unverified DOIs (`04` §4.1 step 5).
    }
    return out;
  };
}
