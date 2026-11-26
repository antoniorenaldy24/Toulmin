/**
 * Bundled Remote Config defaults (`04` §6.4, §6.5.1) and offline reader helpers.
 */

import { BM25_MIN_COV } from "@toulmin/core-l0";
import { PROMPT_VERSION } from "@toulmin/prompts";
import { BUNDLED_ROUTING_TABLE } from "@toulmin/schemas";

export const DEFAULT_CLOUD_MODEL = "gemini-3.8-flash" as const;
export const DEFAULT_WEB_DEADLINE_MS = 20_000;
export const DEFAULT_ANDROID_DEADLINE_MS = 30_000;
export const DEFAULT_SETTLE_CEILING_MS = 120_000;

export const BUNDLED_RC_DEFAULTS = {
  routing_table: JSON.stringify(BUNDLED_ROUTING_TABLE),
  cloud_model: DEFAULT_CLOUD_MODEL,
  prompt_version: PROMPT_VERSION,
  reasoning_word_cap: 40,
  kill_switch_cloud: false,
  probe_set_version: "p2",
  min_probe_agreement: 0.8,
  l2_max_inflight: 2,
  bm25_min_cov: BM25_MIN_COV,
  l1_deadline_ms: JSON.stringify({
    web: DEFAULT_WEB_DEADLINE_MS,
    android: DEFAULT_ANDROID_DEADLINE_MS,
  }),
  l1_slot_release: "ON_SETTLE",
  l1_settle_ceiling_ms: DEFAULT_SETTLE_CEILING_MS,
  b4_counts_in_review: true,
  sample_pool_global: 20,
  o2_grid_enabled: false,
  audit_enabled_web: true,
  show_local_supports_default: false,
} as const satisfies Readonly<Record<string, string | number | boolean>>;

export type RemoteConfigKey = keyof typeof BUNDLED_RC_DEFAULTS;

export interface RemoteConfigReader {
  getString(key: string): string;
  getNumber(key: string): number;
  getBoolean(key: string): boolean;
}

export function createMemoryRcReader(
  overrides?: Partial<Record<string, string | number | boolean>>
): RemoteConfigReader {
  const merged: Record<string, string | number | boolean> = {
    ...BUNDLED_RC_DEFAULTS,
    ...(overrides ?? {}),
  };

  return {
    getString(key: string): string {
      const val = merged[key];
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean") return String(val);
      return "";
    },
    getNumber(key: string): number {
      const val = merged[key];
      if (typeof val === "number" && Number.isFinite(val)) return val;
      if (typeof val === "string") {
        const parsed = Number(val);
        if (Number.isFinite(parsed)) return parsed;
      }
      if (typeof val === "boolean") return val ? 1 : 0;
      return 0;
    },
    getBoolean(key: string): boolean {
      const val = merged[key];
      if (typeof val === "boolean") return val;
      if (typeof val === "number") return val !== 0;
      if (typeof val === "string") {
        const lower = val.trim().toLowerCase();
        return lower === "true" || lower === "1" || lower === "yes";
      }
      return false;
    },
  };
}

export function parseWebDeadlineMs(rawJson: string): number {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const webVal = (parsed as Record<string, unknown>)["web"];
      if (typeof webVal === "number" && Number.isFinite(webVal) && webVal > 0) {
        return webVal;
      }
    }
  } catch {
    // Fall back to the initial Web L1 deadline (`04` §1.3, D-28).
  }
  return DEFAULT_WEB_DEADLINE_MS;
}
