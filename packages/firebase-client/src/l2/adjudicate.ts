/**
 * L2 cloud single-call adjudicators (`l2Adjudicate`, `l2AdjudicateProvided`),
 * deterministic `TEXT_JSON` fallback parser, and the seven L0 post-checks
 * (`04` §3.6.1–§3.6.4, §4.1, §5.1.4, D-19, D-21, D-22, AC-L2-04..06, AC-GND-01).
 */

import {
  InferenceMode,
  type GenerateContentResult,
  type GenerativeModel,
  type HybridParams,
} from "firebase/ai";
import {
  createSanitizerUnitBlocker,
  sanitizeText,
  sha256hex,
} from "@toulmin/core-l0";
import { validateL2Verdict, type AnchorEvidenceInput } from "@toulmin/core-l0/anchor";
import { cloudResultKey } from "@toulmin/core-l0/ledger";
import { EN_COPY } from "@toulmin/copy";
import { buildL2Prompt, PROMPT_VERSION, type L2ReferenceMetadata } from "@toulmin/prompts";
import {
  isValidDoi,
  parseAndValidateAiOutput,
  SCHEMAS,
  validateCloudResult,
  type CloudResult,
  type CloudVerdict,
  type InferenceSourceTag,
  type L2Verdict,
} from "@toulmin/schemas";
import { BUILD_FLAGS, type L2Mode, type L2ThinkingConfig } from "../buildFlags.js";
import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import { memo } from "../l1/models.js";
import { normalizeInferenceSource } from "../l1/call.js";
import { DEFAULT_CLOUD_MODEL } from "../rcDefaults.js";
import { toFirebaseSchema } from "../schemas/toFirebaseSchema.js";
import {
  filterGroundingSources,
  type GroundingChunk,
  type GroundingDisplaySource,
} from "./grounding.js";

export const L2_MODE: L2Mode = BUILD_FLAGS.l2Mode;
const DEFAULT_L2_THINKING: L2ThinkingConfig | undefined = BUILD_FLAGS.l2Thinking;

export interface L2ModelOptions {
  readonly mode?: L2Mode;
  readonly thinkingConfig?: L2ThinkingConfig | undefined;
}

function l2Config(
  withSchema: boolean,
  thinkingConfig: L2ThinkingConfig | undefined
): NonNullable<NonNullable<HybridParams["inCloudParams"]>["generationConfig"]> {
  return {
    ...(withSchema
      ? {
          responseMimeType: "application/json",
          responseSchema: toFirebaseSchema(SCHEMAS.L2Verdict),
        }
      : {}),
    maxOutputTokens: 2048,
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };
}

export function l2Adjudicate(
  runtime: FirebaseRuntime = getDefaultRuntime(),
  options?: L2ModelOptions
): GenerativeModel {
  const mode = options?.mode ?? L2_MODE;
  const thinking =
    options && "thinkingConfig" in options ? options.thinkingConfig : DEFAULT_L2_THINKING;
  const thinkingKey = thinking ? thinking.thinkingLevel : "NONE";
  return memo(
    `cloud:l2Adjudicate:${mode}:${thinkingKey}`,
    () => {
      const params: HybridParams = {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: runtime.rcReader.getString("cloud_model") || DEFAULT_CLOUD_MODEL,
          tools: [{ googleSearch: {} }],
          generationConfig: l2Config(mode === "SCHEMA", thinking),
        },
      };
      return runtime.sdk.getGenerativeModel(runtime.ai, params);
    },
    runtime.modelRegistry
  );
}

export function l2AdjudicateProvided(
  runtime: FirebaseRuntime = getDefaultRuntime(),
  options?: Pick<L2ModelOptions, "thinkingConfig">
): GenerativeModel {
  const thinking =
    options && "thinkingConfig" in options ? options.thinkingConfig : DEFAULT_L2_THINKING;
  const thinkingKey = thinking ? thinking.thinkingLevel : "NONE";
  return memo(
    `cloud:l2AdjudicateProvided:${thinkingKey}`,
    () => {
      const params: HybridParams = {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: runtime.rcReader.getString("cloud_model") || DEFAULT_CLOUD_MODEL,
          generationConfig: l2Config(true, thinking),
        },
      };
      return runtime.sdk.getGenerativeModel(runtime.ai, params);
    },
    runtime.modelRegistry
  );
}

