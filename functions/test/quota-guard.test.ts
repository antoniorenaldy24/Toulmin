import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { CounterEngine, GlobalStateCache } from "../src/common/counters.js";
import { JudgeValidityCache, hmacHex } from "../src/judge/validity.js";
import { createQuotaGuardHandler } from "../src/quota/quotaGuard.js";
import { InMemoryFirestore } from "./helpers/inMemoryFirestore.js";

const PEPPER_NET = "net-pepper-test-32-bytes-long!!";
const PEPPER_CODE = "code-pepper-test-32-bytes-long!";
const BASE_NOW_MS = Date.UTC(2026, 10, 27, 10, 0, 0);
const FUTURE_EXP_SEC = Math.floor(BASE_NOW_MS / 1000) + 86_400 * 30;

function sha(label: string): string {
  return createHash("sha256").update(label, "utf8").digest("hex");
}

const SAMPLE_HASHES = [sha("s1"), sha("s2"), sha("s3"), sha("s4"), sha("s5")];

function setupHarness(initialNow = BASE_NOW_MS) {
  let nowMs = initialNow;
  let leaseSeq = 0;
  const db = new InMemoryFirestore();
  const stateCache = new GlobalStateCache(db, { now: () => nowMs, ttlMs: 60_000 });
  const counters = new CounterEngine(db, stateCache, {
    now: () => nowMs,
    randomInt: (max) => leaseSeq % max,
  });
  const judgeValidator = new JudgeValidityCache(db, { now: () => nowMs, ttlMs: 60_000 });
  const handler = createQuotaGuardHandler({
    db,
    stateCache,
    counters,
    judgeValidator,
    getNetHashPepper: () => PEPPER_NET,
    sampleClaimHashes: SAMPLE_HASHES,
    now: () => nowMs,
    generateLeaseId: () => {
      leaseSeq += 1;
      return `lease-${leaseSeq}`;
    },
  });

  return {
    db,
    stateCache,
    judgeValidator,
    handler,
    advanceMs: (delta: number) => {
      nowMs += delta;
    },
  };
}

