import { describe, expect, it } from "vitest";
import { validateLedgerEvent } from "@toulmin/schemas";
import {
  EMPTY_EVIDENCE_VERSION,
  applyEvent,
  category,
  cloudResultKey,
  computeCoverageMeter,
  createInitialLedgerState,
  derive,
  formatCoverageHeader,
  jcsHash,
  jcsSerialize,
  localResultKey,
  physicalResultKey,
  reduceLedger,
  stage1ResultKey,
  validateCoverageMeter,
  type AuthorOverride,
  type ClaimLedgerEntry,
  type CloudResult,
  type LedgerEvent,
  type LocalResult,
  type PhysicalResult,
  type PolicySnapshot,
  type PrivacyContext,
  type SessionFacts,
  type Stage1Result,
} from "../src/ledger.js";
import { sha256hex } from "../src/norm.js";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Map || value instanceof Set) {
    return Object.freeze(value);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return Object.freeze(value);
}

const POLICY_A: PolicySnapshot = deepFreeze({
  deviceProfile: "web_chrome_nano",
  b4CountsAsReview: true,
  profiles: {
    web_chrome_nano: {
      path: "A",
      authority: {
        B1: "authoritative",
        B2: "authoritative",
        B3: "authoritative",
        B5: "advisory",
        O2: "advisory",
      },
      supportVerdicts: "authoritative",
      calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
    },
  },
});

const POLICY_B: PolicySnapshot = deepFreeze({
  deviceProfile: "web_chrome_nano",
  b4CountsAsReview: true,
  profiles: {
    web_chrome_nano: {
      path: "B",
      authority: {
        B1: "advisory",
        B2: "advisory",
        B3: "advisory",
        B5: "advisory",
        O2: "advisory",
      },
      supportVerdicts: "advisory",
      calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
    },
  },
});

const MODE_STANDARD: PrivacyContext = deepFreeze({
  mode: "STANDARD",
  cloudAvailable: true,
  quotaExhausted: false,
  quotaResetAt: null,
});

const MODE_CONFIDENTIAL: PrivacyContext = deepFreeze({
  mode: "CONFIDENTIAL",
  cloudAvailable: false,
  quotaExhausted: false,
  quotaResetAt: null,
});

const SESSION_DEFAULT: SessionFacts = {
  localUnavailable: false,
  transient: new Map(),
};

function makeSkeletonEntry(overrides?: Partial<ClaimLedgerEntry>): ClaimLedgerEntry {
  const claimText = overrides?.claimText ?? "Drug X lowered mortality by 30%.";
  const normClaimHash = overrides?.normalizedClaimHash ?? sha256hex("drug x lowered mortality by ⟨v:30%⟩");
  const sentenceHash = overrides?.sentenceHash ?? sha256hex("drug x lowered mortality by 30% ⟦c⟧.");
  return {
    claimId: overrides?.claimId ?? "claim-1",
    docId: overrides?.docId ?? "doc-uuid-1",
    sentenceHash,
    occurrenceIndex: overrides?.occurrenceIndex ?? 0,
    clauseIndex: overrides?.clauseIndex ?? 0,
    section: overrides?.section ?? "results",
    subsection: overrides?.subsection ?? null,
    span: overrides?.span ?? { start: 0, end: 32 },
    claimText,
    normalizedClaimHash: normClaimHash,
    baseline: overrides?.baseline ?? {
      atoms: [{ start: 0, end: 5, claimType: "QUANTITATIVE" }],
      worth: "HIGH",
      claimType: "QUANTITATIVE",
      uncited: false,
    },
    stage1: overrides?.stage1 ?? null,
    citationKeys: overrides?.citationKeys ?? ["ref-1"],
    possibleCitations: overrides?.possibleCitations ?? [],
    refs: overrides?.refs ?? [
      { refId: "ref-1", selection: null, local: null, cloud: null, physical: null },
    ],
    heldNei: overrides?.heldNei ?? { value: null, seq: 0 },
    job: overrides?.job ?? { value: false, seq: 0 },
    l0Error: overrides?.l0Error ?? null,
    b5: overrides?.b5 ?? { inconsistentWith: [] },
    labNoteMismatch: overrides?.labNoteMismatch ?? [],
    suggestedRefIds: overrides?.suggestedRefIds ?? [],
    override: overrides?.override ?? { value: null, seq: 0 },
    archived: overrides?.archived ?? false,
    updatedAt: overrides?.updatedAt ?? 1700000000000,
  };
}