function extractFirstJsonFencedBlock(raw: string): string | null {
  const fenceStart = "```json";
  const lower = raw.toLowerCase();
  const idx = lower.indexOf(fenceStart);
  if (idx === -1) {
    return null;
  }
  const afterHeader = idx + fenceStart.length;
  // Skip optional whitespace / newline after ```json
  let contentStart = afterHeader;
  while (contentStart < raw.length) {
    const ch = raw.charAt(contentStart);
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      contentStart += 1;
      if (ch === "\n") break;
    } else {
      break;
    }
  }
  const closeIdx = raw.indexOf("```", contentStart);
  if (closeIdx === -1) {
    return null;
  }
  return raw.slice(contentStart, closeIdx).trim();
}

function extractFirstBalancedJsonObject(raw: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}

function stripTrailingJsonCommas(jsonText: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonText.length; i += 1) {
    const ch = jsonText.charAt(i);
    if (inString) {
      out.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out.push(ch);
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < jsonText.length) {
        const next = jsonText.charAt(j);
        if (next === " " || next === "\t" || next === "\n" || next === "\r") {
          j += 1;
        } else {
          break;
        }
      }
      const nextNonWs = jsonText.charAt(j);
      if (nextNonWs === "}" || nextNonWs === "]") {
        continue;
      }
    }
    out.push(ch);
  }
  return out.join("");
}

export type ParseTextJsonL2Result =
  | { readonly ok: true; readonly data: L2Verdict }
  | {
      readonly ok: false;
      readonly error: "PARSE" | "KEY_ORDER" | "SCHEMA";
      readonly message: string;
    };

/**
 * Deterministic L0 parser for single-call `TEXT_JSON` fallback (`04` §3.6.4):
 * extracts first ```` ```json ```` block or balanced `{...}` object, strips trailing
 * commas before `}` or `]`, and validates against `L2Verdict` (including key order).
 * Never triggers a second model call.
 */
export function parseTextJsonL2(rawText: string): ParseTextJsonL2Result {
  const extracted =
    extractFirstJsonFencedBlock(rawText) ?? extractFirstBalancedJsonObject(rawText);
  if (extracted === null) {
    return {
      ok: false,
      error: "PARSE",
      message: EN_COPY.cloud.unreadableJson,
    };
  }
  const cleaned = stripTrailingJsonCommas(extracted);
  const validated = parseAndValidateAiOutput("L2Verdict", cleaned);
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.error,
      message: EN_COPY.cloud.unreadableJson,
    };
  }
  return { ok: true, data: validated.data };
}

export interface ResolvedAlternativeDoi {
  readonly doi: string;
  readonly title: string | null;
}

export type DoiResolverHook = (
  dois: readonly string[]
) => Promise<ReadonlyMap<string, ResolvedAlternativeDoi>>;

export interface L2SessionDisplay {
  readonly isWebSourceOnly: boolean;
  readonly sessionVerdict: CloudVerdict;
  readonly sessionQuote: string | null;
  readonly sessionReasoning: string;
  readonly label: string | null;
  readonly hideRerunUntilEvidenceVersionChanges: boolean;
  readonly providedEvidenceOnly: boolean;
  readonly renderedContent: string | null;
  readonly groundingChunks: readonly GroundingChunk[];
  readonly sources: readonly GroundingDisplaySource[];
  readonly resolvedAlternatives: readonly ResolvedAlternativeDoi[];
}

export interface AdjudicateClaimL2Input {
  readonly normalizedClaimHash: string;
  readonly approvedClaimText: string;
  readonly refId: string;
  readonly reference: L2ReferenceMetadata;
  readonly publisherHost?: string | null;
  readonly evidence: readonly AnchorEvidenceInput[];
  readonly suspicious: boolean;
  readonly hasExcludedUserPdf?: boolean;
  readonly adjudicator?: "l2Adjudicate" | "l2AdjudicateProvided";
  readonly mode?: L2Mode;
  readonly decidedAt?: number;
}

export interface AdjudicateClaimL2Deps {
  readonly runtime?: FirebaseRuntime;
  readonly model?: GenerativeModel;
  readonly resolveAlternativeDois?: DoiResolverHook;
}

export interface AdjudicateClaimL2Output {
  readonly persisted: CloudResult;
  readonly sessionDisplay: L2SessionDisplay | null;
  readonly inferenceSource: InferenceSourceTag;
  readonly statusMessage: string | null;
}

function evidenceUnitText(unit: AnchorEvidenceInput): string {
  return typeof unit === "string" ? unit : unit.text;
}

