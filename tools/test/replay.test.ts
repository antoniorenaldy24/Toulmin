import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectTierATsFiles, computeFreezeHash } from "../freeze-hash.js";
import {
  replayRun,
  runReplayCli,
  type ReplayLoggedR1ECall,
  type ReplayRunLog,
} from "../replay.js";

const REPO_ROOT = resolve(__dirname, "..", "..");

function makeCall(params: {
  pairId: string;
  run: 1 | 2 | 3;
  gold: "S" | "C" | "N";
  claimText: string;
  evidence: string;
  span: string;
  verdict: "SUPPORTED" | "CONTRADICTS" | "NEI_SILENT_ESCALATE";
  reasoning: string;
  recordedVerdict?: "S" | "C" | "N" | "MISSING";
  recordedFailReason?: string | null;
}): ReplayLoggedR1ECall {
  const rawText = JSON.stringify({
    s01_evidence_span: params.span,
    s02_evidence_idx: params.verdict === "NEI_SILENT_ESCALATE" ? -1 : 0,
    s03_micro_reasoning: params.reasoning,
    s04_verdict: params.verdict,
  });
  return {
    pairId: params.pairId,
    run: params.run,
    gold: params.gold,
    layer: "L1",
    schemaId: "VerdictV1",
    claimText: params.claimText,
    evidenceTexts: [params.evidence],
    rawText,
    inferenceSource: "ON_DEVICE",
    ...(params.recordedVerdict !== undefined ? { recordedVerdict: params.recordedVerdict } : {}),
    ...(params.recordedFailReason !== undefined
      ? { recordedFailReason: params.recordedFailReason }
      : {}),
  };
}

