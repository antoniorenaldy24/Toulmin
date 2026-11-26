/**
 * Web L1 call wrapper (`04` §5.1.7, D-28):
 * streaming output cut, L1 deadline, ON_SETTLE vs IMMEDIATE slot release,
 * settle ceiling, UNEXPECTED_CLOUD guard, prompt-hash guard, and L0 validation chain.
 */

import { InferenceSource, type GenerateContentStreamResult, type GenerativeModel } from "firebase/ai";
import {
  createSanitizerUnitBlocker,
  sanitizeText,
} from "@toulmin/core-l0";
import {
  validateLocalVerdict,
  type AnchorEvidenceInput,
  type AnchorValidationResult,
} from "@toulmin/core-l0/anchor";
import { checkL1B5Output, type B5CheckVerdict } from "@toulmin/core-l0/b5pairing";
import { baselineTriage } from "@toulmin/core-l0/triageBaseline";
import { PROMPT_VERSION, verifyPromptHashes } from "@toulmin/prompts";
import {
  parseAndValidateAiOutput,
  streamCharLimit,
  type AiClaimType,
  type AiWorthLevel,
  type B5CheckV1,
  type InferenceSourceTag,
  type SchemaId,
  type Stage1Atom,
  type TransientReason,
  type TriageFlatV1,
  type TriageV1,
  type VerdictFlatV1,
  type VerdictV1,
} from "@toulmin/schemas";
import { BUILD_FLAGS } from "../buildFlags.js";
import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import { DEFAULT_SETTLE_CEILING_MS, parseWebDeadlineMs } from "../rcDefaults.js";
import { classify } from "../telemetry.js";
import { raceWithDeadline } from "./deadline.js";
import { reasoningCapForSchema } from "./models.js";
import { waitForSlotRelease, type SlotReleaseMode, type SlotStatus } from "./settle.js";
import { looksTruncated } from "./truncation.js";

export type { TransientReason };

export type L1ErrorCode =
  | TransientReason
  | "PARSE"
  | "KEY_ORDER"
  | "SCHEMA"
  | "NOT_SUPPORTED"
  | "QUOTA"
  | "UNEXPECTED_CLOUD"
  | "PROMPT_HASH_MISMATCH";

export interface L1Result<T> {
  readonly data: T | null;
  readonly rawText: string;
  readonly inferenceSource: InferenceSourceTag;
  readonly ms: number;
  readonly error?: L1ErrorCode;
}

export interface CallL1Output<T> {
  readonly result: L1Result<T>;
  readonly slotFree: Promise<SlotStatus>;
}

export interface CallL1Options {
  readonly runtime?: FirebaseRuntime;
  readonly pairKey?: string;
  readonly verifyPrompts?: boolean;
}

export function isTransient(error?: string): error is TransientReason {
  return (
    error === "DEADLINE" ||
    error === "TRUNCATED" ||
    error === "BUSY" ||
    error === "NETWORK" ||
    error === "SLOT_LOST" ||
    error === "OTHER"
  );
}

export function normalizeInferenceSource(raw: unknown): InferenceSourceTag {
  if (raw === InferenceSource.ON_DEVICE || raw === "ON_DEVICE") {
    return "ON_DEVICE";
  }
  if (raw === InferenceSource.IN_CLOUD || raw === "IN_CLOUD") {
    return "IN_CLOUD";
  }
  return "NONE";
}

export function getStreamCharLimit(schemaId: SchemaId): number {
  return streamCharLimit(schemaId);
}

export interface SanitizerFilterResult {
  readonly cleanEvidence: readonly string[];
  readonly blockedIndices: readonly number[];
  readonly suspicious: boolean;
}

/**
 * Caller-side defense: filters out sanitizer-blocked evidence units BEFORE
 * passing evidence arrays into `buildStage2Prompt` / `buildL2Prompt`.
 */
