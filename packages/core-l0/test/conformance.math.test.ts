import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/math.json" with { type: "json" };
import {
  MASK_CHAR,
  applyLatexSubstitutions,
  mathText,
  normSentence,
  preMask,
  sentenceHash,
  type SourceFormat,
} from "../src/index.js";

type MathGoldenEntry =
  | {
      readonly id: string;
      readonly op: "normSentenceCompare";
      readonly format: SourceFormat;
      readonly inputA: string;
      readonly inputB: string;
      readonly expected: {
        readonly normA: string;
        readonly normB: string;
        readonly equal: boolean;
      };
    }
  | {
      readonly id: string;
      readonly op: "normSentence";
      readonly format: SourceFormat;
      readonly input: string;
      readonly markerRanges?: readonly { readonly start: number; readonly end: number }[];
      readonly expected: string;
    }
  | {
      readonly id: string;
      readonly op: "mathText";
      readonly input: string;
      readonly expected: string;
    }
  | {
      readonly id: string;
      readonly op: "preMask";
      readonly format: SourceFormat;
      readonly input: string;
      readonly expected: {
        readonly mathCount?: number;
        readonly displayCount?: number;
        readonly inlineCount?: number;
        readonly mathTexts?: readonly string[];
        readonly firstMathIsBlockBoundary?: boolean;
        readonly unmaskedEqualsInput?: boolean;
        readonly userMacros?: Readonly<Record<string, string>>;
        readonly macrosNotExpanded?: readonly string[];
        readonly fullyMasked?: boolean;
        readonly maskedLength?: number;
        readonly unmaskedTail?: string;
        readonly captions?: readonly {
          readonly rawText: string;
          readonly section: { readonly label: string; readonly subsection: string | null };
        }[];
        readonly footnotes?: readonly unknown[];
      };
    }
  | {
      readonly id: string;
      readonly op: "applyLatexSubstitutions";
      readonly input: string;
      readonly expected: {
        readonly text: string;
        readonly map?: readonly number[];
        readonly unregisteredCommands: readonly string[];
      };
    };

function assertOffsetMapInvariants(inputLen: number, outputText: string, map: readonly number[]): void {
  expect(map).toHaveLength(outputText.length + 1);
  expect(map[outputText.length]).toBe(inputLen);
  for (let i = 0; i < map.length; i++) {
    const val = map[i]!;
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(inputLen);
    if (i > 0) {
      expect(val).toBeGreaterThanOrEqual(map[i - 1]!);
    }
  }
}

describe("conformance/l0/math.json", () => {
  const cases = vectors as unknown as readonly MathGoldenEntry[];

  for (const tc of cases) {
    it(`${tc.id} (${tc.op})`, () => {
      switch (tc.op) {
        case "normSentenceCompare": {
          const normA = normSentence(tc.inputA, { format: tc.format });
          const normB = normSentence(tc.inputB, { format: tc.format });
          expect(normA).toBe(tc.expected.normA);
          expect(normB).toBe(tc.expected.normB);
          expect(normA === normB).toBe(tc.expected.equal);
          expect(sentenceHash(tc.inputA, { format: tc.format }) === sentenceHash(tc.inputB, { format: tc.format })).toBe(
            tc.expected.equal,
          );
          break;
        }
        case "normSentence": {
          const opts =
            tc.markerRanges !== undefined
              ? { format: tc.format, markerRanges: tc.markerRanges }
              : { format: tc.format };
          expect(normSentence(tc.input, opts)).toBe(tc.expected);
          break;
        }
        case "mathText": {
          expect(mathText(tc.input)).toBe(tc.expected);
          break;
        }
        case "preMask": {
          const res = preMask(tc.input, tc.format);
          expect(res.maskedText.length).toBe(tc.input.length);
          const exp = tc.expected;
          if (exp.mathCount !== undefined) {
            expect(res.mathRegions).toHaveLength(exp.mathCount);
          }
          if (exp.displayCount !== undefined) {
            expect(res.report.mathRegions.display).toBe(exp.displayCount);
          }
          if (exp.inlineCount !== undefined) {
            expect(res.report.mathRegions.inline).toBe(exp.inlineCount);
          }
          if (exp.mathTexts !== undefined) {
            expect(res.mathRegions.map((m) => m.text)).toEqual(exp.mathTexts);
          }
          if (exp.firstMathIsBlockBoundary !== undefined) {
            const firstMathRegion = res.regions.find(
              (r) => r.kind === "display_math" || r.kind === "inline_math",
            );
            expect(firstMathRegion?.isBlockBoundary).toBe(exp.firstMathIsBlockBoundary);
          }
          if (exp.unmaskedEqualsInput === true) {
            expect(res.maskedText).toBe(tc.input);
          }
          if (exp.userMacros !== undefined) {
            const actualObj: Record<string, string> = {};
            for (const [k, v] of res.userMacros.entries()) {
              actualObj[k] = v;
            }
            expect(actualObj).toEqual(exp.userMacros);
          }
          if (exp.macrosNotExpanded !== undefined) {
            expect(res.report.macrosNotExpanded).toEqual(exp.macrosNotExpanded);
          }
          if (exp.fullyMasked === true) {
            expect(res.maskedText).toBe(MASK_CHAR.repeat(tc.input.length));
          }
          if (exp.maskedLength !== undefined && exp.unmaskedTail !== undefined) {
            expect(res.maskedText).toBe(MASK_CHAR.repeat(exp.maskedLength) + exp.unmaskedTail);
          }
          if (exp.captions !== undefined) {
            const captions = res.proseStreams
              .filter((s) => s.kind === "caption")
              .map((s) => ({ rawText: s.rawText, section: s.section }));
            expect(captions).toEqual(exp.captions);
          }
          if (exp.footnotes !== undefined) {
            const footnotes = res.proseStreams.filter((s) => s.kind === "footnote");
            expect(footnotes).toEqual(exp.footnotes);
          }
          break;
        }
        case "applyLatexSubstitutions": {
          const res = applyLatexSubstitutions(tc.input);
          expect(res.text).toBe(tc.expected.text);
          expect(res.unregisteredCommands).toEqual(tc.expected.unregisteredCommands);
          assertOffsetMapInvariants(tc.input.length, res.text, res.map);
          if (tc.expected.map !== undefined) {
            expect(res.map).toEqual(tc.expected.map);
          }
          break;
        }
      }
    });
  }
});
