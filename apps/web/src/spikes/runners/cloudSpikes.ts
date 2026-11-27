/**
 * Cloud L2, AltSources (`PREFER_IN_CLOUD`), Replay Protection, and Spend Cap / Quota
 * spikes (`S-W9`, `S-L2`, `S-RP`, `S-SC`) routed strictly through `@toulmin/firebase-client`.
 */

import { EN_COPY } from "@toulmin/copy";
import { sha256hex } from "@toulmin/core-l0";
import {
  adjudicateClaimL2,
  callQuotaGuard,
  findAlternativeSources,
  l2Adjudicate,
  l2AdjudicateProvided,
} from "@toulmin/firebase-client";
import { median, percentile, round2 } from "../stats.js";
import { buildSpikeResultRecord } from "../runtime.js";
import type {
  SpikeDefinition,
  SpikeManualStepItem,
  SpikeRunOptions,
  SpikeRunRecord,
  SpikeRuntimeContext,
} from "../types.js";

function missingCloudRecord(
  def: SpikeDefinition,
  ctx: SpikeRuntimeContext,
  startedAtMs: number,
  envMeta: Awaited<ReturnType<SpikeRuntimeContext["inspectEnvironment"]>>
): SpikeRunRecord {
  return buildSpikeResultRecord({
    def,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: "UNAVAILABLE",
    primaryRecommended: false,
    summary: `${def.spikeId} cannot run: Firebase runtime config / App Check site key unavailable (${envMeta.capabilities.missingCloudFields.join(", ") || "FirebaseRuntime missing"}).`,
    missingPrerequisites:
      envMeta.capabilities.missingCloudFields.length > 0
        ? envMeta.capabilities.missingCloudFields
        : ["FirebaseRuntime"],
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runSW9(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  if (!rt) {
    return missingCloudRecord(S_W9_DEF, ctx, startedAtMs, envMeta);
  }

  const onlineMode = options?.onlineOverride ?? ctx.host.navigatorLike.onLine ?? true;
  const authOk = onlineMode ? await rt.ensureAuth() : true;
  if (onlineMode && !authOk) {
    return buildSpikeResultRecord({
      def: S_W9_DEF,
      executionMode: ctx.executionMode,
      environment: envMeta,
      status: "UNAVAILABLE",
      primaryRecommended: false,
      summary: "S-W9 online check unavailable: ensureAuth() entered degraded mode.",
      missingPrerequisites: ["Anonymous Firebase Auth"],
      startedAtMs,
      finishedAtMs: ctx.host.nowMs(),
    });
  }

  const callsCount = options?.maxIterations ?? 10;
  let successCount = 0;
  const samples: Array<Record<string, unknown>> = [];

  for (let i = 0; i < callsCount; i += 1) {
    const out = await findAlternativeSources(
      {
        approvedClaimText: "Statins reduce major vascular events by 21% per 1 mmol/L LDL reduction.",
        library: [
          { title: "Cholesterol Treatment Trialists Collaboration meta-analysis", year: 2019 },
        ],
        confidential: false,
        online: onlineMode,
      },
      { runtime: rt }
    );
    if (out.ok) successCount += 1;
    samples.push({
      run: i + 1,
      online: onlineMode,
      ok: out.ok,
      inferenceSource: out.inferenceSource,
      error: out.error ?? null,
    });
  }

  const expectedSource = onlineMode ? "IN_CLOUD" : "ON_DEVICE";
  const matchingSource = samples.filter((s) => s["inferenceSource"] === expectedSource).length;
  const passed = successCount === callsCount && matchingSource === callsCount;

  return buildSpikeResultRecord({
    def: S_W9_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: passed ? "PASS" : "FAIL",
    primaryRecommended: passed,
    summary: `S-W9 (${onlineMode ? "online" : "offline"}) ${successCount}/${callsCount} valid AltSourcesV1 responses (matching ${expectedSource}: ${matchingSource}).`,
    metrics: {
      onlineMode,
      successCount,
      matchingSourceCount: matchingSource,
      totalCalls: callsCount,
    },
    rawSamples: samples,
    telemetrySnapshot: rt.telemetry.snapshot(),
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

interface Sl2CaseFixture {
  readonly claim: string;
  readonly doi: string;
  readonly title: string;
  readonly firstAuthor: string;
  readonly year: number;
  readonly venue: string;
  readonly providedEvidence: string;
}

const SL2_DEV_CASES: readonly Sl2CaseFixture[] = [
  {
    claim: "In the RECOVERY trial, dexamethasone lowered 28-day mortality among patients receiving invasive mechanical ventilation compared with usual care.",
    doi: "10.1056/NEJMoa2021436",
    title: "Dexamethasone in Hospitalized Patients with Covid-19",
    firstAuthor: "Horby",
    year: 2021,
    venue: "NEJM",
    providedEvidence: "Among patients receiving invasive mechanical ventilation, 28-day mortality was 29.3% with dexamethasone versus 41.4% with usual care (rate ratio 0.64).",
  },
  {
    claim: "In the SPRINT trial, intensive systolic blood-pressure targeting (<120 mm Hg) reduced the primary composite cardiovascular outcome compared with standard targeting (<140 mm Hg).",
    doi: "10.1056/NEJMoa1511939",
    title: "A Randomized Trial of Intensive versus Standard Blood-Pressure Control",
    firstAuthor: "Wright",
    year: 2015,
    venue: "NEJM",
    providedEvidence: "Intensive treatment (<120 mm Hg) yielded a lower rate of the primary composite cardiovascular outcome than standard treatment (1.65% vs 2.19% per year; HR 0.75).",
  },
  {
    claim: "In EMPA-REG OUTCOME, empagliflozin significantly increased cardiovascular mortality in patients with type 2 diabetes at high cardiovascular risk.",
    doi: "10.1056/NEJMoa1504720",
    title: "Empagliflozin, Cardiovascular Outcomes, and Mortality in Type 2 Diabetes",
    firstAuthor: "Zinman",
    year: 2015,
    venue: "NEJM",
    providedEvidence: "Death from cardiovascular causes occurred in 3.7% of patients in the empagliflozin group versus 5.9% in the placebo group (HR 0.62).",
  },
  {
    claim: "In DAPA-HF, dapagliflozin lowered the risk of worsening heart failure or cardiovascular death among patients with HFrEF regardless of diabetes status.",
    doi: "10.1056/NEJMoa1911303",
    title: "Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction",
    firstAuthor: "McMurray",
    year: 2019,
    venue: "NEJM",
    providedEvidence: "The primary outcome of worsening heart failure or cardiovascular death occurred in 16.3% with dapagliflozin versus 21.2% with placebo (HR 0.74), including patients without diabetes.",
  },
  {
    claim: "In the FOURIER trial, evolocumab added to statin therapy reduced LDL cholesterol and the composite of cardiovascular events.",
    doi: "10.1056/NEJMoa1615664",
    title: "Evolocumab and Clinical Outcomes in Patients with Cardiovascular Disease",
    firstAuthor: "Sabatine",
    year: 2017,
    venue: "NEJM",
    providedEvidence: "Evolocumab lowered LDL cholesterol by 59% and reduced the primary composite endpoint (9.8% vs 11.3%; HR 0.85).",
  },
  {
    claim: "In CANTOS, canakinumab 150 mg every 3 months led to a lower rate of recurrent cardiovascular events than placebo without lowering lipid levels.",
    doi: "10.1056/NEJMoa1707914",
    title: "Antiinflammatory Therapy with Canakinumab for Atherosclerotic Disease",
    firstAuthor: "Ridker",
    year: 2017,
    venue: "NEJM",
    providedEvidence: "Canakinumab at 150 mg every 3 months yielded a 15% reduction in the primary cardiovascular endpoint (HR 0.85) independent of lipid-level lowering.",
  },
  {
    claim: "In COMPASS, low-dose rivaroxaban plus aspirin increased all-cause stroke rates compared with aspirin alone.",
    doi: "10.1056/NEJMoa1709118",
    title: "Rivaroxaban with or without Aspirin in Stable Cardiovascular Disease",
    firstAuthor: "Eikelboom",
    year: 2017,
    venue: "NEJM",
    providedEvidence: "Rivaroxaban 2.5 mg twice daily plus aspirin lowered both the primary outcome (4.1% vs 5.4%; HR 0.76) and stroke events compared with aspirin alone.",
  },
  {
    claim: "In PARADIGM-HF, sacubitril-valsartan reduced death from cardiovascular causes or hospitalization for heart failure compared with enalapril.",
    doi: "10.1056/NEJMoa1409077",
    title: "Angiotensin-Neprilysin Inhibition versus Enalapril in Heart Failure",
    firstAuthor: "McMurray",
    year: 2014,
    venue: "NEJM",
    providedEvidence: "The primary outcome occurred in 21.8% of the sacubitril-valsartan group and 26.5% of the enalapril group (HR 0.80).",
  },
  {
    claim: "In the LEADER trial, liraglutide reduced the rate of first occurrence of cardiovascular death, nonfatal MI, or nonfatal stroke among patients with type 2 diabetes.",
    doi: "10.1056/NEJMoa1603827",
    title: "Liraglutide and Cardiovascular Outcomes in Type 2 Diabetes",
    firstAuthor: "Marso",
    year: 2016,
    venue: "NEJM",
    providedEvidence: "The primary composite outcome occurred in 13.0% with liraglutide versus 14.9% with placebo (HR 0.87).",
  },
  {
    claim: "In ASPREE, daily low-dose aspirin significantly prolonged disability-free survival in healthy older adults.",
    doi: "10.1056/NEJMoa1805819",
    title: "Effect of Aspirin on Disability-Free Survival in the Healthy Elderly",
    firstAuthor: "McNeil",
    year: 2018,
    venue: "NEJM",
    providedEvidence: "Aspirin use in healthy older adults did not prolong disability-free survival compared with placebo (HR 1.01) and resulted in higher major hemorrhage rates.",
  },
];

interface CapturedL2Usage {
  readonly promptTokenCount: number;
  readonly thoughtsTokenCount: number;
  readonly candidatesTokenCount: number;
  readonly totalTokenCount: number;
  readonly webSearchQueriesCount: number;
  readonly finishReason: string;
}

function wrapModelUsageCapture(baseModel: ReturnType<typeof l2Adjudicate>): {
  readonly model: ReturnType<typeof l2Adjudicate>;
  readonly getLastUsage: () => CapturedL2Usage;
} {
  let lastUsage: CapturedL2Usage = {
    promptTokenCount: 0,
    thoughtsTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0,
    webSearchQueriesCount: 0,
    finishReason: "UNKNOWN",
  };

  const wrapped = Object.create(baseModel) as ReturnType<typeof l2Adjudicate>;
  (wrapped as { generateContent: typeof baseModel.generateContent }).generateContent = async (
    request
  ) => {
    const res = await baseModel.generateContent(request);
    const meta = (
      res.response as unknown as {
        usageMetadata?: {
          promptTokenCount?: number;
          thoughtsTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      }
    )?.usageMetadata;
    const cand = res.response.candidates?.[0] as
      | {
          finishReason?: string;
          groundingMetadata?: { webSearchQueries?: unknown[] };
        }
      | undefined;

    const promptTokenCount = meta?.promptTokenCount ?? 0;
    const thoughtsTokenCount = meta?.thoughtsTokenCount ?? 0;
    const candidatesTokenCount = meta?.candidatesTokenCount ?? 0;
    const totalTokenCount =
      meta?.totalTokenCount ?? promptTokenCount + thoughtsTokenCount + candidatesTokenCount;

    lastUsage = {
      promptTokenCount,
      thoughtsTokenCount,
      candidatesTokenCount,
      totalTokenCount,
      webSearchQueriesCount: cand?.groundingMetadata?.webSearchQueries?.length ?? 0,
      finishReason: cand?.finishReason ?? "UNKNOWN",
    };
    return res;
  };

  return { model: wrapped, getLastUsage: () => lastUsage };
}

async function runSL2(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  if (!rt) {
    return missingCloudRecord(S_L2_DEF, ctx, startedAtMs, envMeta);
  }

  const authOk = await rt.ensureAuth();
  if (!authOk) {
    return buildSpikeResultRecord({
      def: S_L2_DEF,
      executionMode: ctx.executionMode,
      environment: envMeta,
      status: "UNAVAILABLE",
      primaryRecommended: false,
      summary: "S-L2 unavailable: Firebase anonymous Auth + App Check could not initialize.",
      missingPrerequisites: ["Anonymous Firebase Auth + reCAPTCHA Enterprise App Check"],
      startedAtMs,
      finishedAtMs: ctx.host.nowMs(),
    });
  }

  // `07` §1.3 S-L2: 5 grounded calls with thinkingLevel="LOW", 5 without thinkingConfig (10 grounded),
  // plus 10 l2AdjudicateProvided calls on the exact same claims.
  const lowRuns = options?.maxIterations ?? 5;
  const omittedRuns = options?.maxIterations ?? 5;
  const providedRuns = options?.maxIterations !== undefined ? options.maxIterations * 2 : 10;

  let lowThinkingAccepted = 0;
  let lowValidJson = 0;
  let lowWithGrounding = 0;
  let omittedValidJson = 0;
  let omittedWithGrounding = 0;
  let fallbackNoThinkValidJson = 0;
  let fallbackNoThinkWithGrounding = 0;
  let providedSucceeded = 0;
  let anyMaxTokens = false;

  let totalPromptTokens = 0;
  let totalThoughtsTokens = 0;
  let totalCandidatesTokens = 0;
  let totalTokens = 0;
  let groundedPromptTokens = 0;
  let providedPromptTokens = 0;
  let totalWebSearchQueries = 0;
  const groundedLatencies: number[] = [];
  const providedLatencies: number[] = [];

  const rawSamples: Array<Record<string, unknown>> = [];

  const runOneL2Call = async (
    variantLabel: string,
    caseIdx: number,
    adjudicator: "l2Adjudicate" | "l2AdjudicateProvided",
    baseModel: ReturnType<typeof l2Adjudicate>
  ) => {
    const c = SL2_DEV_CASES[caseIdx % SL2_DEV_CASES.length]!;
    const { model: capturedModel, getLastUsage } = wrapModelUsageCapture(baseModel);
    const eventsBefore = rt.telemetry.snapshot().events.length;
    const t0 = ctx.host.nowPerfMs();
    const res = await adjudicateClaimL2(
      {
        normalizedClaimHash: sha256hex(c.claim),
        approvedClaimText: c.claim,
        refId: `doi:${c.doi}`,
        reference: {
          title: c.title,
          firstAuthor: c.firstAuthor,
          year: c.year,
          venue: c.venue,
          doi: c.doi,
        },
        // `l2Adjudicate` gets empty/insufficient local evidence so Google Search is needed;
        // `l2AdjudicateProvided` gets the full trial abstract sentence without tools.
        evidence: adjudicator === "l2Adjudicate" ? [] : [c.providedEvidence],
        suspicious: false,
        adjudicator,
        ...(adjudicator === "l2Adjudicate" ? { mode: "SCHEMA" as const } : {}),
      },
      { runtime: rt, model: capturedModel }
    );
    const latencyMs = round2(Math.max(0, ctx.host.nowPerfMs() - t0));
    const newEvents = rt.telemetry.snapshot().events.slice(eventsBefore);
    const ev = newEvents[newEvents.length - 1];
    const directUsage = getLastUsage();

    const promptTokenCount = directUsage.promptTokenCount;
    const thoughtsTokenCount = ev?.thoughtsTokenCount ?? directUsage.thoughtsTokenCount;
    const candidatesTokenCount = ev?.candidatesTokenCount ?? directUsage.candidatesTokenCount;
    const callTotalTokens =
      directUsage.totalTokenCount > 0
        ? directUsage.totalTokenCount
        : promptTokenCount + thoughtsTokenCount + candidatesTokenCount;
    const webSearchQueriesCount =
      ev?.webSearchQueriesCount ??
      (directUsage.webSearchQueriesCount > 0
        ? directUsage.webSearchQueriesCount
        : (res.sessionDisplay?.sources.length ?? 0));
    const finishReason = ev?.finishReason ?? directUsage.finishReason;
    if (finishReason === "MAX_TOKENS") {
      anyMaxTokens = true;
    }

    totalPromptTokens += promptTokenCount;
    totalThoughtsTokens += thoughtsTokenCount;
    totalCandidatesTokens += candidatesTokenCount;
    totalTokens += callTotalTokens;
    if (adjudicator === "l2Adjudicate") {
      groundedPromptTokens += promptTokenCount;
    } else {
      providedPromptTokens += promptTokenCount;
    }
    totalWebSearchQueries += webSearchQueriesCount;

    const validJson =
      res.persisted.inferenceSource === "IN_CLOUD" &&
      res.statusMessage !== EN_COPY.cloud.unreadableJson;
    const hasRenderedContent = Boolean(res.sessionDisplay?.renderedContent?.trim());
    const groundingChunksCount = res.sessionDisplay?.groundingChunks.length ?? 0;
    const hasGrounding = hasRenderedContent && groundingChunksCount > 0;

    rawSamples.push({
      variant: variantLabel,
      caseIndex: caseIdx,
      verdict: res.persisted.verdict,
      inferenceSource: res.persisted.inferenceSource,
      validJson,
      hasRenderedContent,
      groundingChunks: groundingChunksCount,
      webSearchQueriesCount,
      promptTokenCount,
      thoughtsTokenCount,
      candidatesTokenCount,
      totalTokenCount: callTotalTokens,
      finishReason,
      latencyMs,
    });

    return { latencyMs, validJson, hasGrounding };
  };

  // 1. Grounded calls with thinkingLevel: "LOW"
  for (let i = 0; i < lowRuns; i += 1) {
    try {
      const mLow = l2Adjudicate(rt, { mode: "SCHEMA", thinkingConfig: { thinkingLevel: "LOW" } });
      const out = await runOneL2Call("grounded_thinking_LOW", i, "l2Adjudicate", mLow);
      lowThinkingAccepted += 1;
      groundedLatencies.push(out.latencyMs);
      if (out.validJson) lowValidJson += 1;
      if (out.hasGrounding) lowWithGrounding += 1;
    } catch (e) {
      rawSamples.push({
        variant: "grounded_thinking_LOW",
        caseIndex: i,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2. Grounded calls without thinkingConfig
  for (let i = 0; i < omittedRuns; i += 1) {
    try {
      const mNoThink = l2Adjudicate(rt, { mode: "SCHEMA", thinkingConfig: undefined });
      const out = await runOneL2Call("grounded_no_thinkingConfig", lowRuns + i, "l2Adjudicate", mNoThink);
      groundedLatencies.push(out.latencyMs);
      if (out.validJson) omittedValidJson += 1;
      if (out.hasGrounding) omittedWithGrounding += 1;
    } catch (e) {
      rawSamples.push({
        variant: "grounded_no_thinkingConfig",
        caseIndex: lowRuns + i,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Independent fallback axis (`07` §1.3): if thinkingLevel="LOW" was rejected, evaluate SCHEMA
  // on the first `lowRuns` claims without `thinkingConfig` rather than blaming L2_MODE="SCHEMA".
  const thinkingRejected = lowRuns > 0 && lowThinkingAccepted === 0;
  if (thinkingRejected) {
    for (let i = 0; i < lowRuns; i += 1) {
      try {
        const mFallback = l2Adjudicate(rt, { mode: "SCHEMA", thinkingConfig: undefined });
        const out = await runOneL2Call(
          "grounded_fallback_no_thinkingConfig",
          i,
          "l2Adjudicate",
          mFallback
        );
        groundedLatencies.push(out.latencyMs);
        if (out.validJson) fallbackNoThinkValidJson += 1;
        if (out.hasGrounding) fallbackNoThinkWithGrounding += 1;
      } catch (e) {
        rawSamples.push({
          variant: "grounded_fallback_no_thinkingConfig",
          caseIndex: i,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // 3. l2AdjudicateProvided calls on the exact same claims
  for (let i = 0; i < providedRuns; i += 1) {
    try {
      const mProv = l2AdjudicateProvided(rt, { thinkingConfig: undefined });
      const out = await runOneL2Call("l2AdjudicateProvided", i, "l2AdjudicateProvided", mProv);
      providedLatencies.push(out.latencyMs);
      if (out.validJson) providedSucceeded += 1;
    } catch (e) {
      rawSamples.push({
        variant: "l2AdjudicateProvided",
        caseIndex: i,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const telemetry = rt.telemetry.snapshot();
  const totalGroundedCalls = lowRuns + omittedRuns;
  const groundedValidJsonCount = thinkingRejected
    ? fallbackNoThinkValidJson + omittedValidJson
    : lowValidJson + omittedValidJson;
  const totalGroundedWithSearch = thinkingRejected
    ? fallbackNoThinkWithGrounding + omittedWithGrounding
    : lowWithGrounding + omittedWithGrounding;
  const groundedValidJsonRate =
    totalGroundedCalls > 0 ? round2(groundedValidJsonCount / totalGroundedCalls) : 0;
  const groundedSearchRate =
    totalGroundedCalls > 0 ? round2(totalGroundedWithSearch / totalGroundedCalls) : 0;
  const providedSuccessRate =
    providedRuns > 0 ? round2(providedSucceeded / providedRuns) : 0;

  const schemaGroundingOk =
    totalGroundedCalls > 0 &&
    groundedValidJsonCount / totalGroundedCalls >= 0.9 &&
    totalGroundedWithSearch / totalGroundedCalls >= 0.9;
  const passed =
    schemaGroundingOk &&
    !anyMaxTokens &&
    providedRuns > 0 &&
    providedSucceeded / providedRuns >= 0.9;

  return buildSpikeResultRecord({
    def: S_L2_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: passed ? "PASS" : "FAIL",
    primaryRecommended: passed,
    summary: `S-L2 validJson=${groundedValidJsonCount}/${totalGroundedCalls}, searchGrounding=${totalGroundedWithSearch}/${totalGroundedCalls}, provided=${providedSucceeded}/${providedRuns}, maxTokens=${String(anyMaxTokens)} -> mode=${schemaGroundingOk ? "SCHEMA" : "TEXT_JSON"}, thinking=${thinkingRejected || lowThinkingAccepted < lowRuns ? "OMIT" : "LOW"}, maxOut=${anyMaxTokens ? 4096 : 2048}.`,
    metrics: {
      totalGroundedCalls,
      groundedValidJsonCount,
      totalGroundedWithSearch,
      groundedValidJsonRate,
      groundedSearchRate,
      providedCalls: providedRuns,
      providedSucceeded,
      providedSuccessRate,
      lowThinkingAccepted,
      lowWithGrounding,
      omittedWithGrounding,
      thinkingRejected,
      anyMaxTokens,
      recommendedMaxOutputTokens: anyMaxTokens ? 4096 : 2048,
      totalPromptTokens,
      totalThoughtsTokens,
      totalCandidatesTokens,
      totalTokens,
      groundedPromptTokens,
      providedPromptTokens,
      totalWebSearchQueries,
      medianGroundedLatencyMs:
        groundedLatencies.length > 0 ? round2(median(groundedLatencies)) : null,
      medianProvidedLatencyMs:
        providedLatencies.length > 0 ? round2(median(providedLatencies)) : null,
      recommendedL2Mode: schemaGroundingOk ? "SCHEMA" : "TEXT_JSON",
      recommendedThinking: lowThinkingAccepted === lowRuns && lowRuns > 0 ? "LOW" : "OMIT",
    },
    rawSamples,
    telemetrySnapshot: telemetry,
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runSRP(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  if (!rt) {
    return missingCloudRecord(S_RP_DEF, ctx, startedAtMs, envMeta);
  }

  const authOk = await rt.ensureAuth();
  if (!authOk) {
    return buildSpikeResultRecord({
      def: S_RP_DEF,
      executionMode: ctx.executionMode,
      environment: envMeta,
      status: "UNAVAILABLE",
      primaryRecommended: false,
      summary: "S-RP unavailable: ensureAuth() failed (App Check / anonymous sign-in required).",
      missingPrerequisites: ["Anonymous Firebase Auth + reCAPTCHA Enterprise App Check"],
      startedAtMs,
      finishedAtMs: ctx.host.nowMs(),
    });
  }

  const probeCount = options?.maxIterations ?? 5;
  const latencies: number[] = [];
  let acceptedCount = 0;

  for (let i = 0; i < probeCount; i += 1) {
    const t0 = ctx.host.nowPerfMs();
    try {
      const claimHash =
        options?.manualInputs?.sampleClaimHash ?? sha256hex(`srp-probe-${i}-${startedAtMs}`);
      const res = await callQuotaGuard(
        { claimHashes: [claimHash], kind: "L2" },
        { runtime: rt }
      );
      if (res.ok || res.reason === "POOL_EXHAUSTED" || res.reason === "QUOTA_EXCEEDED") {
        acceptedCount += 1;
      }
      latencies.push(round2(ctx.host.nowPerfMs() - t0));
    } catch {
      latencies.push(round2(ctx.host.nowPerfMs() - t0));
    }
  }

  const p50 = round2(percentile(latencies, 0.5));
  const p95 = round2(percentile(latencies, 0.95));
  const manualChecklist: SpikeManualStepItem[] = [
    {
      id: "srp-curl-replay",
      description:
        "Capture one limited-use App Check token from DevTools/AI Logic and replay with curl; confirm HTTP 403/permission-denied.",
      completed: false,
    },
    {
      id: "srp-auth-preview-enforce",
      description:
        "Enable App Check enforcement for Firebase Authentication (Preview) in staging; run 10 tokenless scripted sign-ups (all rejected) & 10 real client sign-ups.",
      completed: false,
    },
    {
      id: "srp-recaptcha-assessments",
      description: "Record reCAPTCHA Enterprise assessment count per L2 call & 1M-token rejection behavior.",
      completed: false,
    },
  ];

  const status = acceptedCount > 0 ? "MANUAL_REQUIRED" : "FAIL";
  return buildSpikeResultRecord({
    def: S_RP_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status,
    primaryRecommended: acceptedCount === probeCount,
    summary: `S-RP limited-use quotaGuard calls ${acceptedCount}/${probeCount} succeeded (p50=${p50} ms, p95=${p95} ms); curl replay & Auth Preview checklist pending.`,
    metrics: {
      probeCount,
      acceptedCount,
      p50Ms: p50,
      p95Ms: p95,
    },
    manualChecklist,
    telemetrySnapshot: rt.telemetry.snapshot(),
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runSSC(ctx: SpikeRuntimeContext): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();

  let quotaProbeStatus: string = "not_run";
  if (rt && (await rt.ensureAuth())) {
    try {
      const q = await callQuotaGuard(
        { claimHashes: [sha256hex("ssc-kill-switch-probe")], kind: "L2" },
        { runtime: rt }
      );
      quotaProbeStatus = q.ok ? `granted:${q.pool}` : `denied:${q.reason}`;
    } catch (e) {
      quotaProbeStatus = e instanceof Error ? e.message : "error";
    }
  }

  const manualChecklist: SpikeManualStepItem[] = [
    {
      id: "ssc-spend-caps",
      description: "Configure Cloud Billing spend caps: Firebase AI Logic US$60/mo and Cloud Functions US$40/mo.",
      completed: false,
    },
    {
      id: "ssc-four-budgets",
      description:
        "Create 4 gross-cost budgets (gross US$110, ai-logic US$60, uncapped US$20 -> billing-alerts; recaptcha US$10 -> recaptcha-alerts) and test synthetic Pub/Sub messages.",
      completed: false,
    },
    {
      id: "ssc-recaptcha-breaker",
      description: "Confirm recaptchaBreaker disables staging Web key within 10 min and degraded chip shows cleanly.",
      completed: false,
    },
    {
      id: "ssc-functions-us1-drill",
      description:
        "In toulmin-staging, drive US$1 Functions cap, capture error + paused banner, lift cap, and record recovery time.",
      completed: false,
    },
  ];

  return buildSpikeResultRecord({
    def: S_SC_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: "MANUAL_REQUIRED",
    primaryRecommended: false,
    summary: `S-SC client quotaGuard probe="${quotaProbeStatus}"; billing caps & Pub/Sub breaker drills require manual GCP Console verification in toulmin-staging.`,
    metrics: {
      quotaProbeStatus,
    },
    manualChecklist,
    telemetrySnapshot: rt ? rt.telemetry.snapshot() : null,
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

export const S_W9_DEF: SpikeDefinition = {
  spikeId: "S-W9",
  title: "PREFER_IN_CLOUD Find Alternative Sources (Online Search + Offline Ranking)",
  category: "cloud-l2",
  targetDoc: "docs/spikes/S-W9.md",
  flagName: "spike_s_w9_primary",
  passCriterion: "Online 10/10 IN_CLOUD with valid AltSourcesV1 JSON; offline 10/10 ON_DEVICE with valid JSON",
  fallbackAction: "Online uses ONLY_IN_CLOUD with googleSearch; offline uses ONLY_ON_DEVICE library ranking",
  markerLocations: ["04 §4.5"],
  run: runSW9,
};

export const S_L2_DEF: SpikeDefinition = {
  spikeId: "S-L2",
  title: "L2 Single Call (ONLY_IN_CLOUD + googleSearch + responseSchema + thinkingLevel)",
  category: "cloud-l2",
  targetDoc: "docs/spikes/S-L2.md",
  flagName: "spike_s_l2_primary",
  passCriterion: ">=9/10 valid JSON AND non-empty searchEntryPoint + groundingChunks; zero finishReason=MAX_TOKENS at 2048",
  fallbackAction: "Switch L2_MODE to TEXT_JSON single-call parser; omit thinkingConfig if LOW rejected; raise cap to 4096 if MAX_TOKENS observed",
  markerLocations: ["04 §3.6.1", "04 §3.6.4", "05 §4.1"],
  run: runSL2,
};

export const S_RP_DEF: SpikeDefinition = {
  spikeId: "S-RP",
  title: "AI Logic Replay Protection, Auth App Check Preview & Authenticated Users Mode",
  category: "cloud-l2",
  targetDoc: "docs/spikes/S-RP.md",
  flagName: "spike_s_rp_primary",
  passCriterion: ">=19/20 success with limited-use tokens; curl replay rejected; 10/10 tokenless sign-ups rejected",
  fallbackAction: "Disable cloud features on failing platform or fall back per 07 §1.3 while keeping replay protection enforced",
  markerLocations: ["00 §6.2", "05 §4"],
  run: runSRP,
};

export const S_SC_DEF: SpikeDefinition = {
  spikeId: "S-SC",
  title: "Spend Caps, Gross Cost Budgets, Breakers & Paused-Service Recovery",
  category: "cloud-l2",
  targetDoc: "docs/spikes/S-SC.md",
  flagName: "spike_s_sc_primary",
  passCriterion: "Caps US$60/US$40 & 4 budgets active; quotaGuard honors pool updates <=60s; recaptchaBreaker <=10min",
  fallbackAction: "Rely on lower pools / breakers if service cap unavailable; resolve paused-service banner defects before Phase 3",
  markerLocations: ["05 §3.5", "05 §4.4"],
  run: runSSC,
};

export const CLOUD_L2_SPIKES: readonly SpikeDefinition[] = [
  S_W9_DEF,
  S_L2_DEF,
  S_RP_DEF,
  S_SC_DEF,
];
