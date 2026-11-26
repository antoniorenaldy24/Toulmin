import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_ROUTING_TABLE, type RoutingCalibration, type RoutingFreeze } from "@toulmin/schemas";
import holmFixture from "../fixtures/holm_fixture.json" with { type: "json" };
import statsFixture from "../fixtures/stats_fixture.json" with { type: "json" };
import {
  Pcg64Rng,
  SEED_PERMUTATION,
  assembleRoutingTable,
  cohensKappa,
  computeB4CountsInReview,
  computePrevalenceSummary,
  computeR1EMetrics,
  evaluateCf1ProfileHolm,
  exactOneSidedMcNemar,
  majorityOf3,
  pairedPermutationTest,
  prevalenceAdjustedFromRates,
  prevalencePrecisionFromLikelihoodRatio,
  runPublishRoutingCli,
  simulateMcNemarPower,
  supportGateOperatingCharacteristic,
  verifyPublishableRoutingTable,
  wilson,
  type R1EPairObservation,
} from "../src/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_CF1 = "c".repeat(64);
const FREEZE_OK: RoutingFreeze = {
  tier_a_hash: HASH_A,
  tier_b_hash: HASH_B,
  cf1_baseline_hash: HASH_CF1,
  replay_report: "H4_DECISION.md",
};

function makePassingCalibration(overrides?: Partial<RoutingCalibration>): RoutingCalibration {
  return {
    p_hat: 0.80,
    wilson_ci95: [0.584, 0.9193],
    wilson_lb: 0.584,
    stability: 0.80,
    stability_ci95: [0.73, 0.87],
    pp_pairs: 20,
    tp_pairs: 16,
    recall: 0.32,
    fcr_s: 0.04,
    fcr_n: 0.04,
    prevalence_adjusted: { "0.08": 0.41, "0.12": 0.52, "0.18": 0.63 },
    prevalence_adjusted_lb: { "0.08": 0.28, "0.12": 0.39, "0.18": 0.50 },
    support: {
      p_hat_s: 0.92,
      wilson_lb_s: 0.8116,
      ps_pairs: 50,
      ts_pairs: 46,
      fsr_c: 0.02,
      fsr_n: 0.02,
    },
    per_call: { p_hat_call_c: 0.78, p_hat_call_s: 0.90 },
    n_pairs: 150,
    runs_per_pair: 3,
    samplingMode: "browser_default",
    bm25_min_cov: 0.25,
    measured_on: "PC Ryzen 7 7700X / Chrome 138",
    measured_at: "2026-11-27T00:00:00Z",
    prompt_version: "p2.1",
    reasoning_word_cap: 40,
    ...overrides,
  };
}

