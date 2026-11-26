/**
 * Deterministic Offline Tier B Replay Engine & CLI (`tools/replay.ts`)
 * (`docs/spec/00_MASTER_CONTRACT.md` §5 D-30; `06` §5.2; `07` §2.5–§2.7, `AC-EVAL-06`, `AC-EVAL-12`).
 *
 * Re-executes Tier B post-decode validation, R1-E metrics/gates, B5 L1/baseline checks,
 * triage baseline, and CF-1 Holm-Bonferroni authority over logged raw outputs with zero
 * network/LLM calls. Aborts immediately with `TIER_A_MISMATCH` if live Tier A hash
 * differs from `recordedTierAHash`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateL2Verdict,
  validateLocalVerdict,
  type AnchorEvidenceInput,
  type AnchorValidationResult,
  type L2AnchorValidationResult,
  type LocalVerdict,
} from "@toulmin/core-l0/anchor";
import {
  checkL1B5Output,
  classifyB5Baseline,
  type B5Tuple,
} from "@toulmin/core-l0/b5pairing";
import {
  DEFAULT_GATE_THRESHOLDS,
  evaluateGate,
  evaluateSupportGate,
} from "@toulmin/core-l0/gate";
import { baselineTriage, type BaselineTriageInput } from "@toulmin/core-l0/triageBaseline";
import {
  parseAndValidateAiOutput,
  type Authority,
  type B5CheckV1,
  type B5Verdict,
  type BaselineTriage,
  type L2Verdict,
  type ProbeLetter,
  type Task,
  type VerdictFlatV1,
  type VerdictV1,
} from "@toulmin/schemas";
import {
  DEFAULT_REPO_ROOT,
  checkFreezeManifest,
  collectTierATsFiles,
  collectTierBTsFiles,
  compareUtf8Bytes,
  computeFreezeHash,
  isBareSha256Hex,
  sha256HexUtf8,
} from "./freeze-hash.js";
import {
  evaluateCf1ProfileHolm,
  type Cf1TaskInput,
} from "../eval-harness/src/holm.js";
import {
  SEED_BOOTSTRAP,
  computeR1EMetrics,
  type R1EMetricsSummary,
  type R1EPairObservation,
  type RunVerdict,
} from "../eval-harness/src/stats.js";

export type ReplayErrorCode =
  | "TIER_A_MISMATCH"
  | "CF1_BASELINE_MISMATCH"
  | "INVALID_LOG"
  | "LOG_NOT_FOUND";

export interface ReplayLoggedR1ECall {
  readonly pairId: string;
  readonly run: 1 | 2 | 3;
  readonly gold: ProbeLetter;
  readonly layer?: "L1" | "L2";
  readonly schemaId:
    | "VerdictV1"
    | "VerdictV1_cap30"
    | "VerdictV1_cap20"
    | "VerdictFlatV1"
    | "L2Verdict";
  readonly claimText: string;
  readonly contextSentence?: string;
  readonly evidenceTexts: readonly AnchorEvidenceInput[];
  readonly rawText: string;
  readonly inferenceSource: "ON_DEVICE" | "IN_CLOUD" | "NONE";
  readonly transientReason?: "DEADLINE" | "TRUNCATED" | "BUSY" | "NETWORK" | "SLOT_LOST" | "OTHER" | null;
  readonly calibratedVariant?: { readonly schemaId: string; readonly reasoningCap: number };
  readonly actualVariant?: { readonly schemaId: string; readonly reasoningCap: number };
  readonly lang?: string;
  readonly recordedVerdict?: RunVerdict | "PARTIAL";
  readonly recordedFailReason?: string | null;
}

export interface ReplayLoggedB5Call {
  readonly itemId: string;
  readonly rawText: string;
  readonly recordedVerdict?: B5Verdict | "INVALID";
  readonly baselinePair?: { readonly a: B5Tuple; readonly b: B5Tuple };
  readonly recordedBaselineVerdict?: B5Verdict;
}

export interface ReplayLoggedTriageCall {
  readonly itemId: string;
  readonly input: BaselineTriageInput;
  readonly recorded?: BaselineTriage;
}

export interface ReplayRunLog {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly profileId: string;
  readonly recordedTierAHash: string;
  readonly recordedTierBHash?: string;
  readonly cf1BaselineHash?: string;
  readonly r1eCalls?: readonly ReplayLoggedR1ECall[];
  readonly b5Calls?: readonly ReplayLoggedB5Call[];
  readonly triageCalls?: readonly ReplayLoggedTriageCall[];
  readonly cf1Tasks?: readonly Cf1TaskInput[];
  readonly recordedSummary?: {
    readonly pHat?: number;
    readonly wilsonLb?: number;
    readonly stability?: number;
    readonly ppPairs?: number;
    readonly recall?: number;
    readonly pathA?: boolean;
    readonly psPairs?: number;
    readonly wilsonLbS?: number;
    readonly supportAuthoritative?: boolean;
    readonly authority?: Partial<Record<Task, Authority>>;
  };
}

export interface ReplayVerdictDiff {
  readonly kind: "R1E" | "B5_L1" | "B5_BASELINE" | "TRIAGE_BASELINE";
  readonly id: string;
  readonly run?: number;
  readonly oldVerdict: string;
  readonly newVerdict: string;
  readonly oldFailReason: string | null;
  readonly newFailReason: string | null;
}

export interface ReplayMetricDiff {
  readonly metric: string;
  readonly firstLook: string;
  readonly replayed: string;
}

export interface ReplayOptions {
  readonly log: ReplayRunLog;
  readonly repoRoot?: string;
  readonly tierAManifestPath?: string;
  readonly tierBManifestPath?: string;
  readonly cf1BaselineManifestPath?: string;
  readonly bootstrapIterations?: number;
}

export interface R1EL2ReplaySummary {
  readonly totalCalls: number;
  readonly ppL2: number;
  readonly tpL2: number;
  readonly fpSL2: number;
  readonly fpNL2: number;
  readonly pHatL2C: number;
  readonly rHatL2C: number;
  readonly fsrCL2: number;
  readonly fsrNL2: number;
  readonly partialCount: number;
  readonly missingCount: number;
}

export interface ReplaySuccessResult {
  readonly ok: true;
  readonly runId: string;
  readonly profileId: string;
  readonly tierAHash: string;
  readonly recordedTierBHash: string | null;
  readonly replayedTierBHash: string;
  readonly cf1BaselineHash: string | null;
  readonly verdictDiffs: readonly ReplayVerdictDiff[];
  readonly metricDiffs: readonly ReplayMetricDiff[];
  readonly r1eSummary: R1EMetricsSummary | null;
  readonly r1eL2Summary: R1EL2ReplaySummary | null;
  readonly b5Summary: {
    readonly total: number;
    readonly diffs: number;
  };
  readonly triageSummary: {
    readonly total: number;
    readonly diffs: number;
  };
  readonly cf1Authority: Record<Task, Authority> | null;
  readonly replayDiffHash: string;
  readonly reportMarkdown: string;
  readonly reportSha256: string;
}

export interface ReplayFailureResult {
  readonly ok: false;
  readonly errorCode: ReplayErrorCode;
  readonly message: string;
  readonly currentTierAHash?: string;
  readonly recordedTierAHash?: string;
}

export type ReplayResult = ReplaySuccessResult | ReplayFailureResult;

function mapValidatedLocalToProbe(verdict: LocalVerdict | "NEI"): ProbeLetter {
  if (verdict === "SUPPORTED") return "S";
  if (verdict === "CONTRADICTS") return "C";
  return "N";
}

function mapValidatedL2ToVerdictLabel(verdict: L2AnchorValidationResult["verdict"]): RunVerdict | "PARTIAL" {
  if (verdict === "SUPPORTED") return "S";
  if (verdict === "CONTRADICTED") return "C";
  if (verdict === "PARTIAL") return "PARTIAL";
  return "N";
}

function replaySingleR1ECall(call: ReplayLoggedR1ECall): {
  readonly verdict: RunVerdict;
  readonly l2DetailedVerdict?: RunVerdict | "PARTIAL";
  readonly failReason: string | null;
} {
  const layer = call.layer ?? "L1";
  // Per 07 §3.5: transient outcome ALWAYS yields MISSING regardless of partial rawText
  if (call.transientReason !== undefined && call.transientReason !== null) {
    return { verdict: "MISSING", failReason: call.transientReason };
  }
  if (layer === "L1" && call.inferenceSource !== "ON_DEVICE") {
    return { verdict: "MISSING", failReason: "NOT_ON_DEVICE" };
  }
  if (call.rawText.trim().length === 0) {
    return { verdict: "N", failReason: "PARSE" };
  }

  const parsed = parseAndValidateAiOutput(call.schemaId, call.rawText);
  if (!parsed.ok) {
    return { verdict: "N", failReason: parsed.error };
  }

  if (layer === "L2") {
    const l2Data = parsed.data as L2Verdict;
    const l2Res = validateL2Verdict(
      l2Data,
      call.evidenceTexts,
      call.claimText,
      call.lang !== undefined ? { lang: call.lang } : undefined
    );
    const detailed = mapValidatedL2ToVerdictLabel(l2Res.verdict);
    return {
      verdict: detailed === "PARTIAL" ? "N" : detailed,
      l2DetailedVerdict: detailed,
      failReason: l2Res.failReason,
    };
  }

  const l1Data = parsed.data as VerdictV1 | VerdictFlatV1;
  const rawVerdict: LocalVerdict =
    l1Data.s04_verdict === "SUPPORTED" ||
    l1Data.s04_verdict === "CONTRADICTS" ||
    l1Data.s04_verdict === "NEI_SILENT_ESCALATE"
      ? l1Data.s04_verdict
      : "NEI_SILENT_ESCALATE";

  const l1Res: AnchorValidationResult = validateLocalVerdict(
    {
      s01_evidence_span: l1Data.s01_evidence_span,
      s02_evidence_idx: l1Data.s02_evidence_idx,
      s03_micro_reasoning: l1Data.s03_micro_reasoning,
      s04_verdict: rawVerdict,
    },
    call.evidenceTexts,
    call.claimText,
    {
      ...(call.calibratedVariant !== undefined ? { calibratedVariant: call.calibratedVariant } : {}),
      ...(call.actualVariant !== undefined ? { actualVariant: call.actualVariant } : {}),
      ...(call.lang !== undefined ? { lang: call.lang } : {}),
    }
  );
  return {
    verdict: mapValidatedLocalToProbe(l1Res.verdict),
    failReason: l1Res.failReason,
  };
}

function resolveCurrentTierHashes(
  repoRoot: string,
  tierAManifestPath?: string,
  tierBManifestPath?: string
): { readonly tierAHash: string; readonly tierBHash: string } {
  let tierAHash: string;
  if (tierAManifestPath !== undefined) {
    const check = checkFreezeManifest({ rootDir: repoRoot, manifestPath: tierAManifestPath });
    if (!check.ok || check.hash === undefined) {
      throw new Error(check.message ?? `Failed reading Tier A manifest: ${tierAManifestPath}`);
    }
    tierAHash = check.hash;
  } else {
    tierAHash = computeFreezeHash(repoRoot, collectTierATsFiles(repoRoot)).hash;
  }

  let tierBHash: string;
  if (tierBManifestPath !== undefined) {
    const check = checkFreezeManifest({ rootDir: repoRoot, manifestPath: tierBManifestPath });
    if (!check.ok || check.hash === undefined) {
      throw new Error(check.message ?? `Failed reading Tier B manifest: ${tierBManifestPath}`);
    }
    tierBHash = check.hash;
  } else {
    tierBHash = computeFreezeHash(repoRoot, collectTierBTsFiles(repoRoot)).hash;
  }

  return { tierAHash, tierBHash };
}

/**
 * Deterministic Markdown formatter (`07` §2.5 rule 4) — zero wall-clock timestamps,
 * guaranteeing identical SHA-256 across repeated replays on identical Tier B inputs (`AC-EVAL-12`).
 */
