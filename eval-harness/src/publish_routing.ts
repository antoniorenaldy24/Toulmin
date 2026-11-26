/**
 * Tier B Publication Guard & `routing_table` Assembler (`eval-harness/src/publish_routing.ts`)
 * (`docs/spec/04_AI_RUNTIME_PROMPTS_AND_L3.md` §6.5; `07` §3.9, §4.5, §4.9, `AC-EVAL-05`, `AC-EVAL-09`).
 *
 * Refuses `--confirm` publication (exiting non-zero without touching Remote Config / output file)
 * if any gate, support floor (`ps_pairs >= 16`, `wilson_lb_s >= 0.80`), CF-1 authority rule
 * (including B5 precision), calibrated variant manifest match, or H4 freeze hash check fails.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_GATE_THRESHOLDS,
  PATH_A_ALLOWED_PROFILES,
  PROFILE_CF1_FAMILIES,
  checkAuthority,
  evaluateGate,
  evaluateSupportGate,
  gateConfigMatchesDefault,
  gateGridKey,
  isValidCalibratedVariant,
} from "@toulmin/core-l0/gate";
import {
  BUNDLED_ROUTING_TABLE,
  TASKS,
  isValidSha256Hex,
  validateRoutingTable,
  type Authority,
  type ProbeLetter,
  type RoutingCalibratedVariant,
  type RoutingCalibration,
  type RoutingCf1Entry,
  type RoutingFreeze,
  type RoutingProfileEntry,
  type RoutingTable,
  type Task,
} from "@toulmin/schemas";

export interface ExpectedH4Hashes {
  readonly tier_a_hash: string;
  readonly tier_b_hash: string;
  readonly cf1_baseline_hash: string;
}

export interface PublishRoutingValidationInput {
  readonly table: unknown;
  readonly expectedFreeze: ExpectedH4Hashes;
  readonly manifestVariants?: Readonly<Record<string, RoutingCalibratedVariant>>;
  readonly resultValidByProfile?: Readonly<Record<string, boolean>>;
  readonly precisionB4?: number;
}

export interface PublishRoutingValidationResult {
  readonly ok: boolean;
  readonly table?: RoutingTable;
  readonly errors: readonly string[];
  readonly b4CountsInReview: boolean;
}

/**
 * Computes Remote Config `b4_counts_in_review` (`04` §6.4, `07` §4.5, `AC-EVAL-09`):
 * `false` iff measured `Precision_B4 < 0.60`.
 */
export function computeB4CountsInReview(precisionB4: number | undefined): boolean {
  if (precisionB4 === undefined) {
    return true;
  }
  if (!Number.isFinite(precisionB4)) {
    return false;
  }
  return gateGridKey(precisionB4) >= gateGridKey(0.60);
}

/**
 * Validates every invariant required before `publish_routing.ts --confirm` writes
 * `routing_table` (`04` §6.5.3, `07` §3.9, `AC-EVAL-05` (a)–(h)).
 */
