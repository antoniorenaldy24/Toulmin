import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/segment.json" with { type: "json" };
import {
  segmentDocument,
  type CanonicalSectionLabel,
  type SourceFormat,
} from "../src/index.js";

interface ExpectedSegmentItem {
  readonly text: string;
  readonly markerCount?: number;
  readonly section?: CanonicalSectionLabel;
  readonly eligible?: boolean;
  readonly wordCount?: number;
}

interface SegmentGoldenEntry {
  readonly id: string;
  readonly op: "segment";
  readonly format: SourceFormat;
  readonly input: string;
  readonly expected: readonly ExpectedSegmentItem[];
}

describe("conformance/l0/segment.json", () => {
  const cases = vectors as unknown as readonly SegmentGoldenEntry[];

  for (const tc of cases) {
    it(`${tc.id}`, () => {
      const res = segmentDocument(tc.input, tc.format);
      expect(res.sentences).toHaveLength(tc.expected.length);
      for (let i = 0; i < tc.expected.length; i++) {
        const sent = res.sentences[i]!;
        const exp = tc.expected[i]!;
        expect(sent.rawText).toBe(exp.text);
        expect(tc.input.slice(sent.start, sent.end)).toBe(exp.text);
        if (exp.markerCount !== undefined) {
          expect(sent.markers).toHaveLength(exp.markerCount);
        }
        if (exp.section !== undefined) {
          expect(sent.section).toBe(exp.section);
        }
        if (exp.eligible !== undefined) {
          expect(sent.eligible).toBe(exp.eligible);
        }
        if (exp.wordCount !== undefined) {
          expect(sent.wordCount).toBe(exp.wordCount);
        }
      }
    });
  }
});