function filterCleanL2Evidence(
  evidence: readonly AnchorEvidenceInput[],
  defaultRefId: string
): {
  readonly cleanUnits: AnchorEvidenceInput[];
  readonly cleanTexts: string[];
  readonly anyBlocked: boolean;
} {
  const isBlocked = createSanitizerUnitBlocker();
  const cleanUnits: AnchorEvidenceInput[] = [];
  const cleanTexts: string[] = [];
  let anyBlocked = false;

  for (let i = 0; i < evidence.length; i += 1) {
    const unit = evidence[i]!;
    const raw = evidenceUnitText(unit);
    const res = sanitizeText(raw);
    if (res.blocked || isBlocked({ text: raw })) {
      anyBlocked = true;
      continue;
    }
    if (typeof unit === "string") {
      cleanUnits.push({
        text: res.text,
        refId: defaultRefId,
        sourceKind: "ABSTRACT",
        chunkId: `ev_${i}`,
      });
    } else {
      cleanUnits.push({
        ...unit,
        text: res.text,
        refId: unit.refId && unit.refId.length > 0 ? unit.refId : defaultRefId,
        sourceKind: unit.sourceKind ?? "ABSTRACT",
        chunkId: unit.chunkId && unit.chunkId.length > 0 ? unit.chunkId : `ev_${i}`,
      });
    }
    cleanTexts.push(res.text);
  }

  return { cleanUnits, cleanTexts, anyBlocked };
}

const L2_MAX_EVIDENCE_BLOCKS = 8;
const L2_MAX_EVIDENCE_TOKENS = 6000;

export function normalizeDoi(raw: string): string {
  let s = raw.trim().toLowerCase();
  const prefixes = [
    "https://doi.org/",
    "http://doi.org/",
    "https://dx.doi.org/",
    "http://dx.doi.org/",
    "doi:",
  ];
  for (const prefix of prefixes) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length).trim();
      break;
    }
  }
  return s;
}

export async function resolveAlternativeDoiList(
  rawDois: readonly string[],
  resolveAlternativeDois: DoiResolverHook | undefined
): Promise<ResolvedAlternativeDoi[]> {
  if (!resolveAlternativeDois || rawDois.length === 0) {
    return [];
  }
  const candidateDois = Array.from(
    new Set(rawDois.map(normalizeDoi).filter((d) => isValidDoi(d)))
  );
  if (candidateDois.length === 0) {
    return [];
  }
  const resolvedMap = await resolveAlternativeDois(candidateDois);
  const resolved: ResolvedAlternativeDoi[] = [];
  for (const doi of candidateDois) {
    const hit = resolvedMap.get(doi);
    if (hit !== undefined && !resolved.some((r) => r.doi === hit.doi)) {
      resolved.push(hit);
    }
  }
  return resolved;
}

function estimateEvidenceTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(Math.ceil(text.length / 3.2) * 1.25);
}

function capL2Evidence(
  units: readonly AnchorEvidenceInput[],
  texts: readonly string[]
): {
  readonly cappedUnits: AnchorEvidenceInput[];
  readonly cappedTexts: string[];
} {
  const cappedUnits: AnchorEvidenceInput[] = [];
  const cappedTexts: string[] = [];
  let tokenTotal = 0;
  const maxBlocks = Math.min(units.length, texts.length, L2_MAX_EVIDENCE_BLOCKS);
  for (let i = 0; i < maxBlocks; i += 1) {
    const t = texts[i]!;
    const wrappedApprox = `<<EVIDENCE id=${i}>>\n${t}\n<</EVIDENCE>>`;
    const nextTokens = estimateEvidenceTokens(wrappedApprox);
    if (tokenTotal + nextTokens > L2_MAX_EVIDENCE_TOKENS) {
      break;
    }
    tokenTotal += nextTokens;
    cappedUnits.push(units[i]!);
    cappedTexts.push(t);
  }
  return { cappedUnits, cappedTexts };
}

