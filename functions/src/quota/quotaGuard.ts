import { randomUUID } from "node:crypto";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { QuotaGuardLease, QuotaGuardResponse } from "@toulmin/schemas";
import { rejectReplay, type AppCheckAwareRequest } from "../common/appcheck.js";
import { extractClientNetworkPrefix, type RawRequestWithIp } from "../common/clientIp.js";
import { CONSUMING, SERVICE_ACCOUNTS, nextJakartaMidnightMs, yyyymmdd } from "../common/config.js";
import {
  CounterEngine,
  GlobalStateCache,
  wrapAdminFirestore,
  type FirestoreLike,
} from "../common/counters.js";
import type { CallerAuthContext, JudgeLaneValidator } from "../common/lanes.js";
import { defaultLogger, type SafeLogger } from "../common/log.js";
import { assertValidQuotaGuardRequest } from "../common/validate.js";
import { JudgeValidityCache } from "../judge/validity.js";
import { computeNetHash } from "./netHash.js";
import type { PoolField, PoolName } from "./pools.js";

const NET_HASH_PEPPER = defineSecret("NET_HASH_PEPPER");

/**
 * Default compiled sample claim-hash allow-list placeholder until Phase 2 populates
 * `/apps/web/public/sample/expected.json`. Tests inject deterministic 5-hash lists via deps.
 */
export const DEFAULT_SAMPLE_CLAIM_HASHES: readonly string[] = [];

const LEASE_TTL_MS = 300_000;
const LEASE_DOC_RETENTION_MS = 86_400_000;

export interface QuotaGuardRequestLike extends AppCheckAwareRequest {
  readonly auth?: CallerAuthContext | undefined;
  readonly data: unknown;
  readonly rawRequest?: RawRequestWithIp | undefined;
}

export interface QuotaGuardDeps {
  readonly db: FirestoreLike;
  readonly stateCache: GlobalStateCache;
  readonly counters: CounterEngine;
  readonly judgeValidator: JudgeLaneValidator;
  readonly getNetHashPepper: () => string;
  readonly sampleClaimHashes?: readonly string[];
  readonly now?: () => number;
  readonly generateLeaseId?: () => string;
  readonly trustedProxyHopsFromRight?: number;
  readonly logger?: SafeLogger;
}

function isExactSampleAllowList(
  requested: readonly string[],
  allowList: readonly string[]
): boolean {
  if (allowList.length !== 5 || requested.length !== 5) {
    return false;
  }
  const allowedSet = new Set(allowList);
  const seen = new Set<string>();
  for (const h of requested) {
    if (!allowedSet.has(h) || seen.has(h)) {
      return false;
    }
    seen.add(h);
  }
  return seen.size === 5;
}