export function filterSanitizerBlockedEvidence(
  evidence: readonly string[]
): SanitizerFilterResult {
  const isBlocked = createSanitizerUnitBlocker();
  const cleanEvidence: string[] = [];
  const blockedIndices: number[] = [];

  for (let i = 0; i < evidence.length; i += 1) {
    const unit = evidence[i] ?? "";
    const res = sanitizeText(unit);
    if (res.blocked || isBlocked({ text: unit })) {
      blockedIndices.push(i);
    } else {
      cleanEvidence.push(res.text);
    }
  }

  return {
    cleanEvidence,
    blockedIndices,
    suspicious: blockedIndices.length > 0,
  };
}

export function assertPromptHashesReady(
  runtime: FirebaseRuntime = getDefaultRuntime()
): { readonly ok: true } | { readonly ok: false; readonly error: "PROMPT_HASH_MISMATCH" } {
  const expectedVersion = runtime.rcReader.getString("prompt_version") || PROMPT_VERSION;
  if (expectedVersion !== PROMPT_VERSION) {
    runtime.telemetry.defect("PROMPT_HASH_MISMATCH");
    return { ok: false, error: "PROMPT_HASH_MISMATCH" };
  }
  const verification = verifyPromptHashes(BUILD_FLAGS.promptHashes);
  if (!verification.ok) {
    runtime.telemetry.defect("PROMPT_HASH_MISMATCH");
    return { ok: false, error: "PROMPT_HASH_MISMATCH" };
  }
  return { ok: true };
}

export type Stage2SchemaId =
  | "VerdictV1"
  | "VerdictV1_cap30"
  | "VerdictV1_cap20"
  | "VerdictFlatV1";

export interface Stage2ValidationOutcome {
  readonly ok: boolean;
  readonly error?: "PARSE" | "KEY_ORDER" | "SCHEMA";
  readonly validation: AnchorValidationResult;
  readonly rawVerdict: "SUPPORTED" | "CONTRADICTS" | "NEI_SILENT_ESCALATE";
  readonly microReasoning: string;
  readonly evidenceIdx: number;
}

export function validateStage2RawOutput(
  schemaId: Stage2SchemaId,
  rawText: string,
  evidence: readonly AnchorEvidenceInput[],
  claim: string,
  options?: {
    readonly calibratedVariant?: { readonly schemaId: string; readonly reasoningCap: number };
    readonly actualVariant?: { readonly schemaId: string; readonly reasoningCap: number };
    readonly lang?: string;
    readonly runtime?: FirebaseRuntime;
  }
): Stage2ValidationOutcome {
  const runtime = options?.runtime ?? getDefaultRuntime();
  const parsed = parseAndValidateAiOutput(schemaId, rawText);

  if (!parsed.ok) {
    if (parsed.error === "KEY_ORDER") {
      runtime.telemetry.defect("KEY_ORDER_VIOLATION");
    }
    return {
      ok: false,
      error: parsed.error,
      validation: {
        verdict: "NEI_SILENT_ESCALATE",
        anchor: null,
        failReason: null,
        noDifferenceNote: false,
      },
      rawVerdict: "NEI_SILENT_ESCALATE",
      microReasoning: "",
      evidenceIdx: -1,
    };
  }

  const out = parsed.data as VerdictV1 | VerdictFlatV1;
  const rawVerdict: "SUPPORTED" | "CONTRADICTS" | "NEI_SILENT_ESCALATE" =
    out.s04_verdict === "SUPPORTED" ||
    out.s04_verdict === "CONTRADICTS" ||
    out.s04_verdict === "NEI_SILENT_ESCALATE"
      ? out.s04_verdict
      : "NEI_SILENT_ESCALATE";

  const configuredCap = runtime.rcReader.getNumber("reasoning_word_cap");
  const actualVariant =
    options?.calibratedVariant !== undefined
      ? (options.actualVariant ?? {
          schemaId,
          reasoningCap: reasoningCapForSchema(
            schemaId,
            Number.isFinite(configuredCap) && configuredCap > 0 ? configuredCap : 40
          ),
        })
      : options?.actualVariant;

  const validation = validateLocalVerdict(
    {
      s01_evidence_span: out.s01_evidence_span,
      s02_evidence_idx: out.s02_evidence_idx,
      s03_micro_reasoning: out.s03_micro_reasoning,
      s04_verdict: rawVerdict,
    },
    evidence,
    claim,
    {
      ...(options?.calibratedVariant !== undefined
        ? { calibratedVariant: options.calibratedVariant }
        : {}),
      ...(actualVariant !== undefined ? { actualVariant } : {}),
      ...(options?.lang !== undefined ? { lang: options.lang } : {}),
    }
  );

  return {
    ok: true,
    validation,
    rawVerdict,
    microReasoning: out.s03_micro_reasoning,
    evidenceIdx: out.s02_evidence_idx,
  };
}