function buildPersistedCloudResult(params: {
  readonly normalizedClaimHash: string;
  readonly approvedTextSha256: string;
  readonly refId: string;
  readonly verdict: CloudVerdict;
  readonly quote: string | null;
  readonly quoteAnchor: CloudResult["quoteAnchor"];
  readonly alternativesDois: string[];
  readonly noDifferenceNote: boolean;
  readonly adjudicator: "l2Adjudicate" | "l2AdjudicateProvided";
  readonly inferenceSource: InferenceSourceTag;
  readonly decidedAt: number;
}): CloudResult {
  const resultKey = cloudResultKey(
    params.normalizedClaimHash,
    params.approvedTextSha256,
    params.refId,
    PROMPT_VERSION,
    params.adjudicator
  );
  const result: CloudResult = {
    resultKey,
    normalizedClaimHash: params.normalizedClaimHash,
    refId: params.refId,
    verdict: params.verdict,
    quote: params.quote,
    quoteAnchor: params.quoteAnchor,
    approvedTextSha256: params.approvedTextSha256,
    alternativesDois: params.alternativesDois,
    noDifferenceNote: params.noDifferenceNote,
    adjudicator: params.adjudicator,
    inferenceSource: params.inferenceSource,
    promptVersion: PROMPT_VERSION,
    decidedAt: params.decidedAt,
  };
  const check = validateCloudResult(result);
  if (!check.ok) {
    throw new Error(`Invalid CloudResult constructed: ${check.errors.join("; ")}`);
  }
  return result;
}

/**
 * Executes a single L2 call (`l2Adjudicate` or `l2AdjudicateProvided`) and applies
 * all seven deterministic L0 post-checks (`04` §4.1).
 */
