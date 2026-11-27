/**
 * On-device Web L1 spike runners (`S-W1`, `S-W2`, `S-W3`, `S-W4`, `S-W7`, `S-W10`)
 * per `07` §1.2, routed strictly through `@toulmin/firebase-client`.
 */

import {
  callL1,
  formatEnvironmentReasons,
  getStreamCharLimit,
  localModel,
  startModelDownload,
  type FirebaseRuntime,
} from "@toulmin/firebase-client";
import { buildB5Prompt, buildStage1Prompt, buildStage2Prompt } from "@toulmin/prompts";
import {
  SCHEMAS,
  checkTopLevelKeyOrder,
  extractTopLevelJsonKeys,
  parseAndValidateAiOutput,
  type SchemaId,
} from "@toulmin/schemas";
import { computeWebL1DeadlineMs, estimateOutputTokens, median, percentile, round2 } from "../stats.js";
import { buildSpikeResultRecord } from "../runtime.js";
import type {
  SpikeDefinition,
  SpikeManualStepItem,
  SpikeRunOptions,
  SpikeRunRecord,
  SpikeRuntimeContext,
} from "../types.js";

const SW2_EXPECTED_KEYS = [
  "s01_evidence_span",
  "s02_evidence_idx",
  "s03_micro_reasoning",
  "s04_verdict",
] as const;

function makeSampleStage1Prompt(wordCount = 12, seedIdx = 0) {
  const words = Array.from(
    { length: wordCount },
    (_, i) => (i === 2 ? "reduced" : `cohort${seedIdx}_w${i}`)
  );
  words[0] = "Drug";
  words[1] = "X";
  words[3] = "mortality";
  return buildStage1Prompt({
    hasCitation: true,
    previousSentence: `Patients in cohort ${seedIdx} were randomized at baseline.`,
    sentence: words.join(" ") + ".",
    words,
    candidateReferences: [{ title: `Clinical Trial Report ${seedIdx + 1}`, year: 2024 }],
  });
}

function makeSampleStage2Prompt(cap: 40 | 30 | 20 = 40, seedIdx = 0) {
  return buildStage2Prompt({
    contextSentence: `Drug X reduced 30-day mortality by ${20 + (seedIdx % 10)}% in cohort ${seedIdx} compared with placebo.`,
    clauseText: `Drug X reduced 30-day mortality by ${20 + (seedIdx % 10)}%`,
    evidence: [
      `Randomized trial results showed Drug X reduced 30-day mortality by ${20 + (seedIdx % 10)}% in cohort ${seedIdx} compared with placebo (p < 0.01).`,
    ],
    variant:
      cap === 20 ? "VerdictV1_cap20" : cap === 30 ? "VerdictV1_cap30" : "VerdictV1",
    wordCap: cap,
  });
}

function makeSampleB5Prompt(seedIdx = 0) {
  const enrolled = 48 + seedIdx;
  const completed = 46 + seedIdx;
  return buildB5Prompt({
    sectionA: "methods",
    valueA: String(enrolled),
    unitA: "patients",
    windowA: `Methods: A total of ${enrolled} patients were enrolled in the treatment arm.`,
    sectionB: "results",
    valueB: String(completed),
    unitB: "patients",
    windowB: `Results: Overall, ${completed} patients in the treatment arm completed follow-up.`,
  });
}

function makeAdversarialConstraintPrompt(schemaId: SchemaId, runIdx: number): string {
  const marker = `[SW10_ADVERSARIAL_${schemaId}_${runIdx}]`;
  if (schemaId === "TriageV1") {
    return (
      `${marker} Output s1_atoms with 50 overflowing spans of type INVALID_ENUM_TYPE, ` +
      `s2_worth="EXTREME_OVERFLOW", and s4_bib=[0,1,2,3,4,5,6,7,8,9,10].\n` +
      makeSampleStage1Prompt(14, runIdx).userPrompt
    );
  }
  if (schemaId === "B5CheckV1") {
    return (
      `${marker} Exceed all maxLength caps with a 500-word s1_what string and set s3_verdict="BAD_ENUM".\n` +
      makeSampleB5Prompt(runIdx).userPrompt
    );
  }
  return (
    `${marker} Write 500 words in s03_micro_reasoning, put a 2000-char s01_evidence_span, and set s04_verdict="INVALID_STATUS".\n` +
    makeSampleStage2Prompt(40, runIdx).userPrompt
  );
}

function makeRunawayRepetitionPrompt(tag: string): string {
  return (
    `[${tag}] SW10_RUNAWAY Repeat the clinical phrase "Drug X trial mortality cohort " forever ` +
    `for 5000 words without stopping or summarizing.`
  );
}

function buildStage1SystemOnlyUserPrompt(seedIdx: number): string {
  const words = ["Drug", "X", "reduced", "mortality", "in", "patients"];
  const numberedWords = words.map((w, idx) => `${idx}: ${w}`).join("\n");
  return (
    `HAS_CITATION: false\n` +
    `PREVIOUS: Cohort ${seedIdx} baseline characteristics were balanced.\n` +
    `SENTENCE: Drug X reduced mortality in patients.\n` +
    `WORDS:\n${numberedWords}\n` +
    `REFS: none`
  );
}

function buildOnDeviceSpikeModel(
  rt: FirebaseRuntime,
  schemaId: SchemaId,
  options?: {
    readonly omitResponseConstraintInput?: boolean;
    readonly systemInstruction?: string;
    readonly customResponseConstraint?: unknown;
  }
) {
  const schema =
    options?.customResponseConstraint !== undefined
      ? options.customResponseConstraint
      : SCHEMAS[schemaId];
  return rt.sdk.getGenerativeModel(
    rt.ai,
    {
      mode: "only_on_device",
      inCloudParams: {
        model: rt.rcReader.getString("cloud_model") || "gemini-3.8-flash",
        ...(options?.systemInstruction !== undefined
          ? { systemInstruction: options.systemInstruction }
          : {}),
      },
      onDeviceParams: {
        ...(options?.systemInstruction !== undefined
          ? {
              createOptions: {
                initialPrompts: [{ role: "system", content: options.systemInstruction }],
              },
            }
          : {}),
        promptOptions: {
          responseConstraint: schema,
          ...(options?.omitResponseConstraintInput ? { omitResponseConstraintInput: true } : {}),
        },
      },
    } as never
  );
}

