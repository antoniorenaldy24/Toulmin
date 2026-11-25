/**
 * Canonical `routing_table` contract, bundled offline defaults, and strict validator
 * (`docs/spec/04_AI_RUNTIME_PROMPTS_AND_L3.md` §6.5).
 *
 * Pure module: zero Firebase, DOM, network, Node I/O, clock, or regex usage.
 */

import { AUTHORITIES, TASKS, type Authority, type Task } from "./domain.js";

export const ROUTING_SURFACES = [
  "HINT_THEN_CLOUD",
  "QUIET_ESCALATE",
  "INFO_ONLY",
  "CLOUD_ONLY_WITH_CONSENT",
] as const;
export type RoutingSurface = (typeof ROUTING_SURFACES)[number];

export const PROBE_LETTERS = ["S", "C", "N"] as const;
export type ProbeLetter = (typeof PROBE_LETTERS)[number];

export interface RoutingGateConfig {
  precision_min: number;
  wilson_lb_min: number;
  stability_min: number;
  pp_pairs_min: number;
  support_wilson_lb_min: number;
  ps_pairs_min: number;
}

export interface RoutingFreeze {
  tier_a_hash: string;
  tier_b_hash: string;
  cf1_baseline_hash: string;
  replay_report: string;
}

export interface RoutingCalibratedVariant {
  schemaId: string;
  reasoningCap: number;
}

export interface RoutingCalibration {
  p_hat: number;
  wilson_ci95: [number, number];
  wilson_lb: number;
  stability: number;
  stability_ci95: [number, number];
  pp_pairs: number;
  tp_pairs: number;
  recall: number;
  fcr_s: number;
  fcr_n: number;
  prevalence_adjusted: {
    "0.08": number;
    "0.12": number;
    "0.18": number;
  };
  prevalence_adjusted_lb: {
    "0.08": number;
    "0.12": number;
    "0.18": number;
  };
  support: {
    p_hat_s: number;
    wilson_lb_s: number;
    ps_pairs: number;
    ts_pairs: number;
    fsr_c: number;
    fsr_n: number;
  };
  per_call: {
    p_hat_call_c: number;
    p_hat_call_s: number;
  };
  n_pairs: number;
  runs_per_pair: number;
  samplingMode: "browser_default" | "generation_config";
  bm25_min_cov: number;
  measured_on: string;
  measured_at: string;
  prompt_version: string;
  reasoning_word_cap: number;
}

export interface RoutingCf1Entry {
  delta: number;
  p: number;
  p_holm: number;
  power: number;
  inconsistent_precision_l1?: number;
  inconsistent_precision_baseline?: number;
}

export interface RoutingProfileEntry {
  path: "A" | "B";
  contradicts: { surface: RoutingSurface };
  supported: { surface: RoutingSurface };
  nei: { surface: RoutingSurface };
  authority: Record<Task, Authority>;
  supportVerdicts: Authority;
  calibratedVariant: RoutingCalibratedVariant | null;
  calibration: RoutingCalibration | null;
  cf1: Partial<Record<Task, RoutingCf1Entry>> | null;
  probe_expected: ProbeLetter[] | null;
}

export interface RoutingTable {
  version: string;
  gate: RoutingGateConfig;
  freeze: RoutingFreeze | null;
  kappa_ok?: boolean;
  profiles: Record<string, RoutingProfileEntry>;
}

const DEFAULT_GATE: RoutingGateConfig = {
  precision_min: 0.7,
  wilson_lb_min: 0.5,
  stability_min: 0.6,
  pp_pairs_min: 15,
  support_wilson_lb_min: 0.8,
  ps_pairs_min: 16,
};

function makeBundledProfile(contradictsSurface: RoutingSurface): RoutingProfileEntry {
  return {
    path: "B",
    contradicts: { surface: contradictsSurface },
    supported: { surface: "INFO_ONLY" },
    nei: { surface: "QUIET_ESCALATE" },
    authority: {
      B1: "advisory",
      B2: "advisory",
      B3: "advisory",
      B5: "advisory",
      O2: "advisory",
    },
    supportVerdicts: "advisory",
    calibratedVariant: null,
    calibration: null,
    cf1: null,
    probe_expected: null,
  };
}