export interface ValidatedStage1Output {
  readonly atoms: Stage1Atom[];
  readonly worth: AiWorthLevel;
  readonly uncited: boolean;
  readonly bibIndices: number[];
  readonly usedBaselineAtoms: boolean;
}

const VALID_CLAIM_TYPES: ReadonlySet<string> = new Set<AiClaimType>([
  "QUANTITATIVE",
  "CAUSAL",
  "COMPARATIVE",
  "EXISTENCE",
  "METHODOLOGICAL",
  "NON_EMPIRICAL",
]);

function mergeOverlappingAtoms(atoms: readonly Stage1Atom[]): Stage1Atom[] {
  if (atoms.length <= 1) return [...atoms];
  const sorted = [...atoms].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Stage1Atom[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const prev = merged[merged.length - 1]!;
    if (cur.start <= prev.end) {
      merged[merged.length - 1] = {
        start: prev.start,
        end: Math.max(prev.end, cur.end),
        claimType: prev.claimType,
      };
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

export function validateStage1RawOutput(
  schemaId: "TriageV1" | "TriageFlatV1",
  rawText: string,
  context: {
    readonly wordCount: number;
    readonly candidateCount: number;
    readonly hasCitation: boolean;
    readonly clauseText: string;
    readonly section: string;
    readonly runtime?: FirebaseRuntime;
  }
): { readonly ok: true; readonly data: ValidatedStage1Output } | { readonly ok: false; readonly error: "PARSE" | "KEY_ORDER" | "SCHEMA" } {
  const parsed = parseAndValidateAiOutput(schemaId, rawText);
  if (!parsed.ok) {
    if (parsed.error === "KEY_ORDER") {
      (context.runtime ?? getDefaultRuntime()).telemetry.defect("KEY_ORDER_VIOLATION");
    }
    return { ok: false, error: parsed.error };
  }

  let validAtoms: Stage1Atom[] = [];
  let worth: AiWorthLevel;
  let uncited: boolean;
  let rawBib: readonly number[] = [];

  if (schemaId === "TriageV1") {
    const data = parsed.data as TriageV1;
    worth = data.s2_worth;
    uncited = data.s3_uncited;
    rawBib = data.s4_bib;
    for (const atom of data.s1_atoms) {
      if (
        Number.isInteger(atom.a1_start) &&
        Number.isInteger(atom.a2_end) &&
        atom.a1_start >= 0 &&
        atom.a1_start <= atom.a2_end &&
        atom.a2_end < context.wordCount
      ) {
        validAtoms.push({
          start: atom.a1_start,
          end: atom.a2_end,
          claimType: atom.a3_type,
        });
      }
    }
    validAtoms = mergeOverlappingAtoms(validAtoms);
  } else {
    const data = parsed.data as TriageFlatV1;
    worth = data.s4_worth;
    uncited = data.s5_uncited;
    if (
      Number.isInteger(data.s1_start) &&
      Number.isInteger(data.s2_end) &&
      data.s1_start >= 0 &&
      data.s1_start <= data.s2_end &&
      data.s2_end < context.wordCount &&
      VALID_CLAIM_TYPES.has(data.s3_type)
    ) {
      validAtoms = [
        {
          start: data.s1_start,
          end: data.s2_end,
          claimType: data.s3_type,
        },
      ];
    }
  }

  let usedBaselineAtoms = false;
  if (validAtoms.length === 0) {
    usedBaselineAtoms = true;
    const base = baselineTriage({
      clauseText: context.clauseText,
      section: context.section,
      hasResolvedCitation: context.hasCitation,
    });
    validAtoms = base.atoms;
  }

  const bibIndices = context.hasCitation
    ? []
    : rawBib.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < context.candidateCount);

  return {
    ok: true,
    data: {
      atoms: validAtoms,
      worth,
      uncited,
      bibIndices,
      usedBaselineAtoms,
    },
  };
}

export function validateB5RawOutput(
  rawText: string,
  runtime: FirebaseRuntime = getDefaultRuntime()
):
  | { readonly ok: true; readonly data: B5CheckV1; readonly verdict: B5CheckVerdict }
  | { readonly ok: false; readonly error: "PARSE" | "KEY_ORDER" | "SCHEMA" } {
  const parsed = parseAndValidateAiOutput("B5CheckV1", rawText);
  if (!parsed.ok) {
    if (parsed.error === "KEY_ORDER") {
      runtime.telemetry.defect("KEY_ORDER_VIOLATION");
    }
    return { ok: false, error: parsed.error };
  }
  return {
    ok: true,
    data: parsed.data,
    verdict: checkL1B5Output(parsed.data),
  };
}

function getSlotReleaseMode(runtime: FirebaseRuntime): SlotReleaseMode {
  return runtime.rcReader.getString("l1_slot_release") === "IMMEDIATE"
    ? "IMMEDIATE"
    : "ON_SETTLE";
}

function getSettleCeilingMs(runtime: FirebaseRuntime): number {
  const configured = runtime.rcReader.getNumber("l1_settle_ceiling_ms");
  return configured > 0 ? configured : DEFAULT_SETTLE_CEILING_MS;
}

export async function callL1<T>(
  model: GenerativeModel,
  schemaId: SchemaId,
  prompt: string,
  resultKey: string,
  validate: (raw: string) => T | null,
  expect: "ON_DEVICE_ONLY" | "HYBRID",
  deadlineMs?: number,
  options?: CallL1Options
): Promise<CallL1Output<T>> {
  const runtime = options?.runtime ?? getDefaultRuntime();
  const effectiveDeadlineMs =
    deadlineMs ?? parseWebDeadlineMs(runtime.rcReader.getString("l1_deadline_ms"));

  if (options?.verifyPrompts !== false) {
    const promptOk = assertPromptHashesReady(runtime);
    if (!promptOk.ok) {
      return {
        result: {
          data: null,
          rawText: "",
          inferenceSource: "NONE",
          ms: 0,
          error: "PROMPT_HASH_MISMATCH",
        },
        slotFree: Promise.resolve("FREE"),
      };
    }
  }

  if (runtime.sessionCache.localUnavailable && expect === "ON_DEVICE_ONLY") {
    return {
      result: {
        data: null,
        rawText: "",
        inferenceSource: "NONE",
        ms: 0,
        error: "SLOT_LOST",
      },
      slotFree: Promise.resolve("FREE"),
    };
  }

  if (options?.pairKey !== undefined) {
    runtime.sessionCache.registerInFlightKey(resultKey, options.pairKey);
  }

  const t0 = performance.now();
  let settleCalled = false;
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = () => {
      if (!settleCalled) {
        settleCalled = true;
        resolve();
      }
    };
  });

  let cut = false;
  let streamObj: GenerateContentStreamResult | null = null;
  let responseSettleAttached = false;

  const attachResponseSettle = (s: GenerateContentStreamResult): void => {
    if (!responseSettleAttached) {
      responseSettleAttached = true;
      s.response.then(
        () => settle(),
        () => settle()
      );
    }
  };

  const work = (async (): Promise<L1Result<T>> => {
    try {
      const stream = await model.generateContentStream(prompt);
      streamObj = stream;
      let raw = "";
      const limit = getStreamCharLimit(schemaId);
      for await (const chunk of stream.stream) {
        raw += chunk.text();
        if (raw.length > limit) {
          cut = true;
          break;
        }
      }
      if (cut) {
        attachResponseSettle(stream);
      }
      const res = cut ? null : await stream.response;
      const src = normalizeInferenceSource(res?.inferenceSource);
      const elapsed = performance.now() - t0;
      runtime.telemetry.record({ src, ms: elapsed, schema: schemaId });

      if (expect === "ON_DEVICE_ONLY" && src === "IN_CLOUD") {
        runtime.telemetry.defect("UNEXPECTED_CLOUD");
        return {
          data: null,
          rawText: "",
          inferenceSource: src,
          ms: elapsed,
          error: "UNEXPECTED_CLOUD",
        };
      }

      if (cut || looksTruncated(raw)) {
        return {
          data: null,
          rawText: raw,
          inferenceSource: src,
          ms: elapsed,
          error: "TRUNCATED",
        };
      }

      const keyOrderBefore = runtime.telemetry
        .snapshot()
        .defects.filter((d) => d === "KEY_ORDER_VIOLATION").length;
      const data = validate(raw);
      if (data === null) {
        const keyOrderAfter = runtime.telemetry
          .snapshot()
          .defects.filter((d) => d === "KEY_ORDER_VIOLATION").length;
        const preCheck = parseAndValidateAiOutput(schemaId, raw);
        let errCode: L1ErrorCode = "SCHEMA";
        if (!preCheck.ok) {
          if (preCheck.error === "KEY_ORDER" && keyOrderAfter === keyOrderBefore) {
            runtime.telemetry.defect("KEY_ORDER_VIOLATION");
          }
          errCode = preCheck.error;
        }
        return {
          data: null,
          rawText: raw,
          inferenceSource: src,
          ms: elapsed,
          error: errCode,
        };
      }

      return {
        data,
        rawText: raw,
        inferenceSource: src,
        ms: elapsed,
      };
    } catch (e) {
      if (streamObj !== null) {
        attachResponseSettle(streamObj);
      }
      return {
        data: null,
        rawText: "",
        inferenceSource: "NONE",
        ms: performance.now() - t0,
        error: classify(e),
      };
    } finally {
      if (!responseSettleAttached) {
        settle();
      }
    }
  })();

  const result = await raceWithDeadline<L1Result<T>>(work, effectiveDeadlineMs, () => ({
    data: null,
    rawText: "",
    inferenceSource: "NONE",
    ms: effectiveDeadlineMs,
    error: "DEADLINE",
  }));

  if (result.error === "DEADLINE") {
    void work.then((late) => {
      if (late.data !== null) {
        runtime.sessionCache.putLate(
          resultKey,
          {
            data: late.data,
            inferenceSource: late.inferenceSource,
            ms: late.ms,
          },
          options?.pairKey
        );
      }
    });
  }

  if (options?.pairKey !== undefined && isTransient(result.error)) {
    runtime.sessionCache.recordTransient(options.pairKey, result.error);
  }

  const earlyStop =
    result.error !== undefined &&
    result.error !== "SCHEMA" &&
    result.error !== "PARSE" &&
    result.error !== "KEY_ORDER" &&
    result.error !== "UNEXPECTED_CLOUD" &&
    result.error !== "PROMPT_HASH_MISMATCH";

  const slotFree = waitForSlotRelease({
    earlyStop,
    mode: getSlotReleaseMode(runtime),
    settled,
    ceilingMs: getSettleCeilingMs(runtime),
  }).then((status) => {
    if (status === "LOST") {
      runtime.sessionCache.markSlotLost(options?.pairKey);
    }
    return status;
  });

  return { result, slotFree };
}
