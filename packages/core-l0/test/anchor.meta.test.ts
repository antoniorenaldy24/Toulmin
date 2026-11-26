import { describe, expect, it } from "vitest";
import {
  bestWindow,
  contentStems,
  contentTokens,
  countNeg,
  measureOf,
  sharedSeq,
  softFor,
  vTok,
  validateAnchor,
  validateL2Verdict,
} from "../src/anchor.js";
import { baselineTriage } from "../src/triageBaseline.js";
import {
  BUNDLED_SAMPLE_PRIVACY_CONTEXT,
  derive,
  type ClaimLedgerEntry,
  type PolicySnapshot,
  type PrivacyContext,
  type RefFacts,
  type SessionFacts,
} from "../src/ledger.js";
import { sha256hex } from "../src/norm.js";

/**
 * Meta-test executing the complete post-decode Tier B algorithms over every
 * normative worked example of `03` §2.6 (1–20 + sub-cases) and `03` §3.4
 * (`AC-L0-24`), verifying all stated intermediate counts and derived states.
 */
describe("anchor.meta.test.ts — 03 §2.6 & §3.4 normative examples (AC-L0-24)", () => {
  it("03 §2.6 Ex 1–4: negation margin, mid-dot decimal snapping, and non-diabetic comma clause stop", () => {
    const ev1 = "We found no significant difference in 30-day mortality (12.1% vs 12.4%).";
    const sp1 = "significant difference in 30-day mortality";
    const ev1Tok = vTok(ev1).tokens;
    const sp1Tok = vTok(sp1).tokens;
    const r1 = validateAnchor(
      {
        s01_evidence_span: sp1,
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      [ev1],
      "X lowered 30-day mortality",
      "L1",
    );
    expect(countNeg(sp1Tok, softFor(ev1Tok))).toBe(0);
    expect(countNeg(ev1Tok.slice(1, 8), softFor(sp1Tok))).toBe(1);
    expect(r1.failReason).toBe("NEGATION_PARITY");

    const r2 = validateAnchor(
      {
        s01_evidence_span: "no significant difference in 30-day mortality",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["We found no significant difference in 30-day mortality (12.1% vs 12.4%)."],
      "There was no significant difference in 30-day mortality with X",
      "L1",
    );
    expect(r2.verdict).toBe("SUPPORTED");
    expect(r2.trace?.negSpan).toBe(1);
    expect(r2.trace?.negWin).toBe(1);
    expect(r2.trace?.sharedStemsCount).toBeGreaterThanOrEqual(3);

    const r3 = validateAnchor(
      {
        s01_evidence_span: "Mortality fell from 18.2% to 12.7%",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Exact match.",
        s04_verdict: "SUPPORTED",
      },
      ["Mortality fell from 18\u00b72% to 12\u00b77% (p = 0\u00b701)."],
      "Mortality fell from 18.2% to 12.7%",
      "L1",
    );
    expect(r3.verdict).toBe("SUPPORTED");
    expect(r3.anchor?.snippet).toBe("Mortality fell from 18\u00b72% to 12\u00b77%");
    expect(r3.anchor?.snapped).toStrictEqual({ start: 0, end: 34 });

    const r4 = validateAnchor(
      {
        s01_evidence_span: "the intervention reduced HbA1c by 0.4%",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Exact match.",
        s04_verdict: "SUPPORTED",
      },
      ["In non-diabetic patients, the intervention reduced HbA1c by 0.4%."],
      "the intervention reduced HbA1c by 0.4%",
      "L1",
    );
    expect(r4.verdict).toBe("SUPPORTED");
    expect(r4.trace?.negWin).toBe(0);
  });

  it("03 §2.6 Ex 5–9b: fragments, value contradiction, kindMismatch, lowOverlap = 0, scopeNeg = 1, concessive", () => {
    expect(contentTokens(vTok("by 40%").tokens)).toHaveLength(1);
    const r5 = validateAnchor(
      {
        s01_evidence_span: "treatment reduced pain ... by 40%",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["The treatment reduced pain scores by 30% at 12 weeks."],
      "The treatment reduced pain scores by 40%",
      "L1",
    );
    expect(r5.failReason).toBe("FRAGMENT_TOO_SHORT");

    const r6 = validateAnchor(
      {
        s01_evidence_span: "The treatment reduced pain scores by 30%",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Pain reduced.",
        s04_verdict: "SUPPORTED",
      },
      ["The treatment reduced pain scores by 30% at 12 weeks."],
      "The treatment reduced pain scores by 40%",
      "L1",
    );
    expect(r6.failReason).toBe("CLAIM_SPAN_MISMATCH");
    expect(r6.trace?.valueDiff).toBe(true);

    const r7 = validateAnchor(
      {
        s01_evidence_span: "The treatment reduced pain scores by 30%",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "30% differs from 40%.",
        s04_verdict: "CONTRADICTS",
      },
      ["The treatment reduced pain scores by 30% at 12 weeks."],
      "The treatment reduced pain scores by 40%",
      "L1",
    );
    expect(r7.verdict).toBe("CONTRADICTS");
    expect(r7.trace?.sharedStemsCount).toBe(3);
    expect(r7.trace?.kindMismatch).toBe(false);

    const r7b = validateAnchor(
      {
        s01_evidence_span: "The treatment reduced pain scores within 30 days",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Duration rather than percentage.",
        s04_verdict: "CONTRADICTS",
      },
      ["The treatment reduced pain scores within 30 days."],
      "The treatment reduced pain scores by 40%",
      "L1",
    );
    expect(r7b.failReason).toBe("CLAIM_SPAN_MISMATCH");
    expect(r7b.trace?.kindMismatch).toBe(true);

    const r7c = validateAnchor(
      {
        s01_evidence_span: "The treatment reduced anxiety scores by 30%",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "30% vs 40%.",
        s04_verdict: "CONTRADICTS",
      },
      ["The treatment reduced anxiety scores by 30%."],
      "The drug lowered blood pressure by 40%",
      "L1",
    );
    expect(r7c.failReason).toBe("LOW_CLAIM_OVERLAP");
    expect(r7c.trace?.sharedStemsCount).toBe(0);

    const ev8 = "There was no convincing evidence in this trial that the new intervention substantially reduced mortality.";
    const ev8Tok = vTok(ev8).tokens;
    const sp8 = "the new intervention substantially reduced mortality";
    // "no" at index 2 lies > 4 tokens left of window start (9), so without scopeNeg margin has 0 negations:
    expect(countNeg(ev8Tok.slice(5, ev8Tok.length), softFor(vTok(sp8).tokens))).toBe(0);
    const r8 = validateAnchor(
      {
        s01_evidence_span: sp8,
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      [ev8],
      "the intervention reduced mortality",
      "L1",
    );
    expect(r8.failReason).toBe("NEGATION_PARITY");

    const r9 = validateAnchor(
      {
        s01_evidence_span: "The intervention reduced mortality",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["The intervention reduced mortality, although not significantly (p = 0.2)."],
      "The intervention reduced mortality",
      "L1",
    );
    expect(r9.trace?.spanContentCount).toBe(3);
    expect(r9.trace?.qualified).toBe(true);
    expect(r9.failReason).toBe("NEGATION_PARITY");

    const r9b = validateAnchor(
      {
        s01_evidence_span: "The intervention reduced pain",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["The intervention reduced pain, but there were no serious adverse events."],
      "The intervention reduced pain",
      "L1",
    );
    expect(r9b.trace?.spanContentCount).toBe(3);
    expect(r9b.trace?.qualified).toBe(false);
    expect(r9b.verdict).toBe("SUPPORTED");
  });

  it("03 §2.6 Ex 10–17: exact containment 3/4 & 4/5, measureOf, softFor(clTok) with overlap=2, idioms, and conflict/kindMismatch", () => {
    const r10 = validateAnchor(
      {
        s01_evidence_span: "Differences were significant in both arms",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Significant differences observed.",
        s04_verdict: "SUPPORTED",
      },
      ["Differences were non-significant in both arms."],
      "Differences were significant in both arms",
      "L1",
    );
    expect(r10.failReason).toBe("NEGATION_PARITY");

    const ev11 = "Adherence was 12.1% in the control arm.";
    const sp11 = vTok("Adherence was 2.1% in the control arm").tokens;
    expect(contentTokens(sp11)).toHaveLength(4);
    expect(bestWindow(vTok(ev11).tokens, sp11, 0).containment).toBe(0.75);
    const r11 = validateAnchor(
      {
        s01_evidence_span: "Adherence was 2.1% in the control arm",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Adherence was 2.1%.",
        s04_verdict: "SUPPORTED",
      },
      [ev11],
      "Adherence was 2.1% in the control arm",
      "L1",
    );
    expect(r11.failReason).toBe("NUMERIC_PARITY");

    const ev12 = "Symptoms worsened by 30% in the treated group.";
    const sp12 = "Symptoms improved by 30% in the treated group";
    expect(contentTokens(vTok(sp12).tokens)).toHaveLength(5);
    expect(bestWindow(vTok(ev12).tokens, vTok(sp12).tokens, 0).containment).toBe(0.8);
    const r12 = validateAnchor(
      {
        s01_evidence_span: sp12,
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Symptoms improved by 30%.",
        s04_verdict: "SUPPORTED",
      },
      [ev12],
      sp12,
      "L1",
    );
    expect(r12.failReason).toBe("DIRECTION_PARITY");

    const ev12bText = "Pain decreased by 30% in the treated group.";
    expect(measureOf(ev12bText, vTok(ev12bText).tokens, 1)).toBe("ADVERSE");
    const r12b = validateAnchor(
      {
        s01_evidence_span: "Pain decreased by 30% in the treated group",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      [ev12bText],
      "Pain improved by 30% in the treated group",
      "L1",
    );
    expect(r12b.verdict).toBe("SUPPORTED");
    expect(r12b.trace?.dirDiff).toBe(false);

    const r13 = validateAnchor(
      {
        s01_evidence_span: "The odds ratio was 0.045 lower",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["The odds ratio was .045 lower."],
      "The odds ratio was 0.045 lower",
      "L1",
    );
    expect(r13.verdict).toBe("SUPPORTED");
    expect(r13.trace?.valueDiff).toBe(false);

    const r14 = validateAnchor(
      {
        s01_evidence_span: "The effect was not only large but also durable",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["The effect was not only large but also durable."],
      "the effect was large and durable",
      "L1",
    );
    expect(r14.trace?.spanContentCount).toBe(5);
    expect(r14.trace?.negSpan).toBe(0);
    expect(r14.trace?.negWin).toBe(0);
    expect(r14.trace?.sharedStemsCount).toBe(3);
    expect(r14.verdict).toBe("SUPPORTED");

    const r15 = validateAnchor(
      {
        s01_evidence_span: "Rates were similar between groups",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["Rates were similar between groups."],
      "Rates were similar between groups",
      "L1",
    );
    expect(r15.trace?.spanContentCount).toBe(3);
    expect(r15.trace?.negSpan).toBe(0);
    expect(r15.trace?.negWin).toBe(0);
    expect(r15.verdict).toBe("SUPPORTED");

    const r15b = validateAnchor(
      {
        s01_evidence_span: "Rates were similar between groups",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["Rates were similar between groups."],
      "Rates did not differ between groups",
      "L1",
    );
    expect(r15b.trace?.sharedStemsCount).toBe(2);
    expect(r15b.trace?.negDiff).toBe(false);
    expect(r15b.verdict).toBe("SUPPORTED");

    const r15c = validateAnchor(
      {
        s01_evidence_span: "Mortality was lower in patients with heart failure",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches.",
        s04_verdict: "SUPPORTED",
      },
      ["Mortality was lower in patients with heart failure."],
      "Mortality was lower in patients with heart failure",
      "L1",
    );
    expect(r15c.verdict).toBe("SUPPORTED");
    expect(r15c.trace?.negWin).toBe(0);

    const r16 = validateAnchor(
      {
        s01_evidence_span: "Dose information was reviewed during follow-up",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "The abstract does not mention dose.",
        s04_verdict: "SUPPORTED",
      },
      ["Dose information was reviewed during follow-up."],
      "Dose information was reviewed during follow-up",
      "L1",
    );
    expect(r16.failReason).toBe("REASONING_VERDICT_CONFLICT");

    const r17 = validateAnchor(
      {
        s01_evidence_span: "Readmission was 30% in both arms",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Matches 30.",
        s04_verdict: "SUPPORTED",
      },
      ["Readmission was 30% in both arms."],
      "Readmission was 30 days in both arms",
      "L1",
    );
    expect(r17.failReason).toBe("CLAIM_SPAN_MISMATCH");
    expect(r17.trace?.kindMismatch).toBe(true);
  });

  it("03 §2.6 Ex 18–20: sharedSeq order check on numeric swaps and L1/L2 noDifferenceNote & valence", () => {
    const ev18 = "The drug reduced blood pressure in older adults.";
    const r18 = validateAnchor(
      {
        s01_evidence_span: "The drug reduced blood pressure in older adults",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Contradicts claim.",
        s04_verdict: "CONTRADICTS",
      },
      [ev18],
      "The drug reduced blood pressure in older adults",
      "L1",
    );
    expect(r18.failReason).toBe("NO_DIFFERENCE_SIGNAL");
    expect(r18.trace?.identical).toBe(true);

    const r18b = validateL2Verdict(
      {
        s1_source_identified: "CITED_DOI_MATCHED",
        s2_quote: "The drug reduced blood pressure in older adults",
        s3_quote_origin: "PROVIDED_EVIDENCE",
        s4_reasoning: "Contradicts claim.",
        s5_verdict: "CONTRADICTED",
        s6_alternatives: [],
      },
      [ev18],
      "The drug reduced blood pressure in older adults",
    );
    expect(r18b.verdict).toBe("NEI");
    expect(r18b.failReason).toBe("NO_DIFFERENCE_SIGNAL");

    const ev19 = "Drug Y outperformed drug X in remission rates.";
    const r19 = validateAnchor(
      {
        s01_evidence_span: "Drug Y outperformed drug X in remission rates",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Drugs reversed.",
        s04_verdict: "CONTRADICTS",
      },
      [ev19],
      "Drug X outperformed drug Y in remission rates",
      "L1",
    );
    expect(r19.failReason).toBe("NO_DIFFERENCE_SIGNAL");

    const r19b = validateL2Verdict(
      {
        s1_source_identified: "CITED_DOI_MATCHED",
        s2_quote: "Drug Y outperformed drug X in remission rates",
        s3_quote_origin: "PROVIDED_EVIDENCE",
        s4_reasoning: "Drug Y outperformed Drug X instead of Drug X outperforming Drug Y.",
        s5_verdict: "CONTRADICTED",
        s6_alternatives: [],
      },
      [ev19],
      "Drug X outperformed drug Y in remission rates",
    );
    expect(r19b.verdict).toBe("CONTRADICTED");
    expect(r19b.noDifferenceNote).toBe(true);

    const ev19c = "Mortality was 12% with X and 18% with Y.";
    const cl19c = "Mortality was 18% with X and 12% with Y";
    const evTok = vTok(ev19c).tokens;
    const clTok = vTok(cl19c).tokens;
    expect(sharedSeq(clTok, evTok)).toStrictEqual(["mortal", "#18|%|true", "x", "#12|%|true", "y"]);
    expect(sharedSeq(evTok, clTok)).toStrictEqual(["mortal", "#12|%|true", "x", "#18|%|true", "y"]);

    const r19c = validateL2Verdict(
      {
        s1_source_identified: "CITED_DOI_MATCHED",
        s2_quote: "Mortality was 12% with X and 18% with Y",
        s3_quote_origin: "PROVIDED_EVIDENCE",
        s4_reasoning: "Values are swapped between X and Y.",
        s5_verdict: "CONTRADICTED",
        s6_alternatives: [],
      },
      [ev19c],
      cl19c,
    );
    expect(r19c.verdict).toBe("CONTRADICTED");
    expect(r19c.noDifferenceNote).toBe(true);

    const r20Sup = validateAnchor(
      {
        s01_evidence_span: "The drug increased pain scores in older adults",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Adverse pain direction.",
        s04_verdict: "SUPPORTED",
      },
      ["The drug increased pain scores in older adults."],
      "The drug improved pain scores in older adults",
      "L1",
    );
    expect(r20Sup.failReason).toBe("CLAIM_SPAN_MISMATCH");
    expect(r20Sup.trace?.dirDiff).toBe(true);

    const r20Con = validateAnchor(
      {
        s01_evidence_span: "The drug increased pain scores in older adults",
        s02_evidence_idx: 0,
        s03_micro_reasoning: "Evidence shows increased pain, contradicting improvement.",
        s04_verdict: "CONTRADICTS",
      },
      ["The drug increased pain scores in older adults."],
      "The drug improved pain scores in older adults",
      "L1",
    );
    expect(r20Con.verdict).toBe("CONTRADICTS");
    expect(r20Con.trace?.dirDiff).toBe(true);
    expect(contentStems(vTok("Rates were similar between groups").tokens).size).toBe(2);
  });

  it("03 §3.4 normative examples integrated end-to-end with derive() from ledger.ts", () => {
    const policy: PolicySnapshot = {
      deviceProfile: "web_chrome_nano",
      b4CountsAsReview: true,
      profiles: {
        web_chrome_nano: {
          path: "B",
          authority: { B1: "advisory", B2: "advisory", B3: "advisory", B5: "advisory", O2: "advisory" },
          supportVerdicts: "advisory",
          calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
        },
      },
    };
    const mode: PrivacyContext = BUNDLED_SAMPLE_PRIVACY_CONTEXT;
    const session: SessionFacts = { localUnavailable: false, transient: new Map() };
    const refFacts = new Map<string, RefFacts>([
      [
        "ref-3",
        {
          refId: "ref-3",
          bibStatus: "RESOLVED",
          retracted: false,
          checkMetadata: false,
          evidenceVersion: sha256hex(""),
          hasEvidence: false,
          updatedSeq: 1,
        },
      ],
    ]);

    const rows: ReadonlyArray<{
      readonly text: string;
      readonly section: string;
      readonly refs: readonly string[];
      readonly expectedState: string;
    }> = [
      { text: "We enrolled 120 patients.", section: "methods", refs: [], expectedState: "NOT_CHECKABLE" },
      { text: "Mortality was 12% in the treated group.", section: "results", refs: [], expectedState: "NOT_CHECKABLE" },
      { text: "Mortality was 12% in the treated group.", section: "discussion", refs: [], expectedState: "UNCITED_EMPIRICAL" },
      { text: "One of the main causes of delay is staffing.", section: "introduction", refs: [], expectedState: "UNCITED_EMPIRICAL" },
      { text: "We followed the protocol of [3].", section: "methods", refs: ["ref-3"], expectedState: "NOT_CHECKABLE" },
      { text: "This study aims to describe staffing.", section: "introduction", refs: [], expectedState: "NOT_CHECKABLE" },
      { text: "More patients were treated.", section: "discussion", refs: [], expectedState: "NOT_CHECKABLE" },
      { text: "The delay resulted in longer stays.", section: "discussion", refs: [], expectedState: "UNCITED_EMPIRICAL" },
      { text: "The results are shown below.", section: "results", refs: [], expectedState: "NOT_CHECKABLE" },
    ];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      const baseline = baselineTriage({
        clauseText: row.text,
        section: row.section,
        hasResolvedCitation: row.refs.length > 0,
      });
      const entry: ClaimLedgerEntry = {
        claimId: `meta-triage-${i}`,
        docId: "doc-meta",
        sentenceHash: sha256hex(row.text),
        occurrenceIndex: 0,
        clauseIndex: 0,
        section: row.section,
        subsection: null,
        span: { start: 0, end: row.text.length },
        claimText: row.text,
        normalizedClaimHash: sha256hex(row.text),
        baseline,
        stage1: null,
        citationKeys: [...row.refs],
        possibleCitations: [],
        refs: row.refs.map((refId) => ({
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
        updatedAt: 1700000000000,
      };
      const derived = derive(entry, refFacts, policy, mode, session);
      expect(derived.state, `Row ${i}: ${row.text}`).toBe(row.expectedState);
    }
  });
});
