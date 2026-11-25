/**
 * Canonical TypeScript interfaces for all 11 structured AI output schemas
 * (`docs/spec/04_AI_RUNTIME_PROMPTS_AND_L3.md` §2.2–§2.7).
 *
 * Pure module: zero runtime imports, zero Firebase, DOM, network, I/O, or clock access.
 */

export const AI_CLAIM_TYPES = [
  "QUANTITATIVE",
  "CAUSAL",
  "COMPARATIVE",
  "EXISTENCE",
  "METHODOLOGICAL",
  "NON_EMPIRICAL",
] as const;

export type AiClaimType = (typeof AI_CLAIM_TYPES)[number];

export const AI_WORTH_LEVELS = ["HIGH", "LOW"] as const;
export type AiWorthLevel = (typeof AI_WORTH_LEVELS)[number];

export const AI_LOCAL_VERDICTS = [
  "SUPPORTED",
  "CONTRADICTS",
  "NEI_SILENT_ESCALATE",
] as const;
export type AiLocalVerdict = (typeof AI_LOCAL_VERDICTS)[number];

export const B5_VERDICTS = [
  "INCONSISTENT",
  "CONSISTENT_DIFFERENT_SUBSET",
  "DIFFERENT_QUANTITY",
] as const;
export type B5Verdict = (typeof B5_VERDICTS)[number];

export const PHYSICAL_EXTRACT_KINDS = ["TABLE_ROW", "TEXT", "LAB_NOTE"] as const;
export type PhysicalExtractKind = (typeof PHYSICAL_EXTRACT_KINDS)[number];

export const L2_SOURCES_IDENTIFIED = [
  "CITED_DOI_MATCHED",
  "CITED_TITLE_MATCHED",
  "NOT_IDENTIFIED",
] as const;
export type L2SourceIdentified = (typeof L2_SOURCES_IDENTIFIED)[number];

export const L2_QUOTE_ORIGINS = [
  "PROVIDED_EVIDENCE",
  "WEB_SOURCE",
  "NONE",
] as const;
export type L2QuoteOrigin = (typeof L2_QUOTE_ORIGINS)[number];

export const L2_VERDICTS = [
  "SUPPORTED",
  "PARTIAL",
  "CONTRADICTED",
  "NEI",
] as const;
export type L2VerdictValue = (typeof L2_VERDICTS)[number];

export const L2_ALTERNATIVE_RELATIONS = [
  "SUPPORTS_CLAIM",
  "CONTRADICTS_CLAIM",
] as const;
export type L2AlternativeRelation = (typeof L2_ALTERNATIVE_RELATIONS)[number];

export interface AtomV1 {
  a1_start: number;
  a2_end: number;
  a3_type: AiClaimType;
}

export interface TriageV1 {
  s1_atoms: AtomV1[];
  s2_worth: AiWorthLevel;
  s3_uncited: boolean;
  s4_bib: number[];
}

export interface TriageFlatV1 {
  s1_start: number;
  s2_end: number;
  s3_type: AiClaimType;
  s4_worth: AiWorthLevel;
  s5_uncited: boolean;
}

export interface VerdictV1 {
  s01_evidence_span: string;
  s02_evidence_idx: number;
  s03_micro_reasoning: string;
  s04_verdict: AiLocalVerdict;
}

export type VerdictV1Cap30 = VerdictV1;
export type VerdictV1Cap20 = VerdictV1;

export interface VerdictFlatV1 {
  s01_evidence_span: string;
  s02_evidence_idx: number;
  s03_micro_reasoning: string;
  s04_verdict: string;
}

export interface B5CheckV1 {
  s1_what: string;
  s2_same_population: boolean;
  s3_verdict: B5Verdict;
}

export interface PhysicalFactV1 {
  f1_quote: string;
  f2_column: string;
  f3_value: string;
}

export interface O2PhysicalExtractV1 {
  s1_kind: PhysicalExtractKind;
  s2_facts: PhysicalFactV1[];
  s3_doi: string;
}

export interface O2PhysicalExtractFlatV1 {
  s1_kind: string;
  s2_quote: string;
  s3_column: string;
  s4_value: string;
  s5_doi: string;
}

export interface L2Alternative {
  a1_doi: string;
  a2_relation: L2AlternativeRelation;
}

export interface L2Verdict {
  s1_source_identified: L2SourceIdentified;
  s2_quote: string;
  s3_quote_origin: L2QuoteOrigin;
  s4_reasoning: string;
  s5_verdict: L2VerdictValue;
  s6_alternatives: L2Alternative[];
}

export interface AltSourcesV1 {
  s1_library_idx: number[];
  s2_dois: string[];
}

export interface AiSchemaOutputMap {
  TriageV1: TriageV1;
  TriageFlatV1: TriageFlatV1;
  VerdictV1: VerdictV1;
  VerdictV1_cap30: VerdictV1Cap30;
  VerdictV1_cap20: VerdictV1Cap20;
  VerdictFlatV1: VerdictFlatV1;
  B5CheckV1: B5CheckV1;
  O2PhysicalExtractV1: O2PhysicalExtractV1;
  O2PhysicalExtractFlatV1: O2PhysicalExtractFlatV1;
  L2Verdict: L2Verdict;
  AltSourcesV1: AltSourcesV1;
}
