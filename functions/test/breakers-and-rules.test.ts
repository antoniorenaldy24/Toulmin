import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RemoteConfigTemplate } from "firebase-admin/remote-config";
import { describe, expect, it } from "vitest";
import { createBudgetBreakerHandler } from "../src/budget/budgetBreaker.js";
import { createRecaptchaBreakerHandler } from "../src/budget/recaptchaBreaker.js";
import { createSafeLogger, type SafeLogRecord } from "../src/common/log.js";
import { InMemoryFirestore } from "./helpers/inMemoryFirestore.js";

function createFakeRcAdapter(initialParams: Record<string, string> = {}) {
  let etagCounter = 1;
  let stored: RemoteConfigTemplate = {
    etag: "etag-1",
    parameters: Object.fromEntries(
      Object.entries(initialParams).map(([k, v]) => [k, { defaultValue: { value: v } }])
    ),
    conditions: [],
    parameterGroups: {},
    version: { versionNumber: "1" },
  };
  let conflictFailuresRemaining = 0;

  return {
    setConflictFailures(count: number) {
      conflictFailuresRemaining = count;
    },
    getCurrentValues(): Record<string, string | undefined> {
      const out: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(stored.parameters)) {
        out[k] = (v.defaultValue as { value?: string } | undefined)?.value;
      }
      return out;
    },
    adapter: {
      getTemplate: async (): Promise<RemoteConfigTemplate> => JSON.parse(JSON.stringify(stored)),
      publishTemplate: async (template: RemoteConfigTemplate): Promise<RemoteConfigTemplate> => {
        if (conflictFailuresRemaining > 0) {
          conflictFailuresRemaining -= 1;
          const err = new Error("HTTP 412 ETag mismatch");
          (err as { code?: string }).code = "failed-precondition";
          throw err;
        }
        etagCounter += 1;
        stored = {
          ...JSON.parse(JSON.stringify(template)),
          etag: `etag-${etagCounter}`,
        };
        return JSON.parse(JSON.stringify(stored));
      },
    },
  };
}

