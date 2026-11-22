import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/citations.json" with { type: "json" };
import {
  extractMarkdownNumberedReferences,
  preMask,
  resolveCitationMarkers,
  scanCitations,
  type BibliographyEntry,
  type CitationRuleKind,
  type MarkerKind,
  type MarkerResolutionStatus,
} from "../src/index.js";

type CitationsGoldenEntry =
  | {
      readonly id: string;
      readonly op: "scan";
      readonly latexSource?: string;
      readonly bibKeys?: readonly string[];
      readonly input: string;
      readonly expected: readonly {
        readonly rule: CitationRuleKind;
        readonly kind: MarkerKind;
        readonly narrative: boolean;
        readonly keys?: readonly string[];
        readonly numericIds?: readonly number[];
        readonly rawText?: string;
        readonly surnames?: readonly string[];
        readonly years?: readonly string[];
      }[];
    }
  | {
      readonly id: string;
      readonly op: "scanBatch";
      readonly cases: readonly {
        readonly input: string;
        readonly expectedNumeric: readonly (readonly number[])[];
      }[];
    }
  | {
      readonly id: string;
      readonly op: "resolve";
      readonly input: string;
      readonly entries: readonly BibliographyEntry[];
      readonly expected: {
        readonly markerCount: number;
        readonly statuses: readonly MarkerResolutionStatus[];
        readonly resolvedRefIds?: readonly string[];
        readonly possibleCitationTexts?: readonly string[];
        readonly unresolvedKeys: readonly string[];
      };
    }
  | {
      readonly id: string;
      readonly op: "resolveMarkdown";
      readonly input: string;
      readonly expected: {
        readonly resolvedRefIds: readonly string[];
        readonly statuses: readonly MarkerResolutionStatus[];
        readonly unresolvedKeys: readonly string[];
      };
    };

describe("conformance/l0/citations.json", () => {
  const cases = vectors as unknown as readonly CitationsGoldenEntry[];

  for (const tc of cases) {
    it(`${tc.id} (${tc.op})`, () => {
      switch (tc.op) {
        case "scan": {
          const customCiteMacros =
            tc.latexSource !== undefined ? preMask(tc.latexSource, "latex").customCiteMacros : undefined;
          const bibKeys = tc.bibKeys !== undefined ? new Set(tc.bibKeys) : undefined;
          const scanOpts = {
            ...(customCiteMacros !== undefined ? { customCiteMacros } : {}),
            ...(bibKeys !== undefined ? { bibKeys } : {}),
          };
          const markers = scanCitations(tc.input, scanOpts);
          expect(markers).toHaveLength(tc.expected.length);
          for (let i = 0; i < tc.expected.length; i++) {
            const actual = markers[i]!;
            const exp = tc.expected[i]!;
            expect(actual.rule).toBe(exp.rule);
            expect(actual.kind).toBe(exp.kind);
            expect(actual.narrative).toBe(exp.narrative);
            if (exp.keys !== undefined) expect(actual.keys).toEqual(exp.keys);
            if (exp.numericIds !== undefined) expect(actual.numericIds).toEqual(exp.numericIds);
            if (exp.rawText !== undefined) expect(actual.rawText).toBe(exp.rawText);
            if (exp.surnames !== undefined) {
              expect(actual.authorYears.map((a) => a.surname)).toEqual(exp.surnames);
            }
            if (exp.years !== undefined) {
              expect(actual.authorYears.map((a) => a.year)).toEqual(exp.years);
            }
          }
          break;
        }
        case "scanBatch": {
          for (const sub of tc.cases) {
            const markers = scanCitations(sub.input);
            expect(markers.map((m) => m.numericIds), sub.input).toEqual(sub.expectedNumeric);
          }
          break;
        }
        case "resolve": {
          const markers = scanCitations(tc.input);
          expect(markers).toHaveLength(tc.expected.markerCount);
          const res = resolveCitationMarkers(markers, { entries: tc.entries });
          expect(res.resolvedMarkers.map((r) => r.status)).toEqual(tc.expected.statuses);
          if (tc.expected.resolvedRefIds !== undefined) {
            expect(res.resolvedRefIds).toEqual(tc.expected.resolvedRefIds);
          }
          if (tc.expected.possibleCitationTexts !== undefined) {
            expect(res.possibleCitations.map((p) => p.text)).toEqual(tc.expected.possibleCitationTexts);
          }
          expect(res.unresolvedKeys).toEqual(tc.expected.unresolvedKeys);
          break;
        }
        case "resolveMarkdown": {
          const masked = preMask(tc.input, "md");
          const mdRefs = extractMarkdownNumberedReferences(tc.input, masked);
          expect(mdRefs.length).toBeGreaterThan(0);
          const markers = scanCitations(masked.maskedText, { hasKnownNumberingOrder: true });
          const res = resolveCitationMarkers(markers, { markdownNumberedRefs: mdRefs });
          expect(res.resolvedRefIds).toEqual(tc.expected.resolvedRefIds);
          expect(res.resolvedMarkers.map((r) => r.status)).toEqual(tc.expected.statuses);
          expect(res.unresolvedKeys).toEqual(tc.expected.unresolvedKeys);
          break;
        }
      }
    });
  }
});
