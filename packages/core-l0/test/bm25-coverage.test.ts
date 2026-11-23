import { describe, expect, it } from "vitest";
import bm25MinCovJson from "../bm25_min_cov.json" with { type: "json" };
import {
  BM25_B,
  BM25_K1,
  BM25_MIN_COV,
  BM25_MIN_COV_CONFIG,
  DEFAULT_BM25_MIN_COV,
  buildB4Query,
  buildBm25Corpus,
  buildBm25Query,
  compareBm25Candidates,
  compareCodeUnits,
  computeClaimCoverage,
  computeIdf,
  computeQuantityBonus,
  extractQuantities,
  gridKey,
  isNumericBm25Token,
  isWordBm25Token,
  passesCoverageFilter,
  rankBm25Units,
  resolveBm25MinCov,
  scoreBm25Unit,
  selectEvidenceCandidates,
  tokBM25,
  type Bm25UnitInput,
} from "../src/index.js";

function medianMs(fn: () => void, warmup: number = 6, trials: number = 7): number {
  for (let w = 0; w < warmup; w++) {
    fn();
  }
  const times: number[] = [];
  for (let t = 0; t < trials; t++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

describe("bm25_min_cov.json & threshold resolution", () => {
  it("bundles default bm25_min_cov = 0.25 and detects Remote Config mismatches", () => {
    expect(bm25MinCovJson.bm25_min_cov).toBe(0.25);
    expect(BM25_MIN_COV).toBe(0.25);
    expect(DEFAULT_BM25_MIN_COV).toBe(0.25);
    expect(BM25_MIN_COV_CONFIG).toEqual(bm25MinCovJson);

    expect(resolveBm25MinCov()).toEqual({ value: 0.25, mismatch: false, code: null });
    expect(resolveBm25MinCov(0.25)).toEqual({ value: 0.25, mismatch: false, code: null });
    expect(resolveBm25MinCov(0.2500000001)).toEqual({
      value: 0.25,
      mismatch: false,
      code: null,
    });
    expect(resolveBm25MinCov(0.3)).toEqual({
      value: 0.25,
      mismatch: true,
      code: "BM25_MIN_COV_MISMATCH",
    });
    expect(resolveBm25MinCov(Number.NaN)).toEqual({
      value: 0.25,
      mismatch: true,
      code: "BM25_MIN_COV_MISMATCH",
    });
  });
});

describe("tokBM25 tokenization rules (02 §8.1)", () => {
  it("preserves negation words (not, no, nor, never, without) and deletes stopwords", () => {
    const tokens = tokBM25("We did not and cannot find no, nor never, without harm.");
    expect(tokens).toContain("not");
    expect(tokens).toContain("no");
    expect(tokens).toContain("nor");
    expect(tokens).toContain("never");
    expect(tokens).toContain("without");
    expect(tokens).not.toContain("we");
    expect(tokens).not.toContain("did");
    expect(tokens).not.toContain("and");
  });

  it("handles empty, punctuation-only, digit-only, and all-stopword inputs", () => {
    expect(tokBM25("")).toEqual([]);
    expect(tokBM25("   .,;:!?---()[]  ")).toEqual([]);
    expect(tokBM25("2019 2020")).toEqual([]);
    expect(tokBM25("the a an of in on at to for from by with and or but")).toEqual([]);
  });

  it("normalizes scientific numbers, percentages, signs, LaTeX, and citations", () => {
    expect(tokBM25("0.045")).toEqual(["#0.045"]);
    expect(tokBM25(".045")).toEqual(["#0.045"]);
    expect(tokBM25("30.0")).toEqual(["#30"]);
    expect(tokBM25("30%")).toEqual(["#30%"]);
    expect(tokBM25("30 percent")).toEqual(["#30%"]);
    expect(tokBM25("COVID-19 raised IL-6 by 1e-3")).toEqual([
      "covid",
      "#19",
      "rais",
      "il",
      "#6",
      "#0.001",
    ]);
    expect(tokBM25("Outcome was -0.2 overall (Smith et al., 2020).")).toEqual([
      "outcom",
      "#-0.2",
      "overal",
    ]);
    expect(tokBM25("\\SI{5}{\\milli\\gram} of X \\cite{k1,k2}")).toEqual(["#5", "mg", "x"]);
    expect(tokBM25("Mean was 12.5 (3.1) with 95% CI 1.1 to 2.3.")).toEqual([
      "mean",
      "#12.5",
      "ci",
      "#1.1",
      "#2.3",
    ]);
    expect(tokBM25("12.345", { lang: "de" })).toEqual(["#12345"]);
    expect(tokBM25("0,45", { lang: "de" })).toEqual(["#0.45"]);
    // Scientific braced negative exponent emits exactly one scalar token (not duplicated)
    expect(tokBM25("2.5 \u00d7 10^{-3}")).toEqual(["#0.0025"]);
    expect(tokBM25("1.5 \u00d7 10^{-3} to 3.0 \u00d7 10^{-3}")).toEqual(["#0.0015", "#0.003"]);
    // Percent point+interval and standalone CI preserve non-stopword labels (CI, IQR, range)
    expect(tokBM25("30% (95% CI 20%-40%)")).toEqual(["#30%", "#20%", "#40%", "ci"]);
    expect(tokBM25("95% CI 1.1% to 2.3%")).toEqual(["ci", "#1.1%", "#2.3%"]);
    expect(tokBM25("30% (IQR 20%-40%)")).toEqual(["#30%", "#20%", "#40%", "iqr"]);
    expect(tokBM25("30% (range 20%-40%)")).toEqual(["#30%", "#20%", "#40%", "rang"]);
    expect(tokBM25("30 percent and 25 per cent and 10 pct")).toEqual(["#30%", "#25%", "#10%"]);
    expect(tokBM25("We tested \\footnote{extra info} Drug X [1].")).toEqual(["test", "drug", "x"]);
  });

  it("handles Unicode normalization, combining marks, and token classification", () => {
    expect(tokBM25("Mu\u0308ller \u0130")).toEqual(["m\u00fcller", "\u0130"]);
    expect(tokBM25("Mor\u200btality")).toEqual(["mortal"]);
    expect(tokBM25("Mu\u200b\u0308ller")).toEqual(["mu\u0308ller"]);
    expect(isNumericBm25Token("#0.045")).toBe(true);
    expect(isNumericBm25Token("#30%")).toBe(true);
    expect(isNumericBm25Token("mortal")).toBe(false);
    expect(isWordBm25Token("mortal")).toBe(true);
    expect(isWordBm25Token("#30%")).toBe(false);
  });
});

describe("BM25 scoring, gridKey tie-breaking, and quantity bonus (02 §8.2, §8.6)", () => {
  it("computes gridKey deterministically and preserves transitivity", () => {
    expect(gridKey(-1)).toBe(0);
    expect(gridKey(0)).toBe(0);
    expect(gridKey(Number.NaN)).toBe(0);
    expect(gridKey(0.25)).toBe(250_000_000);
    expect(gridKey(0.2499999999)).toBe(250_000_000);
    expect(gridKey(0.2499999994)).toBe(249_999_999);
    expect(BM25_K1).toBe(1.2);
    expect(BM25_B).toBe(0.75);
    expect(compareCodeUnits("a", "b")).toBeLessThan(0);
    expect(compareCodeUnits("alpha", "alpha2")).toBeLessThan(0);
  });

  it("handles empty corpus, zero-length units, and unseen query terms safely", () => {
    const emptyCorpus = buildBm25Corpus([]);
    expect(emptyCorpus.docCount).toBe(0);
    expect(emptyCorpus.avgdl).toBe(0);
    expect(computeIdf(0, 0)).toBe(0);

    const corpus = buildBm25Corpus([
      { chunkId: "empty", refId: "r1", sourceKind: "ABSTRACT", ordinal: 0, text: "" },
      { chunkId: "nonempty", refId: "r1", sourceKind: "ABSTRACT", ordinal: 1, text: "alpha beta" },
    ]);
    const q = buildBm25Query("unseen");
    const ranked = rankBm25Units(corpus, q);
    expect(ranked[0]!.bm25).toBe(0);
    expect(ranked[1]!.bm25).toBe(0);
    expect(ranked.map((r) => r.unit.chunkId)).toEqual(["empty", "nonempty"]);
  });

  it("breaks gridKey ties by sourceKind then ordinal across all physical kinds", () => {
    const units: Bm25UnitInput[] = [
      { chunkId: "man", refId: "r1", sourceKind: "MANUSCRIPT", ordinal: 0, text: "alpha" },
      { chunkId: "lab", refId: "r1", sourceKind: "LAB_NOTE", ordinal: 0, text: "alpha" },
      { chunkId: "ptxt", refId: "r1", sourceKind: "PHYSICAL_TEXT", ordinal: 0, text: "alpha" },
      { chunkId: "ptbl", refId: "r1", sourceKind: "PHYSICAL_TABLE", ordinal: 0, text: "alpha" },
      { chunkId: "pdf", refId: "r1", sourceKind: "USER_PDF", ordinal: 0, text: "alpha" },
      { chunkId: "ft2", refId: "r1", sourceKind: "FULLTEXT", ordinal: 2, text: "alpha" },
      { chunkId: "ft1", refId: "r1", sourceKind: "FULLTEXT", ordinal: 1, text: "alpha" },
      { chunkId: "abs1", refId: "r1", sourceKind: "ABSTRACT", ordinal: 1, text: "alpha" },
      { chunkId: "abs0", refId: "r1", sourceKind: "ABSTRACT", ordinal: 0, text: "alpha" },
    ];
    const corpus = buildBm25Corpus(units);
    const query = buildBm25Query("alpha");
    const ranked = rankBm25Units(corpus, query);
    expect(ranked.map((r) => r.unit.chunkId)).toEqual([
      "abs0",
      "abs1",
      "ft1",
      "ft2",
      "pdf",
      "ptbl",
      "ptxt",
      "lab",
      "man",
    ]);
    // Verify antisymmetry on compareBm25Candidates
    expect(compareBm25Candidates(ranked[0]!, ranked[1]!)).toBeLessThan(0);
    expect(compareBm25Candidates(ranked[1]!, ranked[0]!)).toBeGreaterThan(0);
  });

  it("withholds quantity bonus for metricClass 'other', missing lemma, and incompatible unit family", () => {
    const claimNoClass = extractQuantities("Group recorded 42 units overall.");
    const unitSameNum = extractQuantities("Group recorded 99 units overall.");
    expect(claimNoClass[0]!.metricClass).toBe("other");
    expect(computeQuantityBonus(claimNoClass, unitSameNum)).toBe(0);

    const claimPct = extractQuantities("Mortality fell by 30%.");
    const unitProp = extractQuantities("Mortality was 0.30.");
    expect(computeQuantityBonus(claimPct, unitProp)).toBe(0);

    const unitSameLemmaPct = extractQuantities("Mortality increased to 45%.");
    expect(computeQuantityBonus(claimPct, unitSameLemmaPct)).toBe(1.0);
  });

  it("builds B4 library query with sentence prompt weight 1.0 and no coverage filter", () => {
    const b4 = buildB4Query("Drug X improved sleep quality [1].");
    expect(b4.weights.get("drug")).toBe(1.0);
    expect(b4.weights.get("sleep")).toBe(1.0);
    expect(b4.claimTokens).toEqual(["drug", "x", "improv", "sleep", "qualiti"]);
  });
});

describe("Coverage filter and Top-5 pool selection (02 §8.3, §8.5)", () => {
  it("applies exact gridKey threshold boundary and stems >= 2 override", () => {
    expect(passesCoverageFilter(0.2499999999, 1, 0.25)).toBe(true);
    expect(passesCoverageFilter(0.2499999994, 1, 0.25)).toBe(false);
    expect(passesCoverageFilter(0.01, 2, 0.25)).toBe(true);
    expect(passesCoverageFilter(0.0, 0, 0.25)).toBe(false);
  });

  it("picks top 3 ABSTRACT + top 2 FULLTEXT/USER_PDF and fills remaining slots including physical units", () => {
    const units: Bm25UnitInput[] = [
      { chunkId: "a0", refId: "r1", sourceKind: "ABSTRACT", ordinal: 0, text: "alpha beta" },
      { chunkId: "a1", refId: "r1", sourceKind: "ABSTRACT", ordinal: 1, text: "alpha gamma" },
      { chunkId: "a2", refId: "r1", sourceKind: "ABSTRACT", ordinal: 2, text: "alpha delta" },
      { chunkId: "a3", refId: "r1", sourceKind: "ABSTRACT", ordinal: 3, text: "alpha beta gamma" },
      { chunkId: "f0", refId: "r1", sourceKind: "FULLTEXT", ordinal: 0, text: "alpha beta gamma delta" },
      { chunkId: "p0", refId: "r1", sourceKind: "PHYSICAL_TABLE", ordinal: 0, text: "beta gamma" },
    ];
    const corpus = buildBm25Corpus(units);
    const query = buildBm25Query("alpha beta gamma delta");
    const sel = selectEvidenceCandidates(corpus, "r1", query);

    // 4 abstracts + 1 fulltext + 1 physical -> top 3 ABSTRACT (a3, a2, a1 or top 3 by score) + 1 FULLTEXT (f0) + fill 1 from remaining (4th abstract or physical depending on score)
    expect(sel.candidates).toBe(5);
    expect(sel.selected.some((s) => s.unit.chunkId === "f0")).toBe(true);
    // Verify result is sorted by compareBm25Candidates
    for (let i = 1; i < sel.selected.length; i++) {
      expect(compareBm25Candidates(sel.selected[i - 1]!, sel.selected[i]!)).toBeLessThanOrEqual(0);
    }

    // Physical unit enters fill pool when abstract + fulltext < 5
    const corpusWithPhys = buildBm25Corpus([
      { chunkId: "a0", refId: "r2", sourceKind: "ABSTRACT", ordinal: 0, text: "alpha beta" },
      { chunkId: "p0", refId: "r2", sourceKind: "PHYSICAL_TABLE", ordinal: 0, text: "alpha gamma" },
    ]);
    const selPhys = selectEvidenceCandidates(corpusWithPhys, "r2", buildBm25Query("alpha beta gamma"));
    expect(selPhys.selected.map((s) => s.unit.chunkId)).toContain("p0");
  });

  it("handles sanitizer blocker hook: excludes blocked units and sets suspicious = true", () => {
    const corpus = buildBm25Corpus([
      { chunkId: "clean-1", refId: "r1", sourceKind: "ABSTRACT", ordinal: 0, text: "alpha beta" },
      { chunkId: "bad-1", refId: "r1", sourceKind: "ABSTRACT", ordinal: 1, text: "alpha beta gamma" },
    ]);
    const query = buildBm25Query("alpha beta gamma");
    const res = selectEvidenceCandidates(corpus, "r1", query, {
      isUnitBlocked: (u) => u.chunkId === "bad-1",
    });
    expect(res.suspicious).toBe(true);
    expect(res.candidates).toBe(1);
    expect(res.selected.map((s) => s.unit.chunkId)).toEqual(["clean-1"]);

    // All candidates blocked -> candidates = 0, suspicious = true (02 §9.5)
    const allBlocked = selectEvidenceCandidates(corpus, "r1", query, {
      isUnitBlocked: () => true,
    });
    expect(allBlocked.suspicious).toBe(true);
    expect(allBlocked.candidates).toBe(0);
    expect(allBlocked.selected).toEqual([]);
  });

  it("ignores context-only terms in cov(c, d) while scoring them at weight 0.5", () => {
    const corpus = buildBm25Corpus([
      { chunkId: "d1", refId: "r1", sourceKind: "ABSTRACT", ordinal: 0, text: "contextone contexttwo" },
      { chunkId: "d2", refId: "r1", sourceKind: "ABSTRACT", ordinal: 1, text: "claimterm contextone" },
    ]);
    const query = buildBm25Query("claimterm", "contextone contexttwo claimterm");
    expect(query.weights.get("claimterm")).toBe(1.0);
    expect(query.weights.get("contexton")).toBe(0.5);
    expect(query.weights.get("contexttwo")).toBe(0.5);

    const cov1 = computeClaimCoverage(query.claimWordTerms, corpus.units[0]!.tokenSet, corpus);
    expect(cov1.cov).toBe(0);
    expect(cov1.kept).toBe(false);

    const cov2 = computeClaimCoverage(query.claimWordTerms, corpus.units[1]!.tokenSet, corpus);
    expect(cov2.cov).toBe(1);
    expect(cov2.kept).toBe(true);

    const score1 = scoreBm25Unit(corpus, query, corpus.units[0]!);
    expect(score1.bm25).toBeGreaterThan(0);
  });
});

describe("AC-L0-15 linear-time latency on 10 KB adversarial inputs", () => {
  it("tokenizes and scores 10 KB adversarial strings within <= 5 ms median", () => {
    const inputs: readonly string[] = [
      "(".repeat(10_000),
      "[".repeat(10_000),
      "\\cite{".repeat(1_666),
      "12,345 ".repeat(1_428),
      "Drug X reduced mortality by 30% [1]. ".repeat(270),
      "the and of in on at ".repeat(500),
    ];

    for (const text of inputs) {
      const tokMs = medianMs(() => {
        tokBM25(text);
      });
      expect(tokMs).toBeLessThanOrEqual(5);
    }

    const longUnits: Bm25UnitInput[] = [];
    for (let i = 0; i < 50; i++) {
      longUnits.push({
        chunkId: `u-${i}`,
        refId: `r-${i % 10}`,
        sourceKind: "ABSTRACT",
        ordinal: i,
        text: "Drug X reduced mortality by 30% in randomized cohorts with low bleeding.",
      });
    }
    const corpus = buildBm25Corpus(longUnits);
    const query = buildBm25Query(
      "Drug X reduced mortality by 30%",
      "In randomized cohorts, Drug X reduced mortality by 30%.",
    );
    const rankMs = medianMs(() => {
      rankBm25Units(corpus, query);
    });
    expect(rankMs).toBeLessThanOrEqual(5);
  });
});