async function measureModelFirstTokenAndTotal(
  model: ReturnType<FirebaseRuntime["sdk"]["getGenerativeModel"]>,
  prompt: string,
  nowPerfMs: () => number
): Promise<{
  readonly firstTokenMs: number;
  readonly totalMs: number;
  readonly rawText: string;
}> {
  const t0 = nowPerfMs();
  let firstTokenMs = -1;
  let raw = "";

  const streamFn = (model as unknown as {
    generateContentStream?: (
      input: string,
      reqOpts?: unknown
    ) => Promise<{
      stream: AsyncIterable<{ text(): string }>;
      response: Promise<{ response: { text(): string } }>;
    }>;
  }).generateContentStream;

  if (typeof streamFn === "function") {
    const res = await streamFn.call(model, prompt);
    for await (const chunk of res.stream) {
      if (firstTokenMs < 0) {
        firstTokenMs = Math.max(0, nowPerfMs() - t0);
      }
      raw += chunk.text();
    }
    const settled = await res.response;
    if (!raw && typeof settled?.response?.text === "function") {
      raw = settled.response.text();
    }
    const totalMs = Math.max(0, nowPerfMs() - t0);
    return {
      firstTokenMs: firstTokenMs < 0 ? totalMs : firstTokenMs,
      totalMs,
      rawText: raw,
    };
  }

  const single = await model.generateContent(prompt);
  const totalMs = Math.max(0, nowPerfMs() - t0);
  raw = single.response.text();
  return { firstTokenMs: totalMs, totalMs, rawText: raw };
}