describe("budgetBreaker & recaptchaBreaker (AC-FN-07, AC-COST-08)", () => {
  it("handles ai-logic thresholds 0.26, 0.51, 0.76, 0.91 idempotently", async () => {
    const db = new InMemoryFirestore();
    const rc = createFakeRcAdapter({ kill_switch_cloud: "false", sample_pool_global: "20" });
    const pages: string[] = [];
    const logs: SafeLogRecord[] = [];
    const handler = createBudgetBreakerHandler({
      db,
      remoteConfig: rc.adapter,
      notifier: {
        pageOnCall: async (b, r) => {
          pages.push(`oncall:${b}:${r}`);
        },
        pageBothOperators: async (b, r) => {
          pages.push(`both:${b}:${r}`);
        },
      },
      now: () => 1_700_000_000_000,
      logger: createSafeLogger((r) => logs.push(r)),
    });

    // 0.26 -> public pools halved (40->20, 20->10), sample stays 20
    const r26 = await handler({ budgetDisplayName: "ai-logic", costAmount: 15.6, budgetAmount: 60 });
    expect(r26.ratioRounded).toBe("0.26");
    expect(db.getDocData("global/state")?.["pools"]).toEqual({
      anon: { l2: { global: 20 }, alt: { global: 10 } },
    });
    expect(rc.getCurrentValues()["sample_pool_global"]).toBe("20");

    // 0.51 -> public pools zeroed, sample halved 20->10
    await handler({ budgetDisplayName: "ai-logic", costAmount: 30.6, budgetAmount: 60 });
    expect(db.getDocData("global/state")?.["pools"]).toEqual({
      anon: { l2: { global: 0 }, alt: { global: 0 } },
      sample: { sampleRuns: { global: 10 } },
    });
    expect(rc.getCurrentValues()["sample_pool_global"]).toBe("10");

    // 0.76 -> sample pool zeroed, judge preserved, both operators paged
    await handler({ budgetDisplayName: "ai-logic", costAmount: 45.6, budgetAmount: 60 });
    expect(db.getDocData("global/state")?.["pools"]).toEqual({
      anon: { l2: { global: 0 }, alt: { global: 0 } },
      sample: { sampleRuns: { global: 0 } },
    });
    expect(rc.getCurrentValues()["sample_pool_global"]).toBe("0");
    expect(pages).toContain("both:ai-logic:0.76");

    // Out-of-order stale 0.26 replay does NOT raise zeroed pools (monotonic idempotency)
    await handler({ budgetDisplayName: "ai-logic", costAmount: 15.6, budgetAmount: 60 });
    expect(db.getDocData("global/state")?.["pools"]).toEqual({
      anon: { l2: { global: 0 }, alt: { global: 0 } },
      sample: { sampleRuns: { global: 0 } },
    });

    // 0.91 -> judge halved (600->300), killSwitch = true, RC kill_switch_cloud = "true"
    await handler({ budgetDisplayName: "ai-logic", costAmount: 54.6, budgetAmount: 60 });
    expect(db.getDocData("global/state")?.["pools"]).toEqual({
      anon: { l2: { global: 0 }, alt: { global: 0 } },
      sample: { sampleRuns: { global: 0 } },
      judge: { l2: { global: 300 }, alt: { global: 50 } },
    });
    expect(db.getDocData("global/state")?.["killSwitch"]).toBe(true);
    expect(db.getDocData("global/state")?.["killSwitchAt"]).toBe(1_700_000_000_000);
    expect(rc.getCurrentValues()["kill_switch_cloud"]).toBe("true");
  });

  it("handles gross (0.51/0.82/1.01) & uncapped (0.81/1.01) and retries Remote Config ETag conflicts up to 3x", async () => {
    const db = new InMemoryFirestore();
    const rc = createFakeRcAdapter({ kill_switch_cloud: "false" });
    rc.setConflictFailures(2); // Fails 2 times, succeeds on 3rd attempt
    const pages: string[] = [];

    const handler = createBudgetBreakerHandler({
      db,
      remoteConfig: rc.adapter,
      notifier: {
        pageOnCall: async (b, r) => {
          pages.push(`oncall:${b}:${r}`);
        },
        pageBothOperators: async (b, r) => {
          pages.push(`both:${b}:${r}`);
        },
      },
      now: () => 2_000_000,
    });

    await handler({ budgetDisplayName: "gross", costAmount: 56.1, budgetAmount: 110 });
    expect(pages).toContain("oncall:gross:0.51");
    expect(db.getDocData("global/state")).toBeUndefined();

    await handler({ budgetDisplayName: "gross", costAmount: 90.2, budgetAmount: 110 });
    expect(rc.getCurrentValues()["kill_switch_cloud"]).toBe("true");
    expect(db.getDocData("global/state")?.["killSwitch"]).toBe(true);
    expect(db.getDocData("global/state")?.["hardStop"]).toBeUndefined();

    await handler({ budgetDisplayName: "gross", costAmount: 111.1, budgetAmount: 110 });
    expect(db.getDocData("global/state")?.["hardStop"]).toBe(true);

    // Operator manually resets killSwitch to false without removing killSwitchAt -> next trigger updates killSwitchAt
    db.seedDoc("global/state", { killSwitch: false, killSwitchAt: 1000, hardStop: false });
    await handler({ budgetDisplayName: "gross", costAmount: 90.2, budgetAmount: 110 });
    expect(db.getDocData("global/state")?.["killSwitch"]).toBe(true);
    expect(db.getDocData("global/state")?.["killSwitchAt"]).toBe(2_000_000);

    const db2 = new InMemoryFirestore();
    const rc2 = createFakeRcAdapter();
    const pages2: string[] = [];
    const handler2 = createBudgetBreakerHandler({
      db: db2,
      remoteConfig: rc2.adapter,
      notifier: {
        pageOnCall: async (b, r) => {
          pages2.push(`oncall:${b}:${r}`);
        },
        pageBothOperators: async () => undefined,
      },
    });
    await handler2({ budgetDisplayName: "uncapped", costAmount: 16.2, budgetAmount: 20 });
    expect(pages2).toContain("oncall:uncapped:0.81");
    expect(db2.getDocData("global/state")?.["hardStop"]).toBeUndefined();

    await handler2({ budgetDisplayName: "uncapped", costAmount: 20.2, budgetAmount: 20 });
    expect(db2.getDocData("global/state")?.["hardStop"]).toBe(true);
  });

  it("disables Web reCAPTCHA Enterprise key at ratio >= 1.0 and logs ratio rounded to 2 decimals (AC-COST-08)", async () => {
    const disabledCalls: Array<{ projectId: string; keyId: string }> = [];
    const logs: SafeLogRecord[] = [];
    const handler = createRecaptchaBreakerHandler({
      disabler: {
        disableWebKey: async (params) => {
          disabledCalls.push(params);
        },
      },
      getProjectId: () => "toulmin-staging",
      getKeyId: () => "key-123",
      logger: createSafeLogger((r) => logs.push(r)),
    });

    const below = await handler({ budgetDisplayName: "recaptcha", costAmount: 9.94, budgetAmount: 10 });
    expect(below.disabled).toBe(false);
    expect(below.ratioRounded).toBe("0.99");
    expect(disabledCalls).toHaveLength(0);

    const atCap = await handler({ budgetDisplayName: "recaptcha", costAmount: 10.0, budgetAmount: 10 });
    expect(atCap.disabled).toBe(true);
    expect(atCap.ratioRounded).toBe("1.00");
    expect(disabledCalls).toEqual([{ projectId: "toulmin-staging", keyId: "key-123" }]);
    expect(logs[1]!.fields["ratio"]).toBe("1.00");
  });
});

