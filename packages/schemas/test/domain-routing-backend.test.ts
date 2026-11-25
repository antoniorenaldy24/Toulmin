import { describe, expect, it } from "vitest";
import {
  BUNDLED_ROUTING_TABLE,
  isValidArxivId,
  isValidDoi,
  isValidPmcid,
  isValidRefId,
  validateBibResolveRequest,
  validateBudgetMessage,
  validateClaimLedgerEntry,
  validateCoverageMeter,
  validateLedgerEvent,
  validateOaFetchRequest,
  validateQuantTuple,
  validateQuotaGuardRequest,
  validateRedeemJudgeCodeRequest,
  validateRefFacts,
  validateRoutingTable,
  type ClaimLedgerEntry,
  type CoverageMeter,
  type QuantTuple,
  type RefFacts,
  type RoutingTable,
} from "../src/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function makeSampleTuple(): QuantTuple {
  return {
    tupleId: "0123456789abcdef0123456789abcdef",
    valueRaw: "30%",
    unitRaw: "%",
    metricClass: "percentage",
    pComparator: null,
    valueNorm: 30,
    valueLo: 30,
    valueHi: 30,
    sigDigits: 2,
    unitCanon: "%",
    keyLemmas: ["mortal", "reduc"],
    section: "results",
    source: "manuscript",
    span: { start: 10, end: 13 },
  };
}

function makeSampleEntry(): ClaimLedgerEntry {
  return {
    claimId: "claim-1",
    docId: "550e8400-e29b-41d4-a716-446655440000",
    sentenceHash: HASH_A,
    occurrenceIndex: 0,
    clauseIndex: 0,
    section: "results",
    subsection: null,
    span: { start: 0, end: 42 },
    claimText: "Drug X reduced mortality by 30%.",
    normalizedClaimHash: HASH_B,
    baseline: {
      atoms: [{ start: 0, end: 5, claimType: "QUANTITATIVE" }],
      worth: "HIGH",
      claimType: "QUANTITATIVE",
      uncited: false,
    },
    stage1: null,
    citationKeys: ["smith2020"],
    possibleCitations: [],
    refs: [
      {
        refId: "doi:10.1000/smith2020",
        selection: {
          evidenceVersion: HASH_A,
          candidates: 3,
          suspicious: false,
          seq: 1,
        },
        local: null,
        cloud: null,
        physical: null,
      },
    ],
    heldNei: { value: null, seq: 0 },
    job: { value: false, seq: 0 },
    l0Error: null,
    b5: { inconsistentWith: [] },
    labNoteMismatch: [],
    suggestedRefIds: [],
    override: { value: null, seq: 0 },
    archived: false,
    updatedAt: 1700000000000,
  };
}

