import { describe, expect, it } from "vitest";
import { BUNDLED_ROUTING_TABLE, type RoutingTable, type Task } from "@toulmin/schemas";
import gateVectors from "../../../conformance/l0/gate.json" with { type: "json" };
import holmVectors from "../../../conformance/l0/holm.json" with { type: "json" };
import supportGateVectors from "../../../conformance/l0/support_gate.json" with { type: "json" };
import {
  checkAuthority,
  computeHolmAdjusted,
  evaluateGate,
  evaluateSupportGate,
  resolvePolicyFromRoutingTable,
  wilson,
  type HolmInputEntry,
} from "../src/gate.js";
import { CONSERVATIVE_PROFILE } from "../src/ledger.js";

function makeValidTable(tierAHash: string): RoutingTable {
  return {
    version: "r1",
    gate: { ...BUNDLED_ROUTING_TABLE.gate },
    freeze: {
      tier_a_hash: tierAHash,
      tier_b_hash: "b".repeat(64),
      cf1_baseline_hash: "c".repeat(64),
      replay_report: "H4_DECISION.md",
    },
    kappa_ok: true,
    profiles: {
      web_chrome_nano: {
        path: "A",
        contradicts: { surface: "HINT_THEN_CLOUD" },
        supported: { surface: "INFO_ONLY" },
        nei: { surface: "QUIET_ESCALATE" },
        authority: {
          B1: "authoritative",
          B2: "advisory",
          B3: "authoritative",
          B5: "advisory",
          O2: "advisory",
        },
        supportVerdicts: "authoritative",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
        calibration: {
          p_hat: 0.8,
          wilson_ci95: [0.584, 0.9193],
          wilson_lb: 0.584,
          stability: 0.8,
          stability_ci95: [0.72, 0.88],
          pp_pairs: 20,
          tp_pairs: 16,
          recall: 0.32,
          fcr_s: 0.04,
          fcr_n: 0.04,
          prevalence_adjusted: { "0.08": 0.4, "0.12": 0.5, "0.18": 0.6 },
          prevalence_adjusted_lb: { "0.08": 0.25, "0.12": 0.35, "0.18": 0.45 },
          support: {
            p_hat_s: 0.92,
            wilson_lb_s: 0.8116,
            ps_pairs: 50,
            ts_pairs: 46,
            fsr_c: 0.02,
            fsr_n: 0.02,
          },
          per_call: { p_hat_call_c: 0.78, p_hat_call_s: 0.9 },
          n_pairs: 150,
          runs_per_pair: 3,
          samplingMode: "browser_default",
          bm25_min_cov: 0.25,
          measured_on: "PC Ryzen 7 7700X",
          measured_at: "2026-11-27T00:00:00Z",
          prompt_version: "p2.1",
          reasoning_word_cap: 40,
        },
        cf1: {
          B1: { delta: 0.18, p: 0.01, p_holm: 0.04, power: 0.8 },
          B2: { delta: 0.05, p: 0.2, p_holm: 0.2, power: 0.3 },
          B3: { delta: 0.16, p: 0.02, p_holm: 0.06, power: 0.75 },
          B5: {
            delta: 0.04,
            p: 0.3,
            p_holm: 0.3,
            power: 0.2,
            inconsistent_precision_l1: 0.6,
            inconsistent_precision_baseline: 0.7,
          },
        },
        probe_expected: ["S", "S", "S", "S", "C", "C", "C", "N", "N", "N"],
      },
    },
  };
}

