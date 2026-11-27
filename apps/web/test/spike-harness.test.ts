import { describe, expect, it } from "vitest";
import {
  createDegradedState,
  createSessionCache,
  createTelemetry,
  type FirebaseRuntime,
} from "@toulmin/firebase-client";
import {
  formatResolutionRow,
  formatSpikeJsonExport,
  formatSpikeMarkdown,
  formatSpikeSuiteMarkdown,
} from "../src/spikes/export.js";
import { SPIKE_REGISTRY, runSpike } from "../src/spikes/registry.js";
import { createSpikeRuntimeContext } from "../src/spikes/runtime.js";
import { computeWebL1DeadlineMs } from "../src/spikes/stats.js";
import type { Phase0SpikeId } from "../src/spikes/types.js";

const EXPECTED_PHASE0_IDS: readonly Phase0SpikeId[] = [
  "S-W1",
  "S-W2",
  "S-W3",
  "S-W4",
  "S-W5",
  "S-W6",
  "S-W7",
  "S-W9",
  "S-W10",
  "S-L2",
  "S-RP",
  "S-SC",
  "S-N4",
  "BE-1",
  "BE-2",
  "BE-3",
  "BE-4",
];

function createMockRuntime(handlers: {
  readonly promptResponse: (
    userPrompt: string,
    modelParams?: Record<string, unknown>
  ) => {
    rawText: string;
    inferenceSource?: "ON_DEVICE" | "IN_CLOUD" | "NONE";
    groundingMetadata?: Record<string, unknown>;
    finishReason?: string;
    chunks?: readonly string[];
    delayMs?: number;
    onChunk?: () => void;
    throwError?: Error;
    keepPendingBeforeSettle?: boolean;
  };
  readonly isJudge?: boolean;
}): FirebaseRuntime {
  return {
    config: {
      firebaseConfig: {
        apiKey: "mock-public-key",
        authDomain: "toulmin.web.app",
        projectId: "toulmin-staging",
        storageBucket: "toulmin-staging.firebasestorage.app",
        messagingSenderId: "123",
        appId: "1:123:web:abc",
      },
      recaptchaEnterpriseSiteKey: "mock-site-key",
      functionsRegion: "us-central1",
    },
    app: {} as FirebaseRuntime["app"],
    appCheck: {} as FirebaseRuntime["appCheck"],
    auth: { currentUser: { uid: "spike-uid" } } as FirebaseRuntime["auth"],
    ai: {} as FirebaseRuntime["ai"],
    rc: {} as FirebaseRuntime["rc"],
    rcReader: {
      getString: (k) => (k === "cloud_model" ? "gemini-3.8-flash" : ""),
      getNumber: (k) => (k === "l1_settle_ceiling_ms" ? 120_000 : 0),
      getBoolean: () => false,
    },
    functions: {} as FirebaseRuntime["functions"],
    telemetry: createTelemetry(),
    degraded: createDegradedState(),
    sessionCache: createSessionCache(),
    modelRegistry: new Map(),
    sdk: {
      initializeApp: () => ({} as FirebaseRuntime["app"]),
      initializeAppCheck: () => ({} as NonNullable<FirebaseRuntime["appCheck"]>),
      getAuth: () => ({} as FirebaseRuntime["auth"]),
      signInAnonymously: async () => undefined,
      getIdToken: async () => "tok",
      getIdTokenResult: async () => ({ claims: {} }),
      getAI: () => ({} as FirebaseRuntime["ai"]),
      getGenerativeModel: (_ai: unknown, modelParams?: unknown) => {
        const mp = (modelParams ?? {}) as Record<string, unknown>;
        return {
          initializeDeviceModel: async (cb?: (p: number) => void) => {
            cb?.(0.5);
            cb?.(1);
          },
          generateContentStream: async (prompt: string) => {
            const out = handlers.promptResponse(prompt, mp);
            if (out.throwError) {
              throw out.throwError;
            }
            const chunkList = out.chunks ?? [out.rawText];
            return {
              stream: (async function* () {
                for (const c of chunkList) {
                  if (out.delayMs && out.delayMs > 0) {
                    await new Promise((r) => setTimeout(r, out.delayMs));
                  }
                  out.onChunk?.();
                  yield { text: () => c };
                }
              })(),
              response: (async () => {
                if (out.keepPendingBeforeSettle) {
                  await new Promise((r) => setTimeout(r, 15));
                }
                return {
                  inferenceSource: out.inferenceSource ?? "ON_DEVICE",
                  text: () => out.rawText,
                  usageMetadata: {
                    promptTokenCount: 180,
                    thoughtsTokenCount: 24,
                    candidatesTokenCount: 80,
                    totalTokenCount: 284,
                  },
                  candidates: [
                    {
                      finishReason: out.finishReason ?? "STOP",
                      ...(out.groundingMetadata ? { groundingMetadata: out.groundingMetadata } : {}),
                    },
                  ],
                };
              })(),
            };
          },
          generateContent: async (prompt: string) => {
            const out = handlers.promptResponse(prompt, mp);
            if (out.throwError) {
              throw out.throwError;
            }
            if (out.keepPendingBeforeSettle || (out.delayMs && out.delayMs > 0)) {
              await new Promise((r) => setTimeout(r, out.delayMs ?? 15));
            }
            return {
              response: {
                inferenceSource: out.inferenceSource ?? "IN_CLOUD",
                text: () => out.rawText,
                usageMetadata: {
                  promptTokenCount: 180,
                  thoughtsTokenCount: 24,
                  candidatesTokenCount: 80,
                  totalTokenCount: 284,
                },
                candidates: [
                  {
                    finishReason: out.finishReason ?? "STOP",
                    ...(out.groundingMetadata ? { groundingMetadata: out.groundingMetadata } : {}),
                  },
                ],
              },
            };
          },
        } as never;
      },
      getRemoteConfig: () => ({} as FirebaseRuntime["rc"]),
      fetchAndActivate: async () => true,
      getRcString: () => "",
      getRcNumber: () => 0,
      getRcBoolean: () => false,
      getFunctions: () => ({} as FirebaseRuntime["functions"]),
    },
    ensureAuth: async () => true,
    retryDegradedRecovery: async () => true,
    refreshIdToken: async () => "tok",
    isJudge: async () => Boolean(handlers.isJudge),
    dispose: () => undefined,
  };
}