describe("tools/replay.ts deterministic Tier B replay & TIER_A_MISMATCH guard (AC-EVAL-06, AC-EVAL-12)", () => {
  it("reproduces identical R1-E/B5/triage/CF-1 outcomes with byte-identical reports across runs", () => {
    const liveTierA = computeFreezeHash(REPO_ROOT, collectTierATsFiles(REPO_ROOT)).hash;

    const r1eCalls: ReplayLoggedR1ECall[] = [];
    // 16 C pairs -> TP = 16, PP = 16 -> P_hat = 1.0, WilsonLB = 0.8064 >= 0.50, Path A PASS
    for (let i = 1; i <= 16; i += 1) {
      for (const run of [1, 2, 3] as const) {
        r1eCalls.push(
          makeCall({
            pairId: `c-${String(i).padStart(2, "0")}`,
            run,
            gold: "C",
            claimText: `Cohort ${i} mortality increased by 30% with treatment.`,
            evidence: `Cohort ${i} mortality decreased by 25% with treatment across follow-up.`,
            span: `Cohort ${i} mortality decreased by 25% with treatment`,
            verdict: "CONTRADICTS",
            reasoning: "Evidence shows mortality decreased whereas the claim states it increased.",
            recordedVerdict: "C",
            recordedFailReason: null,
          })
        );
      }
    }
    // 16 S pairs -> TS = 16, PS = 16 -> WilsonLB_S = 0.8064 >= 0.80, support gate PASS
    for (let i = 1; i <= 16; i += 1) {
      for (const run of [1, 2, 3] as const) {
        r1eCalls.push(
          makeCall({
            pairId: `s-${String(i).padStart(2, "0")}`,
            run,
            gold: "S",
            claimText: `Therapy ${i} improved survival rate by 15%.`,
            evidence: `Therapy ${i} improved survival rate by 15% compared with placebo.`,
            span: `Therapy ${i} improved survival rate by 15%`,
            verdict: "SUPPORTED",
            reasoning: "Evidence directly supports the survival rate increase of 15%.",
            recordedVerdict: "S",
            recordedFailReason: null,
          })
        );
      }
    }

    const log: ReplayRunLog = {
      schemaVersion: 1,
      runId: "replay-parity-run",
      profileId: "web_chrome_nano",
      recordedTierAHash: liveTierA,
      r1eCalls,
      b5Calls: [
        {
          itemId: "b5-1",
          rawText: JSON.stringify({
            s1_what: "Sample sizes differ due to different measures.",
            s2_same_population: false,
            s3_verdict: "INCONSISTENT",
          }),
          // L1 check downgrades INCONSISTENT with s2_same_population=false to DIFFERENT_QUANTITY
          recordedVerdict: "DIFFERENT_QUANTITY",
        },
      ],
      triageCalls: [
        {
          itemId: "tr-1",
          input: {
            clauseText: "Drug X reduced mortality by 30% [1].",
            section: "results",
            hasResolvedCitation: true,
          },
          recorded: {
            atoms: [{ start: 0, end: 5, claimType: "QUANTITATIVE" }],
            worth: "HIGH",
            claimType: "QUANTITATIVE",
            uncited: false,
          },
        },
      ],
      cf1Tasks: [
        { task: "B1", delta: 0.18, p: 0.010, power: 0.82 },
        { task: "B2", delta: 0.05, p: 0.200, power: 0.30 },
        { task: "B3", delta: 0.15, p: 0.030, power: 0.76 },
        {
          task: "B5",
          delta: 0.12,
          p: 0.040,
          power: 0.61,
          inconsistent_precision_l1: 0.82,
          inconsistent_precision_baseline: 0.78,
        },
      ],
      recordedSummary: {
        pHat: 1.0,
        ppPairs: 16,
        pathA: true,
        supportAuthoritative: true,
        authority: {
          B1: "authoritative",
          B2: "advisory",
          B3: "authoritative",
          B5: "authoritative",
          O2: "advisory",
        },
      },
    };

    const rep1 = replayRun({ log, repoRoot: REPO_ROOT, bootstrapIterations: 200 });
    const rep2 = replayRun({ log, repoRoot: REPO_ROOT, bootstrapIterations: 200 });
    expect(rep1.ok).toBe(true);
    expect(rep2.ok).toBe(true);
    if (!rep1.ok || !rep2.ok) throw new Error("Expected ok");

    expect(rep1.verdictDiffs).toEqual([]);
    expect(rep1.metricDiffs).toEqual([]);
    expect(rep1.r1eSummary?.gateResult.pathA).toBe(true);
    expect(rep1.r1eSummary?.supportGateResult.authoritative).toBe(true);
    expect(rep1.cf1Authority?.B1).toBe("authoritative");
    expect(rep1.cf1Authority?.B2).toBe("advisory");
    // Two replays produce byte-identical Markdown reports (`AC-EVAL-12`)
    expect(rep1.reportMarkdown).toBe(rep2.reportMarkdown);
    expect(rep1.reportSha256).toBe(rep2.reportSha256);
    expect(rep1.replayDiffHash).toBe(rep2.replayDiffHash);
  });

  it("aborts immediately with TIER_A_MISMATCH and exits non-zero when recordedTierAHash differs", () => {
    const mismatchLog: ReplayRunLog = {
      schemaVersion: 1,
      runId: "stale-tier-a",
      profileId: "web_chrome_nano",
      recordedTierAHash: "0".repeat(64),
      r1eCalls: [],
    };
    const res = replayRun({ log: mismatchLog, repoRoot: REPO_ROOT });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("Expected failure");
    expect(res.errorCode).toBe("TIER_A_MISMATCH");

    const dir = mkdtempSync(resolve(tmpdir(), "toulmin-replay-cli-"));
    try {
      const logPath = resolve(dir, "log.json");
      writeFileSync(logPath, JSON.stringify(mismatchLog), "utf8");
      expect(runReplayCli(["--log", logPath, "--root", REPO_ROOT])).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects Tier B verdict diffs when logged verdict disagrees with current validateLocalVerdict or checkL1B5Output", () => {
    const liveTierA = computeFreezeHash(REPO_ROOT, collectTierATsFiles(REPO_ROOT)).hash;
    // Logged as CONTRADICTS ("C"), but span is identical to claim -> validateLocalVerdict downgrades to NEI_SILENT_ESCALATE ("N") with NO_DIFFERENCE_SIGNAL
    const diffLog: ReplayRunLog = {
      schemaVersion: 1,
      runId: "tier-b-diff",
      profileId: "web_chrome_nano",
      recordedTierAHash: liveTierA,
      r1eCalls: [
        makeCall({
          pairId: "diff-1",
          run: 1,
          gold: "C",
          claimText: "Drug X reduced mortality by 30 percent in hospital patients.",
          evidence: "Drug X reduced mortality by 30 percent in hospital patients.",
          span: "Drug X reduced mortality by 30 percent in hospital patients.",
          verdict: "CONTRADICTS",
          reasoning: "Claim contradicts evidence.",
          recordedVerdict: "C",
          recordedFailReason: null,
        }),
      ],
      b5Calls: [
        {
          itemId: "b5-diff",
          rawText: JSON.stringify({
            s1_what: "Mismatched populations.",
            s2_same_population: false,
            s3_verdict: "INCONSISTENT",
          }),
          // Recorded old verdict before Tier B check -> replay computes DIFFERENT_QUANTITY
          recordedVerdict: "INCONSISTENT",
        },
      ],
    };

    const dir = mkdtempSync(resolve(tmpdir(), "toulmin-replay-diff-"));
    try {
      const logPath = resolve(dir, "diff_log.json");
      const outMd = resolve(dir, "replay_diff.md");
      writeFileSync(logPath, JSON.stringify(diffLog), "utf8");
      const exitCode = runReplayCli([
        "--log",
        logPath,
        "--root",
        REPO_ROOT,
        "--out",
        outMd,
      ]);
      expect(exitCode).toBe(0);
      const md = readFileSync(outMd, "utf8");
      expect(md).toContain("NO_DIFFERENCE_SIGNAL");
      expect(md).toContain("INCONSISTENT` -> `DIFFERENT_QUANTITY`");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps transient outcomes with partial rawText to MISSING, diffs stability/metric summary fields, and supports --run-dir JSONL", () => {
    const liveTierA = computeFreezeHash(REPO_ROOT, collectTierATsFiles(REPO_ROOT)).hash;
    const logWithTransientAndSummary: ReplayRunLog = {
      schemaVersion: 1,
      runId: "transient-and-stability-diff",
      profileId: "web_chrome_nano",
      recordedTierAHash: liveTierA,
      cf1BaselineHash: "a".repeat(64),
      r1eCalls: [
        {
          pairId: "tr-1",
          run: 1,
          gold: "C",
          layer: "L1",
          schemaId: "VerdictV1",
          claimText: "Drug X reduced mortality.",
          evidenceTexts: ["Drug X increased mortality."],
          rawText: '{"s01_evidence_span": "partial', // partial non-empty rawText from cut stream
          inferenceSource: "ON_DEVICE",
          transientReason: "TRUNCATED",
          recordedVerdict: "N",
          recordedFailReason: "PARSE",
        },
        makeCall({
          pairId: "tr-1",
          run: 2,
          gold: "C",
          claimText: "Drug X reduced mortality.",
          evidence: "Drug X increased mortality.",
          span: "Drug X increased mortality.",
          verdict: "CONTRADICTS",
          reasoning: "Opposite direction.",
          recordedVerdict: "C",
        }),
        makeCall({
          pairId: "tr-1",
          run: 3,
          gold: "C",
          claimText: "Drug X reduced mortality.",
          evidence: "Drug X increased mortality.",
          span: "Drug X increased mortality.",
          verdict: "CONTRADICTS",
          reasoning: "Opposite direction.",
          recordedVerdict: "C",
        }),
      ],
      recordedSummary: {
        stability: 0.99,
      },
    };

    const rep = replayRun({
      log: logWithTransientAndSummary,
      repoRoot: REPO_ROOT,
      bootstrapIterations: 50,
    });
    expect(rep.ok).toBe(true);
    if (!rep.ok) throw new Error("Expected ok");
    expect(rep.r1eSummary?.missingCalls).toBe(1);
    expect(rep.verdictDiffs.some((d) => d.newVerdict === "MISSING" && d.newFailReason === "TRUNCATED")).toBe(true);
    expect(rep.metricDiffs.some((m) => m.metric === "stability")).toBe(true);
    expect(rep.reportMarkdown).toContain("CF-1 baseline hash");

    // --run-dir with manifest.json + calls.jsonl
    const dir = mkdtempSync(resolve(tmpdir(), "toulmin-rundir-"));
    try {
      writeFileSync(
        resolve(dir, "manifest.json"),
        JSON.stringify({ runId: "rundir-1", tier_a_hash: liveTierA }),
        "utf8"
      );
      writeFileSync(
        resolve(dir, "calls.jsonl"),
        logWithTransientAndSummary.r1eCalls!.map((c) => JSON.stringify(c)).join("\n") + "\n",
        "utf8"
      );
      expect(runReplayCli(["--run-dir", dir, "--root", REPO_ROOT])).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes 07 §3.5 runner field aliases (verdictValidated/anchorFailReason) and separates R1-E-L2 reporting-only metrics", () => {
    const liveTierA = computeFreezeHash(REPO_ROOT, collectTierATsFiles(REPO_ROOT)).hash;
    const l2Raw = JSON.stringify({
      s1_source_identified: "CITED_DOI_MATCHED",
      s2_quote: "Drug X showed a narrower effect in older adults.",
      s3_quote_origin: "PROVIDED_EVIDENCE",
      s4_reasoning: "Partial support in older subgroup.",
      s5_verdict: "PARTIAL",
      s6_alternatives: [],
    });

    const dir = mkdtempSync(resolve(tmpdir(), "toulmin-l2-rundir-"));
    try {
      writeFileSync(
        resolve(dir, "manifest.json"),
        JSON.stringify({ runId: "r1e-l2-test", tier_a_hash: liveTierA }),
        "utf8"
      );
      writeFileSync(
        resolve(dir, "r1e_calls.jsonl"),
        [
          JSON.stringify({
            pairId: "l2-1",
            run: 1,
            gold: "C",
            layer: "L2",
            schemaId: "L2Verdict",
            claimText: "Drug X reduced mortality in all adults.",
            evidenceTexts: ["Drug X showed a narrower effect in older adults."],
            rawText: l2Raw,
            inferenceSource: "IN_CLOUD",
            verdictValidated: "NEI",
            anchorFailReason: null,
          }),
          JSON.stringify({
            pairId: "l2-2",
            run: 1,
            gold: "C",
            layer: "L2",
            schemaId: "L2Verdict",
            claimText: "Drug X reduced mortality in all adults.",
            evidenceTexts: ["Unrelated sentence with no match."],
            rawText: l2Raw,
            inferenceSource: "IN_CLOUD",
            verdictValidated: "PARTIAL",
            anchorFailReason: null,
          }),
        ].join("\n") + "\n",
        "utf8"
      );
      const jsonOut = resolve(dir, "replay_out.json");
      expect(
        runReplayCli(["--run-dir", dir, "--root", REPO_ROOT, "--json-out", jsonOut])
      ).toBe(0);
      const parsed = JSON.parse(readFileSync(jsonOut, "utf8")) as {
        r1eSummary: null;
        r1eL2Summary: { totalCalls: number; partialCount: number; missingCount: number };
        verdictDiffs: Array<{ id: string; oldVerdict: string; newVerdict: string }>;
      };
      expect(parsed.r1eSummary).toBeNull();
      expect(parsed.r1eL2Summary.totalCalls).toBe(2);
      expect(parsed.r1eL2Summary.partialCount).toBe(1);
      expect(parsed.r1eL2Summary.missingCount).toBe(0);
      expect(parsed.verdictDiffs).toEqual([
        expect.objectContaining({ id: "l2-1", oldVerdict: "N", newVerdict: "PARTIAL" }),
        expect.objectContaining({ id: "l2-2", oldVerdict: "PARTIAL", newVerdict: "N" }),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