describe("Tier B Conformance: gate.json, support_gate.json, holm.json & L3 client validation", () => {
  it("passes all Wilson interval and Path A gate golden cases in conformance/l0/gate.json", () => {
    for (const c of gateVectors.wilsonCases) {
      const ci = wilson(c.k, c.n);
      if ("expectedNull" in c && c.expectedNull) {
        expect(ci, c.id).toBeNull();
      } else {
        expect(ci, c.id).not.toBeNull();
        expect(Number(ci![0].toFixed(4)), `${c.id} lb`).toBeCloseTo(c.expectedLb4!, 4);
        expect(Number(ci![1].toFixed(4)), `${c.id} ub`).toBeCloseTo(c.expectedUb4!, 4);
      }
    }

    for (const g of gateVectors.pathAGateCases) {
      const res = evaluateGate(g.input);
      expect(res, g.id).toEqual(g.expected);
    }
  });

  it("passes all Support Gate golden cases in conformance/l0/support_gate.json (floor 16)", () => {
    for (const c of supportGateVectors.supportGateCases) {
      const res = evaluateSupportGate(c.input);
      expect(res, c.id).toEqual(c.expected);
    }
  });

  it("passes all Holm-Bonferroni and task authority golden cases in conformance/l0/holm.json", () => {
    for (const h of holmVectors.holmCases) {
      const out = computeHolmAdjusted(h.entries as readonly HolmInputEntry[]);
      expect(out.map((e) => e.task), h.id).toEqual(h.expected.map((e) => e.task));
      for (let i = 0; i < out.length; i += 1) {
        expect(out[i]!.rank, `${h.id}[${i}].rank`).toBe(h.expected[i]!.rank);
        expect(out[i]!.p_holm, `${h.id}[${i}].p_holm`).toBeCloseTo(
          h.expected[i]!.p_holm,
          6
        );
      }
    }

    for (const a of holmVectors.authorityCases) {
      const auth = checkAuthority(a.cf1, a.task as Task);
      expect(auth, a.id).toBe(a.expected);
    }
  });

  it("enforces AC-L3-01, AC-L3-02, AC-L3-09, and AC-L3-10 client policy projection rules", () => {
    const tierAHash = "a".repeat(64);

    // AC-L3-01: bundled defaults offline -> Path B, everything advisory
    const bundledRes = resolvePolicyFromRoutingTable(BUNDLED_ROUTING_TABLE, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
    });
    expect(bundledRes.accepted).toBe(true);
    expect(bundledRes.policy.profiles["web_chrome_nano"]!.path).toBe("B");
    expect(bundledRes.policy.profiles["web_chrome_nano"]!.supportVerdicts).toBe("advisory");

    // Valid published table with matching freeze hash passes intact
    const okTable = makeValidTable(tierAHash);
    const okRes = resolvePolicyFromRoutingTable(okTable, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
      expectedReasoningWordCap: 40,
    });
    expect(okRes.accepted).toBe(true);
    expect(okRes.issues).toEqual([]);
    expect(okRes.policy.profiles["web_chrome_nano"]!.path).toBe("A");
    expect(okRes.policy.profiles["web_chrome_nano"]!.authority.B3).toBe("authoritative");
    expect(okRes.policy.profiles["web_chrome_nano"]!.supportVerdicts).toBe("authoritative");

    // AC-L3-02(a): stability = 0.55 on Path A -> Path B + ROUTING_GATE_MISMATCH
    const badStab = makeValidTable(tierAHash);
    badStab.profiles["web_chrome_nano"]!.calibration!.stability = 0.55;
    const badStabRes = resolvePolicyFromRoutingTable(badStab, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
    });
    expect(badStabRes.policy.profiles["web_chrome_nano"]!.path).toBe("B");
    expect(badStabRes.issues.some((i) => i.code === "ROUTING_GATE_MISMATCH")).toBe(true);

    // AC-L3-02(b): freeze.tier_a_hash mismatch -> table refused, bundled defaults kept, FREEZE_MISMATCH
    const badFreeze = makeValidTable("f".repeat(64));
    const badFreezeRes = resolvePolicyFromRoutingTable(badFreeze, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
    });
    expect(badFreezeRes.accepted).toBe(false);
    expect(badFreezeRes.effectiveTable.version).toBe("bundled");
    expect(badFreezeRes.issues.some((i) => i.code === "FREEZE_MISMATCH")).toBe(true);
    expect(badFreezeRes.policy.profiles["web_chrome_nano"]!.path).toBe("B");
    expect(badFreezeRes.policy.profiles["unknown_profile"]).toBeUndefined();
    expect(CONSERVATIVE_PROFILE.path).toBe("B");

    // AC-L3-09(a): B3 claimed authoritative with cf1.B3.p_holm = 0.20 -> advisory + AUTHORITY_MISMATCH
    const badAuth = makeValidTable(tierAHash);
    badAuth.profiles["web_chrome_nano"]!.cf1!.B3 = {
      delta: 0.12,
      p: 0.04,
      p_holm: 0.20,
      power: 0.7,
    };
    const badAuthRes = resolvePolicyFromRoutingTable(badAuth, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
    });
    expect(badAuthRes.policy.profiles["web_chrome_nano"]!.authority.B3).toBe("advisory");
    expect(badAuthRes.issues.some((i) => i.code === "AUTHORITY_MISMATCH" && i.task === "B3")).toBe(
      true
    );

    // AC-L3-10(b): reasoning_word_cap = 30 vs calibratedVariant.reasoningCap = 40 -> uncalibrated (Path B, all advisory)
    const capMismatchRes = resolvePolicyFromRoutingTable(okTable, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
      expectedReasoningWordCap: 30,
    });
    expect(capMismatchRes.policy.profiles["web_chrome_nano"]!.path).toBe("B");
    expect(capMismatchRes.policy.profiles["web_chrome_nano"]!.authority.B3).toBe("advisory");
    expect(capMismatchRes.policy.profiles["web_chrome_nano"]!.supportVerdicts).toBe("advisory");
    expect(capMismatchRes.issues.some((i) => i.code === "UNCALIBRATED_VARIANT")).toBe(true);

    // Partial published table fills missing bundled defaults (04 §6.5.2, e.g. no_local_model)
    expect(okRes.effectiveTable.profiles["no_local_model"]?.contradicts.surface).toBe(
      "CLOUD_ONLY_WITH_CONSENT"
    );
    expect(okRes.policy.profiles["no_local_model"]?.path).toBe("B");

    // Probe 1 regression: tampered table.gate cannot lower normative Path A / support thresholds
    const tamperedGate = makeValidTable(tierAHash);
    tamperedGate.gate = {
      precision_min: 0.4,
      wilson_lb_min: 0.2,
      stability_min: 0.3,
      pp_pairs_min: 5,
      support_wilson_lb_min: 0.4,
      ps_pairs_min: 5,
    };
    tamperedGate.profiles["web_chrome_nano"]!.calibration!.p_hat = 0.5;
    tamperedGate.profiles["web_chrome_nano"]!.calibration!.pp_pairs = 10;
    tamperedGate.profiles["web_chrome_nano"]!.calibration!.tp_pairs = 5;
    tamperedGate.profiles["web_chrome_nano"]!.calibration!.stability = 0.5;
    tamperedGate.profiles["web_chrome_nano"]!.calibration!.support = {
      p_hat_s: 0.9,
      wilson_lb_s: 0.5958,
      ps_pairs: 10,
      ts_pairs: 9,
      fsr_c: 0.02,
      fsr_n: 0.02,
    };
    const tamperedGateRes = resolvePolicyFromRoutingTable(tamperedGate, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
    });
    expect(tamperedGateRes.policy.profiles["web_chrome_nano"]!.path).toBe("B");
    expect(tamperedGateRes.policy.profiles["web_chrome_nano"]!.supportVerdicts).toBe("advisory");
    expect(tamperedGateRes.issues.some((i) => i.code === "ROUTING_GATE_MISMATCH")).toBe(true);

    // Probe 2 regression: version: "bundled" with Path A / non-conservative entries without freeze is refused
    const spoofedBundled = makeValidTable(tierAHash);
    spoofedBundled.version = "bundled";
    spoofedBundled.freeze = null;
    const spoofedBundledRes = resolvePolicyFromRoutingTable(spoofedBundled, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
    });
    expect(spoofedBundledRes.accepted).toBe(false);
    expect(spoofedBundledRes.issues.some((i) => i.code === "FREEZE_MISMATCH")).toBe(true);
    expect(spoofedBundledRes.policy.profiles["web_chrome_nano"]!.path).toBe("B");

    // Probe 4 regression: VerdictFlatV1 is always uncalibrated even when expectedSchemaId is omitted
    const flatVariantTable = makeValidTable(tierAHash);
    flatVariantTable.profiles["web_chrome_nano"]!.calibratedVariant = {
      schemaId: "VerdictFlatV1",
      reasoningCap: 40,
    };
    const flatVariantRes = resolvePolicyFromRoutingTable(flatVariantTable, {
      deviceProfile: "web_chrome_nano",
      embeddedTierAHash: tierAHash,
    });
    expect(flatVariantRes.policy.profiles["web_chrome_nano"]!.path).toBe("B");
    expect(flatVariantRes.policy.profiles["web_chrome_nano"]!.supportVerdicts).toBe("advisory");
    expect(flatVariantRes.issues.some((i) => i.code === "UNCALIBRATED_VARIANT")).toBe(true);
  });
});