describe("Domain, Routing, and Backend Canonical Schemas", () => {
  it("validates QuantTuple, RefFacts, ClaimLedgerEntry, CoverageMeter, and LedgerEvent E1–E16 + E6b", () => {
    const tuple = makeSampleTuple();
    expect(validateQuantTuple(tuple).ok).toBe(true);
    expect(validateQuantTuple({ ...tuple, metricClass: "bad_class" }).ok).toBe(false);
    expect(validateQuantTuple({ ...tuple, valueLo: 50, valueHi: 10 }).ok).toBe(false);
    expect(validateQuantTuple({ ...tuple, extraField: 1 }).ok).toBe(false);

    const refFacts: RefFacts = {
      refId: "doi:10.1000/smith2020",
      bibStatus: "RESOLVED",
      retracted: false,
      checkMetadata: false,
      evidenceVersion: HASH_A,
      hasEvidence: true,
      updatedSeq: 1,
    };
    expect(validateRefFacts(refFacts).ok).toBe(true);
    expect(validateRefFacts({ ...refFacts, bibStatus: "UNKNOWN" }).ok).toBe(false);

    const entry = makeSampleEntry();
    expect(validateClaimLedgerEntry(entry).ok).toBe(true);
    expect(validateClaimLedgerEntry({ ...entry, unknownProp: true }).ok).toBe(false);

    const meter: CoverageMeter = {
      total: 10,
      supported: 2,
      reviewed: 1,
      local: 1,
      problems: 1,
      to_review: 2,
      waiting: 1,
      unverifiable: 1,
      unchecked: 1,
      notYetChecked: 2,
      notCheckable: 3,
      numberMismatches: 1,
      quotaExhausted: false,
      quotaResetAt: null,
      byProvenance: {
        DETERMINISTIC: 1,
        ON_DEVICE: 3,
        CLOUD: 4,
        PHYSICAL_SOURCE: 0,
        AUTHOR: 1,
      },
    };
    expect(validateCoverageMeter(meter).ok).toBe(true);
    expect(validateCoverageMeter({ ...meter, total: 9 }).ok).toBe(false);
    expect(validateCoverageMeter({ ...meter, notYetChecked: 99 }).ok).toBe(false);
    expect(
      validateCoverageMeter({
        ...meter,
        byProvenance: { ...meter.byProvenance, CLOUD: 5 },
      }).ok
    ).toBe(false);

    const sampleEvents = [
      { type: "ClauseCreated", entry },
      {
        type: "BibResolved",
        refId: "doi:10.1000/smith2020",
        bibStatus: "RESOLVED",
        retracted: false,
        checkMetadata: false,
        seq: 2,
      },
      { type: "RetractionSnapshot", refIds: ["doi:10.1000/smith2020"] },
      {
        type: "EvidenceChanged",
        refId: "doi:10.1000/smith2020",
        evidenceVersion: HASH_B,
        hasEvidence: true,
        seq: 3,
      },
      {
        type: "SelectionComputed",
        claimId: entry.claimId,
        refId: "doi:10.1000/smith2020",
        selection: { evidenceVersion: HASH_B, candidates: 2, suspicious: false, seq: 4 },
      },
      { type: "JobState", claimId: entry.claimId, inFlight: true, seq: 5 },
      { type: "HeldNei", claimId: entry.claimId, value: { since: 1700000000000 }, seq: 6 },
      {
        type: "Override",
        claimId: entry.claimId,
        value: {
          dismissedState: "WAITING",
          basis: "REVIEW",
          captureId: null,
          normalizedClaimHash: entry.normalizedClaimHash,
          refIdsKey: "doi:10.1000/smith2020",
          note: "Checked manually",
          createdAt: 1700000000000,
        },
        seq: 7,
      },
      { type: "B5Changed", claimIds: [entry.claimId] },
      { type: "L0Timeout", claimId: entry.claimId },
      {
        type: "PolicyChanged",
        snapshot: {
          deviceProfile: "web_chrome_nano",
          b4CountsAsReview: true,
          profiles: {
            web_chrome_nano: {
              path: "A",
              authority: { B1: "authoritative", B2: "advisory", B3: "authoritative", B5: "advisory", O2: "advisory" },
              supportVerdicts: "advisory",
              calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
            },
          },
        },
      },
      {
        type: "LabNoteMismatch",
        claimId: entry.claimId,
        captureId: "cap-1",
        value: { pageLabel: "Notebook p.4", confirmedByAuthorAt: 1700000000000 },
        seq: 8,
      },
    ];
    for (const ev of sampleEvents) {
      expect(validateLedgerEvent(ev).ok).toBe(true);
    }
    expect(validateLedgerEvent({ type: "E99", claimId: "x" }).ok).toBe(false);
    expect(validateLedgerEvent({ type: "L0Timeout", claimId: "x", extra: 1 }).ok).toBe(false);
  });

  it("validates bundled and published routing_table with bare 64-hex freeze hashes", () => {
    expect(validateRoutingTable(BUNDLED_ROUTING_TABLE).ok).toBe(true);

    const published: RoutingTable = {
      version: "r1",
      gate: BUNDLED_ROUTING_TABLE.gate,
      freeze: {
        tier_a_hash: HASH_A,
        tier_b_hash: HASH_B,
        cf1_baseline_hash: "0".repeat(64),
        replay_report: "H4_DECISION.md",
      },
      kappa_ok: true,
      profiles: {
        web_chrome_nano: {
          path: "A",
          contradicts: { surface: "HINT_THEN_CLOUD" },
          supported: { surface: "INFO_ONLY" },
          nei: { surface: "QUIET_ESCALATE" },
          authority: { B1: "authoritative", B2: "advisory", B3: "authoritative", B5: "advisory", O2: "advisory" },
          supportVerdicts: "advisory",
          calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
          calibration: {
            p_hat: 0.85,
            wilson_ci95: [0.68, 0.94],
            wilson_lb: 0.68,
            stability: 0.88,
            stability_ci95: [0.82, 0.93],
            pp_pairs: 30,
            tp_pairs: 25,
            recall: 0.5,
            fcr_s: 0.04,
            fcr_n: 0.06,
            prevalence_adjusted: { "0.08": 0.45, "0.12": 0.57, "0.18": 0.68 },
            prevalence_adjusted_lb: { "0.08": 0.3, "0.12": 0.4, "0.18": 0.51 },
            support: {
              p_hat_s: 0.9,
              wilson_lb_s: 0.77,
              ps_pairs: 40,
              ts_pairs: 36,
              fsr_c: 0.04,
              fsr_n: 0.04,
            },
            per_call: { p_hat_call_c: 0.82, p_hat_call_s: 0.88 },
            n_pairs: 150,
            runs_per_pair: 3,
            samplingMode: "browser_default",
            bm25_min_cov: 0.25,
            measured_on: "PC Ryzen 7 7700X / Chrome 151",
            measured_at: "2026-11-25T00:00:00Z",
            prompt_version: "p2.1",
            reasoning_word_cap: 40,
          },
          cf1: {
            B1: { delta: 0.14, p: 0.01, p_holm: 0.04, power: 0.85 },
            B5: {
              delta: 0.02,
              p: 0.4,
              p_holm: 0.8,
              power: 0.2,
              inconsistent_precision_l1: 0.7,
              inconsistent_precision_baseline: 0.8,
            },
          },
          probe_expected: ["S", "S", "S", "S", "C", "C", "C", "N", "N", "N"],
        },
      },
    };
    expect(validateRoutingTable(published).ok).toBe(true);

    // Reject "sha256:" prefix in freeze hashes (RFC fix)
    expect(
      validateRoutingTable({
        ...published,
        freeze: { ...published.freeze!, tier_a_hash: `sha256:${HASH_A}` },
      }).ok
    ).toBe(false);

    // Reject invalid probe_expected length
    expect(
      validateRoutingTable({
        ...published,
        profiles: {
          web_chrome_nano: {
            ...published.profiles["web_chrome_nano"]!,
            probe_expected: ["S", "C"],
          },
        },
      }).ok
    ).toBe(false);
  });

  it("validates backend identifiers and callable payloads (05 §3, AC-FN-05)", () => {
    // SICI DOIs, Unicode whitespace/control rejections, and standard refIds
    expect(isValidDoi("10.1002/(sici)1097-0258(19980815)17:15<1661::aid-sim968>3.0.co;2-k")).toBe(true);
    expect(isValidDoi("10.123/abc")).toBe(false);
    expect(isValidDoi("10.1000/abc\u3000def")).toBe(false);
    expect(isValidDoi("10.1000/abc\u0085def")).toBe(false);
    expect(isValidDoi("10.1000/abc\ud800def")).toBe(false);
    expect(isValidPmcid("PMC1234567")).toBe(true);
    expect(isValidPmcid("PMC")).toBe(false);
    expect(isValidArxivId("2401.12345v2")).toBe(true);
    expect(isValidArxivId("hep-th/9901001")).toBe(true);
    expect(isValidArxivId("solv-int/9901001")).toBe(true);
    expect(isValidArxivId("solv-int/9901001v2")).toBe(true);
    expect(isValidArxivId("math.cv/0309136")).toBe(true);
    expect(isValidArxivId("math.cv/0309136v")).toBe(false);
    expect(isValidArxivId("invalid")).toBe(false);
    expect(isValidRefId("doi:10.1000/xyz")).toBe(true);
    expect(isValidRefId("oa:W1234567890")).toBe(true);
    expect(isValidRefId("http://evil")).toBe(false);

    // AC-FN-05: oaFetch accepts ONLY { refId }, rejects url / license
    expect(validateOaFetchRequest({ refId: "doi:10.1000/xyz" }).ok).toBe(true);
    expect(
      validateOaFetchRequest({
        refId: "doi:10.1000/xyz",
        url: "http://evil",
        license: "cc-by",
      }).ok
    ).toBe(false);

    // bibResolve: 1..100 items, <= 50 raw
    expect(
      validateBibResolveRequest({
        items: [{ key: "k1", doi: "10.1000/xyz" }],
        doiOnly: true,
      }).ok
    ).toBe(true);
    expect(validateBibResolveRequest({ items: [] }).ok).toBe(false);
    const fiftyOneRaw = Array.from({ length: 51 }, (_, i) => ({
      key: `k${i}`,
      raw: `Author ${i}, 2020`,
    }));
    expect(validateBibResolveRequest({ items: fiftyOneRaw }).ok).toBe(false);

    // quotaGuard: 1..25 bare 64-hex hashes
    expect(
      validateQuotaGuardRequest({ claimHashes: [HASH_A], kind: "L2" }).ok
    ).toBe(true);
    expect(
      validateQuotaGuardRequest({ claimHashes: [`sha256:${HASH_A}`], kind: "L2" }).ok
    ).toBe(false);

    expect(validateRedeemJudgeCodeRequest({ code: "TLMN-ABCD-EFGH" }).ok).toBe(true);
    expect(validateRedeemJudgeCodeRequest({ code: "" }).ok).toBe(false);

    expect(
      validateBudgetMessage({
        budgetDisplayName: "ai-logic",
        costAmount: 15.5,
        budgetAmount: 60,
        alertThresholdExceeded: 0.25,
        costIntervalStart: "2026-11-01T07:00:00Z",
        currencyCode: "USD",
        schemaVersion: "1.0",
      }).ok
    ).toBe(true);
    expect(
      validateBudgetMessage({
        budgetDisplayName: "ai-logic",
        costAmount: 15.5,
        budgetAmount: 0,
      }).ok
    ).toBe(false);
  });
});
