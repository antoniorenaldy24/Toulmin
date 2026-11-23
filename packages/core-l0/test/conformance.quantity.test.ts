import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/quantity.json" with { type: "json" };
import {
  extractQuantities,
  sameFamily,
  type MetricClass,
  type PComparator,
} from "../src/index.js";

interface ExpectedTupleShape {
  readonly valueRaw?: string;
  readonly unitRaw?: string;
  readonly unitCanon?: string;
  readonly valueNorm?: number;
  readonly valueLo?: number;
  readonly valueHi?: number;
  readonly sigDigits?: number;
  readonly metricClass?: MetricClass;
  readonly pComparator?: PComparator | null;
  readonly keyLemmas?: readonly string[];
}

interface QuantityGoldenCase {
  readonly id: string;
  readonly input: string;
  readonly lang?: string;
  readonly tableHeader?: string;
  readonly rowLabel?: string;
  readonly assertNotSameFamily?: readonly (readonly [string, string])[];
  readonly expected: readonly ExpectedTupleShape[];
}

describe("conformance/l0/quantity.json", () => {
  const cases = vectors as unknown as readonly QuantityGoldenCase[];

  for (const tc of cases) {
    it(`${tc.id}`, () => {
      const actual = extractQuantities(tc.input, {
        ...(tc.lang !== undefined ? { lang: tc.lang } : {}),
        ...(tc.tableHeader !== undefined ? { tableHeader: tc.tableHeader } : {}),
        ...(tc.rowLabel !== undefined ? { rowLabel: tc.rowLabel } : {}),
      });

      expect(actual).toHaveLength(tc.expected.length);

      for (let i = 0; i < tc.expected.length; i++) {
        const a = actual[i]!;
        const e = tc.expected[i]!;
        if (e.valueRaw !== undefined) {
          expect(a.valueRaw).toBe(e.valueRaw);
        }
        if (e.unitRaw !== undefined) {
          expect(a.unitRaw).toBe(e.unitRaw);
        }
        if (e.unitCanon !== undefined) {
          expect(a.unitCanon).toBe(e.unitCanon);
        }
        if (e.valueNorm !== undefined) {
          expect(a.valueNorm).toBeCloseTo(e.valueNorm, 12);
        }
        if (e.valueLo !== undefined) {
          expect(a.valueLo).toBeCloseTo(e.valueLo, 12);
        }
        if (e.valueHi !== undefined) {
          expect(a.valueHi).toBeCloseTo(e.valueHi, 12);
        }
        if (e.sigDigits !== undefined) {
          expect(a.sigDigits).toBe(e.sigDigits);
        }
        if (e.metricClass !== undefined) {
          expect(a.metricClass).toBe(e.metricClass);
        }
        if (e.pComparator !== undefined) {
          expect(a.pComparator).toBe(e.pComparator);
        }
        if (e.keyLemmas !== undefined) {
          expect(a.keyLemmas).toEqual(e.keyLemmas);
        }
        expect(a.span.start).toBeGreaterThanOrEqual(0);
        expect(a.span.end).toBeLessThanOrEqual(tc.input.length);
        expect(a.span.start).toBeLessThanOrEqual(a.span.end);
      }

      if (tc.assertNotSameFamily !== undefined) {
        for (const [ua, ub] of tc.assertNotSameFamily) {
          expect(sameFamily(ua, ub)).toBe(false);
        }
      }
    });
  }
});