export function verifyPublishableRoutingTable(
  input: PublishRoutingValidationInput
): PublishRoutingValidationResult {
  const errors: string[] = [];
  const b4CountsInReview = computeB4CountsInReview(input.precisionB4);

  const schemaCheck = validateRoutingTable(input.table);
  if (!schemaCheck.ok || schemaCheck.value === undefined) {
    return {
      ok: false,
      errors: [...schemaCheck.errors],
      b4CountsInReview,
    };
  }

  const table = schemaCheck.value;
  if (!gateConfigMatchesDefault(table.gate)) {
    errors.push(
      "gate: routing_table.gate thresholds must exactly equal DEFAULT_GATE_THRESHOLDS (07 §3.7)"
    );
  }
  if (table.freeze === null) {
    errors.push("freeze: published routing_table requires non-null freeze block");
  } else {
    for (const [k, expectedVal] of [
      ["tier_a_hash", input.expectedFreeze.tier_a_hash],
      ["tier_b_hash", input.expectedFreeze.tier_b_hash],
      ["cf1_baseline_hash", input.expectedFreeze.cf1_baseline_hash],
    ] as const) {
      const actualVal = table.freeze[k];
      if (!isValidSha256Hex(actualVal)) {
        errors.push(`freeze.${k}: must be bare 64-char lowercase hex`);
      } else if (actualVal !== expectedVal) {
        errors.push(
          `freeze.${k}: mismatch against H4_DECISION.md (got ${actualVal}, expected ${expectedVal})`
        );
      }
    }
  }

  const kappaOk = table.kappa_ok === true;

  for (const profileId of Object.keys(table.profiles)) {
    const entry = table.profiles[profileId];
    if (entry === undefined) {
      continue;
    }

    const resultValid = input.resultValidByProfile?.[profileId] ?? true;

    if (entry.path === "A") {
      if (!PATH_A_ALLOWED_PROFILES.has(profileId)) {
        errors.push(`profiles.${profileId}.path: Path A not allowed for profile "${profileId}"`);
      }
      if (!kappaOk) {
        errors.push(`profiles.${profileId}.path: Path A refused when kappa_ok !== true`);
      }
      if (!resultValid) {
        errors.push(`profiles.${profileId}.path: Path A refused when RESULT_VALID is false`);
      }
      if (entry.calibratedVariant === null) {
        errors.push(`profiles.${profileId}.path: Path A requires calibratedVariant`);
      }
      if (entry.calibration === null) {
        errors.push(`profiles.${profileId}.path: Path A requires non-null calibration`);
      } else {
        const gateRes = evaluateGate(entry.calibration, DEFAULT_GATE_THRESHOLDS);
        if (!gateRes.pathA) {
          errors.push(
            `profiles.${profileId}.path: fails Path A gate (${gateRes.failed.join(", ")})`
          );
        }
      }
      if (entry.contradicts.surface !== "HINT_THEN_CLOUD") {
        errors.push(
          `profiles.${profileId}.contradicts.surface: Path A requires HINT_THEN_CLOUD`
        );
      }
    } else if (entry.contradicts.surface === "HINT_THEN_CLOUD") {
      errors.push(
        `profiles.${profileId}.contradicts.surface: Path B must never use HINT_THEN_CLOUD`
      );
    }

    if (entry.supportVerdicts === "authoritative") {
      if (!kappaOk) {
        errors.push(
          `profiles.${profileId}.supportVerdicts: authoritative refused when kappa_ok !== true`
        );
      }
      if (!resultValid) {
        errors.push(
          `profiles.${profileId}.supportVerdicts: authoritative refused when RESULT_VALID is false`
        );
      }
      if (entry.calibratedVariant === null) {
        errors.push(
          `profiles.${profileId}.supportVerdicts: authoritative requires calibratedVariant`
        );
      }
      if (entry.calibration === null) {
        errors.push(
          `profiles.${profileId}.supportVerdicts: authoritative requires non-null calibration`
        );
      } else {
        const supportRes = evaluateSupportGate(entry.calibration.support, DEFAULT_GATE_THRESHOLDS);
        if (!supportRes.authoritative) {
          errors.push(
            `profiles.${profileId}.supportVerdicts: fails support gate (${supportRes.failed.join(", ")})`
          );
        }
      }
    }

    const requiredCf1Tasks = PROFILE_CF1_FAMILIES[profileId];
    const hasAuthoritativeTask = TASKS.some((t) => entry.authority[t] === "authoritative");
    if (hasAuthoritativeTask && entry.calibratedVariant === null) {
      errors.push(
        `profiles.${profileId}.authority: authoritative task requires calibratedVariant`
      );
    }

    if (requiredCf1Tasks !== undefined) {
      if (entry.cf1 !== null || hasAuthoritativeTask) {
        if (entry.cf1 === null) {
          errors.push(
            `profiles.${profileId}.cf1: required CF-1 family tasks missing when authority is authoritative`
          );
        } else {
          for (const reqTask of requiredCf1Tasks) {
            if (entry.cf1[reqTask] === undefined) {
              errors.push(
                `profiles.${profileId}.cf1.${reqTask}: missing required CF-1 task for m=${requiredCf1Tasks.length} Holm family`
              );
            }
          }
        }
      }
    }

    for (const task of TASKS) {
      if (entry.authority[task] === "authoritative") {
        if (requiredCf1Tasks === undefined || !requiredCf1Tasks.includes(task)) {
          errors.push(
            `profiles.${profileId}.authority.${task}: task "${task}" cannot be authoritative on profile "${profileId}"`
          );
          continue;
        }
        const checked = checkAuthority(entry.cf1, task);
        if (checked !== "authoritative") {
          errors.push(
            `profiles.${profileId}.authority.${task}: fails CF-1 Holm authority guard`
          );
        }
      }
    }

    if (entry.calibratedVariant !== null && !isValidCalibratedVariant(entry.calibratedVariant)) {
      errors.push(
        `profiles.${profileId}.calibratedVariant: uncalibrated or invalid variant ${JSON.stringify(entry.calibratedVariant)}`
      );
    }

    const expectedVariant = input.manifestVariants?.[profileId];
    if (expectedVariant !== undefined) {
      if (
        entry.calibratedVariant === null ||
        entry.calibratedVariant.schemaId !== expectedVariant.schemaId ||
        entry.calibratedVariant.reasoningCap !== expectedVariant.reasoningCap
      ) {
        errors.push(
          `profiles.${profileId}.calibratedVariant: differs from manifest (${JSON.stringify(entry.calibratedVariant)} vs ${JSON.stringify(expectedVariant)})`
        );
      }
    }

    if (entry.calibration !== null && entry.calibratedVariant !== null) {
      if (entry.calibration.reasoning_word_cap !== entry.calibratedVariant.reasoningCap) {
        errors.push(
          `profiles.${profileId}.calibratedVariant.reasoningCap: differs from calibration.reasoning_word_cap`
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    ...(errors.length === 0 ? { table } : {}),
    errors,
    b4CountsInReview,
  };
}

export interface AssembleProfileInput {
  readonly profileId: string;
  readonly calibration: RoutingCalibration | null;
  readonly calibratedVariant: RoutingCalibratedVariant | null;
  readonly cf1: Partial<Record<Task, RoutingCf1Entry>> | null;
  readonly probe_expected: ProbeLetter[] | null;
  readonly resultValid?: boolean;
}

export interface AssembleRoutingTableInput {
  readonly version: string;
  readonly freeze: RoutingFreeze;
  readonly kappa_ok: boolean;
  readonly profileInputs: Readonly<Record<string, AssembleProfileInput>>;
  readonly expectedFreeze: ExpectedH4Hashes;
  readonly manifestVariants?: Readonly<Record<string, RoutingCalibratedVariant>>;
  readonly precisionB4?: number;
}

/**
 * Deterministically builds a `RoutingTable` from evaluation outcomes using `gate.ts`
 * (falling back safely to Path B / advisory whenever a gate or κ check fails),
 * then verifies publication invariants.
 */
export function assembleRoutingTable(
  input: AssembleRoutingTableInput
): PublishRoutingValidationResult {
  const profiles: Record<string, RoutingProfileEntry> = {};
  const resultValidByProfile: Record<string, boolean> = {};

  for (const baseId of Object.keys(BUNDLED_ROUTING_TABLE.profiles)) {
    const baseEntry = BUNDLED_ROUTING_TABLE.profiles[baseId]!;
    profiles[baseId] = {
      ...baseEntry,
      authority: { ...baseEntry.authority },
    };
  }

  for (const profileId of Object.keys(input.profileInputs)) {
    const pIn = input.profileInputs[profileId]!;
    const validRun = pIn.resultValid ?? true;
    resultValidByProfile[profileId] = validRun;

    const gatePass =
      input.kappa_ok &&
      validRun &&
      PATH_A_ALLOWED_PROFILES.has(profileId) &&
      pIn.calibration !== null &&
      pIn.calibratedVariant !== null &&
      evaluateGate(pIn.calibration, DEFAULT_GATE_THRESHOLDS).pathA;

    const supportPass =
      input.kappa_ok &&
      validRun &&
      pIn.calibration !== null &&
      pIn.calibratedVariant !== null &&
      evaluateSupportGate(pIn.calibration.support, DEFAULT_GATE_THRESHOLDS).authoritative;

    const authority: Record<Task, Authority> = {
      B1: checkAuthority(pIn.cf1, "B1"),
      B2: checkAuthority(pIn.cf1, "B2"),
      B3: checkAuthority(pIn.cf1, "B3"),
      B5: checkAuthority(pIn.cf1, "B5"),
      O2: checkAuthority(pIn.cf1, "O2"),
    };

    profiles[profileId] = {
      path: gatePass ? "A" : "B",
      contradicts: {
        surface: gatePass
          ? "HINT_THEN_CLOUD"
          : profileId === "no_local_model"
            ? "CLOUD_ONLY_WITH_CONSENT"
            : "QUIET_ESCALATE",
      },
      supported: { surface: "INFO_ONLY" },
      nei: { surface: "QUIET_ESCALATE" },
      authority,
      supportVerdicts: supportPass ? "authoritative" : "advisory",
      calibratedVariant: pIn.calibratedVariant,
      calibration: pIn.calibration,
      cf1: pIn.cf1,
      probe_expected: pIn.probe_expected,
    };
  }

  const candidate: RoutingTable = {
    version: input.version,
    gate: { ...DEFAULT_GATE_THRESHOLDS },
    freeze: { ...input.freeze },
    kappa_ok: input.kappa_ok,
    profiles,
  };

  return verifyPublishableRoutingTable({
    table: candidate,
    expectedFreeze: input.expectedFreeze,
    ...(input.manifestVariants !== undefined ? { manifestVariants: input.manifestVariants } : {}),
    resultValidByProfile,
    ...(input.precisionB4 !== undefined ? { precisionB4: input.precisionB4 } : {}),
  });
}

export interface PublishCliIo {
  readonly readText?: (filePath: string) => string;
  readonly writeText?: (filePath: string, content: string) => void;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

/**
 * CLI runner implementing `publish_routing.ts --confirm` (`AC-EVAL-05`).
 * Refuses publication with non-zero exit code without writing `--out` whenever
 * `--confirm` is absent or any guard check fails.
 */
export function runPublishRoutingCli(argv: readonly string[], io?: PublishCliIo): number {
  const readText = io?.readText ?? ((p: string) => readFileSync(p, "utf8"));
  const writeText =
    io?.writeText ??
    ((p: string, content: string) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
    });
  const stdout = io?.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stderr = io?.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));

  let inputPath: string | undefined;
  let hashesPath: string | undefined;
  let outPath: string | undefined;
  let confirm = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--confirm") {
      confirm = true;
    } else if (arg === "--input" && i + 1 < argv.length) {
      inputPath = argv[i + 1];
      i += 1;
    } else if (arg === "--h4-hashes" && i + 1 < argv.length) {
      hashesPath = argv[i + 1];
      i += 1;
    } else if (arg === "--out" && i + 1 < argv.length) {
      outPath = argv[i + 1];
      i += 1;
    }
  }

  if (!inputPath || !hashesPath) {
    stderr("Usage: publish_routing.ts --input <routing.json> --h4-hashes <hashes.json> [--out <rc.json>] --confirm");
    return 1;
  }

  let parsedInput: unknown;
  let parsedHashes: unknown;
  try {
    parsedInput = JSON.parse(readText(resolve(inputPath)));
    parsedHashes = JSON.parse(readText(resolve(hashesPath)));
  } catch (e) {
    stderr(`Failed to read input JSON: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const hashRec =
    typeof parsedHashes === "object" && parsedHashes !== null
      ? (parsedHashes as Record<string, unknown>)
      : {};
  const expectedFreeze: ExpectedH4Hashes = {
    tier_a_hash: String(hashRec["tier_a_hash"] ?? ""),
    tier_b_hash: String(hashRec["tier_b_hash"] ?? ""),
    cf1_baseline_hash: String(hashRec["cf1_baseline_hash"] ?? ""),
  };

  const manifestVariants = hashRec["manifestVariants"] as
    | Readonly<Record<string, RoutingCalibratedVariant>>
    | undefined;
  const precisionB4 =
    typeof hashRec["precisionB4"] === "number" ? hashRec["precisionB4"] : undefined;
  const resultValidByProfile = hashRec["resultValidByProfile"] as
    | Readonly<Record<string, boolean>>
    | undefined;

  const check = verifyPublishableRoutingTable({
    table: parsedInput,
    expectedFreeze,
    ...(manifestVariants !== undefined ? { manifestVariants } : {}),
    ...(resultValidByProfile !== undefined ? { resultValidByProfile } : {}),
    ...(precisionB4 !== undefined ? { precisionB4 } : {}),
  });

  if (!check.ok || check.table === undefined) {
    stderr(`Publication refused:\n- ${check.errors.join("\n- ")}`);
    return 1;
  }

  if (!confirm) {
    stderr("Dry run verified, but --confirm is required to write published routing_table.");
    return 1;
  }

  if (outPath) {
    const absOut = resolve(outPath);
    writeText(
      absOut,
      JSON.stringify(
        {
          routing_table: check.table,
          b4_counts_in_review: check.b4CountsInReview,
        },
        null,
        2
      ) + "\n"
    );
  }

  stdout(
    JSON.stringify({
      ok: true,
      version: check.table.version,
      b4_counts_in_review: check.b4CountsInReview,
    })
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runPublishRoutingCli(process.argv.slice(2));
}