export async function adjudicateClaimL2(
  input: AdjudicateClaimL2Input,
  deps?: AdjudicateClaimL2Deps
): Promise<AdjudicateClaimL2Output> {
  const runtime = deps?.runtime ?? getDefaultRuntime();
  const adjudicator = input.adjudicator ?? "l2Adjudicate";
  const effectiveMode: L2Mode =
    adjudicator === "l2AdjudicateProvided" ? "SCHEMA" : (input.mode ?? L2_MODE);

  const { cleanUnits, cleanTexts, anyBlocked } = filterCleanL2Evidence(
    input.evidence,
    input.refId
  );
  const { cappedUnits, cappedTexts } = capL2Evidence(cleanUnits, cleanTexts);
  const suspicious = input.suspicious || anyBlocked;

  const builtPrompt = buildL2Prompt({
    approvedClaimText: input.approvedClaimText,
    reference: input.reference,
    suspicious,
    ...(input.hasExcludedUserPdf !== undefined
      ? { hasExcludedUserPdf: input.hasExcludedUserPdf }
      : {}),
    evidence: cappedTexts,
    adjudicator,
    mode: effectiveMode,
  });
  const sentUnits = cappedUnits.slice(0, builtPrompt.evidenceCount);

  const model =
    deps?.model ??
    (adjudicator === "l2AdjudicateProvided"
      ? l2AdjudicateProvided(runtime)
      : l2Adjudicate(runtime, { mode: effectiveMode }));

  const t0 = performance.now();
  const genRes: GenerateContentResult = await model.generateContent(builtPrompt.userPrompt);
  const elapsed = performance.now() - t0;

  const response = genRes.response;
  const rawText = response.text();
  const inferenceSource = normalizeInferenceSource(response.inferenceSource);
  const candidate = response.candidates?.[0];
  const groundingMetadata = candidate?.groundingMetadata;
  const renderedContent = groundingMetadata?.searchEntryPoint?.renderedContent ?? null;
  const groundingChunks: readonly GroundingChunk[] = groundingMetadata?.groundingChunks ?? [];
  const webSearchQueriesCount = groundingMetadata?.webSearchQueries?.length ?? 0;

  // Post-check 6: Telemetry (counts and latencies only; zero text persisted).
  runtime.telemetry.record({
    adjudicator,
    src: inferenceSource,
    ms: elapsed,
    schema: "L2Verdict",
    webSearchQueriesCount,
    ...(response.usageMetadata?.thoughtsTokenCount !== undefined
      ? { thoughtsTokenCount: response.usageMetadata.thoughtsTokenCount }
      : {}),
    ...(response.usageMetadata?.candidatesTokenCount !== undefined
      ? { candidatesTokenCount: response.usageMetadata.candidatesTokenCount }
      : {}),
    ...(candidate?.finishReason !== undefined ? { finishReason: candidate.finishReason } : {}),
  });

  const approvedTextSha256 = sha256hex(input.approvedClaimText);
  const decidedAt = input.decidedAt ?? Date.now();

  if (inferenceSource !== "IN_CLOUD") {
    runtime.telemetry.defect("INFERENCE_SOURCE_MISMATCH");
    return {
      persisted: buildPersistedCloudResult({
        normalizedClaimHash: input.normalizedClaimHash,
        approvedTextSha256,
        refId: input.refId,
        verdict: "NEI",
        quote: null,
        quoteAnchor: null,
        alternativesDois: [],
        noDifferenceNote: false,
        adjudicator,
        inferenceSource,
        decidedAt,
      }),
      sessionDisplay: null,
      inferenceSource,
      statusMessage: EN_COPY.cloud.unreadableJson,
    };
  }

  // Post-check 1: Schema and key-order check.
  let l2Out: L2Verdict;
  if (effectiveMode === "TEXT_JSON") {
    const parsedText = parseTextJsonL2(rawText);
    if (!parsedText.ok) {
      if (parsedText.error === "KEY_ORDER") {
        runtime.telemetry.defect("KEY_ORDER_VIOLATION");
      }
      return {
        persisted: buildPersistedCloudResult({
          normalizedClaimHash: input.normalizedClaimHash,
          approvedTextSha256,
          refId: input.refId,
          verdict: "NEI",
          quote: null,
          quoteAnchor: null,
          alternativesDois: [],
          noDifferenceNote: false,
          adjudicator,
          inferenceSource,
          decidedAt,
        }),
        sessionDisplay: null,
        inferenceSource,
        statusMessage: parsedText.message,
      };
    }
    l2Out = parsedText.data;
  } else {
    const parsedSchema = parseAndValidateAiOutput("L2Verdict", rawText);
    if (!parsedSchema.ok) {
      if (parsedSchema.error === "KEY_ORDER") {
        runtime.telemetry.defect("KEY_ORDER_VIOLATION");
      }
      return {
        persisted: buildPersistedCloudResult({
          normalizedClaimHash: input.normalizedClaimHash,
          approvedTextSha256,
          refId: input.refId,
          verdict: "NEI",
          quote: null,
          quoteAnchor: null,
          alternativesDois: [],
          noDifferenceNote: false,
          adjudicator,
          inferenceSource,
          decidedAt,
        }),
        sessionDisplay: null,
        inferenceSource,
        statusMessage: EN_COPY.cloud.unreadableJson,
      };
    }
    l2Out = parsedSchema.data;
  }

  const hasSearchEntryPoint =
    typeof renderedContent === "string" && renderedContent.trim().length > 0;

  // Post-check 2: Grounding presence (skipped for `l2AdjudicateProvided`).
  if (
    adjudicator === "l2Adjudicate" &&
    !hasSearchEntryPoint &&
    l2Out.s3_quote_origin !== "PROVIDED_EVIDENCE"
  ) {
    return {
      persisted: buildPersistedCloudResult({
        normalizedClaimHash: input.normalizedClaimHash,
        approvedTextSha256,
        refId: input.refId,
        verdict: "NEI",
        quote: null,
        quoteAnchor: null,
        alternativesDois: [],
        noDifferenceNote: false,
        adjudicator,
        inferenceSource,
        decidedAt,
      }),
      sessionDisplay: null,
      inferenceSource,
      statusMessage: null,
    };
  }

  if (adjudicator === "l2AdjudicateProvided" && l2Out.s3_quote_origin === "WEB_SOURCE") {
    return {
      persisted: buildPersistedCloudResult({
        normalizedClaimHash: input.normalizedClaimHash,
        approvedTextSha256,
        refId: input.refId,
        verdict: "NEI",
        quote: null,
        quoteAnchor: null,
        alternativesDois: [],
        noDifferenceNote: false,
        adjudicator,
        inferenceSource,
        decidedAt,
      }),
      sessionDisplay: null,
      inferenceSource,
      statusMessage: null,
    };
  }

  // Post-check 3: Source identity (model self-report can only lower a verdict).
  if (l2Out.s1_source_identified === "NOT_IDENTIFIED") {
    return {
      persisted: buildPersistedCloudResult({
        normalizedClaimHash: input.normalizedClaimHash,
        approvedTextSha256,
        refId: input.refId,
        verdict: "NEI",
        quote: null,
        quoteAnchor: null,
        alternativesDois: [],
        noDifferenceNote: false,
        adjudicator,
        inferenceSource,
        decidedAt,
      }),
      sessionDisplay: null,
      inferenceSource,
      statusMessage: EN_COPY.cloud.sourceNotConfirmed,
    };
  }

  const showGroundingUi = adjudicator === "l2Adjudicate" && hasSearchEntryPoint;
  const sources = showGroundingUi
    ? filterGroundingSources(groundingChunks, {
        refDoi: input.reference.doi,
        ...(input.publisherHost !== undefined ? { publisherHost: input.publisherHost } : {}),
      })
    : [];

  // Post-check 4: Quote anchoring & claim parity (`layer = "L2"` against actually-sent evidence).
  let persistedVerdict: CloudVerdict;
  let persistedQuote: string | null = null;
  let persistedQuoteAnchor: CloudResult["quoteAnchor"] = null;
  let noDifferenceNote = false;
  let statusMessage: string | null = null;
  let draftDisplay: Omit<L2SessionDisplay, "resolvedAlternatives"> | null = null;

  if (l2Out.s3_quote_origin === "WEB_SOURCE") {
    // WEB_SOURCE produces NO confirmed state: persisted CloudResult MUST be NEI with quote: null.
    persistedVerdict = "NEI";
    statusMessage = EN_COPY.cloud.webSourcesOnly;
    draftDisplay = {
      isWebSourceOnly: true,
      sessionVerdict: l2Out.s5_verdict,
      sessionQuote: l2Out.s2_quote.trim().length > 0 ? l2Out.s2_quote : null,
      sessionReasoning: l2Out.s4_reasoning,
      label: EN_COPY.cloud.webSourcesOnly,
      hideRerunUntilEvidenceVersionChanges: true,
      providedEvidenceOnly: false,
      renderedContent,
      groundingChunks,
      sources,
    };
  } else if (l2Out.s3_quote_origin === "NONE") {
    persistedVerdict = "NEI";
    draftDisplay = showGroundingUi
      ? {
          isWebSourceOnly: false,
          sessionVerdict: "NEI",
          sessionQuote: null,
          sessionReasoning: l2Out.s4_reasoning,
          label: null,
          hideRerunUntilEvidenceVersionChanges: false,
          providedEvidenceOnly: false,
          renderedContent,
          groundingChunks,
          sources,
        }
      : null;
  } else {
    // PROVIDED_EVIDENCE: run full L2 anchor validator against sentUnits only.
    const anchored = validateL2Verdict(l2Out, sentUnits, input.approvedClaimText);
    persistedVerdict = anchored.verdict;
    persistedQuote = anchored.quote;
    persistedQuoteAnchor = anchored.quoteAnchor;
    noDifferenceNote = anchored.noDifferenceNote;
    const label = anchored.noDifferenceNote
      ? EN_COPY.cloud.noDifferenceNote
      : adjudicator === "l2AdjudicateProvided"
        ? EN_COPY.cloud.providedEvidenceOnly
        : null;
    statusMessage = label;
    draftDisplay = {
      isWebSourceOnly: false,
      sessionVerdict: anchored.verdict,
      sessionQuote: anchored.quote,
      sessionReasoning: l2Out.s4_reasoning,
      label,
      hideRerunUntilEvidenceVersionChanges: false,
      providedEvidenceOnly: adjudicator === "l2AdjudicateProvided",
      renderedContent: showGroundingUi ? renderedContent : null,
      groundingChunks: showGroundingUi ? groundingChunks : [],
      sources,
    };
  }

  // Post-check 5: Alternative DOIs resolved only after Checks 1–4 complete (`04` §4.1, `AC-L2-06`).
  const resolvedAlternatives = await resolveAlternativeDoiList(
    l2Out.s6_alternatives.map((alt) => alt.a1_doi),
    deps?.resolveAlternativeDois
  );
  const alternativesDois = resolvedAlternatives.map((r) => r.doi);

  // Post-check 7: Grounded Output Non-Reuse Rule (persisted CloudResult excludes grounded text/links).
  const persisted = buildPersistedCloudResult({
    normalizedClaimHash: input.normalizedClaimHash,
    approvedTextSha256,
    refId: input.refId,
    verdict: persistedVerdict,
    quote: persistedQuote,
    quoteAnchor: persistedQuoteAnchor,
    alternativesDois,
    noDifferenceNote,
    adjudicator,
    inferenceSource,
    decidedAt,
  });

  const sessionDisplay: L2SessionDisplay | null =
    draftDisplay !== null ? { ...draftDisplay, resolvedAlternatives } : null;

  return {
    persisted,
    sessionDisplay,
    inferenceSource,
    statusMessage,
  };
}