export function createQuotaGuardHandler(
  deps: QuotaGuardDeps
): (request: QuotaGuardRequestLike) => Promise<QuotaGuardResponse> {
  const now = deps.now ?? (() => Date.now());
  const generateLeaseId = deps.generateLeaseId ?? (() => randomUUID());
  const logger = deps.logger ?? defaultLogger;
  const sampleAllowList = deps.sampleClaimHashes ?? DEFAULT_SAMPLE_CLAIM_HASHES;

  return async (request: QuotaGuardRequestLike): Promise<QuotaGuardResponse> => {
    rejectReplay(request);
    const startMs = now();

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
    }

    const req = assertValidQuotaGuardRequest(request.data);
    const currentNowMs = now();
    const day = yyyymmdd(currentNowMs);
    const resetsAt = nextJakartaMidnightMs(currentNowMs);

    const state = await deps.stateCache.get();
    if (state.hardStop) {
      logger.warn("quotaGuard.denied", {
        uid: request.auth.uid,
        kind: req.kind,
        reason: "HARD_STOP",
        latencyMs: Math.max(0, now() - startMs),
      });
      return { ok: false, reason: "HARD_STOP", resetsAt };
    }
    if (state.killSwitch) {
      logger.warn("quotaGuard.denied", {
        uid: request.auth.uid,
        kind: req.kind,
        reason: "KILL_SWITCH",
        latencyMs: Math.max(0, now() - startMs),
      });
      return { ok: false, reason: "KILL_SWITCH", resetsAt };
    }

    if (req.kind === "SAMPLE" && !isExactSampleAllowList(req.claimHashes, sampleAllowList)) {
      throw new HttpsError("invalid-argument", "INVALID_SAMPLE_CLAIM_HASHES");
    }

    const isJudge = await deps.judgeValidator.isActiveJudge(request.auth);

    let pool: PoolName;
    let field: PoolField;
    let reserveCount: number;
    let atomic: boolean;
    let netHash: string | null = null;

    if (isJudge) {
      pool = "judge";
      field = req.kind === "ALT" ? "alt" : "l2";
      reserveCount = req.claimHashes.length;
      atomic = req.kind === "SAMPLE";
    } else if (req.kind === "SAMPLE") {
      pool = "sample";
      field = "sampleRuns";
      reserveCount = 1;
      atomic = true;
    } else {
      pool = "anon";
      field = req.kind === "ALT" ? "alt" : "l2";
      reserveCount = req.claimHashes.length;
      atomic = false;
    }

    if (pool !== "judge") {
      const prefix = extractClientNetworkPrefix(
        request.rawRequest,
        deps.trustedProxyHopsFromRight !== undefined
          ? { trustedProxyHopsFromRight: deps.trustedProxyHopsFromRight }
          : undefined
      );
      if (prefix !== null) {
        netHash = computeNetHash(day, prefix, deps.getNetHashPepper());
      }
    }

    const reservation = await deps.counters.reserve({
      uid: request.auth.uid,
      pool,
      field,
      n: reserveCount,
      netHash,
      atomic,
    });

    if (reservation.granted === 0) {
      const reason = reservation.deniedReason ?? "POOL_EXHAUSTED";
      logger.warn("quotaGuard.denied", {
        uid: request.auth.uid,
        pool,
        kind: req.kind,
        reason,
        latencyMs: Math.max(0, now() - startMs),
      });
      return {
        ok: false,
        reason,
        resetsAt,
      };
    }

    const grantedHashes =
      pool === "sample" ? req.claimHashes : req.claimHashes.slice(0, reservation.granted);

    const exp = currentNowMs + LEASE_TTL_MS;
    const expireAt = new Date(currentNowMs + LEASE_DOC_RETENTION_MS);

    const leases: QuotaGuardLease[] = grantedHashes.map((claimHash) => ({
      claimHash,
      leaseId: generateLeaseId(),
      exp,
    }));

    await deps.db.runTransaction(async (tx) => {
      for (const lease of leases) {
        const ref = deps.db.doc(`users/${request.auth!.uid}/leases/${lease.leaseId}`);
        tx.set(ref, {
          claimHash: lease.claimHash,
          pool,
          kind: req.kind,
          createdAt: currentNowMs,
          exp: lease.exp,
          expireAt,
        });
      }
    });

    logger.info("quotaGuard.granted", {
      uid: request.auth.uid,
      pool,
      kind: req.kind,
      requestedCount: req.claimHashes.length,
      grantedCount: leases.length,
      remainingToday: reservation.remainingToday,
      latencyMs: Math.max(0, now() - startMs),
    });

    return {
      ok: true,
      pool,
      leaseId: leases[0]!.leaseId,
      leases,
      exp,
      remainingToday: reservation.remainingToday,
      resetsAt,
    };
  };
}

let cachedDefaultHandler:
  | ((request: QuotaGuardRequestLike) => Promise<QuotaGuardResponse>)
  | null = null;

function getDefaultHandler(): (request: QuotaGuardRequestLike) => Promise<QuotaGuardResponse> {
  if (cachedDefaultHandler) return cachedDefaultHandler;
  const app = getApps().length > 0 ? getApp() : initializeApp();
  const db = wrapAdminFirestore(getFirestore(app));
  const stateCache = new GlobalStateCache(db);
  const counters = new CounterEngine(db, stateCache);
  const judgeValidator = new JudgeValidityCache(db);
  cachedDefaultHandler = createQuotaGuardHandler({
    db,
    stateCache,
    counters,
    judgeValidator,
    getNetHashPepper: () => NET_HASH_PEPPER.value(),
  });
  return cachedDefaultHandler;
}

export const quotaGuard = onCall(
  {
    ...CONSUMING,
    maxInstances: 3,
    concurrency: 40,
    memory: "256MiB",
    cpu: 1,
    timeoutSeconds: 30,
    serviceAccount: SERVICE_ACCOUNTS.quota,
    secrets: [NET_HASH_PEPPER],
  },
  async (request) => {
    rejectReplay(request);
    return getDefaultHandler()(request as unknown as QuotaGuardRequestLike);
  }
);
