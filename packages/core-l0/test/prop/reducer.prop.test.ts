import { describe, expect, it } from "vitest";
import {
  BUNDLED_SAMPLE_PRIVACY_CONTEXT,
  EMPTY_EVIDENCE_VERSION,
  cloudResultKey,
  computeCoverageMeter,
  derive,
  formatCoverageHeader,
  localResultKey,
  physicalResultKey,
  reduceLedger,
  stage1ResultKey,
  validateCoverageMeter,
  type AuthorOverride,
  type BibStatus,
  type ClaimLedgerEntry,
  type ClaimType,
  type CloudResult,
  type CloudVerdict,
  type LedgerEvent,
  type LocalResult,
  type LocalVerdict,
  type PolicySnapshot,
  type PrivacyContext,
  type SessionFacts,
  type Stage1Result,
} from "../../src/ledger.js";
import { sha256hex } from "../../src/norm.js";

/**
 * Reducer order-independence & Coverage Meter partition property suite
 * (`AC-L0-16`, `AC-L0-19`, `01` §4.5 & §5.1, `07` §6.9 Procedures 2 & 3).
 *
 * Uses pure seeded PRNG with `SEED_PROPERTY = 0x544C4D47` (zero Math.random, zero Date, zero I/O).
 */

const SEED_PROPERTY = 0x544c4d47;
const MULTISETS_PER_RUN = 1000;
const PERMUTATIONS_PER_MULTISET = 20;

interface Rng {
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  bool(prob?: number): boolean;
}

function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(minInclusive: number, maxInclusive: number): number {
      return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)]!;
    },
    bool(prob: number = 0.5): boolean {
      return next() < prob;
    },
  };
}

