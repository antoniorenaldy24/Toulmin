import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/sections.json" with { type: "json" };
import {
  SectionTracker,
  matchCanonicalSectionLabel,
  preMask,
  resolveHeadingSequence,
  type CanonicalSectionLabel,
  type HeadingInput,
  type SectionState,
  type SourceFormat,
} from "../src/index.js";

type SectionsGoldenEntry =
  | {
      readonly id: string;
      readonly op: "tracker";
      readonly steps: readonly HeadingInput[];
      readonly expectedInitial?: SectionState;
      readonly expected: readonly SectionState[];
    }
  | {
      readonly id: string;
      readonly op: "match";
      readonly cases: readonly {
        readonly heading: string;
        readonly isFirstHeading: boolean;
        readonly expected: CanonicalSectionLabel | null;
      }[];
    }
  | {
      readonly id: string;
      readonly op: "preMaskSections";
      readonly format: SourceFormat;
      readonly input: string;
      readonly expected: readonly SectionState[];
    };

describe("conformance/l0/sections.json", () => {
  const cases = vectors as unknown as readonly SectionsGoldenEntry[];

  for (const tc of cases) {
    it(`${tc.id} (${tc.op})`, () => {
      switch (tc.op) {
        case "tracker": {
          if (tc.expectedInitial !== undefined) {
            const tracker = new SectionTracker();
            expect(tracker.current).toEqual(tc.expectedInitial);
          }
          expect(resolveHeadingSequence(tc.steps)).toEqual(tc.expected);
          break;
        }
        case "match": {
          for (const item of tc.cases) {
            expect(matchCanonicalSectionLabel(item.heading, item.isFirstHeading)).toBe(item.expected);
          }
          break;
        }
        case "preMaskSections": {
          const res = preMask(tc.input, tc.format);
          expect(res.sectionTransitions.map((t) => t.state)).toEqual(tc.expected);
          break;
        }
      }
    });
  }
});