describe("RFC 8785 JCS canonicalization", () => {
  it("sorts keys by UTF-16 code units, strips whitespace, and normalizes -0", () => {
    const a = jcsSerialize({ b: 1, a: -0, "\u20ac": [true, null, undefined, "hi"] });
    const b = jcsSerialize({ "\u20ac": [true, null, undefined, "hi"], a: 0, b: 1 });
    expect(a).toBe('{"a":0,"b":1,"\u20ac":[true,null,null,"hi"]}');
    expect(b).toBe(a);
    expect(jcsHash({ x: 1, y: 2 })).toBe(jcsHash({ y: 2, x: 1 }));
    expect(() => jcsSerialize(Number.NaN)).toThrow(RangeError);
    expect(() => jcsSerialize(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("Ledger reducer E1–E16 & E6b unit semantics & immutability", () => {
  it("handles every event type E1–E16 + E6b without mutating frozen inputs", () => {
    const entry1 = makeSkeletonEntry({ claimId: "claim-1" });
    const entry2 = makeSkeletonEntry({
      claimId: "claim-2",
      clauseIndex: 1,
      claimText: "Drug Y showed no effect.",
      normalizedClaimHash: sha256hex("drug y showed no effect"),
      refs: [{ refId: "ref-2", selection: null, local: null, cloud: null, physical: null }],
      citationKeys: ["ref-2"],
    });
    const ev1 = sha256hex("unit-1");
    const approvedSha = sha256hex(entry1.claimText);
    const photoSha = sha256hex("photo-1");

    const s1Result: Stage1Result = {
      resultKey: stage1ResultKey(entry1.sentenceHash, "p2.1", "web_chrome_nano", "TriageV1"),
      atoms: [{ start: 0, end: 4, claimType: "CAUSAL" }],
      worth: "HIGH",
      claimType: "CAUSAL",
      uncited: false,
      modelProfile: "web_chrome_nano",
      schemaId: "TriageV1",
      promptVersion: "p2.1",
      decidedAt: 1700000001000,
    };

    const localResult: LocalResult = {
      resultKey: localResultKey(
        entry1.normalizedClaimHash,
        "ref-1",
        ev1,
        "p2.1",
        "web_chrome_nano",
        "VerdictV1",
        40,
      ),
      verdict: "CONTRADICTS",
      rawVerdict: "CONTRADICTS",
      anchor: null,
      anchorFailReason: null,
      microReasoning: "Source states opposite direction.",
      inferenceSource: "ON_DEVICE",
      modelProfile: "web_chrome_nano",
      schemaId: "VerdictV1",
      reasoningCap: 40,
      promptVersion: "p2.1",
      decidedAt: 1700000002000,
    };

    const cloudResult: CloudResult = {
      resultKey: cloudResultKey(
        entry1.normalizedClaimHash,
        approvedSha,
        "ref-1",
        "p2.1",
        "l2AdjudicateProvided",
      ),
      normalizedClaimHash: entry1.normalizedClaimHash,
      refId: "ref-1",
      verdict: "SUPPORTED",
      quote: "Drug X reduced mortality by 30%.",
      quoteAnchor: null,
      approvedTextSha256: approvedSha,
      alternativesDois: [],
      noDifferenceNote: false,
      adjudicator: "l2AdjudicateProvided",
      inferenceSource: "IN_CLOUD",
      promptVersion: "p2.1",
      decidedAt: 1700000003000,
    };

    const labPhysical: PhysicalResult = {
      resultKey: physicalResultKey(entry2.normalizedClaimHash, null, photoSha),
      normalizedClaimHash: entry2.normalizedClaimHash,
      refId: null,
      verdict: "CONTRADICTS",
      capture: {
        captureId: "cap-lab",
        photoSha256: photoSha,
        kind: "LAB_NOTE",
        linkedRefId: null,
        pageLabel: "Logbook 1",
        rowCropSha256: null,
        confirmedByAuthorAt: 1700000004000,
        entailmentConfirmedByAuthorAt: null,
      },
      inferenceSource: "ON_DEVICE",
      decidedAt: 1700000004000,
    };

    const overrideVal: AuthorOverride = {
      dismissedState: "SUPPORTED",
      basis: "REVIEW",
      captureId: null,
      normalizedClaimHash: entry1.normalizedClaimHash,
      refIdsKey: "ref-1",
      note: "Author verified",
      createdAt: 1700000005000,
    };

    const events: LedgerEvent[] = deepFreeze([
      { type: "ClauseCreated", entry: entry1 }, // E1
      { type: "ClauseCreated", entry: entry2 }, // E1
      {
        type: "BibResolved", // E2
        refId: "ref-1",
        bibStatus: "RESOLVED",
        retracted: false,
        checkMetadata: false,
        seq: 1,
      },
      { type: "RetractionSnapshot", refIds: ["ref-2"] }, // E3
      { type: "Stage1ResultArrived", result: s1Result }, // E4
      { type: "LocalResultArrived", claimId: "claim-1", refId: "ref-1", result: localResult }, // E5
      {
        type: "EvidenceChanged", // E6
        refId: "ref-1",
        evidenceVersion: ev1,
        hasEvidence: true,
        seq: 1,
      },
      {
        type: "SelectionComputed", // E6b
        claimId: "claim-1",
        refId: "ref-1",
        selection: { evidenceVersion: ev1, candidates: 2, suspicious: false, seq: 1 },
      },
      { type: "CloudResultArrived", claimId: "claim-1", refId: "ref-1", result: cloudResult }, // E7
      { type: "PhysicalResultArrived", claimId: "claim-2", result: labPhysical }, // E8 (LAB_NOTE ignored on refs)
      { type: "JobState", claimId: "claim-1", inFlight: true, seq: 1 }, // E10
      { type: "HeldNei", claimId: "claim-1", value: { since: 1700000002500 }, seq: 1 }, // E11
      { type: "Override", claimId: "claim-1", value: overrideVal, seq: 1 }, // E12
      { type: "B5Changed", claimIds: ["claim-1", "claim-2"] }, // E13
      { type: "L0Timeout", claimId: "claim-2" }, // E14
      { type: "PolicyChanged", snapshot: POLICY_B }, // E15
      {
        type: "LabNoteMismatch", // E16
        claimId: "claim-1",
        captureId: "cap-lab",
        value: { pageLabel: "Logbook 1", confirmedByAuthorAt: 1700000004000 },
        seq: 1,
      },
    ]);

    for (const ev of events) {
      const check = validateLedgerEvent(ev);
      expect(check.ok, `Invalid event ${ev.type}: ${check.errors.join("; ")}`).toBe(true);
    }

    const b5Map = new Map<string, readonly string[]>([
      ["claim-1", ["claim-2"]],
      ["claim-2", ["claim-1"]],
    ]);

    let state = createInitialLedgerState({ policy: POLICY_A });
    for (const ev of events) {
      state = applyEvent(state, ev, {
        b5Resolver: (cid) => b5Map.get(cid) ?? [],
      });
    }

    const e1 = state.entries.get("claim-1")!;
    const e2 = state.entries.get("claim-2")!;
    expect(e1.stage1?.claimType).toBe("CAUSAL");
    expect(e1.refs[0]!.local?.verdict).toBe("CONTRADICTS");
    expect(e1.refs[0]!.cloud?.verdict).toBe("SUPPORTED");
    expect(e1.job.value).toBe(true);
    expect(e1.heldNei.value).toStrictEqual({ since: 1700000002500 });
    expect(e1.override.value?.basis).toBe("REVIEW");
    expect(e1.b5.inconsistentWith).toStrictEqual(["claim-2"]);
    expect(e1.labNoteMismatch.length).toBe(1);

    // LAB_NOTE never attaches to ref.physical
    expect(e2.refs[0]!.physical).toBeNull();
    expect(e2.l0Error).toBe("PARSE_TIMEOUT");
    expect(state.refFacts.get("ref-2")?.retracted).toBe(true);
    expect(e2.b5.inconsistentWith).toStrictEqual(["claim-1"]);

    // E9 ClauseEdited archives claim-1 and creates claim-1-edited inheriting override
    const editedEntry = makeSkeletonEntry({ claimId: "claim-1-edited", clauseIndex: 0 });
    const e9: LedgerEvent = deepFreeze({
      type: "ClauseEdited",
      oldClaimIds: ["claim-1"],
      newSegmentation: [editedEntry],
    });
    const afterE9 = applyEvent(state, e9);
    expect(afterE9.entries.get("claim-1")?.archived).toBe(true);
    expect(afterE9.entries.get("claim-1-edited")?.override.value?.note).toBe("Author verified");

    const m = computeCoverageMeter(afterE9, MODE_STANDARD, SESSION_DEFAULT);
    expect(validateCoverageMeter(m).ok).toBe(true);
    expect(m.total).toBe(2); // claim-1-edited (reviewed) + claim-2 (problems via retracted ref-2)
    expect(m.reviewed).toBe(1);
    expect(m.problems).toBe(1);
    expect(m.numberMismatches).toBe(1); // claim-1 was archived; only claim-2 has active B5 mismatch

    const afterEditedLab = applyEvent(afterE9, {
      type: "LabNoteMismatch",
      claimId: "claim-1-edited",
      captureId: "cap-lab-2",
      value: { pageLabel: "Logbook 2", confirmedByAuthorAt: 1700000006000 },
      seq: 1,
    });
    const m2 = computeCoverageMeter(afterEditedLab, MODE_STANDARD, SESSION_DEFAULT);
    expect(validateCoverageMeter(m2).ok).toBe(true);
    expect(m2.numberMismatches).toBe(2);
  });

  it("ignores TriageFlatV1 materialization into entry.stage1", () => {
    const entry = makeSkeletonEntry({ claimId: "c-flat" });
    const flatS1: Stage1Result = {
      resultKey: stage1ResultKey(entry.sentenceHash, "p2.1", "web_chrome_nano", "TriageFlatV1"),
      atoms: [{ start: 0, end: 4, claimType: "CAUSAL" }],
      worth: "HIGH",
      claimType: "CAUSAL",
      uncited: false,
      modelProfile: "web_chrome_nano",
      schemaId: "TriageFlatV1",
      promptVersion: "p2.1",
      decidedAt: 1700000001000,
    };
    const state = reduceLedger(
      [
        { type: "ClauseCreated", entry },
        { type: "Stage1ResultArrived", result: flatS1 },
      ],
      { policy: POLICY_A },
    );
    const mat = state.entries.get("c-flat")!;
    expect(mat.stage1).toBeNull();
    const d = derive(mat, state.refFacts, state.policy, MODE_STANDARD, SESSION_DEFAULT);
    expect(d.triage.claimType).toBe("QUANTITATIVE");
  });

  it("re-materializes immediately on E15 PolicyChanged (hints disappear on Path B)", () => {
    const ev1 = sha256hex("ev-hint");
    const entry = makeSkeletonEntry({ claimId: "c-hint" });
    const localContra: LocalResult = {
      resultKey: localResultKey(
        entry.normalizedClaimHash,
        "ref-1",
        ev1,
        "p2.1",
        "web_chrome_nano",
        "VerdictV1",
        40,
      ),
      verdict: "CONTRADICTS",
      rawVerdict: "CONTRADICTS",
      anchor: null,
      anchorFailReason: null,
      microReasoning: "Different direction",
      inferenceSource: "ON_DEVICE",
      modelProfile: "web_chrome_nano",
      schemaId: "VerdictV1",
      reasoningCap: 40,
      promptVersion: "p2.1",
      decidedAt: 1700000001000,
    };

    const sA = reduceLedger(
      [
        { type: "BibResolved", refId: "ref-1", bibStatus: "RESOLVED", retracted: false, checkMetadata: false, seq: 1 },
        { type: "EvidenceChanged", refId: "ref-1", evidenceVersion: ev1, hasEvidence: true, seq: 1 },
        { type: "LocalResultArrived", claimId: "c-hint", refId: "ref-1", result: localContra },
        { type: "ClauseCreated", entry },
      ],
      { policy: POLICY_A },
    );
    expect(
      derive(sA.entries.get("c-hint")!, sA.refFacts, sA.policy, MODE_CONFIDENTIAL, SESSION_DEFAULT).state,
    ).toBe("HINT");

    const sB = applyEvent(sA, { type: "PolicyChanged", snapshot: POLICY_B });
    expect(
      derive(sB.entries.get("c-hint")!, sB.refFacts, sB.policy, MODE_CONFIDENTIAL, SESSION_DEFAULT).state,
    ).toBe("UNVERIFIABLE");
    expect(
      derive(sB.entries.get("c-hint")!, sB.refFacts, sB.policy, MODE_STANDARD, SESSION_DEFAULT).state,
    ).toBe("WAITING");
  });

  it("rejects stale seq updates and breaks equal-seq ties deterministically by JCS hash", () => {
    const entry = makeSkeletonEntry({ claimId: "c-seq" });
    const s1 = reduceLedger(
      [
        { type: "ClauseCreated", entry },
        { type: "JobState", claimId: "c-seq", inFlight: true, seq: 5 },
        { type: "JobState", claimId: "c-seq", inFlight: false, seq: 3 }, // stale seq ignored
      ],
      { policy: POLICY_A },
    );
    expect(s1.entries.get("c-seq")!.job).toStrictEqual({ value: true, seq: 5 });

    // Equal seq tie on JobState: sha256(JCS(true)) vs sha256(JCS(false))
    const trueWins = jcsHash(true) > jcsHash(false);
    const evTrue: LedgerEvent = { type: "JobState", claimId: "c-tie-seq", inFlight: true, seq: 2 };
    const evFalse: LedgerEvent = { type: "JobState", claimId: "c-tie-seq", inFlight: false, seq: 2 };
    const base = makeSkeletonEntry({ claimId: "c-tie-seq" });

    const order1 = reduceLedger([{ type: "ClauseCreated", entry: base }, evTrue, evFalse], { policy: POLICY_A });
    const order2 = reduceLedger([evFalse, evTrue, { type: "ClauseCreated", entry: base }], { policy: POLICY_A });
    expect(order1.entries.get("c-tie-seq")!.job).toStrictEqual(order2.entries.get("c-tie-seq")!.job);
    expect(order1.entries.get("c-tie-seq")!.job.value).toBe(trueWins);
  });

  it("formats numbers >= 10,000 with grouping and < 10,000 without grouping", () => {
    expect(category("UNCITED_EMPIRICAL", POLICY_A, MODE_STANDARD)).toBe("to_review");
    expect(
      category("UNCITED_EMPIRICAL", { ...POLICY_A, b4CountsAsReview: false }, MODE_STANDARD),
    ).toBe("unchecked");
    expect(formatCoverageHeader({
      total: 10000,
      supported: 10000,
      reviewed: 0,
      local: 0,
      problems: 0,
      to_review: 0,
      waiting: 0,
      unverifiable: 0,
      unchecked: 0,
      notYetChecked: 0,
      notCheckable: 0,
      numberMismatches: 0,
      quotaExhausted: false,
      quotaResetAt: null,
      byProvenance: { DETERMINISTIC: 0, ON_DEVICE: 0, CLOUD: 10000, PHYSICAL_SOURCE: 0, AUTHOR: 0 },
    })).toBe(
      "10,000 supported · 0 reviewed · 0 problems · 0 to review · 0 waiting · 0 can't verify · 0 not yet checked — of 10,000 claims",
    );
    expect(EMPTY_EVIDENCE_VERSION).toBe(sha256hex(""));
  });

  it("commutes valid and invalid Override (E12) events across ClauseCreated (E1) and sibling entries", () => {
    const c1 = makeSkeletonEntry({ claimId: "c1" });
    const c1v2 = makeSkeletonEntry({ claimId: "c1-v2", claimText: "Drug X lowered mortality by 30%." });
    const validOv: AuthorOverride = {
      dismissedState: "WAITING",
      basis: "REVIEW",
      captureId: null,
      normalizedClaimHash: c1.normalizedClaimHash,
      refIdsKey: "ref-1",
      note: "valid",
      createdAt: 1700000001000,
    };
    const invalidOv: AuthorOverride = {
      dismissedState: "WAITING",
      basis: "REVIEW",
      captureId: null,
      normalizedClaimHash: sha256hex("different claim"),
      refIdsKey: "ref-1",
      note: "invalid",
      createdAt: 1700000002000,
    };
    const evBib: LedgerEvent = {
      type: "BibResolved",
      refId: "ref-1",
      bibStatus: "RESOLVED",
      retracted: false,
      checkMetadata: false,
      seq: 1,
    };
    const evValid: LedgerEvent = { type: "Override", claimId: "c1", value: validOv, seq: 1 };
    const evInvalid: LedgerEvent = { type: "Override", claimId: "c1", value: invalidOv, seq: 2 };

    const s1 = reduceLedger(
      [evBib, { type: "ClauseCreated", entry: c1 }, evValid, evInvalid, { type: "ClauseCreated", entry: c1v2 }],
      { policy: POLICY_A },
    );
    const s2 = reduceLedger(
      [evInvalid, { type: "ClauseCreated", entry: c1v2 }, evValid, { type: "ClauseCreated", entry: c1 }, evBib],
      { policy: POLICY_A },
    );
    const s3 = reduceLedger(
      [{ type: "ClauseCreated", entry: c1 }, evInvalid, evValid, evBib, { type: "ClauseCreated", entry: c1v2 }],
      { policy: POLICY_A },
    );

    expect(s1.entries).toStrictEqual(s2.entries);
    expect(s1.entries).toStrictEqual(s3.entries);
    expect(s1.overridesByKey).toStrictEqual(s2.overridesByKey);
    expect(s1.overridesByKey).toStrictEqual(s3.overridesByKey);

    const matOrigin = s1.entries.get("c1")!;
    const matSibling = s1.entries.get("c1-v2")!;
    expect(matOrigin.override.value?.note).toBe("valid");
    expect(matOrigin.override.seq).toBe(1);
    expect(matSibling.override.value?.note).toBe("valid");
    expect(matSibling.override.seq).toBe(1);
    expect(matOrigin.override).toStrictEqual(matSibling.override);

    const derivedOrigin = derive(matOrigin, s1.refFacts, s1.policy, MODE_STANDARD, SESSION_DEFAULT);
    const derivedSibling = derive(matSibling, s1.refFacts, s1.policy, MODE_STANDARD, SESSION_DEFAULT);
    expect(derivedOrigin.state).toBe("REVIEWED_BY_AUTHOR");
    expect(derivedOrigin.provenance).toBe("AUTHOR");
    expect(derivedSibling.state).toBe("REVIEWED_BY_AUTHOR");
    expect(derivedSibling.provenance).toBe("AUTHOR");
  });

  it("commutatively clears REVIEWED_BY_AUTHOR on origin and sibling entries when a valid Override(value: null) arrives with higher seq", () => {
    const c1 = makeSkeletonEntry({ claimId: "c1" });
    const c1v2 = makeSkeletonEntry({ claimId: "c1-v2", claimText: "Drug X lowered mortality by 30%." });
    const validOv: AuthorOverride = {
      dismissedState: "WAITING",
      basis: "REVIEW",
      captureId: null,
      normalizedClaimHash: c1.normalizedClaimHash,
      refIdsKey: "ref-1",
      note: "valid",
      createdAt: 1700000001000,
    };
    const invalidOv: AuthorOverride = {
      dismissedState: "WAITING",
      basis: "REVIEW",
      captureId: null,
      normalizedClaimHash: sha256hex("different claim"),
      refIdsKey: "ref-1",
      note: "invalid",
      createdAt: 1700000002000,
    };
    const evBib: LedgerEvent = {
      type: "BibResolved",
      refId: "ref-1",
      bibStatus: "RESOLVED",
      retracted: false,
      checkMetadata: false,
      seq: 1,
    };
    const evValid: LedgerEvent = { type: "Override", claimId: "c1", value: validOv, seq: 1 };
    const evInvalid: LedgerEvent = { type: "Override", claimId: "c1", value: invalidOv, seq: 2 };
    const evUndo: LedgerEvent = { type: "Override", claimId: "c1", value: null, seq: 3 };
    const evC1: LedgerEvent = { type: "ClauseCreated", entry: c1 };
    const evC1v2: LedgerEvent = { type: "ClauseCreated", entry: c1v2 };

    const orders: LedgerEvent[][] = [
      [evBib, evC1, evC1v2, evValid, evInvalid, evUndo],
      [evUndo, evBib, evInvalid, evC1v2, evValid, evC1],
      [evC1v2, evValid, evUndo, evC1, evInvalid, evBib],
      [evInvalid, evValid, evUndo, evBib, evC1, evC1v2],
    ];

    const baseline = reduceLedger(orders[0]!, { policy: POLICY_A });
    for (const order of orders.slice(1)) {
      const next = reduceLedger(order, { policy: POLICY_A });
      expect(next.entries).toStrictEqual(baseline.entries);
      expect(next.overridesByKey).toStrictEqual(baseline.overridesByKey);
    }

    const matOrigin = baseline.entries.get("c1")!;
    const matSibling = baseline.entries.get("c1-v2")!;
    expect(matOrigin.override).toStrictEqual({ value: null, seq: 3 });
    expect(matSibling.override).toStrictEqual({ value: null, seq: 3 });

    const derivedOrigin = derive(matOrigin, baseline.refFacts, baseline.policy, MODE_STANDARD, SESSION_DEFAULT);
    const derivedSibling = derive(matSibling, baseline.refFacts, baseline.policy, MODE_STANDARD, SESSION_DEFAULT);
    expect(derivedOrigin.state).toBe("WAITING");
    expect(derivedSibling.state).toBe("WAITING");
  });

  it("rejects forged LocalResult and Stage1Result whose internal schema/prompt fields do not match resultKey", () => {
    const ev1 = sha256hex("ev-forged");
    const entry = makeSkeletonEntry({ claimId: "c-forged" });
    const validKey = localResultKey(
      entry.normalizedClaimHash,
      "ref-1",
      ev1,
      "p2.1",
      "web_chrome_nano",
      "VerdictV1",
      40,
    );
    const forgedLocal: LocalResult = {
      resultKey: validKey,
      verdict: "CONTRADICTS",
      rawVerdict: "CONTRADICTS",
      anchor: null,
      anchorFailReason: null,
      microReasoning: "Forged mismatch",
      inferenceSource: "ON_DEVICE",
      modelProfile: "web_chrome_nano",
      schemaId: "VerdictV1_cap20",
      reasoningCap: 20,
      promptVersion: "old_prompt",
      decidedAt: 1700000009000,
    };
    const forgedStage1: Stage1Result = {
      resultKey: stage1ResultKey(entry.sentenceHash, "p2.1", "web_chrome_nano", "TriageV1"),
      atoms: [{ start: 0, end: 3, claimType: "CAUSAL" }],
      worth: "HIGH",
      claimType: "CAUSAL",
      uncited: true,
      modelProfile: "web_chrome_nano",
      schemaId: "TriageV1",
      promptVersion: "old_prompt",
      decidedAt: 1700000009000,
    };

    const state = reduceLedger(
      [
        { type: "EvidenceChanged", refId: "ref-1", evidenceVersion: ev1, hasEvidence: true, seq: 1 },
        { type: "LocalResultArrived", claimId: "c-forged", refId: "ref-1", result: forgedLocal },
        { type: "Stage1ResultArrived", result: forgedStage1 },
        { type: "ClauseCreated", entry },
      ],
      { policy: POLICY_A },
    );

    const mat = state.entries.get("c-forged")!;
    expect(mat.refs[0]!.local).toBeNull();
    expect(mat.stage1).toBeNull();
  });
});
