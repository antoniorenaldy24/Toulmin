import { describe, expect, it } from "vitest";
import b5PairingVectors from "../../../conformance/l0/b5pairing.json" with { type: "json" };
import b5BaselineVectors from "../../../conformance/l0/b5_baseline.json" with { type: "json" };
import b5IncrementalVectors from "../../../conformance/l0/b5_incremental.json" with { type: "json" };
import {
  applyB5IncrementalUpdate,
  checkL1B5Output,
  classifyB5Baseline,
  consistentValues,
  createB5Index,
  isCandidatePairEligible,
  pairKeyOf,
  queryLemmaCandidates,
  recomputeB5Full,
  type B5Index,
  type B5MutationBatch,
  type B5Tuple,
} from "../src/b5pairing.js";
import type { B5CheckV1 } from "@toulmin/schemas";

function snapshotKeptTuples(index: B5Index): Array<[string, string]> {
  const deduped = new Map<string, [string, string]>();
  for (const list of index.keptByTuple.values()) {
    for (const p of list) {
      if (!deduped.has(p.pairKey)) {
        deduped.set(p.pairKey, [p.tupleA, p.tupleB]);
      }
    }
  }
  return Array.from(deduped.values()).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
}

describe("conformance/l0/b5pairing.json (AC-L0-13, Procedure 4)", () => {
  for (const tc of b5PairingVectors.consistentCases) {
    it(`consistent symmetric: ${tc.id}`, () => {
      const a = tc.a as Parameters<typeof consistentValues>[0];
      const b = tc.b as Parameters<typeof consistentValues>[1];
      expect(consistentValues(a, b)).toBe(tc.expectedConsistent);
      expect(consistentValues(b, a)).toBe(tc.expectedConsistent);
    });
  }

  for (const tc of b5PairingVectors.eligibilityCases) {
    it(`eligibility symmetric: ${tc.id}`, () => {
      const a = tc.a as unknown as B5Tuple;
      const b = tc.b as unknown as B5Tuple;
      expect(isCandidatePairEligible(a, b)).toBe(tc.expectedEligible);
      expect(isCandidatePairEligible(b, a)).toBe(tc.expectedEligible);
    });
  }

  for (const tc of b5PairingVectors.indexPipelineCases) {
    it(`index pipeline: ${tc.id}`, () => {
      const res = applyB5IncrementalUpdate(createB5Index(), {
        upsert: tc.tuples as unknown as B5Tuple[],
      });
      const mainKept = res.index.keptByTuple.get("t-main") ?? [];
      const partners = mainKept.map((p) => (p.tupleA === "t-main" ? p.tupleB : p.tupleA));
      expect(partners).toStrictEqual(tc.expectedTop3PartnersForMain);
      expect(partners.length).toBeLessThanOrEqual(3);
    });
  }

  it("queries candidates strictly from key-lemma index, splits jobs by metric class, and deletes orphan b5_checks", () => {
    const t1: B5Tuple = {
      tupleId: "t-orphan-a",
      docId: "doc-ops",
      claimId: "c1",
      sentenceHash: "s1",
      occurrence: 0,
      section: "methods",
      metricClass: "sample_size",
      keyLemmas: ["adult", "cohort"],
      valueRaw: "48",
      valueNorm: 48,
      valueLo: null,
      valueHi: null,
      sigDigits: 2,
      pComparator: null,
      unitRaw: "",
      unitCanon: "count",
      source: "manuscript",
      span: { start: 0, end: 2 },
      windowText: "48 adults.",
    };
    const t2: B5Tuple = {
      ...t1,
      tupleId: "t-orphan-b",
      claimId: "c2",
      sentenceHash: "s2",
      valueRaw: "48.0",
      windowText: "48.0 adults.",
    };
    const tPct: B5Tuple = {
      ...t1,
      tupleId: "t-pct-other",
      claimId: "c3",
      sentenceHash: "s3",
      metricClass: "percentage",
      valueRaw: "25",
      valueNorm: 25,
      unitRaw: "%",
      unitCanon: "%",
    };

    const step1 = applyB5IncrementalUpdate(createB5Index(), { upsert: [t1, t2, tPct] });
    expect(step1.jobs.map((j) => j.metricClass)).toStrictEqual(["percentage", "sample_size"]);
    const pk = pairKeyOf(t1.tupleId, t2.tupleId).pairKey;
    expect(step1.index.checks.get(pk)?.verdict).toBe("DETERMINISTIC_CONSISTENT");
    expect(queryLemmaCandidates(step1.index, t1)).toStrictEqual(["t-orphan-b"]);

    // Inject an unindexed tuple directly into tuples map only -> queryLemmaCandidates must ignore it
    const rogueTuple: B5Tuple = {
      ...t1,
      tupleId: "t-unindexed",
      sentenceHash: "s4",
      valueRaw: "99",
      valueNorm: 99,
    };
    const modifiedTuples = new Map(step1.index.tuples);
    modifiedTuples.set(rogueTuple.tupleId, rogueTuple);
    expect(
      queryLemmaCandidates({ ...step1.index, tuples: modifiedTuples }, t1),
    ).not.toContain("t-unindexed");

    // Delete t2 -> orphan b5_checks row pk MUST be deleted
    const step2 = applyB5IncrementalUpdate(step1.index, { remove: [t2.tupleId] });
    expect(step2.deletedOrphanPairKeys).toStrictEqual([pk]);
    expect(step2.index.checks.has(pk)).toBe(false);
  });
});