describe("quotaGuard pools, limits, killSwitch, leases (AC-FN-08, AC-COST-01..03, AC-SEC-08)", () => {
  it("enforces HARD_STOP and server-side KILL_SWITCH without writing leases (AC-FN-08)", async () => {
    const h = setupHarness();
    h.db.seedDoc("global/state", { hardStop: false, killSwitch: true });

    const ksRes = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "anon-ks", token: {} },
      data: { claimHashes: [sha("c1")], kind: "L2" },
      rawRequest: { headers: { "x-forwarded-for": "198.51.100.10" } },
    });
    expect(ksRes.ok).toBe(false);
    if (!ksRes.ok) {
      expect(ksRes.reason).toBe("KILL_SWITCH");
    }
    expect(h.db.listDocs("users/anon-ks/leases/")).toHaveLength(0);

    h.db.seedDoc("global/state", { hardStop: true, killSwitch: true });
    h.advanceMs(60_000);
    const hsRes = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "anon-ks", token: {} },
      data: { claimHashes: [sha("c1")], kind: "L2" },
      rawRequest: { headers: { "x-forwarded-for": "198.51.100.10" } },
    });
    expect(hsRes.ok).toBe(false);
    if (!hsRes.ok) {
      expect(hsRes.reason).toBe("HARD_STOP");
    }
  });

  it("enforces anonymous per-UID cap (10), partial grants, and writes 300 s / 24 h leases (AC-COST-01)", async () => {
    const h = setupHarness();

    const first = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "anon-u1", token: {} },
      data: { claimHashes: [sha("a1"), sha("a2"), sha("a3"), sha("a4"), sha("a5"), sha("a6")], kind: "L2" },
      rawRequest: { headers: { "x-forwarded-for": "203.0.113.10" } },
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.pool).toBe("anon");
      expect(first.leases).toHaveLength(6);
      expect(first.remainingToday).toBe(4);
      expect(first.exp).toBe(BASE_NOW_MS + 300_000);
    }

    // Request 6 more when only 4 remain -> partial grant m = 4, remainingToday = 0
    const partial = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "anon-u1", token: {} },
      data: { claimHashes: [sha("b1"), sha("b2"), sha("b3"), sha("b4"), sha("b5"), sha("b6")], kind: "L2" },
      rawRequest: { headers: { "x-forwarded-for": "203.0.113.10" } },
    });
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.leases).toHaveLength(4);
      expect(partial.remainingToday).toBe(0);
    }

    // Verify lease TTL expireAt = now + 24 h
    const leaseDocs = h.db.listDocs("users/anon-u1/leases/");
    expect(leaseDocs).toHaveLength(10);
    expect((leaseDocs[0]!.data["expireAt"] as Date).getTime()).toBe(BASE_NOW_MS + 86_400_000);

    // 11th lease refused with QUOTA_EXCEEDED
    const eleventh = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "anon-u1", token: {} },
      data: { claimHashes: [sha("c11")], kind: "L2" },
      rawRequest: { headers: { "x-forwarded-for": "203.0.113.10" } },
    });
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) {
      expect(eleventh.reason).toBe("QUOTA_EXCEEDED");
    }
  });

  it("enforces per-network limit (20 L2, 2 sample runs) across forged XFF & 4 shards (AC-COST-02, AC-SEC-09)", async () => {
    const h = setupHarness();

    // 2 UIDs on same /24 each take 10 -> 20 total; forged left-most IP must not bypass
    for (const [uid, forged] of [
      ["net-u1", "1.1.1.1, 198.51.100.20"],
      ["net-u2", "8.8.8.8, 198.51.100.21"],
    ] as const) {
      const res = await h.handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid, token: {} },
        data: { claimHashes: Array.from({ length: 10 }, (_, i) => sha(`${uid}-${i}`)), kind: "L2" },
        rawRequest: { headers: { "x-forwarded-for": forged } },
      });
      expect(res.ok).toBe(true);
    }

    // 3rd UID on same /24 -> NET_LIMIT
    const thirdNet = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "net-u3", token: {} },
      data: { claimHashes: [sha("x1")], kind: "L2" },
      rawRequest: { headers: { "x-forwarded-for": "9.9.9.9, 198.51.100.22" } },
    });
    expect(thirdNet.ok).toBe(false);
    if (!thirdNet.ok) {
      expect(thirdNet.reason).toBe("NET_LIMIT");
    }

    // Sample pool: 2 runs per network, 3rd UID on same /24 refused NET_LIMIT
    for (const uid of ["s-u1", "s-u2"]) {
      const sRes = await h.handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid, token: {} },
        data: { claimHashes: SAMPLE_HASHES, kind: "SAMPLE" },
        rawRequest: { headers: { "x-forwarded-for": "203.0.113.77" } },
      });
      expect(sRes.ok).toBe(true);
      if (sRes.ok) {
        expect(sRes.pool).toBe("sample");
        expect(sRes.leases).toHaveLength(5);
      }
    }
    const s3 = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "s-u3", token: {} },
      data: { claimHashes: SAMPLE_HASHES, kind: "SAMPLE" },
      rawRequest: { headers: { "x-forwarded-for": "203.0.113.88" } },
    });
    expect(s3.ok).toBe(false);
    if (!s3.ok) {
      expect(s3.reason).toBe("NET_LIMIT");
    }

    // Verify network counters are stored only under /netCounters/<hash>_<day>_<shard>
    const netDocs = h.db.listDocs("netCounters/");
    expect(netDocs.length).toBeGreaterThan(0);
    for (const d of netDocs) {
      expect(d.path).toMatch(/^netCounters\/[0-9a-f]{64}_\d{8}_[0-3]$/);
    }
  });

  it("keeps judge pool & judge sample working when anonymous & sample global pools are exhausted (AC-COST-03, AC-SEC-08)", async () => {
    const h = setupHarness();
    const codeId = hmacHex(PEPPER_CODE, "TLMN55556666");
    h.db.seedDoc(`judgeCodes/${codeId}`, {
      uids: ["judge-1"],
      maxUids: 5,
      exp: FUTURE_EXP_SEC,
      disabled: false,
    });

    // Exhaust anonymous global L2 pool (40) across 4 distinct /24s
    for (let u = 0; u < 4; u += 1) {
      const r = await h.handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid: `anon-g-${u}`, token: {} },
        data: { claimHashes: Array.from({ length: 10 }, (_, i) => sha(`g-${u}-${i}`)), kind: "L2" },
        rawRequest: { headers: { "x-forwarded-for": `198.51.${u + 1}.10` } },
      });
      expect(r.ok).toBe(true);
    }
    const anon41 = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "anon-g-4", token: {} },
      data: { claimHashes: [sha("g-41")], kind: "L2" },
      rawRequest: { headers: { "x-forwarded-for": "198.51.99.10" } },
    });
    expect(anon41.ok).toBe(false);
    if (!anon41.ok) {
      expect(anon41.reason).toBe("POOL_EXHAUSTED");
    }

    // Exhaust public sample global pool (20 runs) across 20 distinct UIDs / networks
    for (let s = 0; s < 20; s += 1) {
      const sr = await h.handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid: `pub-s-${s}`, token: {} },
        data: { claimHashes: SAMPLE_HASHES, kind: "SAMPLE" },
        rawRequest: { headers: { "x-forwarded-for": `203.0.${s + 1}.1` } },
      });
      expect(sr.ok).toBe(true);
    }
    const sample21 = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "pub-s-20", token: {} },
      data: { claimHashes: SAMPLE_HASHES, kind: "SAMPLE" },
      rawRequest: { headers: { "x-forwarded-for": "203.0.99.1" } },
    });
    expect(sample21.ok).toBe(false);
    if (!sample21.ok) {
      expect(sample21.reason).toBe("POOL_EXHAUSTED");
    }

    // Judge sample run draws 5 leases from judge pool and succeeds!
    const judgeSample = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: {
        uid: "judge-1",
        token: { tier: "judge", codeId: codeId.slice(0, 32), tierExp: FUTURE_EXP_SEC },
      },
      data: { claimHashes: SAMPLE_HASHES, kind: "SAMPLE" },
      rawRequest: { headers: { "x-forwarded-for": "203.0.99.1" } },
    });
    expect(judgeSample.ok).toBe(true);
    if (judgeSample.ok) {
      expect(judgeSample.pool).toBe("judge");
      expect(judgeSample.leases).toHaveLength(5);
      expect(judgeSample.remainingToday).toBe(195);
    }

    // Judge hitting per-judge cap (200): 195 left, request 195 succeeds, next 1 fails
    for (let batch = 0; batch < 7; batch += 1) {
      const count = 25;
      const r = await h.handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: {
          uid: "judge-1",
          token: { tier: "judge", codeId: codeId.slice(0, 32), tierExp: FUTURE_EXP_SEC },
        },
        data: { claimHashes: Array.from({ length: count }, (_, i) => sha(`jb-${batch}-${i}`)), kind: "L2" },
      });
      expect(r.ok).toBe(true);
    }
    const rFinal = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: {
        uid: "judge-1",
        token: { tier: "judge", codeId: codeId.slice(0, 32), tierExp: FUTURE_EXP_SEC },
      },
      data: { claimHashes: Array.from({ length: 20 }, (_, i) => sha(`jb-last-${i}`)), kind: "L2" },
    });
    expect(rFinal.ok).toBe(true);
    if (rFinal.ok) {
      expect(rFinal.remainingToday).toBe(0);
    }
    const r201 = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: {
        uid: "judge-1",
        token: { tier: "judge", codeId: codeId.slice(0, 32), tierExp: FUTURE_EXP_SEC },
      },
      data: { claimHashes: [sha("j-201")], kind: "L2" },
    });
    expect(r201.ok).toBe(false);
    if (!r201.ok) {
      expect(r201.reason).toBe("QUOTA_EXCEEDED");
    }
  });

  it("rejects mismatched SAMPLE claimHashes with invalid-argument and picks up /global/state.pools within 60 s", async () => {
    const h = setupHarness();
    await expect(
      h.handler({
        app: { appId: "web", alreadyConsumed: false },
        auth: { uid: "u-bad-sample", token: {} },
        data: { claimHashes: [sha("not-in-allowlist")], kind: "SAMPLE" },
      })
    ).rejects.toBeInstanceOf(HttpsError);

    // Trigger initial cache load, then lower global anon L2 pool to 2
    const ok1 = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "u-dyn-1", token: {} },
      data: { claimHashes: [sha("d1")], kind: "L2" },
    });
    expect(ok1.ok).toBe(true);

    h.db.seedDoc("global/state", {
      hardStop: false,
      killSwitch: false,
      pools: { anon: { l2: { global: 2 } } },
    });
    h.advanceMs(60_000);

    const ok2 = await h.handler({
      app: { appId: "web", alreadyConsumed: false },
      auth: { uid: "u-dyn-2", token: {} },
      data: { claimHashes: [sha("d2"), sha("d3")], kind: "L2" },
    });
    expect(ok2.ok).toBe(true);
    if (ok2.ok) {
      expect(ok2.leases).toHaveLength(1);
    }
  });
});
