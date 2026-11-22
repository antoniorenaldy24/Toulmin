import { describe, expect, it } from "vitest";
import {
  applyLatexSubstitutions,
  extractCorporateInitials,
  foldLatin,
  mathText,
  norm,
  normLower,
  normSentence,
  partitionClausesWithTrace,
  preMask,
  resolveCitationMarkers,
  scanCitations,
  SectionTracker,
  segmentDocument,
} from "../src/index.js";

/**
 * Meta-test running complete end-to-end Tier A algorithms over ALL normative
 * worked examples implemented so far in `docs/spec/02_L0_TIER_A_PRE_DECODE.md`
 * (§2–§6, spec §1.3 & `AC-L0-24`).
 */
describe("examples.meta.test.ts — 02 §2–§6 normative examples (AC-L0-24)", () => {
  it("§2 normalization: decomposed umlaut, foldLatin, U+0130, zero-width preservation/deletion, and Lancet middle dot", () => {
    expect(norm("Mu\u0308ller").text).toBe("M\u00fcller");
    expect(foldLatin("M\u00fcller")).toBe("Muller");
    expect(normLower("\u0130")).toBe("\u0130"); // Turkic dotted I preserved by lower_overrides
    expect(norm("mor\u200btality").text).toBe("mortality");
    expect(norm("\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645").text).toBe(
      "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645",
    );
    expect(norm("\ud83d\udc69\u200d\ud83d\udd2c").text).toBe("\ud83d\udc69\u200d\ud83d\udd2c");
    expect(norm("0\u00b745").text).toBe("0.45");
    expect(norm("1.2\u00b710\u207b\u00b3").text).toBe("1.2\u00d710^-3");
  });

  it("§3 pre-masking, mathText, LaTeX substitutions, and section hierarchy", () => {
    expect(mathText("p < 0.05")).toBe("p < 0.05");
    expect(mathText("\\frac{a}{b} + \\sqrt{x}")).toBe("(a)/(b) + sqrt(x)");

    const latex = applyLatexSubstitutions(
      "\\ce{CO2}, \\gls{CI}, \\cellcolor{gray}{12}, \\newline end",
    );
    expect(latex.text).toBe("CO2, CI, 12,  end");

    const mdCurrency = preMask("Cost was $5 per dose and $10 per visit.", "md");
    expect(mdCurrency.mathRegions).toHaveLength(0);
    expect(mdCurrency.maskedText).toBe("Cost was $5 per dose and $10 per visit.");

    const texPre = preMask(
      "\\section{Methods}\nSample size $p<0.05$.\n\\subsection{Cohort and follow-up}\nOutcomes $p<0.01$.",
      "latex",
    );
    expect(texPre.mathRegions.map((m) => m.text)).toEqual(["p<0.05", "p<0.01"]);
    expect(texPre.sectionTransitions[texPre.sectionTransitions.length - 1]!.state).toEqual({
      label: "methods",
      subsection: "Cohort and follow-up",
    });

    const tracker = new SectionTracker();
    tracker.pushHeading(3, "Methods");
    tracker.pushHeading(4, "Cohort and follow-up");
    expect(tracker.current).toEqual({
      label: "methods",
      subsection: "Cohort and follow-up",
    });

    expect(
      normSentence("Drug X reduced pain [1] by 30%.", {
        format: "md",
        markerRanges: [{ start: 20, end: 23 }],
      }),
    ).toBe("drug x reduced pain \u27e6c\u27e7 by 30%.");
  });

  it("§4 segmentation normative biomedical and punctuation examples", () => {
    const doc = [
      "Mice were injected i.p. Animals were monitored after a 0.5 mg i.p. injection in group B. The protocol matched vitamin C. Controls remained stable while J. Smith recorded measurements.",
      "Pathways p53, mRNA, siRNA, iPSC, pH, t1, t-test, p-value, and n-3 reached 3.5. X showed no effect. [12] The steps follow: 1) Mix reagents. 2) Incubate in sec. results or sec. Methods.",
    ].join(" ");
    const seg = segmentDocument(doc, "md");
    expect(seg.sentences.map((s) => s.rawText)).toEqual([
      "Mice were injected i.p.",
      "Animals were monitored after a 0.5 mg i.p. injection in group B.",
      "The protocol matched vitamin C.",
      "Controls remained stable while J. Smith recorded measurements.",
      "Pathways p53, mRNA, siRNA, iPSC, pH, t1, t-test, p-value, and n-3 reached 3.5.",
      "X showed no effect. [12]",
      "The steps follow: 1) Mix reagents. 2) Incubate in sec. results or sec.",
      "Methods.",
    ]);
  });

  it("§5 citation scanner Rule 2 normative table, Author-Year, organization rule, NON_NAME_WORDS, and email check", () => {
    const rule2Table: readonly { readonly text: string; readonly expected: readonly number[] }[] = [
      { text: "reduced mortality by 30% [1]", expected: [1] },
      { text: "reduced mortality by 30% [1, 2].", expected: [1, 2] },
      { text: "as listed in Table 2 [3, 7].", expected: [3, 7] },
      { text: "reported in 2019 [3]", expected: [3] },
      { text: "in social [3] contexts", expected: [3] },
      { text: "across species [14]", expected: [14] }, // W1 check: 'species' ends in 'se' vs 'species' whole word
      { text: "95% CI [12, 45]", expected: [] },
      { text: "IQR [3, 7]", expected: [] },
    ];
    for (const row of rule2Table) {
      const m = scanCitations(row.text);
      expect(m.flatMap((x) => x.numericIds)).toEqual(row.expected);
    }

    const ay = scanCitations(
      "(Smith et al., 2020a) alongside (March 2020) and (Table 2020) and name@example.org.",
    );
    expect(ay).toHaveLength(1);
    expect(ay[0]!.rule).toBe("author_year_paren");
    expect(ay[0]!.authorYears[0]!.surname).toBe("Smith");
    expect(ay[0]!.authorYears[0]!.year).toBe("2020a");

    expect(extractCorporateInitials("{{World Health Organization}}")).toBe("WHO");
    const whoResolved = resolveCitationMarkers(scanCitations("WHO (2020) reported reductions."), {
      entries: [
        {
          refId: "who_ref",
          key: "who2020",
          corporateAuthor: "{{World Health Organization}}",
          year: "2020",
        },
      ],
    });
    expect(whoResolved.resolvedMarkers).toHaveLength(1);
    expect(whoResolved.resolvedMarkers[0]!.status).toBe("RESOLVED");
    expect(whoResolved.resolvedRefIds).toEqual(["who_ref"]);
  });

  it("§6 ALL 15 normative clause examples with stated intermediate trace and word counts", () => {
    const ex1 = partitionClausesWithTrace(
      "Drug X reduced mortality by 30% [1] but increased bleeding [2].",
      scanCitations("Drug X reduced mortality by 30% [1] but increased bleeding [2]."),
    );
    expect(ex1.clauses.map((c) => c.claimText)).toEqual([
      "Drug X reduced mortality by 30%",
      "increased bleeding",
    ]);

    const ex2 = partitionClausesWithTrace(
      "Smith et al. (2020) found no effect of X on Y.",
      scanCitations("Smith et al. (2020) found no effect of X on Y."),
    );
    expect(ex2.clauses.map((c) => c.claimText)).toEqual(["found no effect of X on Y"]);
    expect(ex2.groups[0]!.narrative).toBe(true);

    const ex3 = partitionClausesWithTrace(
      "X improves Y \\cite{a,b}.",
      scanCitations("X improves Y \\cite{a,b}."),
    );
    expect(ex3.clauses[0]!.claimText).toBe("X improves Y");
    expect(ex3.clauses[0]!.markers[0]!.keys).toEqual(["a", "b"]);

    const ex4 = partitionClausesWithTrace(
      "As shown previously [3], X improves Y.",
      scanCitations("As shown previously [3], X improves Y."),
    );
    expect(ex4.clauses.map((c) => c.claimText)).toEqual(["X improves Y"]);

    const ex5 = partitionClausesWithTrace(
      "Smith et al. (2020) found X reduces Y [3].",
      scanCitations("Smith et al. (2020) found X reduces Y [3]."),
    );
    expect(ex5.clauses).toHaveLength(1);
    expect(ex5.clauses[0]!.claimText).toBe("found X reduces Y");
    expect(ex5.clauses[0]!.markers.map((m) => m.rawText)).toEqual(["Smith et al. (2020)", "[3]"]);

    const ex6 = partitionClausesWithTrace(
      "Drug X, as shown by Smith (2020), reduced Y.",
      scanCitations("Drug X, as shown by Smith (2020), reduced Y."),
    );
    expect(ex6.clauses[0]!.claimText).toBe("Drug X reduced Y");

    const ex7 = partitionClausesWithTrace(
      "Smith (2020) found X [3], but Jones (2021) found not-X.",
      scanCitations("Smith (2020) found X [3], but Jones (2021) found not-X."),
    );
    expect(ex7.clauses.map((c) => c.claimText)).toEqual(["found X", "found not-X"]);

    // Example 8: >= 4 words between groups (6 words: and decreased B in older adults)
    const s8 = "X increased A [1] and decreased B in older adults [2].";
    const ex8 = partitionClausesWithTrace(s8, scanCitations(s8));
    expect(ex8.splitTraces).toHaveLength(1);
    expect(ex8.splitTraces[0]!.betweenWordCount).toBe(6);
    expect(ex8.splitTraces[0]!.didSplit).toBe(true);
    expect(ex8.clauses.map((c) => c.claimText)).toEqual([
      "X increased A",
      "decreased B in older adults",
    ]);

    const ex9 = partitionClausesWithTrace(
      "The effect was large [4], which was unexpected.",
      scanCitations("The effect was large [4], which was unexpected."),
    );
    expect(ex9.clauses.map((c) => c.claimText)).toEqual([
      "The effect was large, which was unexpected",
    ]);

    const s10 = "Prior work [@k0; @k1; @k2";
    const ex10 = partitionClausesWithTrace(s10, scanCitations(s10));
    expect(ex10.groups).toHaveLength(0);
    expect(ex10.clauses[0]!.uncited).toBe(true);
    expect(ex10.clauses[0]!.claimText).toBe(s10);

    // Example 11: relativizer + inner split after word 2 ("unexpected") at ", and "
    const s11 =
      "The effect was large [4], which was unexpected, and the control was small [5].";
    const ex11 = partitionClausesWithTrace(s11, scanCitations(s11));
    expect(ex11.splitTraces).toHaveLength(1);
    expect(ex11.splitTraces[0]!.betweenWordCount).toBe(8);
    expect(ex11.splitTraces[0]!.relativizerMatched).toBe("which");
    expect(ex11.splitTraces[0]!.didSplit).toBe(true);
    expect(ex11.splitTraces[0]!.splitOffset).not.toBeNull();
    expect(s11.slice(ex11.splitTraces[0]!.splitOffset!).startsWith(", and the control")).toBe(true);
    expect(ex11.clauses.map((c) => c.claimText)).toEqual([
      "The effect was large, which was unexpected",
      "the control was small",
    ]);

    // Example 12: "not only ... but also" stays single clause
    const s12 = "X not only reduced pain but also improved sleep [6].";
    const ex12 = partitionClausesWithTrace(s12, scanCitations(s12));
    expect(ex12.clauses).toHaveLength(1);
    expect(ex12.clauses[0]!.claimText).toBe("X not only reduced pain but also improved sleep");

    // Example 13: < 4 words (betweenWordCount === 2) stays single clause
    const s13 = "Mortality fell by 30% [1] in 2019 [2].";
    const ex13 = partitionClausesWithTrace(s13, scanCitations(s13));
    expect(ex13.splitTraces).toHaveLength(1);
    expect(ex13.splitTraces[0]!.betweenWordCount).toBe(2);
    expect(ex13.splitTraces[0]!.didSplit).toBe(false);
    expect(ex13.clauses.map((c) => c.claimText)).toEqual(["Mortality fell by 30% in 2019"]);

    // Example 14: < 4 words (betweenWordCount === 2), comma preserved around connector cleanup
    const s14 = "X improves Y [3] , and Z [4].";
    const ex14 = partitionClausesWithTrace(s14, scanCitations(s14));
    expect(ex14.splitTraces).toHaveLength(1);
    expect(ex14.splitTraces[0]!.betweenWordCount).toBe(2);
    expect(ex14.splitTraces[0]!.didSplit).toBe(false);
    expect(ex14.clauses.map((c) => c.claimText)).toEqual(["X improves Y, and Z"]);

    // Example 15: leading connector before comma & marker cleaned to "reported that X reduces Y"
    const s15 = "However, [2] reported that X reduces Y.";
    const ex15 = partitionClausesWithTrace(s15, scanCitations(s15));
    expect(ex15.clauses.map((c) => c.claimText)).toEqual(["reported that X reduces Y"]);
  });
});
