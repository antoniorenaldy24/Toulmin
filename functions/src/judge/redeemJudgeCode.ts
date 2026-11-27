import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineInt, defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { RedeemJudgeCodeResponse } from "@toulmin/schemas";
import { rejectReplay, type AppCheckAwareRequest } from "../common/appcheck.js";
import { extractClientNetworkPrefix, type RawRequestWithIp } from "../common/clientIp.js";
import { SERVICE_ACCOUNTS, CONSUMING, yyyymmdd } from "../common/config.js";
import {
  CounterEngine,
  GlobalStateCache,
  wrapAdminFirestore,
  type FirestoreLike,
} from "../common/counters.js";
import { assertNotHardStopped, type CallerAuthContext } from "../common/lanes.js";
import { defaultLogger, type SafeLogger } from "../common/log.js";
import { assertValidRedeemJudgeCodeRequest } from "../common/validate.js";
import { computeNetHash } from "../quota/netHash.js";
import { canonical, hmacHex } from "./validity.js";

const JUDGE_CODE_PEPPER = defineSecret("JUDGE_CODE_PEPPER");
const NET_HASH_PEPPER = defineSecret("NET_HASH_PEPPER");
const JUDGE_TIER_EXPIRY_EPOCH = defineInt("JUDGE_TIER_EXPIRY_EPOCH");

export interface RedeemJudgeCodeRequestLike extends AppCheckAwareRequest {
  readonly auth?: CallerAuthContext | undefined;
  readonly data: unknown;
  readonly rawRequest?: RawRequestWithIp | undefined;
}

export interface RedeemJudgeCodeDeps {
  readonly db: FirestoreLike;
  readonly stateCache: GlobalStateCache;
  readonly counters: CounterEngine;
  readonly getJudgeCodePepper: () => string;
  readonly getNetHashPepper: () => string;
  readonly getJudgeTierExpiryEpoch: () => number;
  readonly setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
  readonly now?: () => number;
  readonly trustedProxyHopsFromRight?: number;
  readonly logger?: SafeLogger;
}

export function createRedeemJudgeCodeHandler(
  deps: RedeemJudgeCodeDeps
): (request: RedeemJudgeCodeRequestLike) => Promise<RedeemJudgeCodeResponse> {
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger ?? defaultLogger;

  return async (request: RedeemJudgeCodeRequestLike): Promise<RedeemJudgeCodeResponse> => {
    rejectReplay(request);
    const startMs = now();

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
    }

    await assertNotHardStopped(deps.stateCache);

    const uid = request.auth.uid;
    const req = assertValidRedeemJudgeCodeRequest(request.data);

    const prefix = extractClientNetworkPrefix(
      request.rawRequest,
      deps.trustedProxyHopsFromRight !== undefined
        ? { trustedProxyHopsFromRight: deps.trustedProxyHopsFromRight }
        : undefined
    );
    const currentNowMs = now();
    const dayReservation = await deps.counters.reserve({
      uid,
      pool: "anon",
      field: "redeem",
      n: 1,
      netHash:
        prefix !== null
          ? computeNetHash(yyyymmdd(currentNowMs), prefix, deps.getNetHashPepper())
          : null,
    });

    if (dayReservation.granted === 0) {
      logger.warn("redeemJudgeCode.rate_limited", {
        uid,
        reason: dayReservation.deniedReason ?? "QUOTA_EXCEEDED",
        latencyMs: Math.max(0, now() - startMs),
      });
      throw new HttpsError("resource-exhausted", dayReservation.deniedReason ?? "QUOTA_EXCEEDED");
    }

    const canonicalCode = canonical(req.code);
    if (!canonicalCode) {
      logger.warn("redeemJudgeCode.invalid", {
        uid,
        latencyMs: Math.max(0, now() - startMs),
      });
      throw new HttpsError("permission-denied", "INVALID_CODE");
    }

    const id = hmacHex(deps.getJudgeCodePepper(), canonicalCode);
    const codeIdPrefix = id.slice(0, 32);
    const codeRef = deps.db.doc(`judgeCodes/${id}`);
    const tierExp = deps.getJudgeTierExpiryEpoch();

    await deps.db.runTransaction(async (tx) => {
      const doc = await tx.get(codeRef);
      const nowSec = Math.floor(now() / 1000);
      const expVal = doc.get("exp");
      const disabled = doc.get("disabled") === true;
      const maxUidsRaw = doc.get("maxUids");
      const maxUids = typeof maxUidsRaw === "number" && Number.isFinite(maxUidsRaw) ? maxUidsRaw : 5;

      if (
        !doc.exists ||
        disabled ||
        typeof expVal !== "number" ||
        nowSec > expVal ||
        nowSec >= tierExp
      ) {
        throw new HttpsError("permission-denied", "INVALID_CODE");
      }

      const rawUids = doc.get("uids");
      const uids = Array.isArray(rawUids)
        ? rawUids.filter((u): u is string => typeof u === "string")
        : [];

      if (!uids.includes(uid)) {
        if (uids.length >= maxUids) {
          throw new HttpsError("permission-denied", "INVALID_CODE");
        }
        tx.update(codeRef, { uids: [...uids, uid] });
      }
    });

    await deps.setCustomUserClaims(uid, {
      tier: "judge",
      codeId: codeIdPrefix,
      tierExp,
    });

    logger.info("redeemJudgeCode.success", {
      uid,
      codeIdPrefix,
      tierExp,
      latencyMs: Math.max(0, now() - startMs),
    });

    return {
      ok: true,
      pool: "judge",
      tierExp,
    };
  };
}

let cachedDefaultHandler:
  | ((request: RedeemJudgeCodeRequestLike) => Promise<RedeemJudgeCodeResponse>)
  | null = null;

function getDefaultHandler(): (request: RedeemJudgeCodeRequestLike) => Promise<RedeemJudgeCodeResponse> {
  if (cachedDefaultHandler) return cachedDefaultHandler;
  const app = getApps().length > 0 ? getApp() : initializeApp();
  const db = wrapAdminFirestore(getFirestore(app));
  const auth = getAuth(app);
  const stateCache = new GlobalStateCache(db);
  const counters = new CounterEngine(db, stateCache);
  cachedDefaultHandler = createRedeemJudgeCodeHandler({
    db,
    stateCache,
    counters,
    getJudgeCodePepper: () => JUDGE_CODE_PEPPER.value(),
    getNetHashPepper: () => NET_HASH_PEPPER.value(),
    getJudgeTierExpiryEpoch: () => JUDGE_TIER_EXPIRY_EPOCH.value(),
    setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
  });
  return cachedDefaultHandler;
}

export const redeemJudgeCode = onCall(
  {
    ...CONSUMING,
    maxInstances: 3,
    concurrency: 10,
    memory: "256MiB",
    cpu: 1,
    timeoutSeconds: 30,
    serviceAccount: SERVICE_ACCOUNTS.judge,
    secrets: [JUDGE_CODE_PEPPER, NET_HASH_PEPPER],
  },
  async (request) => {
    rejectReplay(request);
    return getDefaultHandler()(request as unknown as RedeemJudgeCodeRequestLike);
  }
);
