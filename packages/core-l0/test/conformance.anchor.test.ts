import { describe, expect, it } from "vitest";
import anchorVectors from "../../../conformance/l0/anchor.json" with { type: "json" };
import triageVectors from "../../../conformance/l0/triage_baseline.json" with { type: "json" };
import {
  validateL2Verdict,
  validateLocalVerdict,
  type AnchorFailReason,
  type Stage2ValidatorInput,
} from "../src/anchor.js";
import { baselineTriage, type BaselineTriageInput } from "../src/triageBaseline.js";
import type { L2Verdict } from "@toulmin/schemas";

describe("conformance/l0/anchor.json (AC-L0-06..09)", () => {
  for (const tc of anchorVectors.localCases) {
    it(`local: ${tc.id}`, () => {
      const actual = validateLocalVerdict(
        tc.out as unknown as Stage2ValidatorInput,
        tc.evidence,
        tc.claim,
        {
          ...("calibratedVariant" in tc && tc.calibratedVariant !== undefined
            ? { calibratedVariant: tc.calibratedVariant }
            : {}),
          ...("actualVariant" in tc && tc.actualVariant !== undefined
            ? { actualVariant: tc.actualVariant }
            : {}),
        },
      );

      expect(actual.verdict).toBe(tc.expected.verdict);
      expect(actual.failReason).toBe(tc.expected.failReason as AnchorFailReason | null);
      expect(actual.noDifferenceNote).toBe(tc.expected.noDifferenceNote);
      expect(actual.anchor !== null).toBe(tc.expected.hasAnchor);

      if ("snappedRange" in tc.expected && tc.expected.snappedRange !== undefined) {
        expect(actual.anchor?.snapped).toStrictEqual(tc.expected.snappedRange);
      }
      if ("snappedSnippet" in tc.expected && tc.expected.snappedSnippet !== undefined) {
        expect(actual.anchor?.snippet).toBe(tc.expected.snappedSnippet);
      }
    });
  }

  for (const tc of anchorVectors.l2Cases) {
    it(`l2: ${tc.id}`, () => {
      const actual = validateL2Verdict(
        tc.l2Out as unknown as L2Verdict,
        tc.evidence,
        tc.claim,
      );

      expect(actual.verdict).toBe(tc.expected.verdict);
      expect(actual.failReason).toBe(tc.expected.failReason as AnchorFailReason | null);
      expect(actual.noDifferenceNote).toBe(tc.expected.noDifferenceNote);
      expect(actual.quote !== null).toBe(tc.expected.hasQuote);
      expect(actual.quoteAnchor !== null).toBe(tc.expected.hasQuote);
      if (tc.expected.hasQuote) {
        expect(actual.quote).toBe(actual.quoteAnchor?.snippet);
      }
      if ("evidenceIdx" in tc.expected && tc.expected.evidenceIdx !== undefined) {
        expect(actual.quoteAnchor?.evidenceIdx).toBe(tc.expected.evidenceIdx);
      }
      if ("quote" in tc.expected && tc.expected.quote !== undefined) {
        expect(actual.quote).toBe(tc.expected.quote);
      }
    });
  }
});

describe("conformance/l0/triage_baseline.json (AC-L0-25)", () => {
  for (const tc of triageVectors.cases) {
    it(`triage: ${tc.id}`, () => {
      const actual = baselineTriage(tc.input as BaselineTriageInput);
      expect(actual.claimType).toBe(tc.expected.claimType);
      expect(actual.worth).toBe(tc.expected.worth);
      expect(actual.uncited).toBe(tc.expected.uncited);
      expect(actual.atoms).toHaveLength(1);
      expect(actual.atoms[0]!.claimType).toBe(tc.expected.claimType);
    });
  }
});
