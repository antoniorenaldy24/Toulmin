import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/sanitize.json" with { type: "json" };
import {
  escapeEvidenceDelimiters,
  sanitizeMetadataField,
  sanitizeText,
  wrapEvidenceBlock,
  type MetadataFieldName,
  type SanitizeOptions,
  type SanitizeReason,
  type SanitizeTier,
} from "../src/index.js";

interface SanitizeGoldenExpected {
  readonly text?: string;
  readonly map?: readonly number[];
  readonly detectText?: string;
  readonly tier: SanitizeTier;
  readonly blocked: boolean;
  readonly reasons: readonly SanitizeReason[];
  readonly invisibleCharCount?: number;
  readonly mixedScriptWordCount?: number;
}

interface SanitizeGoldenCase {
  readonly id: string;
  readonly op: "sanitize";
  readonly input: string;
  readonly options?: SanitizeOptions;
  readonly expected: SanitizeGoldenExpected;
}

interface WrapGoldenCase {
  readonly id: string;
  readonly op: "wrap";
  readonly idArg: number;
  readonly input: string;
  readonly expectedEscaped: string;
  readonly expectedWrapped: string;
}

interface MetadataGoldenCase {
  readonly id: string;
  readonly op: "metadata";
  readonly field: MetadataFieldName;
  readonly input: string;
  readonly expected: {
    readonly value: string;
    readonly withheld: boolean;
  };
}

type GoldenVector = SanitizeGoldenCase | WrapGoldenCase | MetadataGoldenCase;

describe("conformance/l0/sanitize.json", () => {
  const allCases = vectors as readonly GoldenVector[];

  for (const tc of allCases) {
    it(tc.id, () => {
      if (tc.op === "sanitize") {
        const res = sanitizeText(tc.input, tc.options);
        if (tc.expected.text !== undefined) {
          expect(res.text).toBe(tc.expected.text);
        }
        if (tc.expected.map !== undefined) {
          expect(res.map).toEqual(tc.expected.map);
        }
        if (tc.expected.detectText !== undefined) {
          expect(res.detectText).toBe(tc.expected.detectText);
        }
        expect(res.tier).toBe(tc.expected.tier);
        expect(res.blocked).toBe(tc.expected.blocked);
        expect(res.reasons).toEqual(tc.expected.reasons);
        if (tc.expected.invisibleCharCount !== undefined) {
          expect(res.invisibleCharCount).toBe(tc.expected.invisibleCharCount);
        }
        if (tc.expected.mixedScriptWordCount !== undefined) {
          expect(res.mixedScriptWordCount).toBe(tc.expected.mixedScriptWordCount);
        }
        expect(res.map.length).toBe(res.text.length + 1);
      } else if (tc.op === "wrap") {
        const sanitized = sanitizeText(tc.input);
        expect(escapeEvidenceDelimiters(sanitized.text)).toBe(tc.expectedEscaped);
        expect(wrapEvidenceBlock(tc.idArg, sanitized.text)).toBe(tc.expectedWrapped);
      } else if (tc.op === "metadata") {
        const meta = sanitizeMetadataField(tc.field, tc.input);
        expect(meta.value).toBe(tc.expected.value);
        expect(meta.withheld).toBe(tc.expected.withheld);
      }
    });
  }
});