describe("Phase 0 Web & Backend spike harness orchestration & offline contract checks (07 §1.2–1.7)", () => {
  it("registers all 17 expected Phase 0 Web and Backend spikes", () => {
    const registeredIds = SPIKE_REGISTRY.map((s) => s.spikeId).sort();
    expect(registeredIds).toEqual([...EXPECTED_PHASE0_IDS].sort());
  });

  it("degrades cleanly to status='UNAVAILABLE' when browser Prompt API or Firebase config is absent", async () => {
    const ctx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      host: {
        navigatorLike: { platform: "node", userAgent: "vitest", onLine: false },
      },
      injectedFirebaseRuntime: null,
      envReportOverride: async () => ({
        readiness: "unsupported",
        chromeMajor: null,
        reasons: ["NOT_CHROME", "API_MISSING"],
      }),
    });

    const sw1 = await runSpike("S-W1", ctx);
    expect(sw1.status).toBe("UNAVAILABLE");
    expect(sw1.primaryRecommended).toBe(false);
    expect(sw1.missingPrerequisites.length).toBeGreaterThan(0);

    const sl2 = await runSpike("S-L2", ctx);
    expect(sl2.status).toBe("UNAVAILABLE");

    const be2 = await runSpike("BE-2", ctx);
    expect(be2.status).toBe("UNAVAILABLE");

    const sw6 = await runSpike("S-W6", ctx);
    expect(sw6.status).toBe("UNAVAILABLE");
    expect(sw6.missingPrerequisites.length).toBeGreaterThan(0);
    expect(sw6.metrics["blobIframeCreated"]).toBe(true);
  });

  it("runs real pdfjs-dist S-W5 against 3 synthetic hidden-text PDFs (1 pt, white fill, render mode 3)", async () => {
    const ctx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      envReportOverride: async () => ({
        readiness: "available",
        chromeMajor: 151,
        reasons: [],
      }),
    });

    const res = await runSpike("S-W5", ctx);
    expect(res.status).toBe("PASS");
    expect(res.primaryRecommended).toBe(true);
    expect(res.metrics["droppedAllThree"]).toBe(true);
    expect(res.metrics["operatorApiExposed"]).toBe(true);
  });

  it("executes full L1 (S-W2, S-W3, S-W4, S-W10) and L2 (S-L2) contract spikes and rejects weak/incomplete signals", async () => {
    expect(computeWebL1DeadlineMs([800, 1200, 1500])).toBe(20_000);
    expect(computeWebL1DeadlineMs([12_000])).toBe(24_000);

    // 1. Negative check: S-W10 MUST FAIL & keep ON_SETTLE when fast normal mock never triggers early stops/SDK errors
    let naiveTick = 1_000;
    const naiveRt = createMockRuntime({
      promptResponse: (prompt) => {
        naiveTick += 5;
        if (prompt.includes("s1_what")) {
          return {
            inferenceSource: "ON_DEVICE",
            rawText: JSON.stringify({
              s1_what: "A is enrolled patients and B is follow-up patients",
              s2_same_population: true,
              s3_verdict: "INCONSISTENT",
            }),
          };
        }
        if (prompt.includes("s1_atoms")) {
          const uncited = prompt.includes("HAS_CITATION: false");
          return {
            inferenceSource: "ON_DEVICE",
            rawText: JSON.stringify({
              s1_atoms: [{ a1_start: 0, a2_end: 3, a3_type: "CAUSAL" }],
              s2_worth: "HIGH",
              s3_uncited: uncited,
              s4_bib: uncited ? [] : [0],
            }),
          };
        }
        return {
          inferenceSource: "ON_DEVICE",
          rawText: JSON.stringify({
            s01_evidence_span: "Drug X reduced 30-day mortality",
            s02_evidence_idx: 0,
            s03_micro_reasoning: "Evidence matches claim directly.",
            s04_verdict: "SUPPORTED",
          }),
        };
      },
    });
    const naiveCtx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      host: {
        nowMs: () => naiveTick,
        nowPerfMs: () => naiveTick,
        languageModel: { availability: async () => "available" },
      },
      injectedFirebaseRuntime: naiveRt,
      envReportOverride: async () => ({ readiness: "available", chromeMajor: 151, reasons: [] }),
    });
    const naiveSw10 = await runSpike("S-W10", naiveCtx, { maxIterations: 1 });
    expect(naiveSw10.status).toBe("FAIL");
    expect(naiveSw10.primaryRecommended).toBe(false);
    expect(naiveSw10.metrics["recommendedSlotRelease"]).toBe("ON_SETTLE");

    // 2. Negative check: S-L2 MUST FAIL & recommend TEXT_JSON when only 1/4 (25%) grounded calls have search metadata
    let sl2CallNum = 0;
    const partialGroundRt = createMockRuntime({
      promptResponse: (prompt) => {
        if (prompt.includes("s1_source_identified")) {
          sl2CallNum += 1;
          const includeSearch = sl2CallNum === 1;
          return {
            inferenceSource: "IN_CLOUD",
            rawText: JSON.stringify({
              s1_source_identified: "CITED_DOI_MATCHED",
              s2_quote: "Results: 30-day mortality was 14% vs 15%.",
              s3_quote_origin: "PROVIDED_EVIDENCE",
              s4_reasoning: "Trial found 15% mortality.",
              s5_verdict: "CONTRADICTED",
              s6_alternatives: [],
            }),
            ...(includeSearch
              ? {
                  groundingMetadata: {
                    searchEntryPoint: { renderedContent: "<div>Search Suggestions</div>" },
                    groundingChunks: [{ web: { uri: "https://doi.org/10.1000/sl2", title: "Trial" } }],
                    webSearchQueries: ["Drug X mortality"],
                  },
                }
              : {}),
          };
        }
        return { inferenceSource: "IN_CLOUD", rawText: "{}" };
      },
    });
    const partialSl2Ctx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      injectedFirebaseRuntime: partialGroundRt,
      envReportOverride: async () => ({ readiness: "available", chromeMajor: 151, reasons: [] }),
    });
    const weakSl2 = await runSpike("S-L2", partialSl2Ctx, { maxIterations: 2 });
    expect(weakSl2.status).toBe("FAIL");
    expect(weakSl2.primaryRecommended).toBe(false);
    expect(weakSl2.metrics["recommendedL2Mode"]).toBe("TEXT_JSON");

    // 3. Positive contract check: complete S-W2, S-W3, S-W4, S-W10 (real early stops), and S-L2 (>=90% grounded)
    let tick = 1_000;
    const mockRt = createMockRuntime({
      promptResponse: (prompt, mp) => {
        tick += 20;
        const onDev = (mp?.["onDeviceParams"] as Record<string, unknown> | undefined)?.[
          "promptOptions"
        ] as Record<string, unknown> | undefined;
        const constraint = onDev?.["responseConstraint"] as Record<string, unknown> | undefined;
        if (constraint?.["type"] === "invalid_sw10_schema_type") {
          return {
            rawText: "",
            throwError: new Error("Invalid schema responseConstraint"),
          };
        }
        if (prompt.includes("SW10_RUNAWAY")) {
          const runawayChunk = "Drug X trial mortality cohort ".repeat(40);
          return {
            inferenceSource: "ON_DEVICE",
            rawText: runawayChunk,
            chunks: [runawayChunk, runawayChunk],
            keepPendingBeforeSettle: true,
          };
        }
        if (prompt.includes("s1_source_identified")) {
          return {
            inferenceSource: "IN_CLOUD",
            rawText: JSON.stringify({
              s1_source_identified: "CITED_DOI_MATCHED",
              s2_quote: "Results: 30-day mortality was 14% in the placebo group and 15% with Drug X.",
              s3_quote_origin: "PROVIDED_EVIDENCE",
              s4_reasoning: "Trial found 15% vs claimed 9% mortality.",
              s5_verdict: "CONTRADICTED",
              s6_alternatives: [],
            }),
            groundingMetadata: {
              searchEntryPoint: { renderedContent: "<div>Search Suggestions</div>" },
              groundingChunks: [{ web: { uri: "https://doi.org/10.1000/sl2-probe", title: "Trial" } }],
              webSearchQueries: ["Drug X acute care mortality"],
            },
          };
        }
        if (prompt.includes("s1_what")) {
          return {
            inferenceSource: "ON_DEVICE",
            rawText: JSON.stringify({
              s1_what: "A is enrolled patients and B is follow-up patients",
              s2_same_population: true,
              s3_verdict: "INCONSISTENT",
            }),
          };
        }
        if (prompt.includes("s1_atoms")) {
          const uncited = prompt.includes("HAS_CITATION: false");
          return {
            inferenceSource: "ON_DEVICE",
            rawText: JSON.stringify({
              s1_atoms: [{ a1_start: 0, a2_end: 3, a3_type: "CAUSAL" }],
              s2_worth: "HIGH",
              s3_uncited: uncited,
              s4_bib: uncited ? [] : [0],
            }),
          };
        }
        return {
          inferenceSource: "ON_DEVICE",
          rawText: JSON.stringify({
            s01_evidence_span: "Drug X reduced 30-day mortality by 25%",
            s02_evidence_idx: 0,
            s03_micro_reasoning: "Evidence matches claim directly.",
            s04_verdict: "SUPPORTED",
          }),
        };
      },
    });

    const ctx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      host: {
        nowMs: () => tick,
        nowPerfMs: () => tick,
        languageModel: {
          availability: async () => "available",
          create: async () => ({
            inputQuota: 9216,
            measureInputUsage: async (_p, opts) => (opts?.["omitResponseConstraintInput"] ? 310 : 520),
            destroy: () => undefined,
          }),
        },
        navigatorLike: {
          platform: "Win32",
          userAgent: "Chrome/151",
          onLine: true,
          userAgentData: { brands: [{ brand: "Google Chrome", version: "151" }] },
        },
      },
      injectedFirebaseRuntime: mockRt,
      envReportOverride: async () => ({
        readiness: "available",
        chromeMajor: 151,
        reasons: [],
      }),
    });

    const sw2 = await runSpike("S-W2", ctx, { maxIterations: 3 });
    expect(sw2.status).toBe("PASS");
    expect(sw2.metrics["orderedCount"]).toBe(3);

    const sw3 = await runSpike("S-W3", ctx, { maxIterations: 2 });
    expect(sw3.status).toBe("PASS");
    expect(sw3.metrics["inputQuota"]).toBe(9216);
    expect(sw3.metrics["promptsMeasuredTotal"]).toBe(6);
    expect(sw3.metrics["omitOptionForwarded"]).toBe(true);

    const sw4 = await runSpike("S-W4", ctx, { maxIterations: 2 });
    expect(sw4.status).toBe("PASS");
    expect(sw4.metrics["VerdictV1_deadline_ms"]).toBeGreaterThanOrEqual(20_000);
    expect(typeof sw4.metrics["tPrefillMedianMs"]).toBe("number");

    const sw10 = await runSpike("S-W10", ctx, { maxIterations: 1 });
    expect(sw10.status).toBe("PASS");
    expect(sw10.metrics["cStreamObserved"]).toBe(1);
    expect(sw10.metrics["cAbandonObserved"]).toBe(1);
    expect(sw10.metrics["eCutObserved"]).toBe(1);
    expect(sw10.metrics["eErrorObserved"]).toBe(1);
    expect(sw10.metrics["recommendedSlotRelease"]).toBe("IMMEDIATE");

    const sl2 = await runSpike("S-L2", ctx, { maxIterations: 5 });
    expect(sl2.status).toBe("PASS");
    expect(sl2.metrics["totalGroundedCalls"]).toBe(10);
    expect(sl2.metrics["providedCalls"]).toBe(10);
    expect(sl2.metrics["totalGroundedWithSearch"]).toBe(10);
    expect(sl2.metrics["totalPromptTokens"]).toBeGreaterThan(0);
    expect(sl2.metrics["totalThoughtsTokens"]).toBeGreaterThan(0);
    expect(sl2.metrics["totalTokens"]).toBeGreaterThan(0);
    expect(sl2.metrics["totalWebSearchQueries"]).toBeGreaterThan(0);
    expect(sl2.metrics["recommendedL2Mode"]).toBe("SCHEMA");
    expect(sl2.metrics["recommendedMaxOutputTokens"]).toBe(2048);

    // Verify S-W10 rejects IMMEDIATE without contaminating maxSettleMs when subsequent TriageV1 is slow
    let wallMs = 5_000;
    const slowTriageRt = createMockRuntime({
      promptResponse: (prompt, mp) => {
        const onDev = (mp?.["onDeviceParams"] as Record<string, unknown> | undefined)?.[
          "promptOptions"
        ] as Record<string, unknown> | undefined;
        const constraint = onDev?.["responseConstraint"] as Record<string, unknown> | undefined;
        if (constraint?.["type"] === "invalid_sw10_schema_type") {
          return { rawText: "", throwError: new Error("Invalid schema") };
        }
        if (prompt.includes("SW10_RUNAWAY")) {
          const chunk = "Drug X trial mortality cohort ".repeat(40);
          return {
            inferenceSource: "ON_DEVICE",
            rawText: chunk,
            chunks: [chunk, chunk],
            keepPendingBeforeSettle: true,
          };
        }
        if (prompt.includes("s1_what")) {
          return {
            inferenceSource: "ON_DEVICE",
            rawText: JSON.stringify({
              s1_what: "A vs B",
              s2_same_population: true,
              s3_verdict: "INCONSISTENT",
            }),
          };
        }
        if (prompt.includes("s1_atoms")) {
          return {
            inferenceSource: "ON_DEVICE",
            delayMs: 35,
            onChunk: () => {
              wallMs += 1500;
            },
            rawText: JSON.stringify({
              s1_atoms: [{ a1_start: 0, a2_end: 3, a3_type: "CAUSAL" }],
              s2_worth: "HIGH",
              s3_uncited: true,
              s4_bib: [],
            }),
          };
        }
        return {
          inferenceSource: "ON_DEVICE",
          rawText: JSON.stringify({
            s01_evidence_span: "Drug X reduced mortality",
            s02_evidence_idx: 0,
            s03_micro_reasoning: "Supported.",
            s04_verdict: "SUPPORTED",
          }),
        };
      },
    });
    const slowTriageCtx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      host: {
        nowMs: () => wallMs,
        nowPerfMs: () => wallMs,
        languageModel: { availability: async () => "available" },
      },
      injectedFirebaseRuntime: slowTriageRt,
      envReportOverride: async () => ({ readiness: "available", chromeMajor: 151, reasons: [] }),
    });
    const sw10SlowTriage = await runSpike("S-W10", slowTriageCtx, { maxIterations: 1 });
    expect(sw10SlowTriage.metrics["recommendedSlotRelease"]).toBe("ON_SETTLE");
    expect(Number(sw10SlowTriage.metrics["maxSettleMs"])).toBeLessThan(500);

    // Exporters stamp clear MOCKED_CONTRACT_TEST warning for offline runs
    const md = formatSpikeMarkdown(sw2);
    expect(md).toContain("MOCKED_CONTRACT_TEST");
    expect(formatResolutionRow(sw2)).toContain("S-W2");
    expect(formatSpikeSuiteMarkdown([sw2, sl2])).toContain("## RESOLUTION.md Candidate Rows");
    expect(JSON.parse(formatSpikeJsonExport([sw2])).warning).toContain("MOCKED_CONTRACT_TEST");
  });

  it("enforces S-W1 HybridParams placement + semantic check and separates S-L2 thinking/MAX_TOKENS fallbacks", async () => {
    // 1. Verify S-W1 passes systemInstruction via inCloudParams & onDeviceParams.createOptions.initialPrompts (never top-level)
    const capturedModelParams: Array<Record<string, unknown>> = [];
    const baseSw1Rt = createMockRuntime({
      promptResponse: (prompt) => ({
        inferenceSource: "ON_DEVICE",
        rawText: JSON.stringify({
          s1_atoms: [{ a1_start: 0, a2_end: 3, a3_type: "CAUSAL" }],
          s2_worth: "HIGH",
          s3_uncited: prompt.includes("HAS_CITATION: false"),
          s4_bib: prompt.includes("HAS_CITATION: false") ? [] : [0],
        }),
      }),
    });
    const origGetModel = baseSw1Rt.sdk.getGenerativeModel;
    const wrappedSw1Rt: FirebaseRuntime = {
      ...baseSw1Rt,
      sdk: {
        ...baseSw1Rt.sdk,
        getGenerativeModel: (ai, params) => {
          capturedModelParams.push(params as unknown as Record<string, unknown>);
          return origGetModel(ai, params);
        },
      },
    };
    const sw1Ctx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      host: {
        languageModel: { availability: async () => "available" },
      },
      injectedFirebaseRuntime: wrappedSw1Rt,
      envReportOverride: async () => ({ readiness: "available", chromeMajor: 151, reasons: [] }),
    });
    const sw1Res = await runSpike("S-W1", sw1Ctx, { maxIterations: 2 });
    expect(sw1Res.status).toBe("PASS");
    expect(sw1Res.metrics["systemInstructionHonouredCount"]).toBe(2);
    const sysParamCall = capturedModelParams.find(
      (p) => (p["inCloudParams"] as Record<string, unknown> | undefined)?.["systemInstruction"] !== undefined
    );
    expect(sysParamCall).toBeDefined();
    expect(sysParamCall!["systemInstruction"]).toBeUndefined();
    const onDevCreate = (sysParamCall!["onDeviceParams"] as Record<string, unknown>)["createOptions"] as {
      initialPrompts?: Array<{ role: string; content: string }>;
    };
    expect(onDevCreate.initialPrompts?.[0]?.role).toBe("system");

    // 2. S-L2 when thinkingLevel="LOW" is rejected: omits thinkingConfig & keeps SCHEMA mode (not TEXT_JSON)
    const lowRejectRt = createMockRuntime({
      promptResponse: (_prompt, mp) => {
        const inCloud = mp?.["inCloudParams"] as Record<string, unknown> | undefined;
        const genCfg = inCloud?.["generationConfig"] as Record<string, unknown> | undefined;
        if ((genCfg?.["thinkingConfig"] as { thinkingLevel?: string } | undefined)?.thinkingLevel === "LOW") {
          return { rawText: "", throwError: new Error("thinkingLevel LOW not supported") };
        }
        const isGrounded = Array.isArray(inCloud?.["tools"]);
        return {
          inferenceSource: "IN_CLOUD",
          rawText: JSON.stringify({
            s1_source_identified: "CITED_DOI_MATCHED",
            s2_quote: "Trial finding observed.",
            s3_quote_origin: isGrounded ? "WEB_SOURCE" : "PROVIDED_EVIDENCE",
            s4_reasoning: "Matches published abstract.",
            s5_verdict: "SUPPORTED",
            s6_alternatives: [],
          }),
          ...(isGrounded
            ? {
                groundingMetadata: {
                  searchEntryPoint: { renderedContent: "<div>Search</div>" },
                  groundingChunks: [{ web: { uri: "https://doi.org/10.1056/NEJMoa2021436", title: "Trial" } }],
                  webSearchQueries: ["trial recovery"],
                },
              }
            : {}),
        };
      },
    });
    const lowRejectCtx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      injectedFirebaseRuntime: lowRejectRt,
      envReportOverride: async () => ({ readiness: "available", chromeMajor: 151, reasons: [] }),
    });
    const lowRejectRes = await runSpike("S-L2", lowRejectCtx, { maxIterations: 2 });
    expect(lowRejectRes.status).toBe("PASS");
    expect(lowRejectRes.metrics["thinkingRejected"]).toBe(true);
    expect(lowRejectRes.metrics["recommendedThinking"]).toBe("OMIT");
    expect(lowRejectRes.metrics["recommendedL2Mode"]).toBe("SCHEMA");

    // 3. S-L2 when MAX_TOKENS occurs: recommends maxOutputTokens=4096 while preserving SCHEMA mode
    let maxTokCallIdx = 0;
    const maxTokRt = createMockRuntime({
      promptResponse: (_prompt, mp) => {
        maxTokCallIdx += 1;
        const inCloud = mp?.["inCloudParams"] as Record<string, unknown> | undefined;
        const isGrounded = Array.isArray(inCloud?.["tools"]);
        return {
          inferenceSource: "IN_CLOUD",
          finishReason: maxTokCallIdx === 1 ? "MAX_TOKENS" : "STOP",
          rawText: JSON.stringify({
            s1_source_identified: "CITED_DOI_MATCHED",
            s2_quote: "Trial finding observed.",
            s3_quote_origin: isGrounded ? "WEB_SOURCE" : "PROVIDED_EVIDENCE",
            s4_reasoning: "Matches published abstract.",
            s5_verdict: "SUPPORTED",
            s6_alternatives: [],
          }),
          ...(isGrounded
            ? {
                groundingMetadata: {
                  searchEntryPoint: { renderedContent: "<div>Search</div>" },
                  groundingChunks: [{ web: { uri: "https://doi.org/10.1056/NEJMoa2021436", title: "Trial" } }],
                  webSearchQueries: ["trial recovery"],
                },
              }
            : {}),
        };
      },
    });
    const maxTokCtx = createSpikeRuntimeContext({
      executionMode: "MOCKED_CONTRACT_TEST",
      injectedFirebaseRuntime: maxTokRt,
      envReportOverride: async () => ({ readiness: "available", chromeMajor: 151, reasons: [] }),
    });
    const maxTokRes = await runSpike("S-L2", maxTokCtx, { maxIterations: 2 });
    expect(maxTokRes.status).toBe("FAIL");
    expect(maxTokRes.metrics["anyMaxTokens"]).toBe(true);
    expect(maxTokRes.metrics["recommendedMaxOutputTokens"]).toBe(4096);
    expect(maxTokRes.metrics["recommendedL2Mode"]).toBe("SCHEMA");
  });
});