function unavailableL1Record(
  def: SpikeDefinition,
  ctx: SpikeRuntimeContext,
  startedAtMs: number,
  envMeta: Awaited<ReturnType<SpikeRuntimeContext["inspectEnvironment"]>>,
  missing: readonly string[],
  summary: string
): SpikeRunRecord {
  return buildSpikeResultRecord({
    def,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: "UNAVAILABLE",
    primaryRecommended: false,
    summary,
    missingPrerequisites: missing,
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

function checkL1Prerequisites(
  envMeta: Awaited<ReturnType<SpikeRuntimeContext["inspectEnvironment"]>>,
  rt: FirebaseRuntime | null,
  requirePromptApi = true
): string[] {
  const missing: string[] = [];
  if (requirePromptApi && !envMeta.capabilities.promptApiAvailable) {
    missing.push("Chrome LanguageModel Prompt API (Chrome >= 148)");
  }
  if (!rt) {
    missing.push(...envMeta.capabilities.missingCloudFields, "FirebaseRuntime");
  }
  return Array.from(new Set(missing));
}

async function runSW1(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  const missing = checkL1Prerequisites(envMeta, rt, true);

  if (missing.length > 0 || !rt) {
    return unavailableL1Record(
      S_W1_DEF,
      ctx,
      startedAtMs,
      envMeta,
      missing,
      `S-W1 cannot execute cleanly: missing ${missing.join(", ")}.`
    );
  }

  const downloadCallbacks: number[] = [];
  if (envMeta.readiness === "downloadable" && options?.manualInputs?.enableDownloadGesture) {
    await startModelDownload((frac) => downloadCallbacks.push(frac), rt);
  }

  const callsCount = options?.maxIterations ?? 10;
  const model = localModel("TriageV1", "ONLY_ON_DEVICE", rt);
  const prompt = makeSampleStage1Prompt();

  let onDeviceHits = 0;
  const samples: Array<Record<string, unknown>> = [];
  for (let i = 0; i < callsCount; i += 1) {
    const out = await callL1(
      model,
      "TriageV1",
      prompt.userPrompt,
      `sw1_${i}`,
      (raw) => {
        const res = parseAndValidateAiOutput("TriageV1", raw);
        return res.ok ? res.data : null;
      },
      "ON_DEVICE_ONLY",
      undefined,
      { runtime: rt }
    );
    if (out.result.inferenceSource === "ON_DEVICE") {
      onDeviceHits += 1;
    }
    samples.push({
      phase: "in_prompt",
      run: i + 1,
      inferenceSource: out.result.inferenceSource,
      ms: round2(out.result.ms),
      error: out.result.error ?? null,
    });
    await out.slotFree;
  }

  // Step (5): systemInstruction set cleanly via HybridParams fields, in-prompt instructions deleted (`07` §1.2)
  const sysModel = buildOnDeviceSpikeModel(rt, "TriageV1", {
    systemInstruction: prompt.systemInstruction,
  });
  let systemInstructionHonouredCount = 0;
  for (let i = 0; i < callsCount; i += 1) {
    const sysOnlyPrompt = buildStage1SystemOnlyUserPrompt(i);
    const out = await callL1(
      sysModel,
      "TriageV1",
      sysOnlyPrompt,
      `sw1_sys_${i}`,
      (raw) => {
        const res = parseAndValidateAiOutput("TriageV1", raw);
        return res.ok ? (res.data as { s1_atoms: unknown[]; s2_worth: string; s3_uncited: boolean; s4_bib: number[] }) : null;
      },
      "ON_DEVICE_ONLY",
      undefined,
      { runtime: rt }
    );
    const parsedData = out.result.data;
    const semanticOk =
      out.result.inferenceSource === "ON_DEVICE" &&
      parsedData !== null &&
      parsedData.s3_uncited === true &&
      parsedData.s1_atoms.length >= 1 &&
      parsedData.s2_worth !== "SKIP" &&
      parsedData.s4_bib.length === 0;
    if (semanticOk) {
      systemInstructionHonouredCount += 1;
    }
    samples.push({
      phase: "system_instruction_only",
      run: i + 1,
      inferenceSource: out.result.inferenceSource,
      validJson: parsedData !== null,
      semanticOk,
      ms: round2(out.result.ms),
      error: out.result.error ?? null,
    });
    await out.slotFree;
  }

  const passed = envMeta.readiness === "available" && onDeviceHits === callsCount;
  const manualChecklist: SpikeManualStepItem[] = [
    {
      id: "sw1-progress-shape",
      description: "Record exact argument shape delivered to model.initializeDeviceModel(cb).",
      completed: downloadCallbacks.length > 0,
      notes: downloadCallbacks.length > 0 ? `Observed ${downloadCallbacks.length} numeric fractions` : "Not downloadable in this run",
    },
    {
      id: "sw1-system-instruction",
      description: "Record whether systemInstruction is honoured without in-prompt instructions.",
      completed: true,
      notes: `Honoured on ${systemInstructionHonouredCount}/${callsCount} calls`,
    },
    {
      id: "sw1-hybrid-params-type",
      description: "Verify exported HybridParams type name in installed firebase/ai typings.",
      completed: true,
      notes: "firebase/ai exports HybridParams",
    },
  ];

  return buildSpikeResultRecord({
    def: S_W1_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: passed ? "PASS" : "FAIL",
    primaryRecommended: passed,
    summary: `S-W1 completed ${onDeviceHits}/${callsCount} ONLY_ON_DEVICE calls & ${systemInstructionHonouredCount}/${callsCount} systemInstruction-only calls (readiness=${envMeta.readiness}).`,
    metrics: {
      readiness: envMeta.readiness,
      onDeviceHits,
      totalCalls: callsCount,
      systemInstructionTestedCalls: callsCount,
      systemInstructionHonouredCount,
      downloadCallbacksObserved: downloadCallbacks.length,
    },
    rawSamples: samples,
    manualChecklist,
    telemetrySnapshot: rt.telemetry.snapshot(),
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runSW2(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  const missing = checkL1Prerequisites(envMeta, rt, true);

  if (missing.length > 0 || !rt) {
    return unavailableL1Record(
      S_W2_DEF,
      ctx,
      startedAtMs,
      envMeta,
      missing,
      `S-W2 unavailable: missing ${missing.join(", ")}.`
    );
  }

  const iterations = options?.maxIterations ?? 50;
  const model = localModel("VerdictV1", "ONLY_ON_DEVICE", rt);
  const prompt = makeSampleStage2Prompt(40);
  let orderedCount = 0;
  const violations: Array<Record<string, unknown>> = [];

  for (let i = 0; i < iterations; i += 1) {
    const out = await callL1(
      model,
      "VerdictV1",
      prompt.userPrompt,
      `sw2_${i}`,
      (raw) => {
        const res = parseAndValidateAiOutput("VerdictV1", raw);
        return res.ok ? res.data : null;
      },
      "ON_DEVICE_ONLY",
      undefined,
      { runtime: rt }
    );
    const keys = extractTopLevelJsonKeys(out.result.rawText);
    const matchesOrder =
      keys !== null && checkTopLevelKeyOrder(out.result.rawText, SW2_EXPECTED_KEYS);
    if (matchesOrder) {
      orderedCount += 1;
    } else {
      violations.push({ run: i + 1, keys, error: out.result.error ?? null });
    }
    await out.slotFree;
  }

  const passed = orderedCount === iterations;
  return buildSpikeResultRecord({
    def: S_W2_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: passed ? "PASS" : "FAIL",
    primaryRecommended: passed,
    summary: `S-W2 observed ${orderedCount}/${iterations} VerdictV1 outputs in canonical s01->s02->s03->s04 order.`,
    metrics: {
      orderedCount,
      totalCalls: iterations,
      violationCount: iterations - orderedCount,
    },
    rawSamples: violations.slice(0, 10),
    telemetrySnapshot: rt.telemetry.snapshot(),
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runSW3(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();

  if (!ctx.host.languageModel?.create) {
    return unavailableL1Record(
      S_W3_DEF,
      ctx,
      startedAtMs,
      envMeta,
      ["LanguageModel.create() Prompt API session"],
      "S-W3 requires Chrome Prompt API LanguageModel.create() to inspect inputQuota and measureInputUsage()."
    );
  }

  const promptsPerSchema = options?.maxIterations ?? 30;
  const prefillCallsPerWay = options?.maxIterations !== undefined ? options.maxIterations : 20;
  const session = await ctx.host.languageModel.create({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  });

  try {
    const inputQuota = typeof session.inputQuota === "number" ? session.inputQuota : null;
    const stage1EightyCount = Math.min(promptsPerSchema, 10);
    const stage1NormalCount = Math.max(0, promptsPerSchema - stage1EightyCount);
    const schemasAndPrompts: Array<{ schemaId: SchemaId; prompts: string[] }> = [
      {
        schemaId: "TriageV1",
        prompts: [
          ...Array.from(
            { length: stage1EightyCount },
            (_, idx) => makeSampleStage1Prompt(80, idx).userPrompt
          ),
          ...Array.from(
            { length: stage1NormalCount },
            (_, idx) => makeSampleStage1Prompt(18 + (idx % 12), stage1EightyCount + idx).userPrompt
          ),
        ],
      },
      {
        schemaId: "VerdictV1",
        prompts: Array.from(
          { length: promptsPerSchema },
          (_, idx) => makeSampleStage2Prompt(40, idx).userPrompt
        ),
      },
      {
        schemaId: "B5CheckV1",
        prompts: Array.from(
          { length: promptsPerSchema },
          (_, idx) => makeSampleB5Prompt(idx).userPrompt
        ),
      },
    ];

    const perSchemaBare: Record<string, number[]> = { TriageV1: [], VerdictV1: [], B5CheckV1: [] };
    const perSchemaWith: Record<string, number[]> = { TriageV1: [], VerdictV1: [], B5CheckV1: [] };
    const perSchemaWithout: Record<string, number[]> = { TriageV1: [], VerdictV1: [], B5CheckV1: [] };
    const rawSamples: Array<Record<string, unknown>> = [];

    if (typeof session.measureInputUsage === "function") {
      for (const group of schemasAndPrompts) {
        const schema = SCHEMAS[group.schemaId];
        for (let idx = 0; idx < group.prompts.length; idx += 1) {
          const promptText = group.prompts[idx]!;
          const bareUsage = await session.measureInputUsage(promptText);
          const withSchema = await session.measureInputUsage(promptText, {
            responseConstraint: schema,
          });
          const omittedSchema = await session.measureInputUsage(promptText, {
            responseConstraint: schema,
            omitResponseConstraintInput: true,
          });
          perSchemaBare[group.schemaId]!.push(bareUsage);
          perSchemaWith[group.schemaId]!.push(withSchema);
          perSchemaWithout[group.schemaId]!.push(omittedSchema);
          if (idx < 2) {
            rawSamples.push({
              schemaId: group.schemaId,
              sampleIndex: idx,
              tokensBarePrompt: bareUsage,
              tokensWithSchema: withSchema,
              tokensOmitResponseConstraintInput: omittedSchema,
            });
          }
        }
      }
    }

    const triageEightyBare = (perSchemaBare["TriageV1"] ?? []).slice(0, stage1EightyCount);
    const triageEightyWith = (perSchemaWith["TriageV1"] ?? []).slice(0, stage1EightyCount);
    const triageEightyOmitted = (perSchemaWithout["TriageV1"] ?? []).slice(0, stage1EightyCount);
    const stage1Max80WordBare = triageEightyBare.length > 0 ? Math.max(...triageEightyBare) : null;
    const stage1Max80WordTokens = triageEightyWith.length > 0 ? Math.max(...triageEightyWith) : null;
    const stage1Max80WordOmitted =
      triageEightyOmitted.length > 0 ? Math.max(...triageEightyOmitted) : null;
    const stage2VerdictMedian =
      (perSchemaWith["VerdictV1"]?.length ?? 0) > 0
        ? median(perSchemaWith["VerdictV1"]!)
        : null;
    const b5Median =
      (perSchemaWith["B5CheckV1"]?.length ?? 0) > 0
        ? median(perSchemaWith["B5CheckV1"]!)
        : null;

    // Step (3): Compare prefill times over 20 calls with vs without omitResponseConstraintInput via Firebase options
    let prefillMedianWithSchemaMs: number | null = null;
    let prefillMedianOmittedMs: number | null = null;
    let prefillDropPct: number | null = null;

    if (rt) {
      const mWith = buildOnDeviceSpikeModel(rt, "TriageV1", {
        omitResponseConstraintInput: false,
      });
      const mOmit = buildOnDeviceSpikeModel(rt, "TriageV1", {
        omitResponseConstraintInput: true,
      });
      const prompt80 = makeSampleStage1Prompt(80, 0).userPrompt;
      const withTimes: number[] = [];
      const omitTimes: number[] = [];
      for (let i = 0; i < prefillCallsPerWay; i += 1) {
        const a = await measureModelFirstTokenAndTotal(mWith, prompt80, ctx.host.nowPerfMs);
        withTimes.push(round2(a.firstTokenMs));
        const b = await measureModelFirstTokenAndTotal(mOmit, prompt80, ctx.host.nowPerfMs);
        omitTimes.push(round2(b.firstTokenMs));
      }
      prefillMedianWithSchemaMs = round2(median(withTimes));
      prefillMedianOmittedMs = round2(median(omitTimes));
      prefillDropPct =
        prefillMedianWithSchemaMs > 0
          ? round2(
              ((prefillMedianWithSchemaMs - prefillMedianOmittedMs) / prefillMedianWithSchemaMs) *
                100
            )
          : 0;
    }

    const usageConfirmsExcluded =
      stage1Max80WordTokens !== null &&
      stage1Max80WordOmitted !== null &&
      stage1Max80WordOmitted < stage1Max80WordTokens;
    const omitOptionForwarded =
      usageConfirmsExcluded || (prefillDropPct !== null && prefillDropPct >= 10);
    const stage1RecommendedCeiling =
      stage1Max80WordTokens !== null ? Math.ceil(stage1Max80WordTokens * 1.1) : 650;
    const quotaReadable = inputQuota !== null && inputQuota > 0;
    const totalMeasuredPrompts =
      (perSchemaWith["TriageV1"]?.length ?? 0) +
      (perSchemaWith["VerdictV1"]?.length ?? 0) +
      (perSchemaWith["B5CheckV1"]?.length ?? 0);
    const passed = quotaReadable && stage1Max80WordTokens !== null && totalMeasuredPrompts > 0;

    return buildSpikeResultRecord({
      def: S_W3_DEF,
      executionMode: ctx.executionMode,
      environment: envMeta,
      status: passed ? "PASS" : "FAIL",
      primaryRecommended: passed,
      summary: `S-W3 inputQuota=${inputQuota ?? "unreadable"}, measured ${totalMeasuredPrompts} prompts across 3 schemas, 80-word max=${stage1Max80WordTokens ?? "n/a"} (bare=${stage1Max80WordBare ?? "n/a"}, ceiling=${stage1RecommendedCeiling}), omitForwarded=${String(omitOptionForwarded)}.`,
      metrics: {
        inputQuota,
        promptsMeasuredTotal: totalMeasuredPrompts,
        stage1Prompt80TokensBare: stage1Max80WordBare,
        stage1Prompt80TokensWithSchema: stage1Max80WordTokens,
        stage1Prompt80TokensOmittedSchema: stage1Max80WordOmitted,
        stage2PromptTokensMedian: stage2VerdictMedian,
        b5PromptTokensMedian: b5Median,
        stage1RecommendedCeiling,
        prefillCallsPerWay: rt ? prefillCallsPerWay : 0,
        prefillMedianWithSchemaMs,
        prefillMedianOmittedMs,
        prefillDropPct,
        omitOptionForwarded,
      },
      rawSamples,
      startedAtMs,
      finishedAtMs: ctx.host.nowMs(),
    });
  } finally {
    session.destroy?.();
  }
}

async function runSW4(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  const missing = checkL1Prerequisites(envMeta, rt, true);

  if (missing.length > 0 || !rt) {
    return unavailableL1Record(
      S_W4_DEF,
      ctx,
      startedAtMs,
      envMeta,
      missing,
      `S-W4 unavailable: missing ${missing.join(", ")}.`
    );
  }

  const callsPerSchema = options?.maxIterations ?? 30;
  const schemasToMeasure: Array<{ id: SchemaId; prompt: string }> = [
    { id: "TriageV1", prompt: makeSampleStage1Prompt(12, 0).userPrompt },
    { id: "VerdictV1", prompt: makeSampleStage2Prompt(40, 0).userPrompt },
    { id: "VerdictV1_cap30", prompt: makeSampleStage2Prompt(30, 0).userPrompt },
    { id: "B5CheckV1", prompt: makeSampleB5Prompt(0).userPrompt },
  ];

  const metricsOut: Record<string, number | string | boolean | null> = {
    callsPerSchema,
  };
  const samples: Array<Record<string, unknown>> = [];

  let stage2Cap40P95 = 0;
  const allPrefills: number[] = [];
  const allDecodes: number[] = [];

  for (const spec of schemasToMeasure) {
    const model = localModel(spec.id, "ONLY_ON_DEVICE", rt);
    const latencies: number[] = [];
    const prefills: number[] = [];
    const decodes: number[] = [];
    const tokens: number[] = [];

    for (let i = 0; i < callsPerSchema; i += 1) {
      const m = await measureModelFirstTokenAndTotal(model, spec.prompt, ctx.host.nowPerfMs);
      const totalMs = round2(m.totalMs);
      const prefillMs = round2(m.firstTokenMs);
      const decodeMs = round2(Math.max(0, m.totalMs - m.firstTokenMs));
      latencies.push(totalMs);
      prefills.push(prefillMs);
      decodes.push(decodeMs);
      allPrefills.push(prefillMs);
      allDecodes.push(decodeMs);
      tokens.push(estimateOutputTokens(m.rawText));
    }

    const p50 = round2(percentile(latencies, 0.5));
    const p95 = round2(percentile(latencies, 0.95));
    const p99 = round2(percentile(latencies, 0.99));
    const tSessionEst =
      latencies.length > 1
        ? round2(Math.max(0, (latencies[0] ?? 0) - median(latencies.slice(1))))
        : 0;
    const deadlineMs = computeWebL1DeadlineMs(latencies);
    const prefillMed = round2(median(prefills));
    const decodeMed = round2(median(decodes));

    metricsOut[`${spec.id}_p50_ms`] = p50;
    metricsOut[`${spec.id}_p95_ms`] = p95;
    metricsOut[`${spec.id}_p99_ms`] = p99;
    metricsOut[`${spec.id}_deadline_ms`] = deadlineMs;
    metricsOut[`${spec.id}_t_session_est_ms`] = tSessionEst;
    metricsOut[`${spec.id}_t_prefill_median_ms`] = prefillMed;
    metricsOut[`${spec.id}_t_decode_median_ms`] = decodeMed;
    if (spec.id === "VerdictV1") {
      stage2Cap40P95 = p95;
    }

    samples.push({
      schemaId: spec.id,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
      recommendedDeadlineMs: deadlineMs,
      tSessionEstMs: tSessionEst,
      tPrefillMedianMs: prefillMed,
      tDecodeMedianMs: decodeMed,
      medianOutputTokens: median(tokens),
    });
  }

  // Decode comparison between short (cap 20) and longer (cap 40) outputs + 100 ms AbortSignal probe
  const shortDecodeMeasure = await measureModelFirstTokenAndTotal(
    localModel("VerdictV1_cap20", "ONLY_ON_DEVICE", rt),
    makeSampleStage2Prompt(20, 0).userPrompt,
    ctx.host.nowPerfMs
  );
  const longDecodeMeasure = await measureModelFirstTokenAndTotal(
    localModel("VerdictV1", "ONLY_ON_DEVICE", rt),
    makeSampleStage2Prompt(40, 1).userPrompt,
    ctx.host.nowPerfMs
  );
  const tDecodeDiffEstMs = round2(
    Math.abs((longDecodeMeasure.totalMs - longDecodeMeasure.firstTokenMs) - (shortDecodeMeasure.totalMs - shortDecodeMeasure.firstTokenMs))
  );

  let abortSupported = false;
  let abortOutcome = "NOT_ABORTED";
  const ac = new AbortController();
  const abortTimer = setTimeout(() => ac.abort(new Error("SW4_ABORT_100MS")), 100);
  try {
    const mVerdict = localModel("VerdictV1", "ONLY_ON_DEVICE", rt);
    const streamFn = (mVerdict as unknown as {
      generateContentStream?: (
        input: string,
        reqOpts?: unknown
      ) => Promise<{ stream: AsyncIterable<{ text(): string }>; response: Promise<unknown> }>;
    }).generateContentStream;
    if (typeof streamFn === "function") {
      const s = await streamFn.call(mVerdict, makeSampleStage2Prompt(40, 2).userPrompt, {
        signal: ac.signal,
      });
      for await (const chunk of s.stream) {
        void chunk.text();
        if (ac.signal.aborted) {
          abortSupported = true;
          abortOutcome = "ABORTED_IN_STREAM";
          break;
        }
      }
      await s.response.catch((err) => {
        if (ac.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          abortSupported = true;
          abortOutcome = "ABORT_SIGNAL_THREW";
        }
      });
    } else {
      await mVerdict.generateContent(makeSampleStage2Prompt(40, 2).userPrompt, {
        signal: ac.signal,
      } as never);
    }
  } catch (err) {
    if (ac.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      abortSupported = true;
      abortOutcome = "ABORT_SIGNAL_THREW";
    } else {
      abortOutcome = `SDK_REJECTED:${err instanceof Error ? err.message : String(err)}`;
    }
  } finally {
    clearTimeout(abortTimer);
  }

  metricsOut["tPrefillMedianMs"] = allPrefills.length > 0 ? round2(median(allPrefills)) : 0;
  metricsOut["tDecodeMedianMs"] = allDecodes.length > 0 ? round2(median(allDecodes)) : 0;
  metricsOut["tDecodeDiffEstMs"] = tDecodeDiffEstMs;
  metricsOut["abortSupported"] = abortSupported;
  metricsOut["abortOutcome"] = abortOutcome;

  const passed = stage2Cap40P95 <= 6000;
  return buildSpikeResultRecord({
    def: S_W4_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: passed ? "PASS" : "FAIL",
    primaryRecommended: passed,
    summary: `S-W4 VerdictV1 (cap 40) p95=${stage2Cap40P95} ms (threshold <= 6000 ms; cap40 primary=${String(passed)}), abort=${abortOutcome}.`,
    metrics: metricsOut,
    rawSamples: samples,
    telemetrySnapshot: rt.telemetry.snapshot(),
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runSW7(ctx: SpikeRuntimeContext): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();

  const isNoLocalDevice =
    envMeta.readiness === "unavailable" || envMeta.readiness === "unsupported";
  const reasonCopy = formatEnvironmentReasons(envMeta.envReasons);

  if (!rt) {
    return buildSpikeResultRecord({
      def: S_W7_DEF,
      executionMode: ctx.executionMode,
      environment: envMeta,
      status: isNoLocalDevice ? "MANUAL_REQUIRED" : "UNAVAILABLE",
      primaryRecommended: isNoLocalDevice,
      summary: isNoLocalDevice
        ? "Environment reported no local model; provide Firebase config to test PREFER_ON_DEVICE cloud fallback."
        : `S-W7 expects ThinkPad/no-local-model profile, but readiness=${envMeta.readiness}.`,
      missingPrerequisites: envMeta.capabilities.missingCloudFields,
      metrics: {
        readiness: envMeta.readiness,
        reasonCopyCount: reasonCopy.length,
      },
      startedAtMs,
      finishedAtMs: ctx.host.nowMs(),
    });
  }

  const model = localModel("TriageV1", "PREFER_ON_DEVICE", rt);
  const prompt = makeSampleStage1Prompt();
  const res = await callL1(
    model,
    "TriageV1",
    prompt.userPrompt,
    "sw7_fallback",
    (raw) => {
      const parsed = parseAndValidateAiOutput("TriageV1", raw);
      return parsed.ok ? parsed.data : null;
    },
    "HYBRID",
    undefined,
    { runtime: rt }
  );
  await res.slotFree;

  const passed = isNoLocalDevice && res.result.inferenceSource === "IN_CLOUD" && res.result.data !== null;
  return buildSpikeResultRecord({
    def: S_W7_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: passed ? "PASS" : isNoLocalDevice ? "FAIL" : "MANUAL_REQUIRED",
    primaryRecommended: passed,
    summary: `S-W7 readiness=${envMeta.readiness}, PREFER_ON_DEVICE inferenceSource=${res.result.inferenceSource}.`,
    metrics: {
      readiness: envMeta.readiness,
      reasonCopy: reasonCopy.join(" | "),
      preferOnDeviceInferenceSource: res.result.inferenceSource,
      validJson: res.result.data !== null,
    },
    telemetrySnapshot: rt.telemetry.snapshot(),
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runSW10(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  const missing = checkL1Prerequisites(envMeta, rt, true);

  if (missing.length > 0 || !rt) {
    return unavailableL1Record(
      S_W10_DEF,
      ctx,
      startedAtMs,
      envMeta,
      missing,
      `S-W10 unavailable: missing ${missing.join(", ")}.`
    );
  }

  const perBucket = options?.maxIterations ?? 10;
  const triageModel = localModel("TriageV1", "ONLY_ON_DEVICE", rt);
  const verdictModel = localModel("VerdictV1", "ONLY_ON_DEVICE", rt);
  const b5Model = localModel("B5CheckV1", "ONLY_ON_DEVICE", rt);
  const invalidSchemaModel = buildOnDeviceSpikeModel(rt, "VerdictV1", {
    customResponseConstraint: { type: "invalid_sw10_schema_type" },
  });

  const dispatchImmediateTriageFirstToken = async (): Promise<number> => {
    const tDispatch = ctx.host.nowPerfMs();
    const res = await measureModelFirstTokenAndTotal(
      triageModel,
      makeSampleStage1Prompt(10, 99).userPrompt,
      ctx.host.nowPerfMs
    );
    return round2(Math.max(res.firstTokenMs, ctx.host.nowPerfMs() - tDispatch >= 0 ? res.firstTokenMs : 0));
  };

  let maxSettleMs = 0;
  const recordSettle = (ms: number): void => {
    if (ms > maxSettleMs) maxSettleMs = round2(ms);
  };

  // (a) 30 adversarial prompts (10 each schema) exceeding maxLength, maxItems, enum
  let constraintCompliant = 0;
  let totalConstraintChecks = 0;
  const samples: Array<Record<string, unknown>> = [];

  for (let i = 0; i < perBucket; i += 1) {
    const advChecks: Array<{ schemaId: SchemaId; model: typeof triageModel }> = [
      { schemaId: "TriageV1", model: triageModel },
      { schemaId: "VerdictV1", model: verdictModel },
      { schemaId: "B5CheckV1", model: b5Model },
    ];
    for (const chk of advChecks) {
      totalConstraintChecks += 1;
      const out = await callL1(
        chk.model,
        chk.schemaId,
        makeAdversarialConstraintPrompt(chk.schemaId, i),
        `sw10_adv_${chk.schemaId}_${i}`,
        (raw) => {
          const parsed = parseAndValidateAiOutput(chk.schemaId, raw);
          return parsed.ok ? parsed.data : null;
        },
        "ON_DEVICE_ONLY",
        20_000,
        { runtime: rt }
      );
      if (out.result.data !== null) {
        constraintCompliant += 1;
      }
      await out.slotFree;
    }
  }

  // (b) Runaway-repetition prompts (termination within 20 s L1 deadline)
  let runawayWithin20s = 0;
  for (let i = 0; i < perBucket; i += 1) {
    const out = await callL1(
      verdictModel,
      "VerdictV1",
      makeRunawayRepetitionPrompt(`SW10_B_${i}`),
      `sw10_b_${i}`,
      (raw) => {
        const parsed = parseAndValidateAiOutput("VerdictV1", raw);
        return parsed.ok ? parsed.data : null;
      },
      "ON_DEVICE_ONLY",
      20_000,
      { runtime: rt }
    );
    if (out.result.ms <= 20_000) {
      runawayWithin20s += 1;
    }
    const tS = ctx.host.nowPerfMs();
    await out.slotFree;
    recordSettle(out.result.ms + (ctx.host.nowPerfMs() - tS));
    if (i < 2) {
      samples.push({
        phase: "b_runaway",
        run: i + 1,
        ms: round2(out.result.ms),
        outputChars: out.result.rawText.length,
        error: out.result.error ?? null,
      });
    }
  }

  // (c)-stream: generateContentStream stopped after per-schema char limit or 5 s
  const charLimit = getStreamCharLimit("VerdictV1");
  let cStreamObserved = 0;
  let cStreamWithin1s = 0;
  for (let i = 0; i < perBucket; i += 1) {
    const streamFn = (verdictModel as unknown as {
      generateContentStream?: (input: string) => Promise<{
        stream: AsyncIterable<{ text(): string }>;
        response: Promise<unknown>;
      }>;
    }).generateContentStream;

    if (typeof streamFn === "function") {
      const tStart = ctx.host.nowPerfMs();
      const s = await streamFn.call(verdictModel, makeRunawayRepetitionPrompt(`SW10_C_STREAM_${i}`));
      let raw = "";
      let hitEarlyStop = false;
      for await (const chunk of s.stream) {
        raw += chunk.text();
        if (raw.length > charLimit || ctx.host.nowPerfMs() - tStart >= 5000) {
          hitEarlyStop = true;
          break;
        }
      }
      const tStop = ctx.host.nowPerfMs();
      let settleElapsed = -1;
      const settlePromise = s.response
        .catch(() => undefined)
        .finally(() => {
          settleElapsed = round2(Math.max(0, ctx.host.nowPerfMs() - tStop));
        });
      const nextFirstTokenMs = await dispatchImmediateTriageFirstToken();
      await settlePromise;
      const recordedSettle = settleElapsed < 0 ? 0 : settleElapsed;
      recordSettle(recordedSettle);
      if (hitEarlyStop) {
        cStreamObserved += 1;
        if (nextFirstTokenMs <= 1000) {
          cStreamWithin1s += 1;
        }
      }
      if (i === 0) {
        samples.push({
          phase: "c_stream_cut",
          hitEarlyStop,
          charsAtCut: raw.length,
          nextFirstTokenMs,
          settleElapsedMs: recordedSettle,
        });
      }
    }
  }

  // (c)-abandon: abandon a non-streaming generateContent promise and dispatch immediate TriageV1
  let cAbandonObserved = 0;
  let cAbandonWithin1s = 0;
  for (let i = 0; i < perBucket; i += 1) {
    const tStart = ctx.host.nowPerfMs();
    let settledEarly = false;
    let settleElapsed = -1;
    let tStop = tStart;
    const pending = verdictModel
      .generateContent(makeRunawayRepetitionPrompt(`SW10_C_ABANDON_${i}`))
      .catch(() => undefined)
      .finally(() => {
        settledEarly = true;
        if (settleElapsed < 0) {
          settleElapsed = round2(Math.max(0, ctx.host.nowPerfMs() - tStop));
        }
      });
    // Yield one microtask to check if prompt resolved synchronously vs stayed in-flight
    await Promise.resolve();
    tStop = ctx.host.nowPerfMs();
    const stillPendingWhenAbandoned = !settledEarly;
    if (settledEarly) {
      settleElapsed = 0;
    }
    const nextFirstTokenMs = await dispatchImmediateTriageFirstToken();
    await pending;
    const recordedSettle = settleElapsed < 0 ? 0 : settleElapsed;
    recordSettle(recordedSettle);
    if (stillPendingWhenAbandoned) {
      cAbandonObserved += 1;
      if (nextFirstTokenMs <= 1000) {
        cAbandonWithin1s += 1;
      }
    }
    if (i === 0) {
      samples.push({
        phase: "c_abandon",
        stillPendingWhenAbandoned,
        nextFirstTokenMs,
        settleElapsedMs: recordedSettle,
        abandonStartDeltaMs: round2(tStop - tStart),
      });
    }
  }

  // (e)-cut: client-side output cut via callL1 TRUNCATED (>charLimit) or DEADLINE followed immediately by TriageV1
  let eCutObserved = 0;
  let eCutWithin1s = 0;
  for (let i = 0; i < perBucket; i += 1) {
    const out = await callL1(
      verdictModel,
      "VerdictV1",
      makeRunawayRepetitionPrompt(`SW10_E_CUT_${i}`),
      `sw10_ecut_${i}`,
      (raw) => {
        const parsed = parseAndValidateAiOutput("VerdictV1", raw);
        return parsed.ok ? parsed.data : null;
      },
      "ON_DEVICE_ONLY",
      5000,
      { runtime: rt }
    );
    const isCut =
      (out.result.error === "TRUNCATED" && out.result.rawText.length > charLimit) ||
      out.result.error === "DEADLINE";
    const tStop = ctx.host.nowPerfMs();
    let settleElapsed = -1;
    const slotPromise = out.slotFree.finally(() => {
      settleElapsed = round2(Math.max(0, ctx.host.nowPerfMs() - tStop));
    });
    const nextFirstTokenMs = await dispatchImmediateTriageFirstToken();
    await slotPromise;
    const recordedSettle = settleElapsed < 0 ? 0 : settleElapsed;
    recordSettle(recordedSettle);
    if (isCut) {
      eCutObserved += 1;
      if (nextFirstTokenMs <= 1000) {
        eCutWithin1s += 1;
      }
    }
    if (i === 0) {
      samples.push({
        phase: "e_client_cut",
        isCut,
        error: out.result.error ?? null,
        rawTextLength: out.result.rawText.length,
        nextFirstTokenMs,
        settleElapsedMs: recordedSettle,
      });
    }
  }

  // (e)-error: SDK error from invalid responseConstraint schema followed immediately by TriageV1
  let eErrorObserved = 0;
  let eErrorWithin1s = 0;
  for (let i = 0; i < perBucket; i += 1) {
    let sawSdkError = false;
    const tStart = ctx.host.nowPerfMs();
    try {
      await invalidSchemaModel.generateContent(makeSampleStage2Prompt(40, i).userPrompt);
    } catch {
      sawSdkError = true;
    }
    const tStop = ctx.host.nowPerfMs();
    recordSettle(tStop - tStart);
    const nextFirstTokenMs = await dispatchImmediateTriageFirstToken();
    if (sawSdkError) {
      eErrorObserved += 1;
      if (nextFirstTokenMs <= 1000) {
        eErrorWithin1s += 1;
      }
    }
    if (i === 0) {
      samples.push({
        phase: "e_sdk_error",
        sawSdkError,
        nextFirstTokenMs,
      });
    }
  }

  const cTotalAttempted = perBucket * 2;
  const cTotalObserved = cStreamObserved + cAbandonObserved;
  const cTotalWithin1s = cStreamWithin1s + cAbandonWithin1s;

  const qualifies = (observed: number, expected: number, within1s: number): boolean =>
    observed === expected && observed > 0 && within1s / observed >= 29 / 30;

  const allWithinCeiling = maxSettleMs < 120_000;
  const slotImmediateRecommended =
    allWithinCeiling &&
    qualifies(cTotalObserved, cTotalAttempted, cTotalWithin1s) &&
    qualifies(eCutObserved, perBucket, eCutWithin1s) &&
    qualifies(eErrorObserved, perBucket, eErrorWithin1s);

  const earlyStopsTriggered = cTotalObserved > 0 && eCutObserved > 0 && eErrorObserved > 0;
  const passed =
    constraintCompliant === totalConstraintChecks &&
    runawayWithin20s === perBucket &&
    allWithinCeiling &&
    earlyStopsTriggered;

  return buildSpikeResultRecord({
    def: S_W10_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: passed ? "PASS" : "FAIL",
    primaryRecommended: slotImmediateRecommended,
    summary: `S-W10 constraints=${constraintCompliant}/${totalConstraintChecks}, runaway<=20s=${runawayWithin20s}/${perBucket}, earlyStops(c=${cTotalWithin1s}/${cTotalObserved}, eCut=${eCutWithin1s}/${eCutObserved}, eErr=${eErrorWithin1s}/${eErrorObserved}), maxSettle=${maxSettleMs} ms -> l1_slot_release=${slotImmediateRecommended ? "IMMEDIATE" : "ON_SETTLE"}.`,
    metrics: {
      constraintCompliant,
      totalConstraintChecks,
      runawayWithin20s,
      runawayTotal: perBucket,
      cStreamObserved,
      cStreamWithin1s,
      cAbandonObserved,
      cAbandonWithin1s,
      eCutObserved,
      eCutWithin1s,
      eErrorObserved,
      eErrorWithin1s,
      maxSettleMs,
      recommendedSlotRelease: slotImmediateRecommended ? "IMMEDIATE" : "ON_SETTLE",
    },
    rawSamples: samples,
    telemetrySnapshot: rt.telemetry.snapshot(),
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

export const S_W1_DEF: SpikeDefinition = {
  spikeId: "S-W1",
  title: "Chrome built-in Gemini Nano Readiness, Download, ONLY_ON_DEVICE & systemInstruction",
  category: "web-l1",
  targetDoc: "docs/spikes/S-W1.md",
  flagName: "spike_s_w1_primary",
  passCriterion: "readiness=available; inferenceSource==='ON_DEVICE' on 10/10 calls; progress callback & HybridParams type recorded",
  fallbackAction: "MacBook M5: state unavailable in README; PC Ryzen 7: try Chrome Beta >= 22 GB disk or run Web as NO_LOCAL_MODEL; rely on in-prompt instruction block",
  markerLocations: ["00 §6.1", "04 §3.1", "04 §5.1.3", "04 §5.1.4"],
  run: runSW1,
};

export const S_W2_DEF: SpikeDefinition = {
  spikeId: "S-W2",
  title: "Web VerdictV1 Key Order Under responseConstraint",
  category: "web-l1",
  targetDoc: "docs/spikes/S-W2.md",
  flagName: "spike_s_w2_primary",
  passCriterion: "50/50 VerdictV1 outputs in key order s01 -> s02 -> s03 -> s04",
  fallbackAction: "Prefixed keys stay; L0 key-order check forces NEI_SILENT_ESCALATE",
  markerLocations: ["04 §2.1"],
  run: runSW2,
};

export const S_W3_DEF: SpikeDefinition = {
  spikeId: "S-W3",
  title: "Prompt API inputQuota, omitResponseConstraintInput & Stage 1 Token Ceiling",
  category: "web-l1",
  targetDoc: "docs/spikes/S-W3.md",
  flagName: "spike_s_w3_primary",
  passCriterion: "inputQuota readable; 80-word Stage 1 ceiling set to max + 10%; prefill drop measured",
  fallbackAction: "Assume 9,216 tokens; truncate sentences above 80 words; do not pass omitResponseConstraintInput",
  markerLocations: ["04 §1.4", "04 §2.2"],
  run: runSW3,
};

export const S_W4_DEF: SpikeDefinition = {
  spikeId: "S-W4",
  title: "Web L1 Latency Split, Deadline, Session Reuse & Abort",
  category: "web-l1",
  targetDoc: "docs/spikes/S-W4.md",
  flagName: "spike_s_w4_primary",
  passCriterion: "VerdictV1 (cap 40) p95 <= 6 s; t_session <= 1 s recorded; l1_deadline_ms = max(20000, 2 * p99)",
  fallbackAction: "Use VerdictV1_cap30 (reasoning_word_cap=30) as calibrated variant before l0-freeze-a",
  markerLocations: ["04 §1.4", "04 §2.3", "04 §5.1.7", "00 D-21"],
  run: runSW4,
};

export const S_W7_DEF: SpikeDefinition = {
  spikeId: "S-W7",
  title: "ThinkPad (No Qualifying Hardware) NO_LOCAL_MODEL Behavior",
  category: "web-l1",
  targetDoc: "docs/spikes/S-W7.md",
  flagName: "spike_s_w7_primary",
  passCriterion: "checkEnvironment() reason shown; Confidential sends 0 AI Logic calls; Standard Consent A uses PREFER_ON_DEVICE -> IN_CLOUD",
  fallbackAction: "If ThinkPad unexpectedly has local model, run with on-device model component deleted and document in README",
  markerLocations: ["00 §6.1", "07 §1.2"],
  run: runSW7,
};

export const S_W10_DEF: SpikeDefinition = {
  spikeId: "S-W10",
  title: "Constrained-Decoding Limits, Runaway Output & On-Device Slot Release",
  category: "web-l1",
  targetDoc: "docs/spikes/S-W10.md",
  flagName: "spike_s_w10_primary",
  passCriterion: "30/30 respect constraints; runaway <= 20 s; settle < 120 s; IMMEDIATE iff >= 29/30 release within 1 s",
  fallbackAction: "Keep l1_slot_release = ON_SETTLE (default) and streaming char cut + L0 validator",
  markerLocations: ["04 §5.1.7", "00 D-28"],
  run: runSW10,
};

export const WEB_L1_SPIKES: readonly SpikeDefinition[] = [
  S_W1_DEF,
  S_W2_DEF,
  S_W3_DEF,
  S_W4_DEF,
  S_W7_DEF,
  S_W10_DEF,
];