export function formatReplayReportMarkdown(res: Omit<ReplaySuccessResult, "reportMarkdown" | "reportSha256">): string {
  const lines: string[] = [
    `# Tier B Deterministic Replay Report (\`${res.runId}\`)`,
    "",
    `- Profile: \`${res.profileId}\``,
    `- Tier A hash (verified equal): \`${res.tierAHash}\``,
    `- Recorded Tier B hash: \`${res.recordedTierBHash ?? "(none)"}\``,
    `- Replayed Tier B hash: \`${res.replayedTierBHash}\``,
    ...(res.cf1BaselineHash !== null ? [`- CF-1 baseline hash: \`${res.cf1BaselineHash}\``] : []),
    `- Replay diff hash: \`${res.replayDiffHash}\``,
    "",
  ];

  if (res.r1eSummary !== null) {
    lines.push(
      "## R1-E Replayed Metrics & Gates",
      "",
      `- Pairs: ${res.r1eSummary.nPairs} (total calls: ${res.r1eSummary.totalCalls}, missing: ${res.r1eSummary.missingCalls})`,
      `- \`RESULT_VALID\`: \`${String(res.r1eSummary.resultValid)}\``,
      `- Path A precision \`P_hat\` = ${res.r1eSummary.pHat.toFixed(4)}, \`WilsonLB95\` = ${res.r1eSummary.wilsonLb.toFixed(4)}, stability \`S_p\` = ${res.r1eSummary.stability.toFixed(4)}, \`PP_pairs\` = ${res.r1eSummary.ppPairs}`,
      `- Path A gate: \`${res.r1eSummary.gateResult.pathA ? "PASS" : "FAIL"}\`${res.r1eSummary.gateResult.failed.length > 0 ? ` (${res.r1eSummary.gateResult.failed.join(", ")})` : ""}`,
      `- Support gate (\`PS_pairs\`=${res.r1eSummary.support.psPairs}, \`WilsonLB95_S\`=${res.r1eSummary.support.wilsonLbS.toFixed(4)}): \`${res.r1eSummary.supportGateResult.authoritative ? "AUTHORITATIVE" : "ADVISORY"}\``,
      ""
    );
  }

  if (res.r1eL2Summary !== null) {
    lines.push(
      "## R1-E-L2 Reporting-Only Summary (`07` §3.10)",
      "",
      `- L2 calls: ${res.r1eL2Summary.totalCalls} (missing: ${res.r1eL2Summary.missingCount}, PARTIAL: ${res.r1eL2Summary.partialCount})`,
      `- \`P_hat_L2(C)\` = ${res.r1eL2Summary.pHatL2C.toFixed(4)} (${res.r1eL2Summary.tpL2}/${res.r1eL2Summary.ppL2}), \`R_hat_L2(C)\` = ${res.r1eL2Summary.rHatL2C.toFixed(4)}`,
      `- \`FSR_C_L2\` = ${res.r1eL2Summary.fsrCL2.toFixed(4)}, \`FSR_N_L2\` = ${res.r1eL2Summary.fsrNL2.toFixed(4)}`,
      ""
    );
  }

  if (res.cf1Authority !== null) {
    lines.push("## CF-1 Holm-Bonferroni Authority", "");
    for (const t of ["B1", "B2", "B3", "B5", "O2"] as const) {
      lines.push(`- \`${t}\`: \`${res.cf1Authority[t]}\``);
    }
    lines.push("");
  }

  lines.push("## Metric Diffs (First-Look vs Replayed)", "");
  if (res.metricDiffs.length === 0) {
    lines.push("- No metric diffs.");
  } else {
    lines.push("| Metric | First-Look | Replayed |", "|---|---|---|");
    for (const d of res.metricDiffs) {
      lines.push(`| \`${d.metric}\` | \`${d.firstLook}\` | \`${d.replayed}\` |`);
    }
  }
  lines.push("");

  lines.push(`## Verdict Diffs (${res.verdictDiffs.length})`, "");
  if (res.verdictDiffs.length === 0) {
    lines.push("- No verdict diffs.");
  } else {
    lines.push("| Kind | ID | Run | Old -> New | Fail Reason (Old -> New) |", "|---|---|---:|---|---|");
    for (const v of res.verdictDiffs) {
      lines.push(
        `| \`${v.kind}\` | \`${v.id}\` | ${v.run ?? "-"} | \`${v.oldVerdict}\` -> \`${v.newVerdict}\` | \`${v.oldFailReason ?? "-"}\` -> \`${v.newFailReason ?? "-"}\` |`
      );
    }
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

/**
 * Executes offline deterministic Tier B replay (`07` §2.5, `AC-EVAL-06`, `AC-EVAL-12`).
 */
export function replayRun(options: ReplayOptions): ReplayResult {
  const { log } = options;
  if (!log || typeof log !== "object" || log.schemaVersion !== 1 || typeof log.runId !== "string") {
    return {
      ok: false,
      errorCode: "INVALID_LOG",
      message: "Replay log must have schemaVersion 1 and runId",
    };
  }

  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  let hashes: { tierAHash: string; tierBHash: string };
  try {
    hashes = resolveCurrentTierHashes(
      repoRoot,
      options.tierAManifestPath,
      options.tierBManifestPath
    );
  } catch (err) {
    return {
      ok: false,
      errorCode: "INVALID_LOG",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Hard Tier A invariance check (`07` §2.5 step 1, `AC-EVAL-12`)
  if (!isBareSha256Hex(log.recordedTierAHash) || hashes.tierAHash !== log.recordedTierAHash) {
    return {
      ok: false,
      errorCode: "TIER_A_MISMATCH",
      currentTierAHash: hashes.tierAHash,
      recordedTierAHash: log.recordedTierAHash,
      message: `TIER_A_MISMATCH: run recorded tier_a_hash=${log.recordedTierAHash}, current=${hashes.tierAHash}`,
    };
  }

  let verifiedCf1BaselineHash: string | null = log.cf1BaselineHash ?? null;
  if (log.cf1BaselineHash !== undefined && !isBareSha256Hex(log.cf1BaselineHash)) {
    return {
      ok: false,
      errorCode: "CF1_BASELINE_MISMATCH",
      message: `Invalid cf1BaselineHash format: "${log.cf1BaselineHash}"`,
    };
  }
  if (options.cf1BaselineManifestPath !== undefined) {
    const cf1Check = checkFreezeManifest({
      rootDir: repoRoot,
      manifestPath: options.cf1BaselineManifestPath,
      ...(log.cf1BaselineHash !== undefined ? { expectedHash: log.cf1BaselineHash } : {}),
    });
    if (!cf1Check.ok || cf1Check.hash === undefined) {
      return {
        ok: false,
        errorCode: "CF1_BASELINE_MISMATCH",
        message: cf1Check.message ?? "CF-1 baseline manifest check failed",
      };
    }
    verifiedCf1BaselineHash = cf1Check.hash;
  }

  const verdictDiffs: ReplayVerdictDiff[] = [];
  const metricDiffs: ReplayMetricDiff[] = [];

  // 1. Replay R1-E (L1, 3 runs/pair) & R1-E-L2 (L2 reporting-only, 1 call/pair) separately
  const r1eCalls = log.r1eCalls ?? [];
  let r1eSummary: R1EMetricsSummary | null = null;
  let r1eL2Summary: R1EL2ReplaySummary | null = null;

  const l1Calls = r1eCalls.filter((c) => (c.layer ?? "L1") === "L1");
  const l2Calls = r1eCalls.filter((c) => c.layer === "L2");

  if (l1Calls.length > 0) {
    const byPair = new Map<
      string,
      { gold: ProbeLetter; runs: Partial<Record<1 | 2 | 3, RunVerdict>> }
    >();

    for (const call of l1Calls) {
      const replayed = replaySingleR1ECall(call);
      if (
        call.recordedVerdict !== undefined &&
        (replayed.verdict !== call.recordedVerdict ||
          (call.recordedFailReason !== undefined &&
            replayed.failReason !== call.recordedFailReason))
      ) {
        verdictDiffs.push({
          kind: "R1E",
          id: call.pairId,
          run: call.run,
          oldVerdict: call.recordedVerdict,
          newVerdict: replayed.verdict,
          oldFailReason: call.recordedFailReason ?? null,
          newFailReason: replayed.failReason,
        });
      }

      let bucket = byPair.get(call.pairId);
      if (bucket === undefined) {
        bucket = { gold: call.gold, runs: {} };
        byPair.set(call.pairId, bucket);
      }
      bucket.runs[call.run] = replayed.verdict;
    }

    const pairObs: R1EPairObservation[] = [];
    for (const pairId of Array.from(byPair.keys()).sort(compareUtf8Bytes)) {
      const b = byPair.get(pairId)!;
      pairObs.push({
        pairId,
        gold: b.gold,
        runs: [b.runs[1] ?? "MISSING", b.runs[2] ?? "MISSING", b.runs[3] ?? "MISSING"],
      });
    }

    r1eSummary = computeR1EMetrics(pairObs, {
      ...(options.bootstrapIterations !== undefined
        ? { bootstrapIterations: options.bootstrapIterations }
        : {}),
      seed: SEED_BOOTSTRAP,
    });

    // Ensure gate decisions come exclusively from `gate.ts`
    const gateCheck = evaluateGate(
      {
        p_hat: r1eSummary.pHat,
        wilson_lb: r1eSummary.wilsonLb,
        stability: r1eSummary.stability,
        pp_pairs: r1eSummary.ppPairs,
        tp_pairs: r1eSummary.tpPairs,
      },
      DEFAULT_GATE_THRESHOLDS
    );
    const supportCheck = evaluateSupportGate(
      {
        ps_pairs: r1eSummary.support.psPairs,
        ts_pairs: r1eSummary.support.tsPairs,
        wilson_lb_s: r1eSummary.support.wilsonLbS,
      },
      DEFAULT_GATE_THRESHOLDS
    );

    if (log.recordedSummary !== undefined) {
      const rs = log.recordedSummary;
      if (rs.pHat !== undefined && rs.pHat.toFixed(4) !== r1eSummary.pHat.toFixed(4)) {
        metricDiffs.push({ metric: "pHat", firstLook: rs.pHat.toFixed(4), replayed: r1eSummary.pHat.toFixed(4) });
      }
      if (rs.wilsonLb !== undefined && rs.wilsonLb.toFixed(4) !== r1eSummary.wilsonLb.toFixed(4)) {
        metricDiffs.push({ metric: "wilsonLb", firstLook: rs.wilsonLb.toFixed(4), replayed: r1eSummary.wilsonLb.toFixed(4) });
      }
      if (rs.stability !== undefined && rs.stability.toFixed(4) !== r1eSummary.stability.toFixed(4)) {
        metricDiffs.push({ metric: "stability", firstLook: rs.stability.toFixed(4), replayed: r1eSummary.stability.toFixed(4) });
      }
      if (rs.recall !== undefined && rs.recall.toFixed(4) !== r1eSummary.recall.toFixed(4)) {
        metricDiffs.push({ metric: "recall", firstLook: rs.recall.toFixed(4), replayed: r1eSummary.recall.toFixed(4) });
      }
      if (rs.ppPairs !== undefined && rs.ppPairs !== r1eSummary.ppPairs) {
        metricDiffs.push({ metric: "ppPairs", firstLook: String(rs.ppPairs), replayed: String(r1eSummary.ppPairs) });
      }
      if (rs.pathA !== undefined && rs.pathA !== gateCheck.pathA) {
        metricDiffs.push({ metric: "pathA", firstLook: String(rs.pathA), replayed: String(gateCheck.pathA) });
      }
      if (rs.psPairs !== undefined && rs.psPairs !== r1eSummary.support.psPairs) {
        metricDiffs.push({ metric: "psPairs", firstLook: String(rs.psPairs), replayed: String(r1eSummary.support.psPairs) });
      }
      if (rs.wilsonLbS !== undefined && rs.wilsonLbS.toFixed(4) !== r1eSummary.support.wilsonLbS.toFixed(4)) {
        metricDiffs.push({ metric: "wilsonLbS", firstLook: rs.wilsonLbS.toFixed(4), replayed: r1eSummary.support.wilsonLbS.toFixed(4) });
      }
      if (rs.supportAuthoritative !== undefined && rs.supportAuthoritative !== supportCheck.authoritative) {
        metricDiffs.push({ metric: "supportAuthoritative", firstLook: String(rs.supportAuthoritative), replayed: String(supportCheck.authoritative) });
      }
    }
  }

  if (l2Calls.length > 0) {
    let ppL2 = 0;
    let tpL2 = 0;
    let fpSL2 = 0;
    let fpNL2 = 0;
    let fsrC = 0;
    let fsrN = 0;
    let goldC = 0;
    let goldN = 0;
    let partialCount = 0;
    let missingCount = 0;

    for (const call of l2Calls) {
      if (call.gold === "C") goldC += 1;
      else if (call.gold === "N") goldN += 1;
      const replayed = replaySingleR1ECall(call);
      const det = replayed.l2DetailedVerdict ?? replayed.verdict;
      if (det === "MISSING") {
        missingCount += 1;
      } else if (det === "PARTIAL") {
        partialCount += 1;
      } else if (det === "C") {
        ppL2 += 1;
        if (call.gold === "C") tpL2 += 1;
        else if (call.gold === "S") fpSL2 += 1;
        else fpNL2 += 1;
      } else if (det === "S") {
        if (call.gold === "C") fsrC += 1;
        else if (call.gold === "N") fsrN += 1;
      }

      const recordedNormalized =
        call.recordedVerdict !== undefined
          ? (normalizeRunnerVerdictField(call.recordedVerdict) ?? call.recordedVerdict)
          : undefined;
      if (
        recordedNormalized !== undefined &&
        (det !== recordedNormalized ||
          (call.recordedFailReason !== undefined &&
            replayed.failReason !== call.recordedFailReason))
      ) {
        verdictDiffs.push({
          kind: "R1E",
          id: call.pairId,
          run: call.run,
          oldVerdict: recordedNormalized,
          newVerdict: det,
          oldFailReason: call.recordedFailReason ?? null,
          newFailReason: replayed.failReason,
        });
      }
    }

    r1eL2Summary = {
      totalCalls: l2Calls.length,
      ppL2,
      tpL2,
      fpSL2,
      fpNL2,
      pHatL2C: ppL2 > 0 ? tpL2 / ppL2 : 0,
      rHatL2C: goldC > 0 ? tpL2 / goldC : 0,
      fsrCL2: goldC > 0 ? fsrC / goldC : 0,
      fsrNL2: goldN > 0 ? fsrN / goldN : 0,
      partialCount,
      missingCount,
    };
  }

  // 2. Replay optional B5 checks
  const b5Calls = log.b5Calls ?? [];
  let b5Diffs = 0;
  for (const b5 of b5Calls) {
    const parsed = parseAndValidateAiOutput("B5CheckV1", b5.rawText);
    const replayedVerdict: B5Verdict | "INVALID" = parsed.ok
      ? checkL1B5Output(parsed.data as B5CheckV1)
      : "INVALID";
    if (b5.recordedVerdict !== undefined && replayedVerdict !== b5.recordedVerdict) {
      b5Diffs += 1;
      verdictDiffs.push({
        kind: "B5_L1",
        id: b5.itemId,
        oldVerdict: b5.recordedVerdict,
        newVerdict: replayedVerdict,
        oldFailReason: null,
        newFailReason: parsed.ok ? null : parsed.error,
      });
    }
    if (b5.baselinePair !== undefined) {
      const baseVerdict = classifyB5Baseline(b5.baselinePair.a, b5.baselinePair.b);
      if (b5.recordedBaselineVerdict !== undefined && baseVerdict !== b5.recordedBaselineVerdict) {
        b5Diffs += 1;
        verdictDiffs.push({
          kind: "B5_BASELINE",
          id: b5.itemId,
          oldVerdict: b5.recordedBaselineVerdict,
          newVerdict: baseVerdict,
          oldFailReason: null,
          newFailReason: null,
        });
      }
    }
  }

  // 3. Replay optional triage baseline checks
  const triageCalls = log.triageCalls ?? [];
  let triageDiffs = 0;
  for (const tr of triageCalls) {
    const res = baselineTriage(tr.input);
    const serialized = `${res.worth}:${res.claimType}:${String(res.uncited)}`;
    if (tr.recorded !== undefined) {
      const oldSer = `${tr.recorded.worth}:${tr.recorded.claimType}:${String(tr.recorded.uncited)}`;
      if (serialized !== oldSer) {
        triageDiffs += 1;
        verdictDiffs.push({
          kind: "TRIAGE_BASELINE",
          id: tr.itemId,
          oldVerdict: oldSer,
          newVerdict: serialized,
          oldFailReason: null,
          newFailReason: null,
        });
      }
    }
  }

  // 4. Replay optional CF-1 Holm-Bonferroni authority
  let cf1Authority: Record<Task, Authority> | null = null;
  if (log.cf1Tasks !== undefined && log.cf1Tasks.length > 0) {
    const evalHolm = evaluateCf1ProfileHolm(log.profileId, log.cf1Tasks);
    cf1Authority = evalHolm.authority;
    if (log.recordedSummary?.authority !== undefined) {
      for (const task of ["B1", "B2", "B3", "B5", "O2"] as const) {
        const oldAuth = log.recordedSummary.authority[task];
        if (oldAuth !== undefined && oldAuth !== cf1Authority[task]) {
          metricDiffs.push({
            metric: `authority.${task}`,
            firstLook: oldAuth,
            replayed: cf1Authority[task],
          });
        }
      }
    }
  }

  verdictDiffs.sort((a, b) => {
    const k = compareUtf8Bytes(a.kind, b.kind);
    if (k !== 0) return k;
    const idCmp = compareUtf8Bytes(a.id, b.id);
    if (idCmp !== 0) return idCmp;
    return (a.run ?? 0) - (b.run ?? 0);
  });

  const canonicalDiffPayload = JSON.stringify({
    runId: log.runId,
    tierAHash: hashes.tierAHash,
    replayedTierBHash: hashes.tierBHash,
    cf1BaselineHash: verifiedCf1BaselineHash,
    verdictDiffs,
    metricDiffs,
    r1eSummary,
    r1eL2Summary,
    b5Summary: { total: b5Calls.length, diffs: b5Diffs },
    triageSummary: { total: triageCalls.length, diffs: triageDiffs },
    cf1Authority,
  });
  const replayDiffHash = sha256HexUtf8(canonicalDiffPayload);

  const partialResult: Omit<ReplaySuccessResult, "reportMarkdown" | "reportSha256"> = {
    ok: true,
    runId: log.runId,
    profileId: log.profileId,
    tierAHash: hashes.tierAHash,
    recordedTierBHash: log.recordedTierBHash ?? null,
    replayedTierBHash: hashes.tierBHash,
    cf1BaselineHash: verifiedCf1BaselineHash,
    verdictDiffs,
    metricDiffs,
    r1eSummary,
    r1eL2Summary,
    b5Summary: { total: b5Calls.length, diffs: b5Diffs },
    triageSummary: { total: triageCalls.length, diffs: triageDiffs },
    cf1Authority,
    replayDiffHash,
  };

  const reportMarkdown = formatReplayReportMarkdown(partialResult);
  const reportSha256 = sha256HexUtf8(reportMarkdown);

  return {
    ...partialResult,
    reportMarkdown,
    reportSha256,
  };
}

function normalizeRunnerVerdictField(raw: unknown): (RunVerdict | "PARTIAL") | undefined {
  if (raw === "S" || raw === "C" || raw === "N" || raw === "MISSING" || raw === "PARTIAL") return raw;
  if (raw === "P") return "PARTIAL";
  if (raw === "SUPPORTED") return "S";
  if (raw === "CONTRADICTS" || raw === "CONTRADICTED") return "C";
  if (raw === "NEI_SILENT_ESCALATE" || raw === "NEI") return "N";
  return undefined;
}

function normalizeRunnerCall(rawObj: Record<string, unknown>): ReplayLoggedR1ECall {
  const recVerdict =
    normalizeRunnerVerdictField(rawObj["recordedVerdict"]) ??
    normalizeRunnerVerdictField(rawObj["verdictValidated"]);
  const recFail =
    rawObj["recordedFailReason"] !== undefined
      ? (rawObj["recordedFailReason"] as string | null)
      : rawObj["anchorFailReason"] !== undefined
        ? (rawObj["anchorFailReason"] as string | null)
        : undefined;
  return {
    ...(rawObj as unknown as ReplayLoggedR1ECall),
    run: (typeof rawObj["run"] === "number" ? rawObj["run"] : 1) as 1 | 2 | 3,
    gold: (typeof rawObj["gold"] === "string" ? rawObj["gold"] : "N") as ProbeLetter,
    schemaId: (typeof rawObj["schemaId"] === "string"
      ? rawObj["schemaId"]
      : "VerdictV1") as ReplayLoggedR1ECall["schemaId"],
    ...(recVerdict !== undefined ? { recordedVerdict: recVerdict } : {}),
    ...(recFail !== undefined ? { recordedFailReason: recFail } : {}),
  };
}

function loadRunDirectoryLog(dir: string): ReplayRunLog {
  const directReplayLog = resolve(dir, "replay_log.json");
  if (existsSync(directReplayLog)) {
    return JSON.parse(readFileSync(directReplayLog, "utf8")) as ReplayRunLog;
  }
  const manifestPath = resolve(dir, "manifest.json");
  const callsJsonlPath = existsSync(resolve(dir, "calls.jsonl"))
    ? resolve(dir, "calls.jsonl")
    : resolve(dir, "r1e_calls.jsonl");
  if (!existsSync(manifestPath)) {
    throw new Error(`Neither replay_log.json nor manifest.json found in ${dir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    runId: string;
    profileId?: string;
    tier_a_hash: string;
    tier_b_hash?: string;
    cf1_baseline_hash?: string;
  };
  const r1eCalls: ReplayLoggedR1ECall[] = [];
  if (existsSync(callsJsonlPath)) {
    const rawLines = readFileSync(callsJsonlPath, "utf8").split(/\r?\n/);
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        r1eCalls.push(normalizeRunnerCall(JSON.parse(trimmed) as Record<string, unknown>));
      }
    }
  }
  return {
    schemaVersion: 1,
    runId: manifest.runId,
    profileId: manifest.profileId ?? "web_chrome_nano",
    recordedTierAHash: manifest.tier_a_hash,
    ...(manifest.tier_b_hash !== undefined ? { recordedTierBHash: manifest.tier_b_hash } : {}),
    ...(manifest.cf1_baseline_hash !== undefined ? { cf1BaselineHash: manifest.cf1_baseline_hash } : {}),
    r1eCalls,
  };
}

export function runReplayCli(argv: readonly string[]): number {
  let logFile: string | undefined;
  let runDir: string | undefined;
  let repoRoot: string = DEFAULT_REPO_ROOT;
  let tierAManifestPath: string | undefined;
  let tierBManifestPath: string | undefined;
  let cf1BaselineManifestPath: string | undefined;
  let outFile: string | undefined;
  let jsonOutFile: string | undefined;
  let jsonFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--json") jsonFlag = true;
    else if (arg === "--log" && i + 1 < argv.length) logFile = argv[++i]!;
    else if (arg === "--run-dir" && i + 1 < argv.length) runDir = argv[++i]!;
    else if (arg === "--root" && i + 1 < argv.length) repoRoot = resolve(argv[++i]!);
    else if (arg === "--tier-a-manifest" && i + 1 < argv.length) tierAManifestPath = argv[++i]!;
    else if (arg === "--tier-b-manifest" && i + 1 < argv.length) tierBManifestPath = argv[++i]!;
    else if (arg === "--cf1-manifest" && i + 1 < argv.length) cf1BaselineManifestPath = argv[++i]!;
    else if (arg === "--out" && i + 1 < argv.length) outFile = argv[++i]!;
    else if (arg === "--json-out" && i + 1 < argv.length) jsonOutFile = argv[++i]!;
    else {
      console.error(`Unknown or incomplete flag: ${arg}`);
      return 2;
    }
  }

  if (logFile === undefined && runDir === undefined) {
    console.error("--log <file.json> or --run-dir <dir> is required");
    return 2;
  }

  let parsedLog: unknown;
  try {
    if (logFile !== undefined) {
      const absLog = resolve(logFile);
      if (!existsSync(absLog)) {
        const errRes: ReplayFailureResult = {
          ok: false,
          errorCode: "LOG_NOT_FOUND",
          message: `Replay log not found: ${logFile}`,
        };
        if (jsonFlag) console.log(JSON.stringify(errRes));
        else console.error(errRes.message);
        return 1;
      }
      parsedLog = JSON.parse(readFileSync(absLog, "utf8"));
    } else {
      parsedLog = loadRunDirectoryLog(resolve(runDir!));
    }
  } catch (err) {
    const errRes: ReplayFailureResult = {
      ok: false,
      errorCode: "INVALID_LOG",
      message: `Malformed or missing replay log: ${err instanceof Error ? err.message : String(err)}`,
    };
    if (jsonFlag) console.log(JSON.stringify(errRes));
    else console.error(errRes.message);
    return 1;
  }

  const res = replayRun({
    log: parsedLog as ReplayRunLog,
    repoRoot,
    ...(tierAManifestPath !== undefined ? { tierAManifestPath } : {}),
    ...(tierBManifestPath !== undefined ? { tierBManifestPath } : {}),
    ...(cf1BaselineManifestPath !== undefined ? { cf1BaselineManifestPath } : {}),
  });

  if (!res.ok) {
    if (jsonFlag) console.log(JSON.stringify(res));
    else console.error(res.message);
    return 1;
  }

  if (outFile !== undefined) {
    const absOut = resolve(outFile);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, res.reportMarkdown, "utf8");
  }
  if (jsonOutFile !== undefined) {
    const absJsonOut = resolve(jsonOutFile);
    mkdirSync(dirname(absJsonOut), { recursive: true });
    writeFileSync(absJsonOut, `${JSON.stringify(res, null, 2)}\n`, "utf8");
  }

  if (jsonFlag) {
    console.log(JSON.stringify(res));
  } else {
    console.log(res.reportMarkdown);
  }
  return 0;
}

const entryArg = process.argv[1];
if (entryArg !== undefined && pathToFileURL(resolve(entryArg)).href === import.meta.url) {
  process.exit(runReplayCli(process.argv.slice(2)));
}
