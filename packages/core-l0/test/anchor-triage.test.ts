import { describe, expect, it } from "vitest";
import {
  bestWindow,
  reasoningConflict,
  vTok,
  validateAnchor,
  validateL2Verdict,
  validateLocalVerdict,
  type AnchorEvidenceUnit,
  type Stage2ValidatorInput,
} from "../src/anchor.js";
import { baselineTriage, mapAtomsToClauses } from "../src/triageBaseline.js";
import { sanitizeText } from "../src/sanitize.js";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return Object.freeze(value);
}

describe("Tier B anchor validator & triage baseline unit/edge tests", () => {
  it("snaps sanitized evidence offsets back to raw unit text via sanitizer offset map", () => {
    const rawUnit = "In\u200b randomized patients, mortality fell by 25% over 6 months.";
    const san = sanitizeText(rawUnit);
    expect(san.tier).toBe("clean");

    const unit: AnchorEvidenceUnit = deepFreeze({
      text: san.text,
      rawText: rawUnit,
      map: san.map,
      refId: "ref-san",
      sourceKind: "FULLTEXT",
      chunkId: "chunk-san-1",
    });

    const out: Stage2ValidatorInput = deepFreeze({
      s01_evidence_span: "mortality fell by 25% over 6 months",
      s02_evidence_idx: 0,
      s03_micro_reasoning: "Matches mortality reduction.",
      s04_verdict: "SUPPORTED",
    });

    const res = validateLocalVerdict(out, [unit], "Mortality fell by 25% over 6 months");
    expect(res.verdict).toBe("SUPPORTED");
    expect(res.anchor?.refId).toBe("ref-san");
    expect(res.anchor?.sourceKind).toBe("FULLTEXT");
    expect(res.anchor?.chunkId).toBe("chunk-san-1");
    expect(rawUnit.slice(res.anchor!.snapped.start, res.anchor!.snapped.end)).toBe(
      "mortality fell by 25% over 6 months",
    );
  });

  it("handles NEI with idx=-1 and empty span cleanly without failure", () => {
    const res = validateAnchor(
      {
        s01_evidence_span: "",
        s02_evidence_idx: -1,
        s03_micro_reasoning: "Not enough information.",
        s04_verdict: "NEI_SILENT_ESCALATE",
      },
      ["Some evidence text."],
      "Some claim",
      "L1",
    );
    expect(res.verdict).toBe("NEI_SILENT_ESCALATE");
    expect(res.anchor).toBeNull();
    expect(res.failReason).toBeNull();
  });

  it("applies reasoningConflict idioms and preceded-negation window accurately", () => {
    expect(reasoningConflict("This result does not contradict the claim.", "SUPPORTED")).toBe(false);
    expect(reasoningConflict("This result is not inconsistent with the claim.", "SUPPORTED")).toBe(false);
    expect(reasoningConflict("This finding contradicts the claim.", "SUPPORTED")).toBe(true);
    expect(reasoningConflict("This evidence supports the claim.", "CONTRADICTS")).toBe(true);
    expect(reasoningConflict("This evidence does not support the claim.", "CONTRADICTS")).toBe(false);
    expect(reasoningConflict("It is unclear whether X works.", "CONTRADICTS")).toBe(true);
    expect(reasoningConflict("Insufficient data.", "NEI_SILENT_ESCALATE")).toBe(false);
  });

  it("handles L2 NOT_IDENTIFIED, NONE, and auto-selecting matching block index", () => {
    const resNotId = validateL2Verdict(
      {
        s1_source_identified: "NOT_IDENTIFIED",
        s2_quote: "Drug X lowered pain by 30%.",
        s3_quote_origin: "PROVIDED_EVIDENCE",
        s4_reasoning: "Matches.",
        s5_verdict: "SUPPORTED",
        s6_alternatives: [],
      },
      ["Drug X lowered pain by 30%."],
      "Drug X lowered pain by 30%",
    );
    expect(resNotId.verdict).toBe("NEI");
    expect(resNotId.quote).toBeNull();

    const resNoneOrigin = validateL2Verdict(
      {
        s1_source_identified: "CITED_DOI_MATCHED",
        s2_quote: "Drug X lowered pain by 30%.",
        s3_quote_origin: "NONE",
        s4_reasoning: "Matches.",
        s5_verdict: "SUPPORTED",
        s6_alternatives: [],
      },
      ["Drug X lowered pain by 30%."],
      "Drug X lowered pain by 30%",
    );
    expect(resNoneOrigin.verdict).toBe("NEI");
    expect(resNoneOrigin.quote).toBeNull();
    expect(resNoneOrigin.quoteAnchor).toBeNull();

    const resSecondBlock = validateL2Verdict(
      {
        s1_source_identified: "CITED_DOI_MATCHED",
        s2_quote: "Drug X lowered pain by 30%",
        s3_quote_origin: "PROVIDED_EVIDENCE",
        s4_reasoning: "Matches pain reduction.",
        s5_verdict: "SUPPORTED",
        s6_alternatives: [],
      },
      ["Unrelated baseline demographics.", "In the trial, Drug X lowered pain by 30% at week 8."],
      "Drug X lowered pain by 30%",
    );
    expect(resSecondBlock.verdict).toBe("SUPPORTED");
    expect(resSecondBlock.quoteAnchor?.evidenceIdx).toBe(1);
    expect(resSecondBlock.quote).toBe("Drug X lowered pain by 30%");
  });

  it("respects exact CLAUSE_STOP_PUNCT (excludes periods in abbreviations like vs. and et al.)", () => {
    const abbrNeg = validateAnchor(
      {
        s01_evidence_span: "placebo lowered overall mortality",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["There was no benefit vs. placebo lowered overall mortality."],
      "placebo lowered overall mortality",
      "L1",
    );
    expect(abbrNeg.failReason).toBe("NEGATION_PARITY");

    const abbrEtAl = validateAnchor(
      {
        s01_evidence_span: "found significant mortality reduction",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches Smith et al.",
        s04_verdict: "SUPPORTED",
      },
      ["Smith et al. found significant mortality reduction."],
      "Smith et al. reported mortality reduction",
      "L1",
    );
    expect(abbrEtAl.verdict).toBe("SUPPORTED");
    expect(abbrEtAl.trace?.sharedStemsCount).toBeGreaterThanOrEqual(2);
  });

  it("keeps combining marks attached in vTok and preserves prefix currency symbols and LaTeX macros on origStart", () => {
    expect(vTok("The \u03b1\u0308beta word").tokens.map((t) => t.text)).toStrictEqual([
      "the",
      "\u03b1\u0308beta",
      "word",
    ]);

    const currencyRes = validateL2Verdict(
      {
        s1_source_identified: "CITED_DOI_MATCHED",
        s2_quote: "$50 was spent on care",
        s3_quote_origin: "PROVIDED_EVIDENCE",
        s4_reasoning: "Matches exact amount.",
        s5_verdict: "SUPPORTED",
        s6_alternatives: [],
      },
      ["$50 was spent on care."],
      "$50 was spent on care",
    );
    expect(currencyRes.verdict).toBe("SUPPORTED");
    expect(currencyRes.quoteAnchor?.snapped).toStrictEqual({ start: 0, end: 21 });
    expect(currencyRes.quote).toBe("$50 was spent on care");

    const latexRes = validateAnchor(
      {
        s01_evidence_span: "5 mg daily worked",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Dose matches.",
        s04_verdict: "SUPPORTED",
      },
      ["Dose \\SI{5}{\\milli\\gram} daily worked."],
      "Dose 5 mg daily worked",
      "L1",
    );
    expect(latexRes.verdict).toBe("SUPPORTED");
    expect(latexRes.anchor?.snapped).toStrictEqual({ start: 5, end: 37 });
    expect(latexRes.anchor?.snippet).toBe("\\SI{5}{\\milli\\gram} daily worked");
  });

  it("clamps gapComparators at clause stops and ignores -> / <- arrows", () => {
    const leftStopRes = validateAnchor(
      {
        s01_evidence_span: "y reduced pain scores",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["If x >, y reduced pain scores."],
      "y < 5 reduced pain scores",
      "L1",
    );
    expect(leftStopRes.trace?.dirDiff).toBe(false);

    const rightStopRes = validateAnchor(
      {
        s01_evidence_span: "y reduced pain scores",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["y reduced pain scores, < 5"],
      "y > 5 reduced pain scores",
      "L1",
    );
    expect(rightStopRes.trace?.dirDiff).toBe(false);

    const arrowRes = validateAnchor(
      {
        s01_evidence_span: "Drug A -> Drug B reduced pain",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches transition.",
        s04_verdict: "SUPPORTED",
      },
      ["Drug A -> Drug B reduced pain."],
      "Drug A <- Drug B reduced pain",
      "L1",
    );
    expect(arrowRes.verdict).toBe("SUPPORTED");
    expect(arrowRes.trace?.dirDiff).toBe(false);
  });

  it("handles zero-width characters and LaTeX substitutions in baselineTriage", () => {
    const zwCausal = baselineTriage({
      clauseText: "This caus\u200bes delay.",
      section: "discussion",
      hasResolvedCitation: false,
    });
    expect(zwCausal.claimType).toBe("CAUSAL");
    expect(zwCausal.worth).toBe("HIGH");
    expect(zwCausal.uncited).toBe(true);

    const zwMethod = baselineTriage({
      clauseText: "We us\u200bed this protocol.",
      section: "discussion",
      hasResolvedCitation: false,
    });
    expect(zwMethod.claimType).toBe("METHODOLOGICAL");

    const latexCausal = baselineTriage({
      clauseText: "This ca\\emph{us}es delay.",
      section: "discussion",
      hasResolvedCitation: false,
    });
    expect(latexCausal.claimType).toBe("CAUSAL");
    expect(latexCausal.uncited).toBe(true);
  });

  it("verifies distinct cue-derived metricClass values (dose vs other) in the same mass unit family", () => {
    const evTok = vTok("The daily dose was 50 mg of aspirin in adults.").tokens.find((t) => t.isNumeric);
    const clTok = vTok("Aspirin weight was 50 mg in adults").tokens.find((t) => t.isNumeric);
    expect(evTok?.unitFamily).toBe("mass");
    expect(clTok?.unitFamily).toBe("mass");
    expect(evTok?.metricFromUnit).toBe(false);
    expect(clTok?.metricFromUnit).toBe(false);
    expect(evTok?.metricClass).toBe("dose");
    expect(clTok?.metricClass).toBe("other");
  });

  it("maps Stage 1 atoms to clauses by majority word overlap with earlier-clause tie-break", () => {
    const mapped = mapAtomsToClauses(
      [
        { start: 0, end: 5, claimType: "QUANTITATIVE" },
        { start: 4, end: 7, claimType: "CAUSAL" }, // 2 words in clause 0 (4,5) and 2 in clause 1 (6,7) -> tie goes to clause 0
        { start: 8, end: 11, claimType: "COMPARATIVE" },
        { start: 15, end: 18, claimType: "EXISTENCE" }, // outside all clauses -> dropped
      ],
      [
        { start: 0, end: 5 },
        { start: 6, end: 12 },
      ],
    );
    expect(mapped[0]).toStrictEqual([
      { start: 0, end: 5, claimType: "QUANTITATIVE" },
      { start: 4, end: 7, claimType: "CAUSAL" },
    ]);
    expect(mapped[1]).toStrictEqual([{ start: 8, end: 11, claimType: "COMPARATIVE" }]);
  });

  it("stays strictly linear (median <= 5 ms on 10 KB inputs) for vTok, bestWindow, validateAnchor, and baselineTriage", () => {
    const unit10k = "The randomized trial evaluated adult patients across clinical sites. ".repeat(150);
    const span = "randomized trial evaluated adult patients across clinical sites";
    const out: Stage2ValidatorInput = {
      s01_evidence_span: "randomized trial ... clinical sites",
      s02_evidence_idx: 0,
      s03_micro_reasoning: "Aligned across clinical sites.",
      s04_verdict: "SUPPORTED",
    };

    const evTok = vTok(unit10k).tokens;
    const fTok = vTok(span).tokens;
    // Warm up
    for (let w = 0; w < 4; w += 1) {
      vTok(unit10k);
      bestWindow(evTok, fTok, 0);
      validateAnchor(out, [unit10k], "The randomized trial evaluated adult patients across clinical sites", "L1");
      baselineTriage({ clauseText: unit10k, section: "discussion", hasResolvedCitation: false });
    }

    const measureMedian = (fn: () => void): number => {
      const times: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const t0 = performance.now();
        fn();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return times[2]!;
    };

    expect(measureMedian(() => vTok(unit10k))).toBeLessThanOrEqual(5);
    expect(measureMedian(() => bestWindow(evTok, fTok, 0))).toBeLessThanOrEqual(5);
    expect(
      measureMedian(() =>
        validateAnchor(
          out,
          [unit10k],
          "The randomized trial evaluated adult patients across clinical sites",
          "L1",
        ),
      ),
    ).toBeLessThanOrEqual(5);
    expect(
      measureMedian(() =>
        baselineTriage({ clauseText: unit10k, section: "discussion", hasResolvedCitation: false }),
      ),
    ).toBeLessThanOrEqual(5);
  });
});