/**
 * Bundled conservative default routing table (`04` §6.5.1).
 */
export const BUNDLED_ROUTING_TABLE: RoutingTable = {
  version: "bundled",
  gate: DEFAULT_GATE,
  freeze: null,
  profiles: {
    web_chrome_nano: makeBundledProfile("QUIET_ESCALATE"),
    android_aicore_stable: makeBundledProfile("QUIET_ESCALATE"),
    android_aicore_preview: makeBundledProfile("QUIET_ESCALATE"),
    apple_slm: makeBundledProfile("QUIET_ESCALATE"),
    no_local_model: makeBundledProfile("CLOUD_ONLY_WITH_CONSENT"),
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isBareSha256Hex(v: unknown): v is string {
  if (typeof v !== "string" || v.length !== 64) {
    return false;
  }
  for (let i = 0; i < 64; i += 1) {
    const c = v.charCodeAt(i);
    const isDigit = c >= 0x30 && c <= 0x39;
    const isLowerHex = c >= 0x61 && c <= 0x66;
    if (!isDigit && !isLowerHex) {
      return false;
    }
  }
  return true;
}

function checkAllowedKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  errors: string[]
): void {
  const allowed = new Set<string>([...required, ...optional]);
  for (const r of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, r) || obj[r] === undefined) {
      errors.push(`${path}.${r}: missing required property`);
    }
  }
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      errors.push(`${path}.${k}: unknown property`);
    }
  }
}

function validateSurfaceBox(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected { surface } object`);
    return;
  }
  checkAllowedKeys(v, ["surface"], [], path, errors);
  if (!ROUTING_SURFACES.includes(v["surface"] as RoutingSurface)) {
    errors.push(`${path}.surface: invalid RoutingSurface`);
  }
}

function validateTuple2Numbers(v: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(v) || v.length !== 2 || !isFiniteNum(v[0]) || !isFiniteNum(v[1])) {
    errors.push(`${path}: expected [number, number]`);
  }
}

function validatePrevalenceMap(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected object`);
    return;
  }
  checkAllowedKeys(v, ["0.08", "0.12", "0.18"], [], path, errors);
  for (const key of ["0.08", "0.12", "0.18"] as const) {
    if (!isFiniteNum(v[key])) {
      errors.push(`${path}["${key}"]: expected finite number`);
    }
  }
}