function shuffleWithSeed<T>(items: readonly T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

const CLAIM_TYPES: readonly ClaimType[] = [
  "QUANTITATIVE",
  "CAUSAL",
  "COMPARATIVE",
  "EXISTENCE",
  "METHODOLOGICAL",
  "NON_EMPIRICAL",
];

const BIB_STATUSES: readonly BibStatus[] = [
  "PENDING",
  "RESOLVED",
  "DOI_NOT_FOUND",
  "NOT_INDEXED",
  "AMBIGUOUS",
  "METADATA_MISMATCH",
  "UNRESOLVED_KEY",
  "UPSTREAM_UNAVAILABLE",
  "RATE_LIMITED",
];

const LOCAL_VERDICTS: readonly LocalVerdict[] = ["SUPPORTED", "CONTRADICTS", "NEI_SILENT_ESCALATE"];
const CLOUD_VERDICTS: readonly CloudVerdict[] = ["SUPPORTED", "PARTIAL", "CONTRADICTED", "NEI"];

const POLICY_MATRIX: readonly PolicySnapshot[] = [
  {
    deviceProfile: "web_chrome_nano",
    b4CountsAsReview: true,
    profiles: {
      web_chrome_nano: {
        path: "A",
        authority: { B1: "authoritative", B2: "authoritative", B3: "authoritative", B5: "advisory", O2: "advisory" },
        supportVerdicts: "authoritative",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
  {
    deviceProfile: "web_chrome_nano",
    b4CountsAsReview: true,
    profiles: {
      web_chrome_nano: {
        path: "A",
        authority: { B1: "advisory", B2: "advisory", B3: "advisory", B5: "advisory", O2: "advisory" },
        supportVerdicts: "advisory",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
  {
    deviceProfile: "web_chrome_nano",
    b4CountsAsReview: false,
    profiles: {
      web_chrome_nano: {
        path: "B",
        authority: { B1: "authoritative", B2: "authoritative", B3: "authoritative", B5: "advisory", O2: "advisory" },
        supportVerdicts: "advisory",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
  {
    deviceProfile: "web_chrome_nano",
    b4CountsAsReview: false,
    profiles: {
      web_chrome_nano: {
        path: "B",
        authority: { B1: "advisory", B2: "advisory", B3: "advisory", B5: "advisory", O2: "advisory" },
        supportVerdicts: "advisory",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
  {
    // Unknown active profile exercises conservative fallback
    deviceProfile: "unknown_device_profile",
    b4CountsAsReview: true,
    profiles: {
      web_chrome_nano: {
        path: "A",
        authority: { B1: "authoritative", B2: "authoritative", B3: "authoritative", B5: "advisory", O2: "advisory" },
        supportVerdicts: "authoritative",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
];

const PRIVACY_MATRIX: readonly PrivacyContext[] = [
  { mode: "STANDARD", cloudAvailable: true, quotaExhausted: false, quotaResetAt: null },
  { mode: "STANDARD", cloudAvailable: true, quotaExhausted: true, quotaResetAt: 1700067600000 },
  { mode: "STANDARD", cloudAvailable: false, quotaExhausted: false, quotaResetAt: null },
  { mode: "CONFIDENTIAL", cloudAvailable: false, quotaExhausted: false, quotaResetAt: null },
  BUNDLED_SAMPLE_PRIVACY_CONTEXT,
];

function buildSessionMatrix(claimIds: readonly string[], refIds: readonly string[]): readonly SessionFacts[] {
  const transientMap = new Map<string, { reason: "DEADLINE"; attempts: number }>();
  for (let i = 0; i < claimIds.length; i += 1) {
    for (let j = 0; j < refIds.length; j += 1) {
      if ((i + j) % 2 === 0) {
        transientMap.set(`${claimIds[i]}|${refIds[j]}`, { reason: "DEADLINE", attempts: (i + j) % 4 });
      }
    }
  }
  return [
    { localUnavailable: false, transient: new Map() },
    { localUnavailable: false, transient: transientMap },
    { localUnavailable: true, transient: new Map() },
    { localUnavailable: true, transient: transientMap },
  ];
}

interface GeneratedCase {
  readonly initialPolicy: PolicySnapshot;
  readonly events: readonly LedgerEvent[];
  readonly b5Map: ReadonlyMap<string, readonly string[]>;
  readonly claimIds: readonly string[];
  readonly refIds: readonly string[];
}

function generateMultiset(rng: Rng, caseIdx: number): GeneratedCase {
  const docId = `doc-${caseIdx}`;
  const numClaims = rng.int(1, 3);
  const numRefs = rng.int(0, 4);
  const refIds = Array.from({ length: numRefs }, (_, r) => `ref-${caseIdx}-${r}`);
  const evPool = [EMPTY_EVIDENCE_VERSION, sha256hex(`ev-old-${caseIdx}`), sha256hex(`ev-cur-${caseIdx}`)];

  const entries: ClaimLedgerEntry[] = [];
  const claimIds: string[] = [];

  for (let c = 0; c < numClaims; c += 1) {
    const cid = `claim-${caseIdx}-${c}`;
    claimIds.push(cid);
    const refCount = numRefs === 0 ? 0 : rng.int(0, numRefs);
    const chosenRefs: string[] = [];
    for (let r = 0; r < refCount; r += 1) {
      const candidate = refIds[r]!;
      if (!chosenRefs.includes(candidate)) chosenRefs.push(candidate);
    }
    chosenRefs.sort();
    const ct = rng.pick(CLAIM_TYPES);
    const normHash = sha256hex(`norm-${caseIdx}-${c}`);
    const sentHash = sha256hex(`sent-${caseIdx}-${Math.floor(c / 2)}`);

    entries.push({
      claimId: cid,
      docId,
      sentenceHash: sentHash,
      occurrenceIndex: c,
      clauseIndex: 0,
      section: "results",
      subsection: null,
      span: { start: c * 20, end: c * 20 + 18 },
      claimText: `Claim text ${caseIdx}-${c}.`,
      normalizedClaimHash: normHash,
      baseline: {
        atoms: [{ start: 0, end: 3, claimType: ct }],
        worth: rng.pick(["HIGH", "LOW", "UNKNOWN"]),
        claimType: ct,
        uncited: chosenRefs.length === 0 ? rng.bool(0.5) : false,
      },
      stage1: null,
      citationKeys: chosenRefs,
      possibleCitations: [],
      refs: chosenRefs.map((refId) => ({
        refId,
        selection: null,
        local: null,
        cloud: null,
        physical: null,
      })),
      heldNei: { value: null, seq: 0 },
      job: { value: false, seq: 0 },
      l0Error: null,
      b5: { inconsistentWith: [] },
      labNoteMismatch: [],
      suggestedRefIds: [],
      override: { value: null, seq: 0 },
      archived: false,
      updatedAt: 1700000000000 + c,
    });
  }

  const events: LedgerEvent[] = [];
  const seqByClaim = new Map<string, number>();
  const nextClaimSeq = (cid: string): number => {
    const n = (seqByClaim.get(cid) ?? 0) + 1;
    seqByClaim.set(cid, n);
    return n;
  };
  const seqByRef = new Map<string, number>();
  const nextRefSeq = (rid: string): number => {
    const n = (seqByRef.get(rid) ?? 0) + 1;
    seqByRef.set(rid, n);
    return n;
  };

  for (const e of entries) {
    events.push({ type: "ClauseCreated", entry: e });
  }

  // E2 + E3 + E6
  for (const rid of refIds) {
    events.push({
      type: "BibResolved",
      refId: rid,
      bibStatus: rng.pick(BIB_STATUSES),
      retracted: rng.bool(0.2),
      checkMetadata: rng.bool(0.2),
      seq: nextRefSeq(rid),
    });
    if (rng.bool(0.5)) {
      events.push({
        type: "BibResolved",
        refId: rid,
        bibStatus: rng.pick(BIB_STATUSES),
        retracted: rng.bool(0.15),
        checkMetadata: rng.bool(0.2),
        seq: nextRefSeq(rid),
      });
    }
    if (rng.bool(0.15)) {
      events.push({ type: "RetractionSnapshot", refIds: [rid] });
    }
    events.push({
      type: "EvidenceChanged",
      refId: rid,
      evidenceVersion: evPool[1]!,
      hasEvidence: true,
      seq: nextRefSeq(rid),
    });
    if (rng.bool(0.7)) {
      events.push({
        type: "EvidenceChanged",
        refId: rid,
        evidenceVersion: evPool[2]!,
        hasEvidence: rng.bool(0.85),
        seq: nextRefSeq(rid),
      });
    }
  }

  // E4 Stage1 + E15 PolicyChanged
  const s1: Stage1Result = {
    resultKey: stage1ResultKey(entries[0]!.sentenceHash, "p2.1", "web_chrome_nano", "TriageV1"),
    atoms: [{ start: 0, end: 3, claimType: rng.pick(CLAIM_TYPES) }],
    worth: rng.pick(["HIGH", "LOW"]),
    claimType: rng.pick(CLAIM_TYPES),
    uncited: rng.bool(0.3),
    modelProfile: "web_chrome_nano",
    schemaId: "TriageV1",
    promptVersion: "p2.1",
    decidedAt: 1700000001000,
  };
  events.push({ type: "Stage1ResultArrived", result: s1 });
  events.push({ type: "PolicyChanged", snapshot: rng.pick(POLICY_MATRIX) });

  // E5, E6b, E7, E8, E10, E11, E12, E14, E16
  for (const e of entries) {
    if (e.refs.length > 0) {
      const r0 = e.refs[0]!.refId;
      // Old & current SelectionComputed (E6b)
      events.push({
        type: "SelectionComputed",
        claimId: e.claimId,
        refId: r0,
        selection: {
          evidenceVersion: evPool[1]!,
          candidates: rng.int(0, 5),
          suspicious: rng.bool(0.2),
          seq: nextClaimSeq(e.claimId),
        },
      });
      events.push({
        type: "SelectionComputed",
        claimId: e.claimId,
        refId: r0,
        selection: {
          evidenceVersion: evPool[2]!,
          candidates: rng.int(0, 5),
          suspicious: rng.bool(0.25),
          seq: nextClaimSeq(e.claimId),
        },
      });

      // LocalResultArrived (valid, stale key, and equal decidedAt tie)
      const validKey = localResultKey(
        e.normalizedClaimHash,
        r0,
        evPool[2]!,
        "p2.1",
        "web_chrome_nano",
        "VerdictV1",
        40,
      );
      const localA: LocalResult = {
        resultKey: validKey,
        verdict: rng.pick(LOCAL_VERDICTS),
        rawVerdict: "SUPPORTED",
        anchor: null,
        anchorFailReason: null,
        microReasoning: "Candidate A",
        inferenceSource: "ON_DEVICE",
        modelProfile: "web_chrome_nano",
        schemaId: "VerdictV1",
        reasoningCap: 40,
        promptVersion: "p2.1",
        decidedAt: 1700000002000,
      };
      events.push({ type: "LocalResultArrived", claimId: e.claimId, refId: r0, result: localA });
      if (rng.bool(0.5)) {
        // Equal resultKey & equal decidedAt -> tie-broken by sha256hex(JCS(result))
        const localB: LocalResult = {
          ...localA,
          verdict: rng.pick(LOCAL_VERDICTS),
          microReasoning: "Candidate B",
        };
        events.push({ type: "LocalResultArrived", claimId: e.claimId, refId: r0, result: localB });
      }
      if (rng.bool(0.4)) {
        // Stale key
        events.push({
          type: "LocalResultArrived",
          claimId: e.claimId,
          refId: r0,
          result: {
            ...localA,
            resultKey: localResultKey(e.normalizedClaimHash, r0, evPool[1]!, "p2.1", "web_chrome_nano", "VerdictV1", 40),
          },
        });
      }

      // CloudResultArrived (valid and wrong approvedTextSha256)
      if (rng.bool(0.5)) {
        const appSha = sha256hex(e.claimText);
        const cRes: CloudResult = {
          resultKey: cloudResultKey(e.normalizedClaimHash, appSha, r0, "p2.1", "l2AdjudicateProvided"),
          normalizedClaimHash: e.normalizedClaimHash,
          refId: r0,
          verdict: rng.pick(CLOUD_VERDICTS),
          quote: null,
          quoteAnchor: null,
          approvedTextSha256: appSha,
          alternativesDois: [],
          noDifferenceNote: false,
          adjudicator: "l2AdjudicateProvided",
          inferenceSource: "IN_CLOUD",
          promptVersion: "p2.1",
          decidedAt: 1700000003000,
        };
        events.push({ type: "CloudResultArrived", claimId: e.claimId, refId: r0, result: cRes });
      }
      if (rng.bool(0.3)) {
        const wrongSha = sha256hex("tampered-claim");
        events.push({
          type: "CloudResultArrived",
          claimId: e.claimId,
          refId: r0,
          result: {
            resultKey: cloudResultKey(e.normalizedClaimHash, sha256hex(e.claimText), r0, "p2.1", "l2AdjudicateProvided"),
            normalizedClaimHash: e.normalizedClaimHash,
            refId: r0,
            verdict: "CONTRADICTED",
            quote: null,
            quoteAnchor: null,
            approvedTextSha256: wrongSha,
            alternativesDois: [],
            noDifferenceNote: false,
            adjudicator: "l2AdjudicateProvided",
            inferenceSource: "IN_CLOUD",
            promptVersion: "p2.1",
            decidedAt: 1700000009000,
          },
        });
      }

      // PhysicalResultArrived (unconfirmed -> confirmed)
      if (rng.bool(0.4)) {
        const pSha = sha256hex(`photo-${e.claimId}`);
        const pKey = physicalResultKey(e.normalizedClaimHash, r0, pSha);
        events.push({
          type: "PhysicalResultArrived",
          claimId: e.claimId,
          result: {
            resultKey: pKey,
            normalizedClaimHash: e.normalizedClaimHash,
            refId: r0,
            verdict: "SUPPORTED",
            capture: {
              captureId: `cap-${e.claimId}`,
              photoSha256: pSha,
              kind: "PHYSICAL_TABLE",
              linkedRefId: r0,
              pageLabel: "Table 1",
              rowCropSha256: null,
              confirmedByAuthorAt: 1700000001000,
              entailmentConfirmedByAuthorAt: null,
            },
            inferenceSource: "ON_DEVICE",
            decidedAt: 1700000004000,
          },
        });
        events.push({
          type: "PhysicalResultArrived",
          claimId: e.claimId,
          result: {
            resultKey: pKey,
            normalizedClaimHash: e.normalizedClaimHash,
            refId: r0,
            verdict: "SUPPORTED",
            capture: {
              captureId: `cap-${e.claimId}`,
              photoSha256: pSha,
              kind: "PHYSICAL_TABLE",
              linkedRefId: r0,
              pageLabel: "Table 1",
              rowCropSha256: null,
              confirmedByAuthorAt: 1700000001000,
              entailmentConfirmedByAuthorAt: 1700000005000,
            },
            inferenceSource: "ON_DEVICE",
            decidedAt: 1700000005000,
          },
        });
      }
    }

    if (rng.bool(0.5)) {
      events.push({ type: "JobState", claimId: e.claimId, inFlight: rng.bool(), seq: nextClaimSeq(e.claimId) });
    }
    if (rng.bool(0.3)) {
      events.push({
        type: "HeldNei",
        claimId: e.claimId,
        value: rng.bool() ? { since: 1700000001500 } : null,
        seq: nextClaimSeq(e.claimId),
      });
    }
    if (rng.bool(0.4)) {
      const ov: AuthorOverride = {
        dismissedState: rng.pick(["WAITING", "CONTRADICTED", "UNVERIFIABLE", "SUPPORTED"]),
        basis: "REVIEW",
        captureId: null,
        normalizedClaimHash: e.normalizedClaimHash,
        refIdsKey: e.refs.map((r) => r.refId).sort().join("|"),
        note: "Reviewed",
        createdAt: 1700000006000,
      };
      events.push({ type: "Override", claimId: e.claimId, value: ov, seq: nextClaimSeq(e.claimId) });
    }
    if (rng.bool(0.2)) {
      events.push({ type: "L0Timeout", claimId: e.claimId });
    }
    if (rng.bool(0.3)) {
      events.push({
        type: "LabNoteMismatch",
        claimId: e.claimId,
        captureId: "cap-lab-0",
        value: rng.bool() ? { pageLabel: "Lab p.1", confirmedByAuthorAt: 1700000007000 } : null,
        seq: nextClaimSeq(e.claimId),
      });
    }
  }

  // E9 re-segmentation on last entry + trivial edit sharing normalizedClaimHash
  if (entries.length >= 1 && rng.bool(0.5)) {
    const oldEntry = entries[entries.length - 1]!;
    const replacement: ClaimLedgerEntry = {
      ...oldEntry,
      claimId: `${oldEntry.claimId}-v2`,
      claimText: `${oldEntry.claimText} `,
      updatedAt: oldEntry.updatedAt + 100,
    };
    claimIds.push(replacement.claimId);
    events.push({
      type: "ClauseEdited",
      oldClaimIds: [oldEntry.claimId],
      newSegmentation: [replacement],
    });
  }

  // E13 B5Changed
  const b5Map = new Map<string, readonly string[]>();
  if (claimIds.length >= 2 && rng.bool(0.5)) {
    b5Map.set(claimIds[0]!, [claimIds[1]!]);
    b5Map.set(claimIds[1]!, [claimIds[0]!]);
    events.push({ type: "B5Changed", claimIds: [claimIds[0]!, claimIds[1]!] });
  }

  // Add deliberate duplicate event to assert idempotency alongside permutations
  if (events.length > 0) {
    events.push(rng.pick(events));
  }

  return {
    initialPolicy: POLICY_MATRIX[0]!,
    events,
    b5Map,
    claimIds,
    refIds,
  };
}

function swapPairs(events: readonly LedgerEvent[], aType: LedgerEvent["type"], bType: LedgerEvent["type"]): LedgerEvent[] {
  const out = [...events];
  const idxA = out.findIndex((e) => e.type === aType);
  const idxB = out.findIndex((e) => e.type === bType);
  if (idxA !== -1 && idxB !== -1) {
    const tmp = out[idxA]!;
    out[idxA] = out[idxB]!;
    out[idxB] = tmp;
  }
  return out;
}

describe(`packages/core-l0/test/prop/reducer.prop.test.ts (SEED_PROPERTY=0x${SEED_PROPERTY.toString(16)})`, () => {
  it(`verifies commutativity, idempotency, meter invariants, and no-dead-drawers across ${MULTISETS_PER_RUN} random multisets x ${PERMUTATIONS_PER_MULTISET} permutations (AC-L0-16, AC-L0-19)`, () => {
    const rng = createSeededRng(SEED_PROPERTY);

    for (let i = 0; i < MULTISETS_PER_RUN; i += 1) {
      const tc = generateMultiset(rng, i);
      const b5Resolver = (cid: string): readonly string[] => tc.b5Map.get(cid) ?? [];
      const sessions = buildSessionMatrix(tc.claimIds, tc.refIds);

      const canonical = reduceLedger(tc.events, { policy: tc.initialPolicy }, { b5Resolver });
      const duplicated = reduceLedger([...tc.events, ...tc.events], { policy: tc.initialPolicy }, { b5Resolver });
      expect(duplicated).toStrictEqual(canonical);

      // Explicit adversarial swaps required by 01 §4.5 and 07 §6.9 Procedure 2
      const targetedPermutations: LedgerEvent[][] = [
        [...tc.events].reverse(),
        swapPairs(tc.events, "Stage1ResultArrived", "PolicyChanged"), // E4 <-> E15
        swapPairs(tc.events, "EvidenceChanged", "SelectionComputed"), // E6 <-> E6b
        swapPairs(tc.events, "LocalResultArrived", "EvidenceChanged"), // E5 <-> E6
        swapPairs(tc.events, "LocalResultArrived", "ClauseEdited"), // E5 <-> E9
        swapPairs(tc.events, "Override", "ClauseCreated"), // E12 <-> E1
        swapPairs(tc.events, "Override", "BibResolved"), // E12 <-> E2
        swapPairs(tc.events, "ClauseEdited", "CloudResultArrived"), // E9 <-> E7
      ];

      for (let p = 0; p < PERMUTATIONS_PER_MULTISET; p += 1) {
        const perm = p < targetedPermutations.length ? targetedPermutations[p]! : shuffleWithSeed(tc.events, rng);
        const permuted = reduceLedger(perm, { policy: tc.initialPolicy }, { b5Resolver });

        expect(permuted.refFacts).toStrictEqual(canonical.refFacts);
        expect(permuted.results).toStrictEqual(canonical.results);
        expect(permuted.entries).toStrictEqual(canonical.entries);
        expect(permuted.overridesByKey).toStrictEqual(canonical.overridesByKey);
      }

      // Check derive() + Coverage Meter + No dead drawers over Policy x Privacy x Session matrix (sampled per multiset + full on every 20th)
      const checkFullMatrix = i % 20 === 0;
      const policies = checkFullMatrix ? POLICY_MATRIX : [POLICY_MATRIX[i % POLICY_MATRIX.length]!];
      const modes = checkFullMatrix ? PRIVACY_MATRIX : [PRIVACY_MATRIX[i % PRIVACY_MATRIX.length]!];
      const sessList = checkFullMatrix ? sessions : [sessions[i % sessions.length]!];

      for (const pol of policies) {
        for (const mode of modes) {
          for (const sess of sessList) {
            for (const entry of canonical.entries.values()) {
              const d = derive(entry, canonical.refFacts, pol, mode, sess);
              if (d.state === "WAITING") {
                // 01 §4.8 "No dead drawers" invariant (statement 1 & 2)
                expect(mode.cloudAvailable).toBe(true);
                const waitingHasActionOrResetTime =
                  !mode.quotaExhausted || mode.quotaResetAt !== null;
                expect(waitingHasActionOrResetTime).toBe(true);
              }
              if (
                d.state === "UNVERIFIABLE" ||
                d.state === "MIXED_SUPPORT" ||
                d.state === "SOURCE_FLAGGED" ||
                d.state === "REVIEWED_BY_AUTHOR"
              ) {
                // Drawer always has an available local primary action (01 §5.4)
                expect(d.claimId.length).toBeGreaterThan(0);
              }
            }

            const stateForPol = { ...canonical, policy: pol };
            const m = computeCoverageMeter(stateForPol, mode, sess);
            const validation = validateCoverageMeter(m);
            expect(validation.ok, `Meter invariant failed on case ${i}: ${validation.errors.join("; ")}`).toBe(true);

            const sevenSum =
              m.supported +
              m.reviewed +
              m.problems +
              m.to_review +
              m.waiting +
              m.unverifiable +
              m.notYetChecked;
            expect(sevenSum).toBe(m.total);
            expect(m.notYetChecked).toBe(m.local + m.unchecked);

            const resetTimeStr = mode.quotaExhausted && mode.quotaResetAt !== null ? "00:00" : undefined;
            const header = formatCoverageHeader(m, resetTimeStr);
            const expectedHeader =
              `${m.supported} supported \u00b7 ${m.reviewed} reviewed \u00b7 ${m.problems} problems \u00b7 ` +
              `${m.to_review} to review \u00b7 ${m.waiting} waiting \u00b7 ${m.unverifiable} can't verify \u00b7 ` +
              `${m.notYetChecked} not yet checked \u2014 of ${m.total} claims` +
              (resetTimeStr !== undefined ? ` \u00b7 cloud checks resume at ${resetTimeStr}` : "");
            expect(header).toBe(expectedHeader);

            // Exhausted pool never changes any of the 8 bucket counts compared to non-exhausted pool
            if (mode.mode === "STANDARD" && mode.cloudAvailable && !mode.quotaExhausted) {
              const exhaustedMode: PrivacyContext = {
                ...mode,
                quotaExhausted: true,
                quotaResetAt: 1700067600000,
              };
              const mExhausted = computeCoverageMeter(stateForPol, exhaustedMode, sess);
              expect(mExhausted.supported).toBe(m.supported);
              expect(mExhausted.reviewed).toBe(m.reviewed);
              expect(mExhausted.local).toBe(m.local);
              expect(mExhausted.problems).toBe(m.problems);
              expect(mExhausted.to_review).toBe(m.to_review);
              expect(mExhausted.waiting).toBe(m.waiting);
              expect(mExhausted.unverifiable).toBe(m.unverifiable);
              expect(mExhausted.unchecked).toBe(m.unchecked);
              expect(mExhausted.total).toBe(m.total);
            }
          }
        }
      }
    }
  }, 60_000);
});
