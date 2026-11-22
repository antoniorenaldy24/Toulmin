import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/clauses.json" with { type: "json" };
import { partitionClauses, scanCitations } from "../src/index.js";

interface ClauseGoldenEntry {
  readonly id: string;
  readonly input: string;
  readonly expected: readonly {
    readonly claimText: string;
    readonly markerRawTexts: readonly string[];
    readonly uncited: boolean;
  }[];
}

describe("conformance/l0/clauses.json", () => {
  const cases = vectors as unknown as readonly ClauseGoldenEntry[];

  for (const tc of cases) {
    it(`${tc.id}`, () => {
      const markers = scanCitations(tc.input);
      const clauses = partitionClauses(tc.input, markers);
      expect(clauses).toHaveLength(tc.expected.length);
      for (let i = 0; i < tc.expected.length; i++) {
        const c = clauses[i]!;
        const exp = tc.expected[i]!;
        expect(c.clauseIndex).toBe(i);
        expect(c.claimText).toBe(exp.claimText);
        expect(c.markers.map((m) => m.rawText)).toEqual(exp.markerRawTexts);
        expect(c.uncited).toBe(exp.uncited);
        expect(c.span.start).toBeGreaterThanOrEqual(0);
        expect(c.span.end).toBeLessThanOrEqual(tc.input.length);
        expect(c.span.start).toBeLessThanOrEqual(c.span.end);
        if (i > 0) {
          expect(clauses[i - 1]!.range.end).toBeLessThanOrEqual(c.range.start);
        }
      }
    });
  }
});
