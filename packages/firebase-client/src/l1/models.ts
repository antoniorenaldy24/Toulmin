/**
 * Configuration singletons for L1 on-device and hybrid models (`04` §5.1.4, D-21).
 *
 * Keyed strictly by `${inference}:${schemaId}`. Never passes sampling parameters
 * (`temperature`, `topK`, `topP`) to any model (`04` §5.1.5).
 */

import { InferenceMode, type GenerativeModel, type HybridParams } from "firebase/ai";
import { SCHEMAS, type SchemaId } from "@toulmin/schemas";
import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import { DEFAULT_CLOUD_MODEL } from "../rcDefaults.js";
import { toFirebaseSchema } from "../schemas/toFirebaseSchema.js";

export type LocalInference = "ONLY_ON_DEVICE" | "PREFER_ON_DEVICE";

export const MAX_OUT_CLOUD: Readonly<Record<SchemaId, number>> = {
  TriageV1: 300,
  TriageFlatV1: 150,
  VerdictV1: 350,
  VerdictV1_cap30: 300,
  VerdictV1_cap20: 250,
  VerdictFlatV1: 350,
  B5CheckV1: 200,
  O2PhysicalExtractV1: 300,
  O2PhysicalExtractFlatV1: 150,
  L2Verdict: 2048,
  AltSourcesV1: 200,
};

export function memo(
  key: string,
  factory: () => GenerativeModel,
  registry: Map<string, GenerativeModel> = getDefaultRuntime().modelRegistry
): GenerativeModel {
  const hit = registry.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const model = factory();
  registry.set(key, model);
  return model;
}

export function localModel(
  schemaId: SchemaId,
  inference: LocalInference,
  runtime: FirebaseRuntime = getDefaultRuntime()
): GenerativeModel {
  const key = `${inference}:${schemaId}`;
  return memo(
    key,
    () => {
      const schema = SCHEMAS[schemaId];
      const params: HybridParams = {
        mode:
          inference === "ONLY_ON_DEVICE"
            ? InferenceMode.ONLY_ON_DEVICE
            : InferenceMode.PREFER_ON_DEVICE,
        inCloudParams: {
          model: runtime.rcReader.getString("cloud_model") || DEFAULT_CLOUD_MODEL,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toFirebaseSchema(schema),
            maxOutputTokens: MAX_OUT_CLOUD[schemaId],
          },
        },
        onDeviceParams: {
          promptOptions: {
            responseConstraint: schema,
          },
        },
      };
      return runtime.sdk.getGenerativeModel(runtime.ai, params);
    },
    runtime.modelRegistry
  );
}

export function reasoningCapForSchema(
  schemaId: SchemaId,
  configuredWordCap: number = 40
): number {
  if (schemaId === "VerdictV1_cap30") return 30;
  if (schemaId === "VerdictV1_cap20") return 20;
  if (schemaId === "VerdictFlatV1") return configuredWordCap === 30 ? 30 : 40;
  if (schemaId === "VerdictV1") return 40;
  return configuredWordCap;
}
