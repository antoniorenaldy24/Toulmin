import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { CounterEngine, GlobalStateCache } from "../src/common/counters.js";
import { assertJudgeLane, assertNotHardStopped, assertPublicLane } from "../src/common/lanes.js";
import { createRedeemJudgeCodeHandler } from "../src/judge/redeemJudgeCode.js";
import { JudgeValidityCache, canonical, hmacHex } from "../src/judge/validity.js";
import { InMemoryFirestore } from "./helpers/inMemoryFirestore.js";

const PEPPER_CODE = "test-judge-code-pepper-32-bytes!";
const PEPPER_NET = "test-net-hash-pepper-32-bytes!!";
const BASE_NOW_MS = Date.UTC(2026, 10, 27, 10, 0, 0);
const FUTURE_EXP_SEC = Math.floor(BASE_NOW_MS / 1000) + 86_400 * 30;
const PAST_EXP_SEC = Math.floor(BASE_NOW_MS / 1000) - 60;

describe("Judge codes canonicalization, redemption & revocation (AC-FN-06, AC-SEC-16)", () => {
  it("canonicalizes Crockford Base32 preserving TLMN prefix and rejecting U", () => {
    expect(canonical("tlmn-2345-6789")).toBe("TLMN23456789");
    expect(canonical("  tlmn o i l 2 - 3 4 5 6  ")).toBe("TLMN01123456");
    expect(canonical("TLMN-ABCD-EFGH")).toBe("TLMNABCDEFGH");
    expect(canonical("TLMN-UUUU-2345")).toBeNull();
    expect(canonical("TLMN-2345-678")).toBeNull();
    expect(canonical("XXXX-2345-6789")).toBeNull();
  });

  it("allows up to 5 UIDs, supports idempotent re-redemption, and rejects 6th UID with generic INVALID_CODE", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const claimsMap = new Map<string, Record<string, unknown>>();

    const canon = canonical("tlmn - o i l 2 - 3 4 5 6")!;
    const docId = hmacHex(PEPPER_CODE, canon);
    db.seedDoc(`judgeCodes/${docId}`, {
      uids: [],
      maxUids: 5,
      exp: FUTURE_EXP_SEC,
      disabled: false,
    });

    const handler = createRedeemJudgeCodeHandler({
      db,
      stateCache,
      counters,
      getJudgeCodePepper: () => PEPPER_CODE,
      getNetHashPepper: () => PEPPER_NET,
      getJudgeTierExpiryEpoch: () => FUTURE_EXP_SEC,
      setCustomUserClaims: async (uid, claims) => {
        claimsMap.set(uid, claims);
      },
      now: () => BASE_NOW_MS,
    });

    for (let i = 1; i <= 5; i += 1) {
      const uid = `judge-uid-${i}`;
      const res = await handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid, token: {} },
        data: { code: "tlmn oil2 3456" },
        rawRequest: { headers: { "x-forwarded-for": `198.51.100.${i}` } },
      });
      expect(res).toEqual({ ok: true, pool: "judge", tierExp: FUTURE_EXP_SEC });
      expect(claimsMap.get(uid)).toEqual({
        tier: "judge",
        codeId: docId.slice(0, 32),
        tierExp: FUTURE_EXP_SEC,
      });
    }

    // Idempotent retry by UID 3 succeeds without exceeding maxUids
    const retryRes = await handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "judge-uid-3", token: {} },
      data: { code: "TLMN-0112-3456" },
      rawRequest: { headers: { "x-forwarded-for": "198.51.100.3" } },
    });
    expect(retryRes.ok).toBe(true);

    // 6th distinct UID rejected with generic INVALID_CODE
    await expect(
      handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid: "judge-uid-6", token: {} },
        data: { code: "TLMN-0112-3456" },
        rawRequest: { headers: { "x-forwarded-for": "198.51.100.6" } },
      })
    ).rejects.toMatchObject({
      code: "permission-denied",
      message: "INVALID_CODE",
    });
  });

  it("returns generic INVALID_CODE for disabled, expired, unknown, and malformed codes", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });

    const disabledId = hmacHex(PEPPER_CODE, "TLMN22223333");
    db.seedDoc(`judgeCodes/${disabledId}`, {
      uids: [],
      maxUids: 5,
      exp: FUTURE_EXP_SEC,
      disabled: true,
    });

    const expiredId = hmacHex(PEPPER_CODE, "TLMN44445555");
    db.seedDoc(`judgeCodes/${expiredId}`, {
      uids: [],
      maxUids: 5,
      exp: PAST_EXP_SEC,
      disabled: false,
    });

    const boundaryExpId = hmacHex(PEPPER_CODE, "TLMN66667777");
    const boundaryNowSec = Math.floor(BASE_NOW_MS / 1000);
    db.seedDoc(`judgeCodes/${boundaryExpId}`, {
      uids: [],
      maxUids: 5,
      exp: boundaryNowSec + 60,
      disabled: false,
    });

    const handler = createRedeemJudgeCodeHandler({
      db,
      stateCache,
      counters,
      getJudgeCodePepper: () => PEPPER_CODE,
      getNetHashPepper: () => PEPPER_NET,
      getJudgeTierExpiryEpoch: () => FUTURE_EXP_SEC,
      setCustomUserClaims: async () => undefined,
      now: () => BASE_NOW_MS,
    });

    for (const code of ["TLMN-2222-3333", "TLMN-4444-5555", "TLMN-9999-8888", "TLMN-UUUU-2345"]) {
      await expect(
        handler({
          app: { appId: "web", alreadyConsumed: false },
          auth: { uid: "u-err", token: {} },
          data: { code },
          rawRequest: { headers: { "x-forwarded-for": "198.51.100.99" } },
        })
      ).rejects.toMatchObject({
        code: "permission-denied",
        message: "INVALID_CODE",
      });
    }

    const boundaryHandler = createRedeemJudgeCodeHandler({
      db,
      stateCache,
      counters,
      getJudgeCodePepper: () => PEPPER_CODE,
      getNetHashPepper: () => PEPPER_NET,
      getJudgeTierExpiryEpoch: () => boundaryNowSec,
      setCustomUserClaims: async () => undefined,
      now: () => BASE_NOW_MS,
    });
    await expect(
      boundaryHandler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid: "u-boundary", token: {} },
        data: { code: "TLMN-6666-7777" },
        rawRequest: { headers: { "x-forwarded-for": "198.51.100.98" } },
      })
    ).rejects.toMatchObject({
      code: "permission-denied",
      message: "INVALID_CODE",
    });
  });

  it("enforces 10/UID/day call limit on redeemJudgeCode", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const handler = createRedeemJudgeCodeHandler({
      db,
      stateCache,
      counters,
      getJudgeCodePepper: () => PEPPER_CODE,
      getNetHashPepper: () => PEPPER_NET,
      getJudgeTierExpiryEpoch: () => FUTURE_EXP_SEC,
      setCustomUserClaims: async () => undefined,
      now: () => BASE_NOW_MS,
    });

    for (let i = 0; i < 10; i += 1) {
      await expect(
        handler({
          app: { appId: "web", alreadyConsumed: false },
          auth: { uid: "bruteforce-uid", token: {} },
          data: { code: "TLMN-9999-8888" },
          rawRequest: { headers: { "x-forwarded-for": "198.51.100.55" } },
        })
      ).rejects.toMatchObject({ message: "INVALID_CODE" });
    }

    await expect(
      handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid: "bruteforce-uid", token: {} },
        data: { code: "TLMN-9999-8888" },
        rawRequest: { headers: { "x-forwarded-for": "198.51.100.55" } },
      })
    ).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "QUOTA_EXCEEDED",
    });
  });

  it("enforces 60 s revocation cache and public/judge lane isolation (AC-SEC-16, AC-SEC-08)", async () => {
    let nowMs = BASE_NOW_MS;
    const db = new InMemoryFirestore();
    const codeIdFull = hmacHex(PEPPER_CODE, "TLMN23456789");
    const codeIdPrefix = codeIdFull.slice(0, 32);

    db.seedDoc(`judgeCodes/${codeIdFull}`, {
      uids: ["judge-1"],
      maxUids: 5,
      exp: FUTURE_EXP_SEC,
      disabled: false,
    });

    const validity = new JudgeValidityCache(db, { now: () => nowMs, ttlMs: 60_000 });
    const judgeAuth = {
      uid: "judge-1",
      token: { tier: "judge", codeId: codeIdPrefix, tierExp: FUTURE_EXP_SEC },
    };
    const anonAuth = { uid: "anon-1", token: {} };

    // Active judge passes judge lane and is rejected on public lane with USE_JUDGE_LANE
    await expect(assertJudgeLane(judgeAuth, validity)).resolves.toBeUndefined();
    await expect(assertPublicLane(judgeAuth, validity)).rejects.toMatchObject({
      code: "failed-precondition",
      message: "USE_JUDGE_LANE",
    });

    // Anonymous caller passes public lane and is rejected on judge lane
    await expect(assertPublicLane(anonAuth, validity)).resolves.toBeUndefined();
    await expect(assertJudgeLane(anonAuth, validity)).rejects.toBeInstanceOf(HttpsError);

    // Disable code in Firestore -> still cached within 59s, revoked at 60s
    db.seedDoc(`judgeCodes/${codeIdFull}`, {
      uids: ["judge-1"],
      maxUids: 5,
      exp: FUTURE_EXP_SEC,
      disabled: true,
    });
    nowMs += 59_000;
    expect(await validity.isActiveJudge(judgeAuth)).toBe(true);

    nowMs += 1_000;
    expect(await validity.isActiveJudge(judgeAuth)).toBe(false);
    await expect(assertJudgeLane(judgeAuth, validity)).rejects.toMatchObject({
      code: "permission-denied",
    });

    // Hard stop check
    const stateCache = new GlobalStateCache(db, { now: () => nowMs, ttlMs: 60_000 });
    db.seedDoc("global/state", { hardStop: true, killSwitch: false });
    await expect(assertNotHardStopped(stateCache)).rejects.toMatchObject({
      code: "unavailable",
      message: "HARD_STOP",
    });
  });
});
