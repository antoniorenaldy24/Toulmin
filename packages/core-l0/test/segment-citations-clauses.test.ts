import { describe, expect, it } from "vitest";
import {
  checkStage1Eligibility,
  computeClaimId,
  extractCorporateInitials,
  extractLatexBibStyle,
  extractMarkdownNumberedReferences,
  groupMarkers,
  norm,
  partitionClauses,
  partitionClausesWithTrace,
  preMask,
  resolveCitationMarkers,
  scanCitations,
  segmentDocument,
  type AuthoritativeDocxMarker,
  type BibliographyEntry,
  type CitationMarker,
} from "../src/index.js";

function medianMs(trials: number, fn: () => void): number {
  for (let w = 0; w < 6; w++) {
    fn(); // warm-up JIT before timing
  }
  const samples: number[] = [];
  for (let i = 0; i < trials; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

describe("segment.ts — detailed boundary, eligibility & offset rules", () => {
  it("handles Class N, Class T case distinction, and INITIAL_TERMINAL_PRECEDERS", () => {
    const text =
      "See Fig. 3 and Dr. Smith et al. show improvements in sec. method today. " +
      "Read sec. Methods before starting; also test vitamin C. Controls improved while J. Smith watched.";
    const res = segmentDocument(text, "md");
    expect(res.sentences.map((s) => s.rawText)).toEqual([
      "See Fig. 3 and Dr. Smith et al. show improvements in sec. method today.",
      "Read sec.",
      "Methods before starting; also test vitamin C.",
      "Controls improved while J. Smith watched.",
    ]);
  });

  it("handles Rule 4 LOWER{1,3}, hyphenated n-3 / t-test, decimals, ellipsis, and inline numbered lists", () => {
    const text =
      "Pathways p53, mRNA, siRNA, iPSC, pH, t1, t-test, p-value, and n-3 fatty acids reached 3.5. " +
      "Dose A failed... Dose B worked\u2026 Steps: 1) Prepare buffer. 2) Add enzyme.";
    const res = segmentDocument(text, "md");
    expect(res.sentences.map((s) => s.rawText)).toEqual([
      "Pathways p53, mRNA, siRNA, iPSC, pH, t1, t-test, p-value, and n-3 fatty acids reached 3.5.",
      "Dose A failed...",
      "Dose B worked\u2026",
      "Steps: 1) Prepare buffer. 2) Add enzyme.",
    ]);
  });

  it("attaches trailing closing quotes and citation markers to the terminating sentence", () => {
    const text =
      'He wrote "Mortality fell." [12] Next trials started. Earlier they asked "Why?" and paused.';
    const res = segmentDocument(text, "md");
    expect(res.sentences.map((s) => s.rawText)).toEqual([
      'He wrote "Mortality fell." [12]',
      "Next trials started.",
      'Earlier they asked "Why?" and paused.',
    ]);
    expect(res.sentences[0]!.markers).toHaveLength(1);
    expect(res.sentences[0]!.markers[0]!.rawText).toBe("[12]");
  });

  it("enforces forced boundaries for paragraphs, Markdown lists without splitting '1. ', LaTeX \\item, headings, and inline math", () => {
    const md = [
      "# Methods",
      "",
      "- First item about $x = 1.5 + 2.0$ without split",
      "* Second bullet with outcome",
      "+ Third bullet with conclusion",
      "1. Numbered list line stays whole",
      "",
      "Closing paragraph.",
    ].join("\n");
    const mdRes = segmentDocument(md, "md");
    expect(mdRes.sentences.map((s) => s.rawText)).toEqual([
      "- First item about $x = 1.5 + 2.0$ without split",
      "* Second bullet with outcome",
      "+ Third bullet with conclusion",
      "1. Numbered list line stays whole",
      "Closing paragraph.",
    ]);
    expect(mdRes.sentences[0]!.section).toBe("methods");

    const tex = [
      "\\begin{itemize}",
      "\\item First LaTeX item\\footnote{Hidden note. With period.} stays whole.",
      "\\item Second LaTeX item",
      "\\end{itemize}",
    ].join("\n");
    const texRes = segmentDocument(tex, "latex");
    expect(texRes.sentences.map((s) => s.rawText)).toEqual([
      "First LaTeX item\\footnote{Hidden note. With period.} stays whole.",
      "Second LaTeX item",
    ]);
  });

  it("enforces all 5 Stage 1 eligibility conditions and increments occurrenceIndex on duplicate normText", () => {
    // 1) < 6 words after citation markers are deleted
    const sShort = checkStage1Eligibility("Too short here.", "Too short here.", [], "results");
    expect(sShort.eligible).toBe(false);
    expect(sShort.wordCount).toBe(3);

    const sWithMarkersOnly = checkStage1Eligibility(
      "Yes [1] [2] [3].",
      "Yes [1] [2] [3].",
      scanCitations("Yes [1] [2] [3]."),
      "results",
    );
    expect(sWithMarkersOnly.eligible).toBe(false);
    expect(sWithMarkersOnly.wordCount).toBe(1);

    const sEligible = checkStage1Eligibility(
      "Drug X reduced blood pressure significantly.",
      "Drug X reduced blood pressure significantly.",
      [],
      "results",
    );
    expect(sEligible.eligible).toBe(true);
    expect(sEligible.wordCount).toBe(6);

    // 2) Fully masked -> ineligible
    const sMasked = checkStage1Eligibility(
      "$a+b+c+d+e+f$",
      "\uE000\uE000 \uE000",
      [],
      "results",
    );
    expect(sMasked.eligible).toBe(false);

    // 3) No word of >= 3 letters -> ineligible
    const sNoLongWord = checkStage1Eligibility(
      "a b c d e f.",
      "a b c d e f.",
      [],
      "results",
    );
    expect(sNoLongWord.eligible).toBe(false);

    // 4) Under section `references` -> ineligible
    const sRefSection = checkStage1Eligibility(
      "Smith et al. Journal of Testing 2020.",
      "Smith et al. Journal of Testing 2020.",
      [],
      "references",
    );
    expect(sRefSection.eligible).toBe(false);

    // 5) Entirely enclosed in quotation marks -> ineligible
    const quotedAscii = '"This entire sentence contains more than six words inside quotes."';
    expect(checkStage1Eligibility(quotedAscii, quotedAscii, [], "results").eligible).toBe(false);
    const quotedSmart = "\u201cThis entire sentence also contains more than six words.\u201d";
    expect(checkStage1Eligibility(quotedSmart, quotedSmart, [], "results").eligible).toBe(false);

    const doc =
      "Drug X lowered blood pressure significantly.\n\nDrug X lowered blood pressure significantly.";
    const res = segmentDocument(doc, "md");
    expect(res.sentences).toHaveLength(2);
    expect(res.sentences[0]!.occurrenceIndex).toBe(0);
    expect(res.sentences[1]!.occurrenceIndex).toBe(1);
    expect(res.sentences[0]!.sentenceHash).toBe(res.sentences[1]!.sentenceHash);

    const cid0 = computeClaimId("doc-1", res.sentences[0]!.sentenceHash, 0, 0);
    const cid1 = computeClaimId("doc-1", res.sentences[1]!.sentenceHash, 1, 0);
    expect(cid0).toHaveLength(32);
    expect(cid0).not.toBe(cid1);
    expect(cid0).toBe(computeClaimId("doc-1", res.sentences[0]!.sentenceHash, 0, 0));
  });

  it("preserves exact raw UTF-16 offsets across zero-width characters (AC-L0-25)", () => {
    const raw = "Drug X reduced mor\u200btality by 30% [1]. Drug Y helped more.";
    const res = segmentDocument(raw, "md");
    expect(res.sentences).toHaveLength(2);
    const s0 = res.sentences[0]!;
    const s1 = res.sentences[1]!;
    expect(s0.rawText).toBe("Drug X reduced mor\u200btality by 30% [1].");
    expect(raw.slice(s0.start, s0.end)).toBe("Drug X reduced mor\u200btality by 30% [1].");
    expect(raw.slice(s1.start, s1.end)).toBe("Drug Y helped more.");

    expect(s0.markers).toHaveLength(1);
    const m0 = s0.markers[0]!;
    expect(m0.rawText).toBe("[1]");
    expect(s0.maskedText.slice(m0.start, m0.end)).toBe("[1]");

    const normInfo = norm(raw);
    const absNormMarkerStart = m0.start;
    const absNormMarkerEnd = m0.end;
    expect(
      raw.slice(normInfo.map[absNormMarkerStart]!, normInfo.map[absNormMarkerEnd]!),
    ).toBe("[1]");
  });

  it("splits across Rule 4 boundaries when next sentence starts with narrative or non-narrative citation markers", () => {
    const latexNar = segmentDocument("We tested aspirin. \\citet{smith2020} showed Y.", "latex");
    expect(latexNar.sentences.map((s) => s.rawText)).toEqual([
      "We tested aspirin.",
      "\\citet{smith2020} showed Y.",
    ]);

    const mdNar = segmentDocument("We tested aspirin. @smith2020 showed Y.", "md", {
      citationOptions: { bibKeys: new Set(["smith2020"]) },
    });
    expect(mdNar.sentences.map((s) => s.rawText)).toEqual([
      "We tested aspirin.",
      "@smith2020 showed Y.",
    ]);

    const ayNar = segmentDocument("We tested aspirin. Smith (2020) showed Y.", "md");
    expect(ayNar.sentences.map((s) => s.rawText)).toEqual([
      "We tested aspirin.",
      "Smith (2020) showed Y.",
    ]);

    const nonNarUpper = segmentDocument(
      "We tested aspirin. \\cite{a} The next trial confirmed Y.",
      "latex",
    );
    expect(nonNarUpper.sentences.map((s) => s.rawText)).toEqual([
      "We tested aspirin.",
      "\\cite{a} The next trial confirmed Y.",
    ]);

    const nonNarLower = segmentDocument("We tested aspirin... (Smith, 2020) then left.", "md");
    expect(nonNarLower.sentences.map((s) => s.rawText)).toEqual([
      "We tested aspirin... (Smith, 2020) then left.",
    ]);
  });

  it("segments large multi-section LaTeX documents with monotonic cursors in O(n) <= 5 ms / 10 KB", () => {
    const unit =
      "\\section{Results}\nPatients received $x = 5$ mg\\footnote{Note.} in trial [1]. Next sentence confirmed effect \\cite{k1}.\n";
    const big = unit.repeat(95); // ~10.4 KB, >= 190 sentences
    const bigRes = segmentDocument(big, "latex");
    expect(bigRes.sentences.length).toBeGreaterThanOrEqual(190);
    expect(bigRes.sentences[0]!.section).toBe("results");
    expect(bigRes.sentences[0]!.markers).toHaveLength(1);
    const slice10k = big.slice(0, 10_240);
    const med = medianMs(7, () => {
      segmentDocument(slice10k, "latex");
    });
    expect(med).toBeLessThanOrEqual(5);
  });
});

describe("citations.ts — full rule, numeric exclusion, and resolution coverage", () => {
  it("handles LaTeX custom macros, starred forms, multicites, Pandoc narrative trailing dot, and numeric exclusions", () => {
    const texDoc = [
      "\\newcommand{\\mycite}[1]{[#1]}",
      "Claim A \\mycite{k1}, \\citet*{k2}, \\textcites{k3}{k4}, @k5.",
      "Email user@example.org stays unsplit.",
    ].join("\n");

    const pre = preMask(texDoc, "latex");
    const texMarkers = scanCitations(pre.maskedText, {
      customCiteMacros: pre.customCiteMacros,
      bibKeys: new Set(["k5"]),
      numberedBibSize: 20,
    });

    const mdNumeric = [
      "Exclusions: decimal [1.5], out-of-range [99], IQR [3, 7], 95% CI [12, 45], SEM [1.2, 3.4], mean 5\u00b1 [2, 4], 10 [15, 25]\u00b0C, 5 [2, 8] \u03bcm, 20 [10, 30]%, 4 [2, 6] days.",
      "Accepted: mortality fell by 30% [1] in 2019 [3] as in Table 2 [4].",
    ].join("\n");
    const mdMarkers = scanCitations(mdNumeric, { numberedBibSize: 20 });

    const summary = [...texMarkers, ...mdMarkers].map((m) => ({
      rule: m.rule,
      raw: m.rawText,
      keys: m.keys,
      nums: m.numericIds,
      narrative: m.narrative,
    }));
    expect(summary).toEqual([
      { rule: "latex_cite", raw: "\\mycite{k1}", keys: ["k1"], nums: [], narrative: false },
      { rule: "latex_cite", raw: "\\citet*{k2}", keys: ["k2"], nums: [], narrative: true },
      { rule: "latex_cite", raw: "\\textcites{k3}{k4}", keys: ["k3", "k4"], nums: [], narrative: true },
      { rule: "pandoc_narrative", raw: "@k5", keys: ["k5"], nums: [], narrative: true },
      { rule: "numeric_bracket", raw: "[1]", keys: [], nums: [1], narrative: false },
      { rule: "numeric_bracket", raw: "[3]", keys: [], nums: [3], narrative: false },
      { rule: "numeric_bracket", raw: "[4]", keys: [], nums: [4], narrative: false },
    ]);
  });

  it("handles NON_NAME_WORDS exclusions, surname foldLatin & particle stripping, case-insensitive fallback, AMBIGUOUS, and IEEE style", () => {
    expect(extractLatexBibStyle("\\bibliographystyle{IEEEtran}")).toBe("IEEEtran");
    expect(extractCorporateInitials("{{World Health Organization}}")).toBe("WHO");

    const entries: BibliographyEntry[] = [
      { refId: "r_muller", key: "Muller2020", firstAuthorFamily: "Müller", year: "2020" },
      { refId: "r_berg", key: "Berg2019", firstAuthorFamily: "van der Berg", year: "2019" },
      { refId: "r_amb1", key: "Lee2021a", firstAuthorFamily: "Lee", year: "2021" },
      { refId: "r_amb2", key: "Lee2021b", firstAuthorFamily: "Lee", year: "2021" },
    ];

    const text =
      "Check (January 2022), (Figure 2021), (March 2020), (Table 2020), " +
      "then (Muller 2020), (Berg 2019), (Lee 2021), and \\cite{muller2020}.";
    const markers = scanCitations(text);
    const res = resolveCitationMarkers(markers, { entries });

    expect(res.resolvedMarkers.map((m) => m.status)).toEqual([
      "RESOLVED",
      "RESOLVED",
      "AMBIGUOUS",
      "RESOLVED",
    ]);
    expect(res.resolvedRefIds).toEqual(["r_muller", "r_berg"]);
    expect(res.ambiguousMarkers).toHaveLength(1);
    expect(res.ambiguousMarkers[0]!.ambiguousCandidates).toEqual(["r_amb1", "r_amb2"]);
  });

  it("handles Rule 6 authoritative DOCX markers without overlapping heuristic scans and extracts Markdown references", () => {
    const md = [
      "Trial A helped [2].",
      "",
      "## References",
      "1. First reference.",
      "2. Second reference.",
    ].join("\n");
    const pre = preMask(md, "md");
    const mdRefs = extractMarkdownNumberedReferences(md, pre);
    expect(mdRefs.map((r) => r.index)).toEqual([1, 2]);

    const docxText = "Clinical benefit [1] was observed in cohort A 2 today.";
    const docxMarkers: AuthoritativeDocxMarker[] = [
      { start: 17, end: 20, kind: "docx_field", keys: ["trial2020"], refIds: ["ref_docx_1"] },
      { start: 47, end: 48, kind: "docx_superscript", numericIds: [2] },
    ];
    const scanned = scanCitations(docxText, { docxMarkers });
    expect(scanned).toHaveLength(2);
    expect(scanned[0]!.rule).toBe("docx_field");
    expect(scanned[0]!.kind).toBe("EXPLICIT");
    expect(scanned[1]!.rule).toBe("docx_superscript");
    expect(scanned[1]!.kind).toBe("EXPLICIT");

    const resolved = resolveCitationMarkers(scanned, {
      entries: [{ refId: "ref_docx_1", key: "trial2020" }],
      docxNumberedRefs: ["ref_docx_1", "ref_docx_2"],
    });
    expect(resolved.resolvedRefIds).toEqual(["ref_docx_1", "ref_docx_2"]);
  });

  it("promotes numeric_bracket to EXPLICIT / UNRESOLVED_KEY when explicit numbering order exists in resolveCitationMarkers", () => {
    // Scan WITHOUT `hasKnownNumberingOrder` so markers start as `HEURISTIC`
    const scanned = scanCitations("Claim A [1] and missing [5].");
    expect(scanned.map((m) => m.kind)).toEqual(["HEURISTIC", "HEURISTIC"]);

    // Without any explicit order source -> remains HEURISTIC -> POSSIBLE_CITATION
    const noOrder = resolveCitationMarkers(scanned, {
      entries: [{ refId: "r1", key: "k1", orderIndex: 0 }],
    });
    expect(noOrder.resolvedMarkers.map((r) => r.status)).toEqual([
      "POSSIBLE_CITATION",
      "POSSIBLE_CITATION",
    ]);
    expect(noOrder.unresolvedKeys).toEqual([]);
    expect(noOrder.possibleCitations).toHaveLength(2);

    // 1) bibStyle (IEEEtran)
    const viaStyle = resolveCitationMarkers(scanned, {
      entries: [{ refId: "r1", key: "k1", orderIndex: 0 }],
      bibStyle: "IEEEtran",
    });
    expect(viaStyle.resolvedMarkers.map((r) => r.status)).toEqual(["RESOLVED", "UNRESOLVED_KEY"]);
    expect(viaStyle.resolvedMarkers.map((r) => r.marker.kind)).toEqual(["EXPLICIT", "EXPLICIT"]);
    expect(viaStyle.unresolvedKeys).toEqual(["5"]);
    expect(viaStyle.possibleCitations).toEqual([]);

    // 2) bibItems
    const viaBibItems = resolveCitationMarkers(scanned, {
      entries: [{ refId: "r1", key: "k1" }],
      bibItems: [{ key: "k1", label: null }],
    });
    expect(viaBibItems.resolvedMarkers.map((r) => r.status)).toEqual(["RESOLVED", "UNRESOLVED_KEY"]);
    expect(viaBibItems.resolvedMarkers.map((r) => r.marker.kind)).toEqual(["EXPLICIT", "EXPLICIT"]);
    expect(viaBibItems.unresolvedKeys).toEqual(["5"]);
    expect(viaBibItems.possibleCitations).toEqual([]);

    // 3) markdownNumberedRefs
    const viaMd = resolveCitationMarkers(scanned, {
      markdownNumberedRefs: [{ index: 1, text: "Ref 1", lineStart: 0 }],
    });
    expect(viaMd.resolvedMarkers.map((r) => r.status)).toEqual(["RESOLVED", "UNRESOLVED_KEY"]);
    expect(viaMd.resolvedMarkers.map((r) => r.marker.kind)).toEqual(["EXPLICIT", "EXPLICIT"]);
    expect(viaMd.unresolvedKeys).toEqual(["5"]);
    expect(viaMd.possibleCitations).toEqual([]);

    // 4) docxNumberedRefs
    const viaDocx = resolveCitationMarkers(scanned, {
      docxNumberedRefs: ["ref_d1"],
    });
    expect(viaDocx.resolvedMarkers.map((r) => r.status)).toEqual(["RESOLVED", "UNRESOLVED_KEY"]);
    expect(viaDocx.resolvedMarkers.map((r) => r.marker.kind)).toEqual(["EXPLICIT", "EXPLICIT"]);
    expect(viaDocx.unresolvedKeys).toEqual(["5"]);
    expect(viaDocx.possibleCitations).toEqual([]);
  });

  it("blocks supplementary-plane LETTER before @ in pandoc_narrative (02 §2.1, §5.2 Rule 3)", () => {
    const mathBoldA = String.fromCodePoint(0x1d400);
    const attached = scanCitations(`${mathBoldA}@k5`, { bibKeys: new Set(["k5"]) });
    expect(attached).toHaveLength(0);

    const spaced = scanCitations(`${mathBoldA} @k5`, { bibKeys: new Set(["k5"]) });
    expect(spaced).toHaveLength(1);
    expect(spaced[0]!.rule).toBe("pandoc_narrative");
    expect(spaced[0]!.keys).toEqual(["k5"]);
  });

  it("resolves sparse gapped markdownNumberedRefs by explicit ref.index and rejects signed/parenthesized bare numbers before intervals", () => {
    const mdDoc = [
      "Trial A [1] beat trial C [3] while [2] is missing.",
      "",
      "## References",
      "1. First reference.",
      "3. Third reference.",
    ].join("\n");
    const pre = preMask(mdDoc, "md");
    const mdRefs = extractMarkdownNumberedReferences(mdDoc, pre);
    expect(mdRefs.map((r) => r.index)).toEqual([1, 3]);
    const mdMarkers = scanCitations(pre.maskedText, { hasKnownNumberingOrder: true });
    const mdResolved = resolveCitationMarkers(mdMarkers, { markdownNumberedRefs: mdRefs });
    expect(mdResolved.resolvedMarkers.map((r) => r.status)).toEqual([
      "RESOLVED",
      "RESOLVED",
      "UNRESOLVED_KEY",
    ]);
    expect(mdResolved.resolvedRefIds).toEqual(["mdref:1", "mdref:3"]);
    expect(mdResolved.unresolvedKeys).toEqual(["2"]);

    expect(scanCitations("Change was -5 [1, 10] mm.")).toHaveLength(0);
    expect(scanCitations("Change was +5 [1, 10] mm.")).toHaveLength(0);
    expect(scanCitations("Median (5 [3, 7] days) fell.")).toHaveLength(0);
    expect(scanCitations("Offset (-5 [1, 10] mm) held.")).toHaveLength(0);
    expect(scanCitations("Median 1.2019 [1, 2] days.")).toHaveLength(0);
    expect(scanCitations("Median (1.2019 [1, 2] days).")).toHaveLength(0);
    expect(scanCitations("95% CI 2.5 [12, 45].")).toHaveLength(0);
    expect(scanCitations("mean 5, SD 1.2 [3, 7].")).toHaveLength(0);
    expect(scanCitations("median 3, IQR 0.5 [1, 2].")).toHaveLength(0);

    // 02 §5.2 Rule 2 item 4: year and percentage before bracket remain numeric citations
    expect(scanCitations("Cohort (2019 [1, 2] patients) improved.").map((m) => m.numericIds)).toEqual([
      [1, 2],
    ]);
    expect(scanCitations("Reduced mortality by 30% [1, 2] across cohorts.").map((m) => m.numericIds)).toEqual([
      [1, 2],
    ]);
    expect(scanCitations("Response 50% [40, 60] patients.").map((m) => m.numericIds)).toEqual([
      [40, 60],
    ]);
  });
});

describe("clauses.ts — Step 1–4 boundaries, connectors, merges, and spans", () => {
  it("handles 'not only ... but also' suppression, second ', but ' in span, and semicolon resets", () => {
    const s1 =
      "Drug X not only reduced pain but also improved sleep [1], but adherence dropped [2].";
    const c1 = partitionClauses(s1, scanCitations(s1));
    expect(c1.map((c) => c.claimText)).toEqual([
      "Drug X not only reduced pain but also improved sleep",
      "adherence dropped",
    ]);

    const s2 = "Drug X not only helped; sleep improved, but adherence dropped [2].";
    const c2 = partitionClauses(s2, scanCitations(s2));
    expect(c2.map((c) => c.claimText)).toEqual([
      "Drug X not only helped; sleep improved",
      "adherence dropped",
    ]);
  });

  it("handles relativizers, <4 short uncited forward and backward merges, and repeated connector/reporting cleanups", () => {
    const backwardMerge =
      "Drug X significantly reduced systolic pressure across older participants [1]; however, yes.";
    const cb = partitionClauses(backwardMerge, scanCitations(backwardMerge));
    expect(cb).toHaveLength(1);
    expect(cb[0]!.markers.map((m) => m.rawText)).toEqual(["[1]"]);

    const trailCleanup =
      "Moreover, in addition, see Smith (2020) that aspirin works, however; placebo fails [2].";
    const ct = partitionClauses(trailCleanup, scanCitations(trailCleanup));
    expect(ct.map((c) => c.claimText)).toEqual(["aspirin works", "placebo fails"]);
    expect(ct[0]!.span.start).toBeGreaterThanOrEqual(0);
    expect(trailCleanup.slice(ct[0]!.span.start, ct[0]!.span.end)).toBe("aspirin works");
    expect(groupMarkers(trailCleanup, scanCitations(trailCleanup))).toHaveLength(2);
  });

  it("keeps partitioned clause ranges strictly disjoint and UTF-16 valid", () => {
    const s =
      "First group [1] , [2] showed efficacy, while second group [3] showed harm, and third group [4] matched.";
    const markers: readonly CitationMarker[] = scanCitations(s);
    const { groups, clauses, splitTraces } = partitionClausesWithTrace(s, markers);
    expect(groups).toHaveLength(3);
    expect(splitTraces).toHaveLength(1);
    expect(clauses).toHaveLength(3);
    for (let i = 1; i < clauses.length; i++) {
      expect(clauses[i - 1]!.range.end).toBeLessThanOrEqual(clauses[i]!.range.start);
    }
  });

  it("handles backward surrogate pairs in isWordBoundaryInStr and Step 2 inner splits after 2-word relative clauses", () => {
    const mathBoldA = String.fromCodePoint(0x1d400);
    const attachedSurrogate = `Drug X ${mathBoldA}not only reduced pain but also improved sleep [1].`;
    const splitAttached = partitionClauses(attachedSurrogate, scanCitations(attachedSurrogate));
    expect(splitAttached.map((c) => c.claimText)).toEqual([
      `Drug X ${mathBoldA}not only reduced pain`,
      "improved sleep",
    ]);

    const spacedSurrogate = `Drug X ${mathBoldA} not only reduced pain but also improved sleep [1].`;
    const keptSpaced = partitionClauses(spacedSurrogate, scanCitations(spacedSurrogate));
    expect(keptSpaced.map((c) => c.claimText)).toEqual([
      `Drug X ${mathBoldA} not only reduced pain but also improved sleep`,
    ]);

    const twoWordRel = "Drug X helped [4], which works, and Drug Y failed [5].";
    const twoWordTrace = partitionClausesWithTrace(twoWordRel, scanCitations(twoWordRel));
    expect(twoWordTrace.splitTraces[0]!.splitOffset).toBe(twoWordRel.indexOf(", and "));
    expect(twoWordTrace.clauses.map((c) => c.claimText)).toEqual([
      "Drug X helped, which works",
      "Drug Y failed",
    ]);

    const oneWordRel = "Drug X helped [4], which and Drug Y failed [5].";
    const oneWordTrace = partitionClausesWithTrace(oneWordRel, scanCitations(oneWordRel));
    expect(oneWordTrace.splitTraces[0]!.splitOffset).toBe(oneWordRel.indexOf(", which"));
    expect(oneWordTrace.clauses.map((c) => c.claimText)).toEqual([
      "Drug X helped",
      "Drug Y failed",
    ]);
  });
});

describe("Linear-time 10 KB ReDoS adversarial latency guard (<= 5 ms / 10 KB)", () => {
  const build64KeyUnclosedCite = (): string => {
    const keys = Array.from({ length: 64 }, (_, i) => `k${i}`).join(",");
    return `\\cite{${keys},` + "a,".repeat(4900);
  };

  const payloads: readonly {
    readonly name: string;
    readonly text: string;
    readonly format?: "latex" | "md";
  }[] = [
    { name: "unclosed \\cite{ with 64 keys", text: build64KeyUnclosedCite(), format: "latex" },
    { name: "unclosed '[' 10 KB", text: "[".repeat(10_000) },
    { name: "unclosed '(' 10 KB", text: "(".repeat(10_000) },
    { name: "unclosed '{' 10 KB", text: "{".repeat(10_000), format: "latex" },
    { name: "unclosed '$' 10 KB", text: "$ ".repeat(5_000), format: "md" },
    { name: "pandoc unclosed [@ 10 KB", text: "[@k0; ".repeat(1_600) },
    { name: "repeated (March 10 KB", text: "(March 2020; ".repeat(750) },
    { name: "repeated not only ... 10 KB", text: "not only x but ".repeat(660) },
  ];

  for (const p of payloads) {
    it(`scans, segments, and partitions '${p.name}' in <= 5 ms median`, () => {
      const scanMed = medianMs(7, () => {
        scanCitations(p.text);
      });
      const segMed = medianMs(7, () => {
        segmentDocument(p.text, p.format ?? "md");
      });
      const clauseInput = `${p.text.slice(0, 9950)} [1]`;
      const clauseMarkers = scanCitations(clauseInput);
      const clauseMed = medianMs(7, () => {
        partitionClauses(clauseInput, clauseMarkers);
      });

      expect(scanMed).toBeLessThanOrEqual(5);
      expect(segMed).toBeLessThanOrEqual(5);
      expect(clauseMed).toBeLessThanOrEqual(5);
    });
  }

  it("scans and segments adversarial 10 KB '@' + 10,000 dots with non-empty bibKeys in <= 5 ms median", () => {
    const atDots = `@${".".repeat(10_000)}`;
    const bibKeys = new Set(["smith2020", "a".repeat(2000)]);
    const scanMed = medianMs(7, () => {
      const m = scanCitations(atDots, { bibKeys });
      expect(m).toHaveLength(0);
    });
    const segMed = medianMs(7, () => {
      const res = segmentDocument(atDots, "md", {
        citationOptions: { bibKeys: new Set(["smith2020"]) },
      });
      expect(res.allMarkers).toHaveLength(0);
    });
    expect(scanMed).toBeLessThanOrEqual(5);
    expect(segMed).toBeLessThanOrEqual(5);
  });
});