describe("@toulmin/eval-harness statistical core (AC-EVAL-03, AC-EVAL-05, AC-EVAL-09)", () => {
  it("reproduces every 07 §3.8 Wilson, prevalence, and support-gate OC fixture to spec precision", () => {
    for (const f of statsFixture.wilsonFixtures) {
      const ci = wilson(f.k, f.n);
      expect(ci).not.toBeNull();
      expect(Number(ci![0].toFixed(4))).toBeCloseTo(f.lb4, 4);
      expect(Number(ci![1].toFixed(4))).toBeCloseTo(f.ub4, 4);
    }
    expect(wilson(0, 0)).toBeNull();

    // Point prevalence from LR+ = 4.6667 (07 §3.8)
    for (const piKey of ["0.08", "0.12", "0.18"] as const) {
      const pi = Number(piKey);
      const val = prevalencePrecisionFromLikelihoodRatio(statsFixture.prevalencePointFromLr.lrPlus, pi);
      expect(Number(val.toFixed(3))).toBeCloseTo(
        statsFixture.prevalencePointFromLr.expected3[piKey],
        3
      );
    }

    // Zero-FP conservative lower bound P_LB(0.12) with TP=25, FP=0 -> 0.575 (never 1.00!)
    const prevZeroFp = computePrevalenceSummary(
      statsFixture.prevalenceLbExample.tpPairs,
      statsFixture.prevalenceLbExample.fpTotal
    );
    expect(prevZeroFp.fpr).toBe(0);
    expect(Number(prevZeroFp.fprUb.toFixed(4))).toBeCloseTo(0.0370, 4);
    expect(Number(prevZeroFp.adjusted["0.12"].lb.toFixed(3))).toBeCloseTo(
      statsFixture.prevalenceLbExample.expectedLb3,
      3
    );
    expect(prevalenceAdjustedFromRates(0, 0, 0, 0.037, 0.12).point).toBeNull();

    // Support-gate 8-row operating characteristic table (04 §6.6.4, 07 §3.7)
    const oc = supportGateOperatingCharacteristic();
    expect(oc).toHaveLength(statsFixture.supportGateOperatingCharacteristic.length);
    for (let i = 0; i < oc.length; i += 1) {
      const actual = oc[i]!;
      const expected = statsFixture.supportGateOperatingCharacteristic[i]!;
      expect(actual.psPairs).toBe(expected.psPairs);
      expect(actual.minTsPairs).toBe(expected.minTsPairs);
      expect(Number(actual.wilsonLbAtMin.toFixed(4))).toBeCloseTo(expected.wilsonLb4, 4);
      expect(Number(actual.passProbByPrecision["0.85"]!.toFixed(3))).toBeCloseTo(expected.p85, 3);
      expect(Number(actual.passProbByPrecision["0.90"]!.toFixed(3))).toBeCloseTo(expected.p90, 3);
      expect(Number(actual.passProbByPrecision["0.95"]!.toFixed(3))).toBeCloseTo(expected.p95, 3);
    }
  });

  it("computes exact McNemar, deterministic PCG64 paired permutation, Cohen's kappa, power, and R1-E metrics", () => {
    expect(exactOneSidedMcNemar(0, 0)).toBe(1.0);
    expect(exactOneSidedMcNemar(10, 0)).toBeCloseTo(Math.pow(0.5, 10), 10);

    // Identical permutation inputs give deterministic reproducible p = 1.0
    const identicalPairs = Array.from({ length: 12 }, () => ({ l1: 1, baseline: 1 }));
    const perm1 = pairedPermutationTest(identicalPairs, (xs) => {
      let d = 0;
      for (const x of xs) d += x.l1 - x.baseline;
      return d / xs.length;
    });
    const perm2 = pairedPermutationTest(identicalPairs, (xs) => {
      let d = 0;
      for (const x of xs) d += x.l1 - x.baseline;
      return d / xs.length;
    });
    expect(perm1.pOneSided).toBe(1.0);
    expect(perm1).toEqual(perm2);

    // Distinct PCG64 repeatability
    const rngA = new Pcg64Rng(SEED_PERMUTATION);
    const rngB = new Pcg64Rng(SEED_PERMUTATION);
    expect([rngA.nextUint32(), rngA.nextUint32()]).toEqual([rngB.nextUint32(), rngB.nextUint32()]);

    expect(majorityOf3("S", "C", "N")).toBe("N");
    expect(majorityOf3("C", "C", "MISSING")).toBe("C");
    expect(majorityOf3("MISSING", "C", "S")).toBe("N");

    // 150-pair R1-E dataset test
    const r1ePairs: R1EPairObservation[] = [];
    for (let i = 0; i < 50; i += 1) {
      r1ePairs.push({
        pairId: `s-${i}`,
        gold: "S",
        runs: i < 46 ? ["S", "S", "S"] : i === 46 ? ["C", "C", "S"] : ["N", "N", "S"],
      });
      r1ePairs.push({
        pairId: `c-${i}`,
        gold: "C",
        runs: i < 20 ? ["C", "C", "C"] : ["N", "N", "N"],
      });
      r1ePairs.push({
        pairId: `n-${i}`,
        gold: "N",
        runs: i < 2 ? ["C", "C", "N"] : ["N", "N", "N"],
      });
    }
    const metrics = computeR1EMetrics(r1ePairs, { bootstrapIterations: 400 });
    expect(metrics.resultValid).toBe(true);
    expect(metrics.ppPairs).toBe(23);
    expect(metrics.tpPairs).toBe(20);
    expect(metrics.fpS).toBe(1);
    expect(metrics.fpN).toBe(2);
    expect(metrics.support.psPairs).toBe(46);
    expect(metrics.support.tsPairs).toBe(46);
    expect(metrics.gateResult.pathA).toBe(true);
    expect(metrics.supportGateResult.authoritative).toBe(true);
    expect(metrics.stabilityCi95[0]).toBeLessThanOrEqual(metrics.stability);
    expect(metrics.stabilityCi95[1]).toBeGreaterThanOrEqual(metrics.stability);
    expect(metrics.perCall.pHatCallCCi95[0]).toBeLessThanOrEqual(metrics.perCall.pHatCallC);
    expect(metrics.perCall.pHatCallCCi95[1]).toBeGreaterThanOrEqual(metrics.perCall.pHatCallC);
    expect(metrics.perCall.pHatCallSCi95[0]).toBeLessThanOrEqual(metrics.perCall.pHatCallS);
    expect(metrics.perCall.pHatCallSCi95[1]).toBeGreaterThanOrEqual(metrics.perCall.pHatCallS);

    // Cohen's kappa perfect & mixed
    const labels1 = Array.from({ length: 45 }, (_, i) => (i < 15 ? "S" : i < 30 ? "C" : "N"));
    const kPerfect = cohensKappa(labels1, labels1, { bootstrapIterations: 200 });
    expect(kPerfect.kappa).toBeCloseTo(1.0, 10);

    // Power simulation stays bounded [0, 1]
    const pwr = simulateMcNemarPower({
      n: 60,
      discordance: 0.30,
      targetDelta: 0.15,
      alpha: 0.025,
      replications: 300,
    });
    expect(pwr).toBeGreaterThan(0);
    expect(pwr).toBeLessThanOrEqual(1);
  });

  it("evaluates per-profile Holm-Bonferroni CF-1 multiplicity cleanly (07 §4.2, AC-EVAL-09)", () => {
    const evalWeb = evaluateCf1ProfileHolm(
      holmFixture.profileId,
      holmFixture.inputs as Parameters<typeof evaluateCf1ProfileHolm>[1]
    );
    expect(evalWeb.m).toBe(4);
    expect(evalWeb.holmOrder.map((e) => e.task)).toEqual(holmFixture.expectedSortedOrder);
    for (let i = 0; i < evalWeb.holmOrder.length; i += 1) {
      expect(evalWeb.holmOrder[i]!.p_holm).toBeCloseTo(holmFixture.expectedAdjustedP[i]!, 6);
    }
    expect(evalWeb.authority).toEqual(holmFixture.expectedAuthority);

    // Android m = 5 enforcement rejects missing O2
    expect(() =>
      evaluateCf1ProfileHolm("android_aicore_stable", [
        { task: "B1", delta: 0.2, p: 0.01, power: 0.8 },
      ])
    ).toThrow(/Missing CF-1 task/);
  });

  it("enforces all 8 AC-EVAL-05 publication guard refusals, B4 precision flag, and --confirm file safety", () => {
    const holmWeb = evaluateCf1ProfileHolm("web_chrome_nano", [
      { task: "B1", delta: 0.20, p: 0.01, power: 0.85 },
      { task: "B2", delta: 0.20, p: 0.01, power: 0.85 },
      { task: "B3", delta: 0.20, p: 0.01, power: 0.85 },
      {
        task: "B5",
        delta: 0.20,
        p: 0.01,
        power: 0.85,
        inconsistent_precision_l1: 0.85,
        inconsistent_precision_baseline: 0.80,
      },
    ]);

    const goodAssembled = assembleRoutingTable({
      version: "r1",
      freeze: FREEZE_OK,
      kappa_ok: true,
      expectedFreeze: {
        tier_a_hash: HASH_A,
        tier_b_hash: HASH_B,
        cf1_baseline_hash: HASH_CF1,
      },
      manifestVariants: {
        web_chrome_nano: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
      precisionB4: 0.65,
      profileInputs: {
        web_chrome_nano: {
          profileId: "web_chrome_nano",
          calibration: makePassingCalibration(),
          calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
          cf1: holmWeb.cf1,
          probe_expected: ["S", "S", "S", "S", "C", "C", "C", "N", "N", "N"],
        },
      },
    });
    expect(goodAssembled.ok).toBe(true);
    expect(goodAssembled.b4CountsInReview).toBe(true);
    expect(computeB4CountsInReview(0.5999)).toBe(false);
    expect(computeB4CountsInReview(0.60)).toBe(true);

    const baseTable = structuredClone(goodAssembled.table!);
    const baseHashes = {
      tier_a_hash: HASH_A,
      tier_b_hash: HASH_B,
      cf1_baseline_hash: HASH_CF1,
    };

    // (a) path = "A", p_hat = 0.65
    const caseA = structuredClone(baseTable);
    caseA.profiles["web_chrome_nano"]!.calibration!.p_hat = 0.65;
    expect(
      verifyPublishableRoutingTable({ table: caseA, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // (b) authority.B3 = "authoritative" with cf1.B3 = { delta: 0.12, p: 0.04, p_holm: 0.12 }
    const caseB = structuredClone(baseTable);
    caseB.profiles["web_chrome_nano"]!.authority.B3 = "authoritative";
    caseB.profiles["web_chrome_nano"]!.cf1!.B3 = { delta: 0.12, p: 0.04, p_holm: 0.12, power: 0.7 };
    expect(
      verifyPublishableRoutingTable({ table: caseB, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // (c) supportVerdicts = "authoritative" with wilson_lb_s = 0.79
    const caseC = structuredClone(baseTable);
    caseC.profiles["web_chrome_nano"]!.calibration!.support.wilson_lb_s = 0.79;
    expect(
      verifyPublishableRoutingTable({ table: caseC, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // (d) calibratedVariant.reasoningCap = 30 while manifest records 40
    const caseD = structuredClone(baseTable);
    caseD.profiles["web_chrome_nano"]!.calibratedVariant = {
      schemaId: "VerdictV1_cap30",
      reasoningCap: 30,
    };
    expect(
      verifyPublishableRoutingTable({
        table: caseD,
        expectedFreeze: baseHashes,
        manifestVariants: { web_chrome_nano: { schemaId: "VerdictV1", reasoningCap: 40 } },
      }).ok
    ).toBe(false);

    // (e) authority.B5 = "authoritative" with L1 INCONSISTENT precision below baseline
    const caseE = structuredClone(baseTable);
    caseE.profiles["web_chrome_nano"]!.cf1!.B5 = {
      delta: 0.20,
      p: 0.01,
      p_holm: 0.04,
      power: 0.7,
      inconsistent_precision_l1: 0.60,
      inconsistent_precision_baseline: 0.70,
    };
    expect(
      verifyPublishableRoutingTable({ table: caseE, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // (f) supportVerdicts = "authoritative" with ps_pairs = 15, ts_pairs = 15
    const caseF = structuredClone(baseTable);
    caseF.profiles["web_chrome_nano"]!.calibration!.support.ps_pairs = 15;
    caseF.profiles["web_chrome_nano"]!.calibration!.support.ts_pairs = 15;
    caseF.profiles["web_chrome_nano"]!.calibration!.support.wilson_lb_s = 0.85; // even if spoofed!
    expect(
      verifyPublishableRoutingTable({ table: caseF, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // (g) freeze.tier_a_hash differing from H4_DECISION.md
    expect(
      verifyPublishableRoutingTable({
        table: baseTable,
        expectedFreeze: { ...baseHashes, tier_a_hash: "f".repeat(64) },
      }).ok
    ).toBe(false);

    // (h) path = "A" with kappa_ok = false
    const caseH = structuredClone(baseTable);
    caseH.kappa_ok = false;
    expect(
      verifyPublishableRoutingTable({ table: caseH, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // Extra security/integrity guards caught in audit probes:
    // (i) tampered table.gate cannot lower normative thresholds
    const caseTamperedGate = structuredClone(baseTable);
    caseTamperedGate.gate = {
      precision_min: 0.4,
      wilson_lb_min: 0.2,
      stability_min: 0.3,
      pp_pairs_min: 5,
      support_wilson_lb_min: 0.4,
      ps_pairs_min: 5,
    };
    expect(
      verifyPublishableRoutingTable({ table: caseTamperedGate, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // (j) partial cf1 missing Holm m=4 tasks (B1/B2/B5) or Path B with HINT_THEN_CLOUD refused
    const casePartialCf1 = structuredClone(baseTable);
    casePartialCf1.profiles["web_chrome_nano"]!.path = "B";
    casePartialCf1.profiles["web_chrome_nano"]!.contradicts.surface = "HINT_THEN_CLOUD";
    casePartialCf1.profiles["web_chrome_nano"]!.cf1 = {
      B3: { delta: 0.2, p: 0.03, p_holm: 0.03, power: 0.8 },
    };
    expect(
      verifyPublishableRoutingTable({ table: casePartialCf1, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // (k) uncalibrated schema VerdictFlatV1 refused even without manifestVariants
    const caseFlatVariant = structuredClone(baseTable);
    caseFlatVariant.profiles["web_chrome_nano"]!.calibratedVariant = {
      schemaId: "VerdictFlatV1",
      reasoningCap: 40,
    };
    expect(
      verifyPublishableRoutingTable({ table: caseFlatVariant, expectedFreeze: baseHashes }).ok
    ).toBe(false);

    // CLI guard: dry-run or refused table exits non-zero and leaves --out file untouched; --confirm writes cleanly.
    const tmpDir = mkdtempSync(resolve(tmpdir(), "toulmin-publish-cli-"));
    try {
      const tableFile = resolve(tmpDir, "routing.json");
      const hashesFile = resolve(tmpDir, "hashes.json");
      const badTableFile = resolve(tmpDir, "bad_routing.json");
      const outFile = resolve(tmpDir, "remoteconfig.routing.json");

      writeFileSync(tableFile, JSON.stringify(baseTable), "utf8");
      writeFileSync(badTableFile, JSON.stringify(caseA), "utf8");
      writeFileSync(
        hashesFile,
        JSON.stringify({
          ...baseHashes,
          precisionB4: 0.55,
          manifestVariants: { web_chrome_nano: { schemaId: "VerdictV1", reasoningCap: 40 } },
        }),
        "utf8"
      );
      writeFileSync(outFile, JSON.stringify({ routing_table: BUNDLED_ROUTING_TABLE }), "utf8");
      const beforeContent = readFileSync(outFile, "utf8");

      // Without --confirm -> refuses & leaves outFile untouched
      expect(
        runPublishRoutingCli(["--input", tableFile, "--h4-hashes", hashesFile, "--out", outFile], {
          stdout: () => {},
          stderr: () => {},
        })
      ).toBe(1);
      expect(readFileSync(outFile, "utf8")).toBe(beforeContent);

      // Failing gate with --confirm -> refuses & leaves outFile untouched
      expect(
        runPublishRoutingCli(
          ["--input", badTableFile, "--h4-hashes", hashesFile, "--out", outFile, "--confirm"],
          { stdout: () => {}, stderr: () => {} }
        )
      ).toBe(1);
      expect(readFileSync(outFile, "utf8")).toBe(beforeContent);

      // Valid + --confirm -> writes updated routing_table and b4_counts_in_review: false
      expect(
        runPublishRoutingCli(
          ["--input", tableFile, "--h4-hashes", hashesFile, "--out", outFile, "--confirm"],
          { stdout: () => {}, stderr: () => {} }
        )
      ).toBe(0);
      expect(existsSync(outFile)).toBe(true);
      const written = JSON.parse(readFileSync(outFile, "utf8")) as {
        routing_table: typeof baseTable;
        b4_counts_in_review: boolean;
      };
      expect(written.routing_table.version).toBe("r1");
      expect(written.b4_counts_in_review).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
