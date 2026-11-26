import { describe, expect, it } from "vitest";
import {
  applyB5IncrementalUpdate,
  classifyB5Baseline,
  computeB5InconsistentWith,
  consistentValues,
  createB5Index,
  createB5PartnerResolver,
  decimalsOf,
  extractDocumentTablesB5Tuples,
  extractLabNoteB5Tuples,
  extractProseB5Tuples,
  jaccardFixed,
  pCompatible,
  pairKeyOf,
  recordB5L1Check,
  recomputeB5Full,
  resolveEffectiveB5Outcome,
  sectionDistance,
  splitB5JobInHalf,
  splitB5JobsByMetricClass,
  type B5Tuple,
} from "../src/b5pairing.js";
import {
  BUNDLED_SAMPLE_PRIVACY_CONTEXT,
  applyEvent,
  computeCoverageMeter,
  createInitialLedgerState,
  derive,
  type ClaimLedgerEntry,
  type PolicySnapshot,
  type SessionFacts,
} from "../src/ledger.js";
import { preMask } from "../src/mask.js";
import { sha256hex } from "../src/norm.js";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return Object.freeze(value);
}

describe("B5 pairing engine, table/prose/lab-note extraction, E13 integration, and performance", () => {
  it("runs AC-L0-13(a) & (b) end-to-end from raw manuscript text", () => {
    const methods = extractProseB5Tuples({
      docId: "doc-1",
      claimId: "c-methods",
      text: "We enrolled sample size n = 48 adult migraine patients across clinical trial centers.",
      section: "Methods",
    });
    const abstract = extractProseB5Tuples({
      docId: "doc-1",
      claimId: "c-abstract",
      text: "Enrolled sample size was n = 48.0 adult migraine patients across clinical trial centers.",
      section: "Abstract",
    });
    expect(methods).toHaveLength(1);
    expect(abstract).toHaveLength(1);
    expect(consistentValues(methods[0]!, abstract[0]!)).toBe(true);

    const res = applyB5IncrementalUpdate(createB5Index(), {
      upsert: [...methods, ...abstract],
    });
    expect(res.keptPairs).toHaveLength(0);
    expect(res.enqueuePairs).toHaveLength(0);
    const pk = pairKeyOf(methods[0]!.tupleId, abstract[0]!.tupleId).pairKey;
    expect(res.index.checks.get(pk)?.verdict).toBe("DETERMINISTIC_CONSISTENT");

    // 37% vs 0.37 sharing key lemmas never pair (`sameFamily("%", "") === false`)
    const pct = extractProseB5Tuples({
      docId: "doc-2",
      claimId: "c-pct",
      text: "Mortality reduction in treated cohort was 37%.",
      section: "Results",
    });
    const bare = extractProseB5Tuples({
      docId: "doc-2",
      claimId: "c-bare",
      text: "Mortality reduction in treated cohort was 0.37.",
      section: "Abstract",
    });
    const resDiffFam = applyB5IncrementalUpdate(createB5Index(), { upsert: [...pct, ...bare] });
    expect(resDiffFam.keptPairs).toHaveLength(0);
    expect(resDiffFam.index.checks.size).toBe(0);
  });

  it("extracts Markdown pipe tables and LaTeX tabular tables (with \\hline / \\multicolumn) and pairs with prose", () => {
    const mdDoc = [
      "# Results",
      "",
      "Mortality in the active arm reached 18.2% at week 12.",
      "",
      "| Cohort | Mortality |",
      "| --- | --- |",
      "| Active arm | 12.1% |",
      "| Placebo arm | 14.0% |",
    ].join("\n");

    const mdMasked = preMask(mdDoc, "md");
    expect(mdMasked.tables).toHaveLength(1);
    const mdTableTuples = extractDocumentTablesB5Tuples(mdDoc, "md", "doc-md");
    expect(mdTableTuples.length).toBeGreaterThanOrEqual(2);
    expect(mdTableTuples.every((t) => t.claimId === null)).toBe(true);

    const mdProse = extractProseB5Tuples({
      docId: "doc-md",
      claimId: "c-prose-active",
      text: "Mortality in the active arm reached 18.2% at week 12.",
      section: "Abstract",
      format: "md",
    });
    const combinedMd = applyB5IncrementalUpdate(createB5Index(), {
      upsert: [...mdProse, ...mdTableTuples],
    });
    expect(combinedMd.keptPairs.length).toBeGreaterThanOrEqual(1);
    expect(sectionDistance("Abstract", mdTableTuples[0]!.section)).toBe(1);

    const texDoc = [
      "\\section{Results}",
      "\\begin{tabular}{lcc}",
      "\\toprule",
      "Group & \\multicolumn{2}{c}{Remission} \\\\",
      "\\midrule",
      "Active drug & 45\\% & 48 patients \\\\",
      "\\bottomrule",
      "\\end{tabular}",
    ].join("\n");
    const texTuples = extractDocumentTablesB5Tuples(texDoc, "latex", "doc-tex");
    expect(texTuples.length).toBeGreaterThanOrEqual(2);
    expect(texTuples[0]!.keyLemmas).toContain("remiss");
    expect(texTuples[0]!.windowText).toContain("Active drug");
  });

  it("supports O3 lab-note tuples, L1 B5CheckV1 validation, and E13 B5Changed ledger integration without affecting clause buckets", () => {
    const photoHash = sha256hex("lab-note-photo-1");
    const lab = extractLabNoteB5Tuples({
      docId: "doc-lab",
      ocrText: "Cohort size in adult active trial arm was 46 patients.",
      photoSha256: photoHash,
    });
    expect(lab).toHaveLength(1);
    expect(lab[0]!.source).toBe("lab_note");
    expect(lab[0]!.section).toBe(`lab:${photoHash.slice(0, 12)}`);

    const ms = extractProseB5Tuples({
      docId: "doc-lab",
      claimId: "c-ms-1",
      text: "Cohort size in adult active trial arm was 48 patients.",
      section: "Results",
    });
    const ms2 = extractProseB5Tuples({
      docId: "doc-lab",
      claimId: "c-ms-2",
      text: "Cohort size in adult active trial arm was 52 patients.",
      section: "Abstract",
    });

    const paired = applyB5IncrementalUpdate(createB5Index(), { upsert: [...ms, ...ms2, ...lab] });
    expect(paired.keptPairs.length).toBeGreaterThanOrEqual(1);

    const l1Recorded = recordB5L1Check(
      paired.index,
      ms[0]!.tupleId,
      ms2[0]!.tupleId,
      {
        s1_what: "Cohort size of active adult trial arm in Results vs Abstract.",
        s2_same_population: true,
        s3_verdict: "INCONSISTENT",
      },
      1000,
    );
    expect(l1Recorded.record.verdict).toBe("INCONSISTENT");
    expect(l1Recorded.changedClaimIds).toStrictEqual(["c-ms-1", "c-ms-2"]);

    expect(computeB5InconsistentWith(l1Recorded.index, "c-ms-1", "authoritative")).toStrictEqual([
      "c-ms-2",
    ]);
    expect(
      resolveEffectiveB5Outcome(ms[0]!, ms2[0]!, l1Recorded.record, "authoritative").badgeKind,
    ).toBe("MANUSCRIPT_MISMATCH");

    // Verify E13 ledger integration leaves clause bucket/state untouched and updates numberMismatches
    const sh1 = sha256hex("s1");
    const sh2 = sha256hex("s2");
    const policy: PolicySnapshot = {
      deviceProfile: "web_chrome_nano",
      b4CountsAsReview: true,
      profiles: {
        web_chrome_nano: {
          path: "A",
          authority: { B1: "authoritative", B2: "authoritative", B3: "authoritative", B5: "authoritative", O2: "advisory" },
          supportVerdicts: "authoritative",
          calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
        },
      },
    };
    const session: SessionFacts = { localUnavailable: false, transient: new Map() };
    const makeEntry = (claimId: string, text: string, section: string, sentenceHash: string): ClaimLedgerEntry => ({
      claimId,
      docId: "doc-lab",
      sentenceHash,
      occurrenceIndex: 0,
      clauseIndex: 0,
      section,
      subsection: null,
      span: { start: 0, end: text.length },
      claimText: text,
      normalizedClaimHash: sha256hex(text),
      baseline: { atoms: [{ start: 0, end: 5, claimType: "QUANTITATIVE" }], worth: "HIGH", claimType: "QUANTITATIVE", uncited: true },
      stage1: null,
      citationKeys: [],
      possibleCitations: [],
      refs: [],
      heldNei: { value: null, seq: 0 },
      job: { value: false, seq: 0 },
      l0Error: null,
      b5: { inconsistentWith: [] },
      labNoteMismatch: [],
      suggestedRefIds: [],
      override: { value: null, seq: 0 },
      archived: false,
      updatedAt: 1700000000000,
    });
    let ledger = createInitialLedgerState({ policy });
    ledger = applyEvent(ledger, {
      type: "ClauseCreated",
      entry: makeEntry("c-ms-1", "Cohort size was 48 patients.", "discussion", sh1),
    });
    ledger = applyEvent(ledger, {
      type: "ClauseCreated",
      entry: makeEntry("c-ms-2", "Cohort size was 52 patients.", "discussion", sh2),
    });
    const resolver = createB5PartnerResolver(l1Recorded.index, "authoritative");
    const entry1Before = ledger.entries.get("c-ms-1")!;
    const d1Before = derive(entry1Before, ledger.refFacts, policy, BUNDLED_SAMPLE_PRIVACY_CONTEXT, session);
    ledger = applyEvent(
      ledger,
      { type: "B5Changed", claimIds: ["c-ms-1", "c-ms-2"] },
      { b5Resolver: (id) => resolver(id) },
    );

    const entry1 = ledger.entries.get("c-ms-1")!;
    const d1After = derive(entry1, ledger.refFacts, policy, BUNDLED_SAMPLE_PRIVACY_CONTEXT, session);
    expect(d1After.state).toBe(d1Before.state);
    expect(d1After.category).toBe(d1Before.category);
    expect(entry1.b5.inconsistentWith).toStrictEqual(["c-ms-2"]);
    const meter = computeCoverageMeter(ledger, BUNDLED_SAMPLE_PRIVACY_CONTEXT, session);
    expect(meter.numberMismatches).toBe(2);
    expect(meter.total).toBe(2);
  });

  it("handles watchdog job halving, decimal/scientific rounding, advisory vs authoritative, and never mutates frozen inputs", () => {
    expect(decimalsOf("48")).toBe(0);
    expect(decimalsOf("48.0")).toBe(1);
    expect(decimalsOf("1,234")).toBe(0);
    expect(decimalsOf("12,345", 12.345)).toBe(3);
    expect(decimalsOf("1.2e-3")).toBe(4);
    expect(jaccardFixed(["a", "b"], ["a", "b"])).toBe(1_000_000_000);

    const sampleTuples: B5Tuple[] = deepFreeze([
      {
        tupleId: "z1",
        docId: "d",
        claimId: "c1",
        sentenceHash: "s1",
        occurrence: 0,
        section: "results",
        metricClass: "sample_size",
        keyLemmas: ["adult", "cohort"],
        valueRaw: "10",
        valueNorm: 10,
        valueLo: null,
        valueHi: null,
        sigDigits: 1,
        pComparator: null,
        unitRaw: "",
        unitCanon: "count",
        source: "manuscript",
        span: { start: 0, end: 2 },
        windowText: "10 adult cohort.",
      },
      {
        tupleId: "z2",
        docId: "d",
        claimId: "c2",
        sentenceHash: "s2",
        occurrence: 0,
        section: "discussion",
        metricClass: "sample_size",
        keyLemmas: ["adult", "cohort"],
        valueRaw: "20",
        valueNorm: 20,
        valueLo: null,
        valueHi: null,
        sigDigits: 1,
        pComparator: null,
        unitRaw: "",
        unitCanon: "count",
        source: "manuscript",
        span: { start: 0, end: 2 },
        windowText: "20 adult cohort.",
      },
      {
        tupleId: "z3",
        docId: "d",
        claimId: "c3",
        sentenceHash: "s3",
        occurrence: 0,
        section: "methods",
        metricClass: "sample_size",
        keyLemmas: ["adult", "cohort"],
        valueRaw: "30",
        valueNorm: 30,
        valueLo: null,
        valueHi: null,
        sigDigits: 1,
        pComparator: null,
        unitRaw: "",
        unitCanon: "count",
        source: "manuscript",
        span: { start: 0, end: 2 },
        windowText: "30 adult cohort.",
      },
    ]) as unknown as B5Tuple[];

    const jobs = splitB5JobsByMetricClass(sampleTuples);
    expect(jobs).toHaveLength(1);
    const split = splitB5JobInHalf(jobs[0]!);
    expect(split).not.toBeNull();
    expect(split![0].affectedTupleIds).toHaveLength(2);
    expect(split![1].affectedTupleIds).toHaveLength(1);
    expect(splitB5JobInHalf(split![1])).toBeNull();

    const base = deepFreeze(createB5Index());
    const r = applyB5IncrementalUpdate(base, deepFreeze({ upsert: sampleTuples }));
    expect(r.index.tuples.size).toBe(3);

    // Advisory uses baseline regardless of L1 INCONSISTENT when sectionDistance = 2
    expect(classifyB5Baseline(sampleTuples[0]!, sampleTuples[1]!)).toBe("DIFFERENT_QUANTITY");
    const adv = resolveEffectiveB5Outcome(
      sampleTuples[0]!,
      sampleTuples[1]!,
      {
        pairKey: pairKeyOf("z1", "z2").pairKey,
        tupleA: "z1",
        tupleB: "z2",
        verdict: "INCONSISTENT",
        provenance: "ON_DEVICE",
      },
      "advisory",
    );
    expect(adv.showBadge).toBe(false);
    expect(adv.detailKind).toBe("ADVISORY_ASSESSMENT");

    const full = recomputeB5Full(sampleTuples);
    expect(r.keptPairs).toStrictEqual(full.keptPairs);
  });

  it("handles German dot-thousands, scientific x10^ exponents, range decimals, inline math $n=48$, unit symbols in windowText, and reused tupleId section/eligibility mutations", () => {
    // 1. German dot-thousands & scientific notation `× 10^` & range decimals
    expect(decimalsOf("12.345", 12345)).toBe(0);
    expect(decimalsOf("1.234.567", 1234567)).toBe(0);
    expect(decimalsOf("1.234,5", 1234.5)).toBe(1);
    expect(decimalsOf("2 × 10^-3", 0.002)).toBe(3);
    expect(decimalsOf("2.5 × 10^3", 2500)).toBe(0);
    expect(decimalsOf("1.25–3")).toBe(2);

    const deA = extractProseB5Tuples({
      docId: "doc-de",
      claimId: "c1",
      text: "Dosage in cohort A was 12.345 mg daily.",
      section: "Results",
      lang: "de",
    })[0]!;
    const deB = extractProseB5Tuples({
      docId: "doc-de",
      claimId: "c2",
      text: "Dosage in cohort A was 12345.4 mg daily.",
      section: "Abstract",
      lang: "en",
    })[0]!;
    expect(consistentValues(deA, deB)).toBe(true);

    const sciSmall = extractProseB5Tuples({
      docId: "doc-sci",
      claimId: "c1",
      text: "Concentration reached 2 × 10^-3 mg in serum.",
      section: "Results",
    })[0]!;
    const sciWrong = extractProseB5Tuples({
      docId: "doc-sci",
      claimId: "c2",
      text: "Concentration reached 0.4 mg in serum.",
      section: "Abstract",
    })[0]!;
    expect(consistentValues(sciSmall, sciWrong)).toBe(false);

    // 2. Inline math `$n=48$` -> `n=48`, siunitx `\qty{50}{mg}`, and `%`/`$` preserved in windowText
    const mathProse = extractProseB5Tuples({
      docId: "doc-math",
      claimId: "c-math",
      text: "We enrolled $n=48$ patients in the cohort.",
      section: "Methods",
      format: "latex",
    })[0]!;
    expect(mathProse.unitCanon).toBe("count");
    expect(mathProse.metricClass).toBe("sample_size");
    expect(mathProse.windowText).toBe("We enrolled n=48 patients in the cohort");

    const pctProse = extractProseB5Tuples({
      docId: "doc-sym",
      claimId: "c-pct",
      text: "Mortality reduction in treated cohort was 37%.",
      section: "Results",
    })[0]!;
    expect(pctProse.windowText).toBe("Mortality reduction in treated cohort was 37%");

    const usdProse = extractProseB5Tuples({
      docId: "doc-sym",
      claimId: "c-usd",
      text: "$50 was spent on patient care.",
      section: "Results",
    })[0]!;
    expect(usdProse.windowText).toBe("$50 was spent on patient care");

    const qtyProse = extractProseB5Tuples({
      docId: "doc-sym",
      claimId: "c-qty",
      text: "Mean dose was \\qty{50}{mg} daily.",
      section: "Results",
      format: "latex",
    })[0]!;
    expect(qtyProse.unitCanon).toBe("mg");
    expect(qtyProse.windowText).toBe("Mean dose was 50 mg daily");

    // 3. Reused `tupleId`: section mutation emits `changedClaimIds` and stale DETERMINISTIC_CONSISTENT is cleared when eligibility drops
    const tBaseA: B5Tuple = {
      tupleId: "reused-a",
      docId: "doc-r",
      claimId: "claim-r-a",
      sentenceHash: "sh-r-a",
      occurrence: 0,
      section: "abstract",
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
      windowText: "48 adult cohort.",
    };
    const tBaseB: B5Tuple = {
      ...tBaseA,
      tupleId: "reused-b",
      claimId: "claim-r-b",
      sentenceHash: "sh-r-b",
      section: "results",
      valueRaw: "60",
      valueNorm: 60,
      windowText: "60 adult cohort.",
    };
    const rStep1 = applyB5IncrementalUpdate(createB5Index(), { upsert: [tBaseA, tBaseB] });
    expect(classifyB5Baseline(tBaseA, tBaseB)).toBe("INCONSISTENT");
    const tMutSec: B5Tuple = { ...tBaseA, section: "methods" };
    const rStep2 = applyB5IncrementalUpdate(rStep1.index, { upsert: [tMutSec] });
    expect(rStep2.keptPairs[0]!.sectionDistance).toBe(2);
    expect(classifyB5Baseline(tMutSec, tBaseB)).toBe("DIFFERENT_QUANTITY");
    expect(rStep2.changedClaimIds).toStrictEqual(["claim-r-a", "claim-r-b"]);
    expect(rStep2.changedPairKeys).toHaveLength(1);

    const tEqB: B5Tuple = { ...tBaseB, valueRaw: "48.0", valueNorm: 48 };
    const rCon1 = applyB5IncrementalUpdate(createB5Index(), { upsert: [tBaseA, tEqB] });
    const conPk = pairKeyOf(tBaseA.tupleId, tEqB.tupleId).pairKey;
    expect(rCon1.index.checks.get(conPk)?.verdict).toBe("DETERMINISTIC_CONSISTENT");
    const rConDrop = applyB5IncrementalUpdate(rCon1.index, {
      upsert: [{ ...tBaseA, keyLemmas: ["x1", "x2", "x3", "x4", "x5"] }],
    });
    expect(rConDrop.index.checks.has(conPk)).toBe(false);
    expect(rConDrop.changedClaimIds).toStrictEqual(["claim-r-a", "claim-r-b"]);

    // Regression: zero-valued 3-decimal literals ("0.000", "0,000", "-0.000", "p=0.000") preserve 3 decimal places
    expect(decimalsOf("0.000", 0)).toBe(3);
    expect(decimalsOf("-0.000", 0)).toBe(3);
    expect(decimalsOf("0,000", 0)).toBe(3);
    expect(decimalsOf("0,000")).toBe(3);
    expect(decimalsOf("00.000", 0)).toBe(3);
    expect(decimalsOf("0.000")).toBe(3);
    expect(decimalsOf("1.000", 1000)).toBe(0);
    expect(decimalsOf("1.000", 1)).toBe(3);
    expect(decimalsOf("1,234", 1234)).toBe(0);
    expect(decimalsOf("1,234")).toBe(0);
    expect(decimalsOf("1,250e-2", 0.0125)).toBe(5);

    const tZero3: B5Tuple = {
      ...tBaseA,
      tupleId: "z-a",
      claimId: "claim-z-a",
      sentenceHash: "sh-z-a",
      valueRaw: "0.000",
      valueNorm: 0,
      unitRaw: "mg",
      unitCanon: "mg",
      metricClass: "dose",
    };
    const tPoint4: B5Tuple = {
      ...tZero3,
      tupleId: "z-b",
      claimId: "claim-z-b",
      sentenceHash: "sh-z-b",
      valueRaw: "0.4",
      valueNorm: 0.4,
    };
    const tPoint0004: B5Tuple = {
      ...tZero3,
      tupleId: "z-c",
      claimId: "claim-z-c",
      sentenceHash: "sh-z-c",
      valueRaw: "0.0004",
      valueNorm: 0.0004,
    };
    expect(consistentValues(tZero3, tPoint4)).toBe(false);
    expect(consistentValues(tZero3, tPoint0004)).toBe(true);

    const pZero3: B5Tuple = {
      ...tZero3,
      metricClass: "p_value",
      pComparator: "=",
      unitRaw: "",
      unitCanon: "dimensionless",
    };
    const pPoint4: B5Tuple = {
      ...pZero3,
      tupleId: "z-p-b",
      claimId: "claim-z-p-b",
      sentenceHash: "sh-z-p-b",
      valueRaw: "0.4",
      valueNorm: 0.4,
    };
    expect(pCompatible(pZero3, pPoint4)).toBe(false);
    expect(consistentValues(pZero3, pPoint4)).toBe(false);
  });

  it("stays strictly linear (median <= 5 ms on 10 KB prose/table input & 200-tuple incremental update, AC-L0-15)", () => {
    const row =
      "| Multicenter randomized adult migraine outpatient cohort | 48.2% | 120 patients | tertiary care center |\n";
    const bigTable = [
      "| Study Group | Mortality Rate | Sample | Clinical Setting |",
      "| --- | --- | --- | --- |",
      row.repeat(94),
    ].join("\n");
    const bigProse = "We enrolled 48 adult patients and observed 12.5% mortality across sites. ".repeat(140);
    expect(bigTable.length).toBeGreaterThanOrEqual(10_000);
    expect(bigProse.length).toBeGreaterThanOrEqual(10_000);

    // Build a 200-tuple B5 index
    const tuples200: B5Tuple[] = [];
    for (let i = 0; i < 200; i += 1) {
      const idxStr = String(i).padStart(4, "0");
      tuples200.push({
        tupleId: `t-${idxStr}`,
        docId: "doc-perf",
        claimId: `c-${idxStr}`,
        sentenceHash: `sh-${idxStr}`,
        occurrence: 0,
        section: i % 2 === 0 ? "results" : "methods",
        metricClass: "sample_size",
        keyLemmas: [`topic${String(i % 40)}`, `cohort${String(i % 40)}`, `arm${String(i % 20)}`],
        valueRaw: String(100 + (i % 5)),
        valueNorm: 100 + (i % 5),
        valueLo: null,
        valueHi: null,
        sigDigits: 2,
        pComparator: null,
        unitRaw: "",
        unitCanon: "count",
        source: "manuscript",
        span: { start: 0, end: 3 },
        windowText: "Cohort enrolled adult patients.",
      });
    }
    const base200 = applyB5IncrementalUpdate(createB5Index(), { upsert: tuples200 }).index;
    const oneUpsert: B5Tuple = {
      ...tuples200[0]!,
      tupleId: "t-9999",
      claimId: "c-9999",
      sentenceHash: "sh-9999",
      valueRaw: "199",
      valueNorm: 199,
    };

    // Warmup
    for (let w = 0; w < 5; w += 1) {
      extractProseB5Tuples({ docId: "dp", claimId: "cp", text: bigProse, section: "Results" });
      extractDocumentTablesB5Tuples(bigTable, "md", "dt");
      applyB5IncrementalUpdate(base200, { upsert: [oneUpsert] });
    }

    const medianMs = (fn: () => void): number => {
      const times: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const t0 = performance.now();
        fn();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return times[2]!;
    };

    expect(
      medianMs(() => extractProseB5Tuples({ docId: "dp", claimId: "cp", text: bigProse, section: "Results" })),
    ).toBeLessThanOrEqual(5);
    expect(medianMs(() => extractDocumentTablesB5Tuples(bigTable, "md", "dt"))).toBeLessThanOrEqual(5);
    expect(medianMs(() => applyB5IncrementalUpdate(base200, { upsert: [oneUpsert] }))).toBeLessThanOrEqual(
      5,
    );
  });
});
