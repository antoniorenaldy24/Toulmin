/**
 * Build-time feature flags governed by compatibility spikes (`00` §3.3, `04` §3.6.1, §3.6.4, §4.5, §5.1.4).
 *
 * `l2Thinking` uses `{ thinkingLevel: "LOW" }` or `undefined` only — never `thinkingBudget` or `"MINIMAL"`.
 */

import { getAllPromptTemplateSha256, PROMPT_VERSION, type PromptTemplateId } from "@toulmin/prompts";

export type L2Mode = "SCHEMA" | "TEXT_JSON";

export interface L2ThinkingConfig {
  readonly thinkingLevel: "LOW";
}

export interface BuildFlags {
  readonly l2Mode: L2Mode;
  readonly l2Thinking: L2ThinkingConfig | undefined;
  readonly spikeSW9Primary: boolean;
  readonly promptVersion: typeof PROMPT_VERSION;
  readonly promptHashes: Readonly<Record<PromptTemplateId, string>>;
}

export const BUILD_FLAGS: BuildFlags = {
  l2Mode: "SCHEMA",
  l2Thinking: { thinkingLevel: "LOW" },
  spikeSW9Primary: true,
  promptVersion: PROMPT_VERSION,
  promptHashes: getAllPromptTemplateSha256(),
};