describe("Security rules, IAM manifest & Storage CORS structural verification (AC-SEC-06, AC-SEC-11)", () => {
  const root = resolve(import.meta.dirname, "../..");

  it("firestore.rules matches 05 §6.1 verbatim (client deny-all except own quota/leases)", () => {
    const rules = readFileSync(resolve(root, "firestore.rules"), "utf8");
    expect(rules).toContain("function signedIn() { return request.auth != null; }");
    expect(rules).toContain("function isOwner(uid) { return signedIn() && request.auth.uid == uid; }");
    expect(rules).toContain("match /quota/{day}      { allow read: if isOwner(uid); allow write: if false; }");
    expect(rules).toContain("match /leases/{leaseId} { allow read: if isOwner(uid); allow write: if false; }");
    expect(rules).toContain("match /refmeta/{h}      { allow read, write: if false; }");
    expect(rules).toContain("match /judgeCodes/{h}   { allow read, write: if false; }");
    expect(rules).toContain("match /netCounters/{k}  { allow read, write: if false; }");
    expect(rules).toContain("match /global/{doc=**}  { allow read, write: if false; }");
    expect(rules).toContain("match /{document=**}    { allow read, write: if false; }");
  });

  it("storage.rules matches 05 §6.2 verbatim (/rw signed-in read only, all else denied)", () => {
    const rules = readFileSync(resolve(root, "storage.rules"), "utf8");
    expect(rules).toContain("match /rw/{file}       { allow read: if request.auth != null; allow write: if false; }");
    expect(rules).toContain("match /{allPaths=**}   { allow read, write: if false; }");
  });

  it("infra/storage-cors.json matches 05 §2.1 verbatim", () => {
    const cors = JSON.parse(readFileSync(resolve(root, "infra/storage-cors.json"), "utf8"));
    expect(cors).toEqual([
      {
        origin: ["https://toulmin.web.app"],
        method: ["GET"],
        responseHeader: ["Content-Type"],
        maxAgeSeconds: 3600,
      },
    ]);
  });

  it("infra/iam/service-accounts.yaml declares all 6 per-class SAs, secret boundaries, and zero roles on oaparse-sa", () => {
    const yaml = readFileSync(resolve(root, "infra/iam/service-accounts.yaml"), "utf8");
    for (const sa of ["bib-sa", "oafetch-sa", "oaparse-sa", "quota-sa", "judge-sa", "ops-sa"]) {
      expect(yaml).toContain(`${sa}@toulmin-prod.iam.gserviceaccount.com`);
    }
    expect(yaml).toContain("JUDGE_CODE_PEPPER:\n    - judge-sa");
    expect(yaml).toContain("serverlessVpcAccessConnector: null");
    expect(yaml).toMatch(/oaparse-sa:[\s\S]*?roles: \[\]\s+secrets: \[\]/);
  });

  it("functions/src contains zero hardcoded calendar date literals or secrets", () => {
    const srcFiles = [
      "src/index.ts",
      "src/common/config.ts",
      "src/common/appcheck.ts",
      "src/common/validate.ts",
      "src/common/log.ts",
      "src/common/clientIp.ts",
      "src/common/counters.ts",
      "src/common/lanes.ts",
      "src/judge/validity.ts",
      "src/judge/redeemJudgeCode.ts",
      "src/quota/pools.ts",
      "src/quota/netHash.ts",
      "src/quota/quotaGuard.ts",
      "src/budget/budgetBreaker.ts",
      "src/budget/recaptchaBreaker.ts",
    ];
    for (const rel of srcFiles) {
      const text = readFileSync(resolve(import.meta.dirname, "..", rel), "utf8");
      expect(text).not.toMatch(/\b202[0-9]-\d{2}-\d{2}\b/);
      expect(text).not.toContain("DebugAppCheckProviderFactory");
      expect(text).not.toContain("FIREBASE_APPCHECK_DEBUG_TOKEN");
    }
  });
});
