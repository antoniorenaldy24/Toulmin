/**
 * Truncation detection and schema-specific truncation ladder (`04` §1.4 rules 3–4).
 *
 * Pure module: linear-time string scan + JSON parse position heuristic.
 */

import type { SchemaId } from "@toulmin/schemas";

export type TruncationStep =
  | {
      readonly action: "RERUN";
      readonly schemaId: SchemaId;
      readonly uncalibrated: true;
    }
  | {
      readonly action: "BASELINE";
    }
  | {
      readonly action: "NEI_SILENT_ESCALATE";
    };

function hasUnclosedJsonStructure(trimmed: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed.charAt(i);
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
    } else if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
    }
  }

  return inString || depth > 0;
}

export function looksTruncated(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return false;
  } catch (e) {
    if (hasUnclosedJsonStructure(trimmed)) {
      return true;
    }
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    return (
      msg.includes("unexpected end") ||
      msg.includes("end of json") ||
      msg.includes("unterminated")
    );
  }
}

export function getTruncationFallback(
  schemaId: SchemaId,
  truncationAttempt: number
): TruncationStep {
  if (schemaId === "TriageV1") {
    return truncationAttempt <= 1
      ? { action: "RERUN", schemaId: "TriageFlatV1", uncalibrated: true }
      : { action: "BASELINE" };
  }
  if (schemaId === "TriageFlatV1") {
    return { action: "BASELINE" };
  }
  if (schemaId === "VerdictV1" || schemaId === "VerdictV1_cap30") {
    return truncationAttempt <= 1
      ? { action: "RERUN", schemaId: "VerdictV1_cap20", uncalibrated: true }
      : { action: "NEI_SILENT_ESCALATE" };
  }
  if (schemaId === "VerdictV1_cap20" || schemaId === "VerdictFlatV1") {
    return { action: "NEI_SILENT_ESCALATE" };
  }
  if (schemaId === "B5CheckV1") {
    return { action: "BASELINE" };
  }
  if (schemaId === "O2PhysicalExtractV1") {
    return truncationAttempt <= 1
      ? { action: "RERUN", schemaId: "O2PhysicalExtractFlatV1", uncalibrated: true }
      : { action: "BASELINE" };
  }
  if (schemaId === "O2PhysicalExtractFlatV1") {
    return { action: "BASELINE" };
  }
  return { action: "NEI_SILENT_ESCALATE" };
}
