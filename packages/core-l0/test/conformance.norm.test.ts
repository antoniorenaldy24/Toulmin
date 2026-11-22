import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/norm.json" with { type: "json" };
import {
  codePointAtSafe,
  foldLatin,
  generalCategory,
  isDigit,
  isLetter,
  isLetterAt,
  isLower,
  isSpace,
  isUpper,
  norm,
  normLower,
  normLowerWithMap,
  sha256hex
} from "../src/index.js";

interface NormExpected {
  readonly text: string;
  readonly map: number[];
}

interface CharClassExpected {
  readonly generalCategory: string;
  readonly isLetter: boolean;
  readonly isUpper: boolean;
  readonly isLower: boolean;
  readonly isDigit: boolean;
  readonly isSpace: boolean;
  readonly normLower: string;
}

type GoldenEntry =
  | {
      readonly id: string;
      readonly op: "norm";
      readonly input?: string;
      readonly codeUnits?: number[];
      readonly expected: NormExpected;
    }
  | {
      readonly id: string;
      readonly op: "normLower";
      readonly input?: string;
      readonly codeUnits?: number[];
      readonly expected: NormExpected;
    }
  | {
      readonly id: string;
      readonly op: "foldLatin";
      readonly input?: string;
      readonly codeUnits?: number[];
      readonly expected: string;
    }
  | {
      readonly id: string;
      readonly op: "letterWord";
      readonly input?: string;
      readonly codeUnits?: number[];
      readonly expected: boolean[];
    }
  | {
      readonly id: string;
      readonly op: "charClass";
      readonly input?: string;
      readonly codeUnits?: number[];
      readonly expected: CharClassExpected;
    }
  | {
      readonly id: string;
      readonly op: "sha256hex";
      readonly input?: string;
      readonly codeUnits?: number[];
      readonly expected: string;
    };

function resolveInput(entry: GoldenEntry): string {
  if (entry.codeUnits !== undefined) {
    return String.fromCharCode(...entry.codeUnits);
  }
  return entry.input ?? "";
}

function assertMapInvariants(input: string, result: NormExpected): void {
  expect(result.map.length).toBe(result.text.length + 1);
  expect(result.map[result.text.length]).toBe(input.length);
  for (let i = 0; i < result.map.length; i += 1) {
    const cur = result.map[i]!;
    expect(cur).toBeGreaterThanOrEqual(0);
    expect(cur).toBeLessThanOrEqual(input.length);
    if (i > 0) {
      expect(cur).toBeGreaterThanOrEqual(result.map[i - 1]!);
    }
  }
}

describe("conformance/l0/norm.json", () => {
  const entries = vectors as readonly GoldenEntry[];

  for (const entry of entries) {
    it(`${entry.id} (${entry.op})`, () => {
      const input = resolveInput(entry);
      switch (entry.op) {
        case "norm": {
          const actual = norm(input);
          expect(actual).toStrictEqual(entry.expected);
          assertMapInvariants(input, actual);
          break;
        }
        case "normLower": {
          const actual = normLowerWithMap(input);
          expect(actual).toStrictEqual(entry.expected);
          expect(normLower(input)).toBe(entry.expected.text);
          assertMapInvariants(input, actual);
          break;
        }
        case "foldLatin": {
          expect(foldLatin(input)).toBe(entry.expected);
          break;
        }
        case "letterWord": {
          const flags: boolean[] = [];
          for (let i = 0; i < input.length; i += 1) {
            flags.push(isLetterAt(input, i));
          }
          expect(flags).toStrictEqual(entry.expected);
          break;
        }
        case "charClass": {
          const unit = codePointAtSafe(input, 0);
          expect(generalCategory(unit.cp)).toBe(entry.expected.generalCategory);
          expect(isLetter(unit.cp, false)).toBe(entry.expected.isLetter);
          expect(isUpper(unit.cp)).toBe(entry.expected.isUpper);
          expect(isLower(unit.cp)).toBe(entry.expected.isLower);
          expect(isDigit(unit.cp)).toBe(entry.expected.isDigit);
          expect(isSpace(unit.cp)).toBe(entry.expected.isSpace);
          expect(normLower(input)).toBe(entry.expected.normLower);
          break;
        }
        case "sha256hex": {
          expect(sha256hex(input)).toBe(entry.expected);
          break;
        }
      }
    });
  }
});
