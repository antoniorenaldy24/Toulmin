/**
 * Privacy-safe telemetry and error classification (`04` §4.1 step 6, §5.1.1, §5.1.7; `05` §3.0).
 *
 * Records ONLY counts, latencies, schema IDs, inference source tags, token counts,
 * finish reasons, and error classes. NEVER logs claim text, evidence text, titles,
 * DOIs, URLs, grounded search content, or judge codes.
 */

import type { InferenceSourceTag, SchemaId } from "@toulmin/schemas";

export type ErrorClass = "BUSY" | "NETWORK" | "QUOTA" | "NOT_SUPPORTED" | "OTHER";

export type DefectCode =
  | "UNEXPECTED_CLOUD"
  | "KEY_ORDER_VIOLATION"
  | "PROMPT_HASH_MISMATCH"
  | "INFERENCE_SOURCE_MISMATCH";

export interface TelemetryEvent {
  readonly appCheckInitError?: ErrorClass;
  readonly authError?: ErrorClass;
  readonly src?: InferenceSourceTag;
  readonly ms?: number;
  readonly schema?: SchemaId;
  readonly adjudicator?: "l2Adjudicate" | "l2AdjudicateProvided" | "altSources";
  readonly webSearchQueriesCount?: number;
  readonly thoughtsTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly finishReason?: string;
}

export interface TelemetrySnapshot {
  readonly events: readonly TelemetryEvent[];
  readonly defects: readonly DefectCode[];
  readonly countsByInferenceSource: Readonly<Record<InferenceSourceTag, number>>;
}

export interface TelemetrySink {
  record(event: TelemetryEvent): void;
  defect(code: DefectCode): void;
  snapshot(): TelemetrySnapshot;
  reset(): void;
}

function readErrorStringField(err: Record<string, unknown>, key: string): string {
  const val = err[key];
  return typeof val === "string" ? val.toLowerCase() : "";
}

export function classify(error: unknown): ErrorClass {
  if (typeof error === "object" && error !== null) {
    const rec = error as Record<string, unknown>;
    const name = readErrorStringField(rec, "name");
    const code = readErrorStringField(rec, "code");
    const message = readErrorStringField(rec, "message");
    const combined = `${name} ${code} ${message}`;

    if (
      name === "notsupportederror" ||
      combined.includes("not-supported") ||
      combined.includes("not_supported") ||
      combined.includes("unsupported")
    ) {
      return "NOT_SUPPORTED";
    }
    if (
      combined.includes("quota") ||
      combined.includes("resource-exhausted") ||
      combined.includes("rate-limit") ||
      combined.includes("429")
    ) {
      return "QUOTA";
    }
    if (
      combined.includes("busy") ||
      combined.includes("model_busy") ||
      combined.includes("in-progress")
    ) {
      return "BUSY";
    }
    if (
      combined.includes("network") ||
      combined.includes("fetch") ||
      combined.includes("offline") ||
      combined.includes("timeout") ||
      combined.includes("econn") ||
      combined.includes("unavailable")
    ) {
      return "NETWORK";
    }
  } else if (typeof error === "string") {
    const lower = error.toLowerCase();
    if (lower.includes("not_supported") || lower.includes("notsupported")) return "NOT_SUPPORTED";
    if (lower.includes("quota") || lower.includes("429")) return "QUOTA";
    if (lower.includes("busy")) return "BUSY";
    if (lower.includes("network") || lower.includes("offline") || lower.includes("timeout")) {
      return "NETWORK";
    }
  }
  return "OTHER";
}

export function createTelemetry(): TelemetrySink {
  const events: TelemetryEvent[] = [];
  const defects: DefectCode[] = [];
  const counts: Record<InferenceSourceTag, number> = {
    ON_DEVICE: 0,
    IN_CLOUD: 0,
    NONE: 0,
  };

  return {
    record(event: TelemetryEvent): void {
      events.push({ ...event });
      if (event.src !== undefined) {
        counts[event.src] += 1;
      }
    },
    defect(code: DefectCode): void {
      defects.push(code);
    },
    snapshot(): TelemetrySnapshot {
      return {
        events: [...events],
        defects: [...defects],
        countsByInferenceSource: { ...counts },
      };
    },
    reset(): void {
      events.length = 0;
      defects.length = 0;
      counts.ON_DEVICE = 0;
      counts.IN_CLOUD = 0;
      counts.NONE = 0;
    },
  };
}

export const telemetry: TelemetrySink = createTelemetry();
