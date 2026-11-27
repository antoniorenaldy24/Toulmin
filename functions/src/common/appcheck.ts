import { HttpsError } from "firebase-functions/v2/https";

/**
 * Minimal structural subset of Firebase `CallableRequest` needed for App Check replay checks.
 */
export interface AppCheckAwareRequest {
  readonly app?:
    | {
        readonly appId?: string;
        readonly alreadyConsumed?: boolean;
      }
    | undefined;
}

/**
 * MUST be the first statement of every handler configured with `CONSUMING` (`05` §3.0, AC-SEC-02).
 */
export function rejectReplay(request: AppCheckAwareRequest): void {
  if (request.app?.alreadyConsumed) throw new HttpsError("permission-denied", "REPLAYED_TOKEN");
  if (!request.app) throw new HttpsError("failed-precondition", "APP_CHECK_REQUIRED");
}