describe("conformance/l0/b5_baseline.json (03 §4.5–§4.6, Procedure 4)", () => {
  for (const tc of b5BaselineVectors.baselineCases) {
    it(`baseline: ${tc.id}`, () => {
      const a = tc.a as unknown as B5Tuple;
      const b = tc.b as unknown as B5Tuple;
      expect(classifyB5Baseline(a, b)).toBe(tc.expected);
      expect(classifyB5Baseline(b, a)).toBe(tc.expected);
    });
  }

  for (const tc of b5BaselineVectors.l1CheckCases) {
    it(`L1 check: ${tc.id}`, () => {
      expect(checkL1B5Output(tc.decoded as B5CheckV1)).toBe(tc.expectedVerdict);
    });
  }
});

describe("conformance/l0/b5_incremental.json (AC-L0-13c, Procedure 4)", () => {
  for (const seq of b5IncrementalVectors.sequences) {
    it(`incremental equivalence: ${seq.id}`, () => {
      let stateFwd = createB5Index();
      for (const batch of seq.stepsFwd) {
        const res = applyB5IncrementalUpdate(stateFwd, batch as unknown as B5MutationBatch);
        stateFwd = res.index;
        const full = recomputeB5Full(Array.from(stateFwd.tuples.values()));
        expect(res.keptPairs.map((p) => [p.tupleA, p.tupleB])).toStrictEqual(
          full.keptPairs.map((p) => [p.tupleA, p.tupleB]),
        );
      }

      let stateAlt = createB5Index();
      for (const batch of seq.stepsAlt) {
        const res = applyB5IncrementalUpdate(stateAlt, batch as unknown as B5MutationBatch);
        stateAlt = res.index;
        const fullAlt = recomputeB5Full(Array.from(stateAlt.tuples.values()));
        expect(res.keptPairs.map((p) => [p.tupleA, p.tupleB])).toStrictEqual(
          fullAlt.keptPairs.map((p) => [p.tupleA, p.tupleB]),
        );
      }

      expect(snapshotKeptTuples(stateFwd)).toStrictEqual(seq.expectedFinalKeptPairTuples);
      expect(snapshotKeptTuples(stateAlt)).toStrictEqual(seq.expectedFinalKeptPairTuples);
      expect(Array.from(stateFwd.checks.entries())).toStrictEqual(
        Array.from(stateAlt.checks.entries()),
      );
    });
  }

  it("evicts an older pair from its partner's top-3 on insert and restores it on delete", () => {
    const ev = b5IncrementalVectors.evictionCase;
    const init = applyB5IncrementalUpdate(createB5Index(), {
      upsert: ev.initialTuples as unknown as B5Tuple[],
    });
    const initPairs = init.keptPairs.map((p) => [p.tupleA, p.tupleB]);
    expect(initPairs).toContainEqual(ev.evictedPairTuples);

    const afterInsert = applyB5IncrementalUpdate(init.index, {
      upsert: [ev.evictingTuple as unknown as B5Tuple],
    });
    const insertPairs = afterInsert.keptPairs.map((p) => [p.tupleA, p.tupleB]);
    expect(insertPairs).not.toContainEqual(ev.evictedPairTuples);
    const fullAfterInsert = recomputeB5Full(Array.from(afterInsert.index.tuples.values()));
    expect(insertPairs).toStrictEqual(fullAfterInsert.keptPairs.map((p) => [p.tupleA, p.tupleB]));

    const afterDelete = applyB5IncrementalUpdate(afterInsert.index, {
      remove: [ev.evictingTuple.tupleId],
    });
    const deletePairs = afterDelete.keptPairs.map((p) => [p.tupleA, p.tupleB]);
    expect(deletePairs).toContainEqual(ev.evictedPairTuples);
    const fullAfterDelete = recomputeB5Full(Array.from(afterDelete.index.tuples.values()));
    expect(deletePairs).toStrictEqual(fullAfterDelete.keptPairs.map((p) => [p.tupleA, p.tupleB]));
  });
});