function validateCalibration(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected RoutingCalibration object`);
    return;
  }
  checkAllowedKeys(
    v,
    [
      "p_hat",
      "wilson_ci95",
      "wilson_lb",
      "stability",
      "stability_ci95",
      "pp_pairs",
      "tp_pairs",
      "recall",
      "fcr_s",
      "fcr_n",
      "prevalence_adjusted",
      "prevalence_adjusted_lb",
      "support",
      "per_call",
      "n_pairs",
      "runs_per_pair",
      "samplingMode",
      "bm25_min_cov",
      "measured_on",
      "measured_at",
      "prompt_version",
      "reasoning_word_cap",
    ],
    [],
    path,
    errors
  );
  for (const k of ["p_hat", "wilson_lb", "stability", "pp_pairs", "tp_pairs", "recall", "fcr_s", "fcr_n", "n_pairs", "runs_per_pair", "bm25_min_cov", "reasoning_word_cap"] as const) {
    if (!isFiniteNum(v[k])) {
      errors.push(`${path}.${k}: expected finite number`);
    }
  }
  validateTuple2Numbers(v["wilson_ci95"], `${path}.wilson_ci95`, errors);
  validateTuple2Numbers(v["stability_ci95"], `${path}.stability_ci95`, errors);
  validatePrevalenceMap(v["prevalence_adjusted"], `${path}.prevalence_adjusted`, errors);
  validatePrevalenceMap(v["prevalence_adjusted_lb"], `${path}.prevalence_adjusted_lb`, errors);

  if (!isRecord(v["support"])) {
    errors.push(`${path}.support: expected object`);
  } else {
    checkAllowedKeys(
      v["support"],
      ["p_hat_s", "wilson_lb_s", "ps_pairs", "ts_pairs", "fsr_c", "fsr_n"],
      [],
      `${path}.support`,
      errors
    );
    for (const k of ["p_hat_s", "wilson_lb_s", "ps_pairs", "ts_pairs", "fsr_c", "fsr_n"] as const) {
      if (!isFiniteNum(v["support"][k])) {
        errors.push(`${path}.support.${k}: expected finite number`);
      }
    }
  }

  if (!isRecord(v["per_call"])) {
    errors.push(`${path}.per_call: expected object`);
  } else {
    checkAllowedKeys(v["per_call"], ["p_hat_call_c", "p_hat_call_s"], [], `${path}.per_call`, errors);
    if (!isFiniteNum(v["per_call"]["p_hat_call_c"])) {
      errors.push(`${path}.per_call.p_hat_call_c: expected finite number`);
    }
    if (!isFiniteNum(v["per_call"]["p_hat_call_s"])) {
      errors.push(`${path}.per_call.p_hat_call_s: expected finite number`);
    }
  }

  if (v["samplingMode"] !== "browser_default" && v["samplingMode"] !== "generation_config") {
    errors.push(`${path}.samplingMode: expected "browser_default" or "generation_config"`);
  }
  for (const s of ["measured_on", "measured_at", "prompt_version"] as const) {
    if (typeof v[s] !== "string" || v[s].length === 0) {
      errors.push(`${path}.${s}: expected non-empty string`);
    }
  }
}

export interface RoutingValidationResult {
  readonly ok: boolean;
  readonly value?: RoutingTable;
  readonly errors: readonly string[];
}

/**
 * Validates a `routing_table` JSON object against `04` §6.5.1–§6.5.2 (strict keys, bare 64-hex freeze hashes).
 */
export function validateRoutingTable(input: unknown): RoutingValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["$: expected RoutingTable object"] };
  }
  checkAllowedKeys(input, ["version", "gate", "freeze", "profiles"], ["kappa_ok"], "$", errors);
  if (typeof input["version"] !== "string" || input["version"].length === 0) {
    errors.push("$.version: expected non-empty string");
  }
  if (input["kappa_ok"] !== undefined && typeof input["kappa_ok"] !== "boolean") {
    errors.push("$.kappa_ok: expected boolean");
  }

  if (!isRecord(input["gate"])) {
    errors.push("$.gate: expected object");
  } else {
    checkAllowedKeys(
      input["gate"],
      [
        "precision_min",
        "wilson_lb_min",
        "stability_min",
        "pp_pairs_min",
        "support_wilson_lb_min",
        "ps_pairs_min",
      ],
      [],
      "$.gate",
      errors
    );
    for (const k of Object.keys(input["gate"])) {
      if (!isFiniteNum(input["gate"][k])) {
        errors.push(`$.gate.${k}: expected finite number`);
      }
    }
  }

  if (input["freeze"] !== null) {
    if (!isRecord(input["freeze"])) {
      errors.push("$.freeze: expected object or null");
    } else {
      checkAllowedKeys(
        input["freeze"],
        ["tier_a_hash", "tier_b_hash", "cf1_baseline_hash", "replay_report"],
        [],
        "$.freeze",
        errors
      );
      for (const h of ["tier_a_hash", "tier_b_hash", "cf1_baseline_hash"] as const) {
        if (!isBareSha256Hex(input["freeze"][h])) {
          errors.push(`$.freeze.${h}: expected bare 64-char lowercase hex SHA-256`);
        }
      }
      if (typeof input["freeze"]["replay_report"] !== "string" || input["freeze"]["replay_report"].length === 0) {
        errors.push("$.freeze.replay_report: expected non-empty string");
      }
    }
  }

  if (!isRecord(input["profiles"])) {
    errors.push("$.profiles: expected object");
  } else {
    for (const profileId of Object.keys(input["profiles"])) {
      const p = input["profiles"][profileId];
      const pPath = `$.profiles.${profileId}`;
      if (!isRecord(p)) {
        errors.push(`${pPath}: expected profile object`);
        continue;
      }
      checkAllowedKeys(
        p,
        [
          "path",
          "contradicts",
          "supported",
          "nei",
          "authority",
          "supportVerdicts",
          "calibratedVariant",
          "calibration",
          "cf1",
          "probe_expected",
        ],
        [],
        pPath,
        errors
      );
      if (p["path"] !== "A" && p["path"] !== "B") {
        errors.push(`${pPath}.path: expected "A" or "B"`);
      }
      validateSurfaceBox(p["contradicts"], `${pPath}.contradicts`, errors);
      validateSurfaceBox(p["supported"], `${pPath}.supported`, errors);
      validateSurfaceBox(p["nei"], `${pPath}.nei`, errors);

      if (!isRecord(p["authority"])) {
        errors.push(`${pPath}.authority: expected Task -> Authority map`);
      } else {
        checkAllowedKeys(p["authority"], TASKS, [], `${pPath}.authority`, errors);
        for (const t of TASKS) {
          if (!AUTHORITIES.includes(p["authority"][t] as Authority)) {
            errors.push(`${pPath}.authority.${t}: invalid Authority`);
          }
        }
      }
      if (!AUTHORITIES.includes(p["supportVerdicts"] as Authority)) {
        errors.push(`${pPath}.supportVerdicts: invalid Authority`);
      }

      if (p["calibratedVariant"] !== null) {
        if (!isRecord(p["calibratedVariant"])) {
          errors.push(`${pPath}.calibratedVariant: expected object or null`);
        } else {
          checkAllowedKeys(
            p["calibratedVariant"],
            ["schemaId", "reasoningCap"],
            [],
            `${pPath}.calibratedVariant`,
            errors
          );
          if (typeof p["calibratedVariant"]["schemaId"] !== "string" || p["calibratedVariant"]["schemaId"].length === 0) {
            errors.push(`${pPath}.calibratedVariant.schemaId: expected non-empty string`);
          }
          if (!isFiniteNum(p["calibratedVariant"]["reasoningCap"])) {
            errors.push(`${pPath}.calibratedVariant.reasoningCap: expected finite number`);
          }
        }
      }

      if (p["calibration"] !== null) {
        validateCalibration(p["calibration"], `${pPath}.calibration`, errors);
      }

      if (p["cf1"] !== null) {
        if (!isRecord(p["cf1"])) {
          errors.push(`${pPath}.cf1: expected object or null`);
        } else {
          checkAllowedKeys(p["cf1"], [], TASKS, `${pPath}.cf1`, errors);
          for (const taskKey of Object.keys(p["cf1"])) {
            const cf1Entry = p["cf1"][taskKey];
            const cfPath = `${pPath}.cf1.${taskKey}`;
            if (!isRecord(cf1Entry)) {
              errors.push(`${cfPath}: expected object`);
              continue;
            }
            checkAllowedKeys(
              cf1Entry,
              ["delta", "p", "p_holm", "power"],
              ["inconsistent_precision_l1", "inconsistent_precision_baseline"],
              cfPath,
              errors
            );
            for (const f of Object.keys(cf1Entry)) {
              if (!isFiniteNum(cf1Entry[f])) {
                errors.push(`${cfPath}.${f}: expected finite number`);
              }
            }
          }
        }
      }

      if (p["probe_expected"] !== null) {
        if (!Array.isArray(p["probe_expected"]) || p["probe_expected"].length !== 10) {
          errors.push(`${pPath}.probe_expected: expected length-10 array or null`);
        } else {
          for (let i = 0; i < p["probe_expected"].length; i += 1) {
            if (!PROBE_LETTERS.includes(p["probe_expected"][i] as ProbeLetter)) {
              errors.push(`${pPath}.probe_expected[${i}]: expected "S", "C", or "N"`);
            }
          }
        }
      }
    }
  }

  return errors.length === 0
    ? { ok: true, value: input as unknown as RoutingTable, errors: [] }
    : { ok: false, errors };
}
