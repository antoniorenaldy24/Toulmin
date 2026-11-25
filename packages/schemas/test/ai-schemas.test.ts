import { describe, expect, it } from "vitest";
import {
  SCHEMAS,
  SCHEMA_IDS,
  TIER_A_SCHEMA_IDS,
  checkTopLevelKeyOrder,
  countUnicodeCodePoints,
  extractTopLevelJsonKeys,
  parseAndValidateAiOutput,
  streamCharLimit,
  sumOfStringMaxLength,
  validateJsonSchema,
} from "../src/index.js";

const VALID_HEX_64 = "a".repeat(64);
void VALID_HEX_64;

describe("Canonical AI JSON Schemas (04 §2.2–§2.7)", () => {
  it("registers all 11 schemas and excludes L2Verdict from Tier A", () => {
    expect(SCHEMA_IDS).toHaveLength(11);
    expect(TIER_A_SCHEMA_IDS).toHaveLength(10);
    expect(TIER_A_SCHEMA_IDS).not.toContain("L2Verdict");
    for (const id of SCHEMA_IDS) {
      const schema = SCHEMAS[id];
      expect(schema.$id).toBe(`toulmin://schema/${id}`);
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it("validates TriageV1 and TriageFlatV1 (positive & negative)", () => {
    const validTriage = {
      s1_atoms: [{ a1_start: 0, a2_end: 12, a3_type: "QUANTITATIVE" }],
      s2_worth: "HIGH",
      s3_uncited: false,
      s4_bib: [0, 3],
    };
    expect(validateJsonSchema(SCHEMAS.TriageV1, validTriage)).toEqual({ ok: true });

    // Negative: empty s1_atoms, >3 atoms, float index, extra prop, out of range s4_bib
    expect(
      validateJsonSchema(SCHEMAS.TriageV1, { ...validTriage, s1_atoms: [] }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.TriageV1, {
        ...validTriage,
        s1_atoms: [
          { a1_start: 0, a2_end: 1, a3_type: "CAUSAL" },
          { a1_start: 2, a2_end: 3, a3_type: "CAUSAL" },
          { a1_start: 4, a2_end: 5, a3_type: "CAUSAL" },
          { a1_start: 6, a2_end: 7, a3_type: "CAUSAL" },
        ],
      }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.TriageV1, {
        ...validTriage,
        s1_atoms: [{ a1_start: 1.5, a2_end: 5, a3_type: "CAUSAL" }],
      }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.TriageV1, {
        ...validTriage,
        s1_atoms: [{ a1_start: 0, a2_end: 80, a3_type: "CAUSAL" }],
      }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.TriageV1, { ...validTriage, s4_bib: [5] }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.TriageV1, { ...validTriage, extra: 1 }).ok
    ).toBe(false);

    const validFlat = {
      s1_start: 0,
      s2_end: 79,
      s3_type: "COMPARATIVE",
      s4_worth: "LOW",
      s5_uncited: true,
    };
    expect(validateJsonSchema(SCHEMAS.TriageFlatV1, validFlat)).toEqual({ ok: true });
    expect(
      validateJsonSchema(SCHEMAS.TriageFlatV1, { ...validFlat, s4_worth: "UNKNOWN" }).ok
    ).toBe(false);
  });

  it("validates VerdictV1, VerdictV1_cap30, VerdictV1_cap20, and VerdictFlatV1", () => {
    const baseVerdict = {
      s01_evidence_span: "mortality decreased by 30%",
      s02_evidence_idx: 0,
      s03_micro_reasoning: "The trial reports a 30% reduction in mortality.",
      s04_verdict: "SUPPORTED",
    };
    expect(validateJsonSchema(SCHEMAS.VerdictV1, baseVerdict)).toEqual({ ok: true });
    expect(validateJsonSchema(SCHEMAS.VerdictV1_cap30, baseVerdict)).toEqual({ ok: true });
    expect(validateJsonSchema(SCHEMAS.VerdictV1_cap20, baseVerdict)).toEqual({ ok: true });
    expect(validateJsonSchema(SCHEMAS.VerdictFlatV1, baseVerdict)).toEqual({ ok: true });

    // Boundary evidence_idx: -1 and 4 allowed; -2 and 5 rejected
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1, { ...baseVerdict, s02_evidence_idx: -1 }).ok
    ).toBe(true);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1, { ...baseVerdict, s02_evidence_idx: 4 }).ok
    ).toBe(true);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1, { ...baseVerdict, s02_evidence_idx: -2 }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1, { ...baseVerdict, s02_evidence_idx: 5 }).ok
    ).toBe(false);

    // Cap differences on s03_micro_reasoning
    const len150 = "x".repeat(150);
    const len210 = "x".repeat(210);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1_cap20, {
        ...baseVerdict,
        s03_micro_reasoning: len150,
      }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1_cap30, {
        ...baseVerdict,
        s03_micro_reasoning: len150,
      }).ok
    ).toBe(true);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1_cap30, {
        ...baseVerdict,
        s03_micro_reasoning: len210,
      }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1, {
        ...baseVerdict,
        s03_micro_reasoning: len210,
      }).ok
    ).toBe(true);

    // Multi-byte surrogate pair counted as 1 Unicode code point
    expect(countUnicodeCodePoints("😀".repeat(200))).toBe(200);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1, {
        ...baseVerdict,
        s01_evidence_span: "😀".repeat(200),
      }).ok
    ).toBe(true);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1, {
        ...baseVerdict,
        s01_evidence_span: "😀".repeat(201),
      }).ok
    ).toBe(false);

    // VerdictFlatV1 allows arbitrary string s04_verdict (validated in L0) while VerdictV1 enforces enum
    expect(
      validateJsonSchema(SCHEMAS.VerdictFlatV1, {
        ...baseVerdict,
        s04_verdict: "NEI",
      }).ok
    ).toBe(true);
    expect(
      validateJsonSchema(SCHEMAS.VerdictV1, {
        ...baseVerdict,
        s04_verdict: "NEI",
      }).ok
    ).toBe(false);
  });

  it("validates B5CheckV1, O2PhysicalExtractV1, O2PhysicalExtractFlatV1, L2Verdict, and AltSourcesV1", () => {
    expect(
      validateJsonSchema(SCHEMAS.B5CheckV1, {
        s1_what: "A measures cohort size; B measures subgroup size.",
        s2_same_population: false,
        s3_verdict: "CONSISTENT_DIFFERENT_SUBSET",
      }).ok
    ).toBe(true);
    expect(
      validateJsonSchema(SCHEMAS.B5CheckV1, {
        s1_what: "x".repeat(151),
        s2_same_population: true,
        s3_verdict: "INCONSISTENT",
      }).ok
    ).toBe(false);

    const validO2 = {
      s1_kind: "TABLE_ROW",
      s2_facts: [
        { f1_quote: "Intervention 12.4% vs control 18.1%", f2_column: "Mortality", f3_value: "12.4%" },
      ],
      s3_doi: "10.1000/test-doi",
    };
    expect(validateJsonSchema(SCHEMAS.O2PhysicalExtractV1, validO2)).toEqual({ ok: true });
    expect(
      validateJsonSchema(SCHEMAS.O2PhysicalExtractV1, {
        ...validO2,
        s2_facts: [validO2.s2_facts[0], validO2.s2_facts[0], validO2.s2_facts[0], validO2.s2_facts[0]],
      }).ok
    ).toBe(false);
    expect(
      validateJsonSchema(SCHEMAS.O2PhysicalExtractFlatV1, {
        s1_kind: "TEXT",
        s2_quote: "Mortality was 12.4%",
        s3_column: "",
        s4_value: "12.4%",
        s5_doi: "",
      }).ok
    ).toBe(true);

    const validL2 = {
      s1_source_identified: "CITED_DOI_MATCHED",
      s2_quote: "Participants receiving Drug X had lower mortality (HR 0.70).",
      s3_quote_origin: "PROVIDED_EVIDENCE",
      s4_reasoning: "The evidence directly supports the claimed hazard reduction.",
      s5_verdict: "SUPPORTED",
      s6_alternatives: [{ a1_doi: "10.1000/alt1", a2_relation: "SUPPORTS_CLAIM" }],
    };
    expect(validateJsonSchema(SCHEMAS.L2Verdict, validL2)).toEqual({ ok: true });
    expect(
      validateJsonSchema(SCHEMAS.L2Verdict, {
        ...validL2,
        s6_alternatives: [{ a1_doi: "10.1000/alt1", a2_relation: "OTHER" }],
      }).ok
    ).toBe(false);

    expect(
      validateJsonSchema(SCHEMAS.AltSourcesV1, {
        s1_library_idx: [0, 19],
        s2_dois: ["10.1000/a", "10.1000/b"],
      }).ok
    ).toBe(true);
    expect(
      validateJsonSchema(SCHEMAS.AltSourcesV1, {
        s1_library_idx: [20],
        s2_dois: [],
      }).ok
    ).toBe(false);
  });

  it("enforces streaming key order and rejects reordered/duplicate/malformed outputs (AC-L1W-06)", () => {
    const orderedRaw = JSON.stringify({
      s01_evidence_span: "quote with {braces} and \"escaped quotes\"",
      s02_evidence_idx: 1,
      s03_micro_reasoning: "Matches value.",
      s04_verdict: "SUPPORTED",
    });
    expect(extractTopLevelJsonKeys(orderedRaw)).toEqual([
      "s01_evidence_span",
      "s02_evidence_idx",
      "s03_micro_reasoning",
      "s04_verdict",
    ]);
    expect(
      checkTopLevelKeyOrder(orderedRaw, SCHEMAS.VerdictV1.required)
    ).toBe(true);
    const parsedOk = parseAndValidateAiOutput("VerdictV1", orderedRaw);
    expect(parsedOk.ok).toBe(true);

    // AC-L1W-06: s04_verdict before s01_evidence_span
    const reversedRaw =
      '{"s04_verdict":"CONTRADICTS","s01_evidence_span":"quote","s02_evidence_idx":0,"s03_micro_reasoning":"reason"}';
    const keyOrderFail = parseAndValidateAiOutput("VerdictV1", reversedRaw);
    expect(keyOrderFail.ok).toBe(false);
    if (!keyOrderFail.ok) {
      expect(keyOrderFail.error).toBe("KEY_ORDER");
    }

    // Invalid primitive token -> null from extractTopLevelJsonKeys
    expect(extractTopLevelJsonKeys('{"a": invalid}')).toBeNull();
    expect(extractTopLevelJsonKeys('{"a": 01}')).toBeNull();
    expect(
      extractTopLevelJsonKeys('{"a": true, "b": false, "c": null, "d": -1.25e+3}')
    ).toEqual(["a", "b", "c", "d"]);

    // Duplicate key rejected
    const dupRaw =
      '{"s01_evidence_span":"a","s01_evidence_span":"b","s02_evidence_idx":0,"s03_micro_reasoning":"r","s04_verdict":"SUPPORTED"}';
    expect(extractTopLevelJsonKeys(dupRaw)).toBeNull();
    const dupFail = parseAndValidateAiOutput("VerdictV1", dupRaw);
    expect(dupFail.ok).toBe(false);
    if (!dupFail.ok) {
      expect(dupFail.error).toBe("KEY_ORDER");
    }

    // Malformed JSON -> PARSE
    const parseFail = parseAndValidateAiOutput("VerdictV1", '{"s01_evidence_span":');
    expect(parseFail.ok).toBe(false);
    if (!parseFail.ok) {
      expect(parseFail.error).toBe("PARSE");
    }

    // Valid key order but schema violation -> SCHEMA
    const schemaFail = parseAndValidateAiOutput(
      "VerdictV1",
      '{"s01_evidence_span":"a","s02_evidence_idx":9,"s03_micro_reasoning":"r","s04_verdict":"SUPPORTED"}'
    );
    expect(schemaFail.ok).toBe(false);
    if (!schemaFail.ok) {
      expect(schemaFail.error).toBe("SCHEMA");
    }
  });

  it("computes sumOfStringMaxLength and STREAM_CHAR_LIMIT accurately across all schemas", () => {
    // VerdictV1: 200 + 280 + maxEnum("NEI_SILENT_ESCALATE"=19) = 499 -> ceil(1.2*499)+200 = 799
    expect(sumOfStringMaxLength(SCHEMAS.VerdictV1)).toBe(499);
    expect(streamCharLimit("VerdictV1")).toBe(Math.ceil(1.2 * 499) + 200);

    // TriageV1: 3 * 14 (METHODOLOGICAL/NON_EMPIRICAL=14/13 -> 14) + 4 (HIGH) = 46 -> 256
    expect(sumOfStringMaxLength(SCHEMAS.TriageV1)).toBe(46);
    expect(streamCharLimit("TriageV1")).toBe(256);
    const maxThreeAtomTriage = JSON.stringify({
      s1_atoms: [
        { a1_start: 10, a2_end: 20, a3_type: "METHODOLOGICAL" },
        { a1_start: 21, a2_end: 40, a3_type: "METHODOLOGICAL" },
        { a1_start: 41, a2_end: 79, a3_type: "METHODOLOGICAL" },
      ],
      s2_worth: "HIGH",
      s3_uncited: false,
      s4_bib: [0, 1],
    });
    expect(maxThreeAtomTriage.length).toBeLessThanOrEqual(streamCharLimit("TriageV1"));
  });
});
