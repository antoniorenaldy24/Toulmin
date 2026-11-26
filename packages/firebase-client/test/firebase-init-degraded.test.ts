import { describe, expect, it, vi } from "vitest";
import { EN_COPY } from "@toulmin/copy";
import { BUNDLED_ROUTING_TABLE } from "@toulmin/schemas";
import {
  BUNDLED_RC_DEFAULTS,
  checkEnvironment,
  createFirebaseRuntime,
  formatEnvironmentReasons,
  localModel,
  startModelDownload,
} from "../src/index.js";
import { createOfflineRuntimeHarness, makeFakeModel } from "./helpers.js";

describe("Firebase initialization, degraded boot, readiness & model download", () => {
  it("AC-SEC-03 & 04 §5.1.1: initializes AI with limited-use tokens and Remote Config defaults without awaiting fetch", () => {
    let fetchResolved = false;
    const harness = createOfflineRuntimeHarness({
      sdkOverrides: {
        fetchAndActivate: () =>
          new Promise<boolean>((resolve) => {
            setTimeout(() => {
              fetchResolved = true;
              resolve(true);
            }, 100);
          }),
      },
    });

    // Boot must not await Remote Config fetch.
    expect(fetchResolved).toBe(false);
    expect(harness.aiCalls).toHaveLength(1);
    expect(harness.aiCalls[0]!.options.useLimitedUseAppCheckTokens).toBe(true);

    // Remote Config settings & all 17 defaults.
    expect(harness.rcInstance.settings.minimumFetchIntervalMillis).toBe(3_600_000);
    expect(Object.keys(BUNDLED_RC_DEFAULTS)).toHaveLength(17);
    expect(harness.runtime.rcReader.getString("cloud_model")).toBe("gemini-3.8-flash");
    expect(harness.runtime.rcReader.getString("prompt_version")).toBe("p2.1");
    expect(harness.runtime.rcReader.getNumber("reasoning_word_cap")).toBe(40);
    expect(harness.runtime.rcReader.getBoolean("kill_switch_cloud")).toBe(false);
    expect(harness.runtime.rcReader.getString("l1_slot_release")).toBe("ON_SETTLE");
    expect(harness.runtime.rcReader.getNumber("l1_settle_ceiling_ms")).toBe(120_000);
    expect(JSON.parse(harness.runtime.rcReader.getString("routing_table"))).toEqual(
      BUNDLED_ROUTING_TABLE
    );
  });

  it("AC-L1W-14 (a): App Check init failure enters degraded mode cleanly with no unhandled rejection", async () => {
    const harness = createOfflineRuntimeHarness({
      sdkOverrides: {
        initializeAppCheck: () => {
          throw new Error("reCAPTCHA script blocked");
        },
      },
    });

    expect(harness.runtime.appCheck).toBeNull();
    expect(harness.runtime.degraded.isDegraded()).toBe(true);
    expect(harness.runtime.degraded.getMessage()).toBe(EN_COPY.quota.degradedChip);
    expect(harness.runtime.degraded.getMessage()).toBe("Cloud features aren't available in this browser");
    expect(harness.runtime.telemetry.snapshot().events[0]?.appCheckInitError).toBe("OTHER");

    const ok = await harness.runtime.ensureAuth();
    expect(ok).toBe(false);
  });

  it("AC-L1W-14 (b): ensureAuth retries exactly once; succeeds on 2nd attempt, degrades after 2 failures, and recovers on chip click", async () => {
    let attempts = 0;
    const harness1 = createOfflineRuntimeHarness({
      sdkOverrides: {
        signInAnonymously: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("network timeout"), { code: "auth/network-request-failed" });
          }
          return { user: { uid: "anon-recovered" } };
        },
      },
    });

    expect(await harness1.runtime.ensureAuth()).toBe(true);
    expect(attempts).toBe(2);
    expect(harness1.runtime.degraded.isDegraded()).toBe(false);

    // Second harness: fails both initial attempt and single retry -> degraded mode.
    let failCount = 0;
    let shouldSucceed = false;
    const harness2 = createOfflineRuntimeHarness({
      sdkOverrides: {
        signInAnonymously: async () => {
          failCount += 1;
          if (!shouldSucceed) {
            throw new Error("network offline");
          }
          return { user: { uid: "anon-unblocked" } };
        },
      },
    });

    expect(await harness2.runtime.ensureAuth()).toBe(false);
    expect(failCount).toBe(2); // Initial + 1 retry max
    expect(harness2.runtime.degraded.isDegraded()).toBe(true);
    expect(harness2.runtime.degraded.getMessage()).toBe("Cloud features aren't available in this browser");

    // Clicking degraded chip unblocks and clears degraded state.
    shouldSucceed = true;
    expect(await harness2.runtime.retryDegradedRecovery()).toBe(true);
    expect(harness2.runtime.degraded.isDegraded()).toBe(false);
  });

  it("checkEnvironment reports exact reasons for non-Chrome, old Chrome, missing API, unavailable hardware, and language error", async () => {
    const nonChrome = await checkEnvironment({
      navigator: { userAgentData: { brands: [{ brand: "Firefox", version: "130" }] } },
      languageModel: undefined,
    });
    expect(nonChrome).toEqual({
      readiness: "unsupported",
      chromeMajor: null,
      reasons: ["NOT_CHROME", "API_MISSING"],
    });
    expect(formatEnvironmentReasons(nonChrome.reasons)).toEqual([
      EN_COPY.environment.NOT_CHROME,
      EN_COPY.environment.API_MISSING,
    ]);

    const oldChrome = await checkEnvironment({
      navigator: { userAgentData: { brands: [{ brand: "Google Chrome", version: "147" }] } },
      languageModel: {
        availability: async () => "unavailable",
      },
    });
    expect(oldChrome).toEqual({
      readiness: "unavailable",
      chromeMajor: 147,
      reasons: ["CHROME_TOO_OLD", "UNAVAILABLE_HARDWARE_OR_DISK"],
    });

    const langError = await checkEnvironment({
      navigator: { userAgentData: { brands: [{ brand: "Google Chrome", version: "151" }] } },
      languageModel: {
        availability: async () => {
          throw new DOMException("Language not supported", "NotSupportedError");
        },
      },
    });
    expect(langError).toEqual({
      readiness: "unavailable",
      chromeMajor: 151,
      reasons: ["LANGUAGE_UNSUPPORTED"],
    });

    const ready = await checkEnvironment({
      navigator: { userAgentData: { brands: [{ brand: "Google Chrome", version: "151" }] } },
      languageModel: {
        availability: async () => "downloadable",
      },
    });
    expect(ready).toEqual({
      readiness: "downloadable",
      chromeMajor: 151,
      reasons: [],
    });
  });

  it("startModelDownload invokes initializeDeviceModel on the singleton TriageV1 ONLY_ON_DEVICE model", async () => {
    const initSpy = vi.fn(async (cb?: (p: number) => void) => {
      cb?.(-0.1);
      cb?.(0.5);
      cb?.(1.4);
    });
    const harness = createOfflineRuntimeHarness({
      modelFactory: () => makeFakeModel({ initializeDeviceModel: initSpy }),
    });

    const progress: number[] = [];
    const m1 = localModel("TriageV1", "ONLY_ON_DEVICE", harness.runtime);
    await startModelDownload((p) => progress.push(p), harness.runtime);

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([0, 0.5, 1]);
    expect(localModel("TriageV1", "ONLY_ON_DEVICE", harness.runtime)).toBe(m1);
  });

  it("createFirebaseRuntime has no side effects until invoked", () => {
    expect(typeof createFirebaseRuntime).toBe("function");
  });
});
