/**
 * `PREFER_IN_CLOUD` — Find alternative sources (`AltSourcesV1`)
 * (`04` §4.5, §5.1.4).
 *
 * Online in Standard mode: `PREFER_IN_CLOUD` with `googleSearch` + `AltSourcesV1`
 * (or two-mode fallback via `useTwoModeFallback` for spike `S-W9`).
 * Confidential or on-device fallback (`inferenceSource === "ON_DEVICE"`): `s2_dois`
 * MUST be ignored (`[]`).
 */

import {
  InferenceMode,
  type GenerateContentResult,
  type GenerativeModel,
  type HybridParams,
} from "firebase/ai";
import { buildAltSourcesPrompt, type PromptReferenceCandidate } from "@toulmin/prompts";
import {
  parseAndValidateAiOutput,
  SCHEMAS,
  type InferenceSourceTag,
} from "@toulmin/schemas";
import { BUILD_FLAGS } from "../buildFlags.js";
import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import { normalizeInferenceSource } from "../l1/call.js";
import { memo } from "../l1/models.js";
import { DEFAULT_CLOUD_MODEL } from "../rcDefaults.js";
import { toFirebaseSchema } from "../schemas/toFirebaseSchema.js";
import {
  resolveAlternativeDoiList,
  type DoiResolverHook,
  type ResolvedAlternativeDoi,
} from "./adjudicate.js";

export interface AltSourcesModelOptions {
  readonly online?: boolean;
  readonly useTwoModeFallback?: boolean;
}

export function altSources(
  confidential: boolean,
  runtime: FirebaseRuntime = getDefaultRuntime(),
  options?: AltSourcesModelOptions
): GenerativeModel {
  if (confidential) {
    return memo(
      "device:altSources",
      () => {
        const params: HybridParams = {
          mode: InferenceMode.ONLY_ON_DEVICE,
          onDeviceParams: {
            promptOptions: {
              responseConstraint: SCHEMAS.AltSourcesV1,
            },
          },
        };
        return runtime.sdk.getGenerativeModel(runtime.ai, params);
      },
      runtime.modelRegistry
    );
  }

  const useTwoModeFallback = options?.useTwoModeFallback ?? !BUILD_FLAGS.spikeSW9Primary;
  if (useTwoModeFallback) {
    const isOnline = options?.online ?? true;
    if (isOnline) {
      return memo(
        "cloud:altSources:fallback",
        () => {
          const params: HybridParams = {
            mode: InferenceMode.ONLY_IN_CLOUD,
            inCloudParams: {
              model: runtime.rcReader.getString("cloud_model") || DEFAULT_CLOUD_MODEL,
              tools: [{ googleSearch: {} }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: toFirebaseSchema(SCHEMAS.AltSourcesV1),
                maxOutputTokens: 200,
              },
            },
          };
          return runtime.sdk.getGenerativeModel(runtime.ai, params);
        },
        runtime.modelRegistry
      );
    }
    return memo(
      "device:altSources",
      () => {
        const params: HybridParams = {
          mode: InferenceMode.ONLY_ON_DEVICE,
          onDeviceParams: {
            promptOptions: {
              responseConstraint: SCHEMAS.AltSourcesV1,
            },
          },
        };
        return runtime.sdk.getGenerativeModel(runtime.ai, params);
      },
      runtime.modelRegistry
    );
  }

  return memo(
    "hybrid:altSources",
    () => {
      const params: HybridParams = {
        mode: InferenceMode.PREFER_IN_CLOUD,
        inCloudParams: {
          model: runtime.rcReader.getString("cloud_model") || DEFAULT_CLOUD_MODEL,
          tools: [{ googleSearch: {} }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toFirebaseSchema(SCHEMAS.AltSourcesV1),
            maxOutputTokens: 200,
          },
        },
        onDeviceParams: {
          promptOptions: {
            responseConstraint: SCHEMAS.AltSourcesV1,
          },
        },
      };
      return runtime.sdk.getGenerativeModel(runtime.ai, params);
    },
    runtime.modelRegistry
  );
}

export interface FindAltSourcesInput {
  readonly approvedClaimText: string;
  readonly library: readonly PromptReferenceCandidate[];
  readonly confidential: boolean;
  readonly online?: boolean;
}

export interface FindAltSourcesDeps {
  readonly runtime?: FirebaseRuntime;
  readonly model?: GenerativeModel;
  readonly resolveAlternativeDois?: DoiResolverHook;
}

export interface FindAltSourcesResult {
  readonly ok: boolean;
  readonly libraryIndices: number[];
  readonly resolvedDois: ResolvedAlternativeDoi[];
  readonly inferenceSource: InferenceSourceTag;
  readonly error?: "PARSE" | "KEY_ORDER" | "SCHEMA";
}

export async function findAlternativeSources(
  input: FindAltSourcesInput,
  deps?: FindAltSourcesDeps
): Promise<FindAltSourcesResult> {
  const runtime = deps?.runtime ?? getDefaultRuntime();
  const model =
    deps?.model ??
    altSources(
      input.confidential,
      runtime,
      input.online !== undefined ? { online: input.online } : undefined
    );

  const builtPrompt = buildAltSourcesPrompt({
    approvedClaimText: input.approvedClaimText,
    library: input.library,
  });

  const t0 = performance.now();
  const genRes: GenerateContentResult = await model.generateContent(builtPrompt.userPrompt);
  const elapsed = performance.now() - t0;

  const response = genRes.response;
  const rawText = response.text();
  const inferenceSource = normalizeInferenceSource(response.inferenceSource);
  const candidate = response.candidates?.[0];

  runtime.telemetry.record({
    adjudicator: "altSources",
    src: inferenceSource,
    ms: elapsed,
    schema: "AltSourcesV1",
    ...(candidate?.finishReason !== undefined ? { finishReason: candidate.finishReason } : {}),
  });

  const parsed = parseAndValidateAiOutput("AltSourcesV1", rawText);
  if (!parsed.ok) {
    if (parsed.error === "KEY_ORDER") {
      runtime.telemetry.defect("KEY_ORDER_VIOLATION");
    }
    return {
      ok: false,
      libraryIndices: [],
      resolvedDois: [],
      inferenceSource,
      error: parsed.error,
    };
  }

  const maxLibraryCount = Math.min(input.library.length, 20);
  const libraryIndices: number[] = [];
  for (const idx of parsed.data.s1_library_idx) {
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < maxLibraryCount &&
      !libraryIndices.includes(idx)
    ) {
      libraryIndices.push(idx);
    }
  }

  // `04` §4.5: `s2_dois` MUST be ignored for on-device responses (`ON_DEVICE`) or Confidential mode.
  if (input.confidential || inferenceSource === "ON_DEVICE") {
    return {
      ok: true,
      libraryIndices,
      resolvedDois: [],
      inferenceSource,
    };
  }

  const resolvedDois = await resolveAlternativeDoiList(
    parsed.data.s2_dois,
    deps?.resolveAlternativeDois
  );

  return {
    ok: true,
    libraryIndices,
    resolvedDois,
    inferenceSource,
  };
}
