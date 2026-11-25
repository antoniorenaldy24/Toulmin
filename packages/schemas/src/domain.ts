/**
 * Canonical domain enumerations, ledger/reducer types, events E1–E16 + E6b,
 * and strict pure runtime validators (`01` §1.1, §2.1, §4.4, §5; `02` §3.4, §7).
 *
 * Pure module: zero Firebase, DOM, network, Node I/O, clock, or regex usage.
 */

export const BIB_STATUSES = [
  "PENDING",
  "RESOLVED",
  "DOI_NOT_FOUND",
  "NOT_INDEXED",
  "AMBIGUOUS",
  "METADATA_MISMATCH",
  "UNRESOLVED_KEY",
  "UPSTREAM_UNAVAILABLE",
  "RATE_LIMITED",
] as const;
export type BibStatus = (typeof BIB_STATUSES)[number];

export const MARKER_KINDS = ["EXPLICIT", "HEURISTIC"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

export const LOCAL_VERDICTS = [
  "SUPPORTED",
  "CONTRADICTS",
  "NEI_SILENT_ESCALATE",
] as const;
export type LocalVerdict = (typeof LOCAL_VERDICTS)[number];

export const CLOUD_VERDICTS = [
  "SUPPORTED",
  "PARTIAL",
  "CONTRADICTED",
  "NEI",
] as const;
export type CloudVerdict = (typeof CLOUD_VERDICTS)[number];

export const PHYSICAL_VERDICTS = ["SUPPORTED", "CONTRADICTS", "NEI"] as const;
export type PhysicalVerdict = (typeof PHYSICAL_VERDICTS)[number];

export const CLAIM_TYPES = [
  "QUANTITATIVE",
  "CAUSAL",
  "COMPARATIVE",
  "EXISTENCE",
  "METHODOLOGICAL",
  "NON_EMPIRICAL",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const WORTH_VALUES = ["HIGH", "LOW", "UNKNOWN"] as const;
export type Worth = (typeof WORTH_VALUES)[number];

export const EVIDENCE_SOURCE_KINDS = [
  "ABSTRACT",
  "FULLTEXT",
  "USER_PDF",
  "PHYSICAL_TABLE",
  "PHYSICAL_TEXT",
  "LAB_NOTE",
  "MANUSCRIPT",
] as const;
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export const PHYSICAL_KINDS = [
  "PHYSICAL_TABLE",
  "PHYSICAL_TEXT",
  "LAB_NOTE",
] as const;
export type PhysicalKind = (typeof PHYSICAL_KINDS)[number];

export const INFERENCE_SOURCE_TAGS = [
  "ON_DEVICE",
  "IN_CLOUD",
  "NONE",
] as const;
export type InferenceSourceTag = (typeof INFERENCE_SOURCE_TAGS)[number];

export const ANCHOR_FAIL_REASONS = [
  "IDX_OUT_OF_BOUNDS",
  "EMPTY_SPAN",
  "FRAGMENT_TOO_SHORT",
  "CONTAINMENT_BELOW_THRESHOLD",
  "WINDOW_TOO_WIDE",
  "FRAGMENT_ORDER_VIOLATION",
  "NUMERIC_PARITY",
  "NEGATION_PARITY",
  "DIRECTION_PARITY",
  "CLAIM_SPAN_MISMATCH",
  "LOW_CLAIM_OVERLAP",
  "REASONING_VERDICT_CONFLICT",
  "UNCALIBRATED_VARIANT",
  "NO_DIFFERENCE_SIGNAL",
] as const;
export type AnchorFailReason = (typeof ANCHOR_FAIL_REASONS)[number];

export const REF_STATES = [
  "REF_PROBLEM",
  "CONTRADICTED_CONFIRMED",
  "PARTIAL_CONFIRMED",
  "SUPPORTED_CONFIRMED",
  "HINT",
  "SUPPORTED_LOCAL",
  "EVIDENCE_FOUND_LOCAL",
  "ALIGNED_ESCALATING",
  "SOURCE_FLAGGED",
  "WAITING",
  "UNVERIFIABLE",
  "CHECKING",
  "UNCHECKED",
] as const;
export type RefState = (typeof REF_STATES)[number];

export const CLAUSE_STATES = [
  "REFERENCE_PROBLEM",
  "CONTRADICTED",
  "HINT",
  "PARTLY_SUPPORTED",
  "MIXED_SUPPORT",
  "UNCITED_EMPIRICAL",
  "CHECK_METADATA",
  "WAITING",
  "SOURCE_FLAGGED",
  "UNVERIFIABLE",
  "LOCAL_EVIDENCE",
  "SUPPORTED_LOCAL",
  "SUPPORTED",
  "REVIEWED_BY_AUTHOR",
  "CHECKING",
  "UNCHECKED",
  "NOT_CHECKABLE",
] as const;
export type ClauseState = (typeof CLAUSE_STATES)[number];

export const METER_CATEGORIES = [
  "supported",
  "reviewed",
  "local",
  "problems",
  "to_review",
  "waiting",
  "unverifiable",
  "unchecked",
] as const;
export type MeterCategory = (typeof METER_CATEGORIES)[number];

export const TRANSIENT_REASONS = [
  "DEADLINE",
  "TRUNCATED",
  "BUSY",
  "NETWORK",
  "SLOT_LOST",
  "OTHER",
] as const;
export type TransientReason = (typeof TRANSIENT_REASONS)[number];

export const OVERRIDE_BASES = ["REVIEW", "PRINTED_SOURCE"] as const;
export type OverrideBasis = (typeof OVERRIDE_BASES)[number];

export const L0_ERRORS = ["PARSE_TIMEOUT"] as const;
export type L0Error = (typeof L0_ERRORS)[number];

export const PROVENANCE_VALUES = [
  "DETERMINISTIC",
  "ON_DEVICE",
  "CLOUD",
  "PHYSICAL_SOURCE",
  "AUTHOR",
  "NONE",
] as const;
export type Provenance = (typeof PROVENANCE_VALUES)[number];

export const TASKS = ["B1", "B2", "B3", "B5", "O2"] as const;
export type Task = (typeof TASKS)[number];

export const AUTHORITIES = ["authoritative", "advisory"] as const;
export type Authority = (typeof AUTHORITIES)[number];

export const METRIC_CLASSES = [
  "sample_size",
  "percentage",
  "effect_size",
  "p_value",
  "duration",
  "dose",
  "concentration",
  "currency",
  "count",
  "ratio",
  "other",
] as const;
export type MetricClass = (typeof METRIC_CLASSES)[number];

export const P_COMPARATORS = ["<", "<=", "=", ">", ">="] as const;
export type PComparator = (typeof P_COMPARATORS)[number];

export const TUPLE_SOURCES = ["manuscript", "lab_note", "print_page"] as const;
export type TupleSource = (typeof TUPLE_SOURCES)[number];

export const CANONICAL_SECTION_LABELS = [
  "abstract",
  "introduction",
  "methods",
  "results",
  "discussion",
  "limitations",
  "conclusion",
  "supplementary",
  "references",
  "unlabeled",
] as const;
export type CanonicalSectionLabel = (typeof CANONICAL_SECTION_LABELS)[number];

export const MODEL_PROFILES = [
  "web_chrome_nano",
  "android_aicore_stable",
  "android_aicore_preview",
  "apple_slm",
  "no_local_model",
] as const;
export type ModelProfile = (typeof MODEL_PROFILES)[number];

export interface TextRange {
  start: number;
  end: number;
}

export interface QuantTuple {
  tupleId: string;
  valueRaw: string;
  unitRaw: string;
  metricClass: MetricClass;
  pComparator: PComparator | null;
  valueNorm: number | null;
  valueLo: number | null;
  valueHi: number | null;
  sigDigits: number;
  unitCanon: string;
  keyLemmas: string[];
  section: string;
  source: TupleSource;
  span: TextRange;
}

export interface EvidenceAnchor {
  refId: string;
  sourceKind: EvidenceSourceKind;
  chunkId: string;
  evidenceIdx: number;
  snapped: TextRange;
  snippet: string;
}

export interface LocalResult {
  resultKey: string;
  verdict: LocalVerdict;
  rawVerdict: LocalVerdict;
  anchor: EvidenceAnchor | null;
  anchorFailReason: AnchorFailReason | null;
  microReasoning: string;
  inferenceSource: InferenceSourceTag;
  modelProfile: string;
  schemaId: string;
  reasoningCap: number;
  promptVersion: string;
  decidedAt: number;
}

export interface Stage1Atom {
  start: number;
  end: number;
  claimType: ClaimType;
}

export interface Stage1Result {
  resultKey: string;
  atoms: Stage1Atom[];
  worth: Worth;
  claimType: ClaimType;
  uncited: boolean;
  modelProfile: string;
  schemaId: string;
  promptVersion: string;
  decidedAt: number;
}

export interface BaselineTriage {
  atoms: Stage1Atom[];
  worth: Worth;
  claimType: ClaimType;
  uncited: boolean;
}

export interface CloudResult {
  resultKey: string;
  normalizedClaimHash: string;
  refId: string;
  verdict: CloudVerdict;
  quote: string | null;
  quoteAnchor: EvidenceAnchor | null;
  approvedTextSha256: string;
  alternativesDois: string[];
  noDifferenceNote: boolean;
  adjudicator: "l2Adjudicate" | "l2AdjudicateProvided";
  inferenceSource: InferenceSourceTag;
  promptVersion: string;
  decidedAt: number;
}

export interface PhysicalSource {
  captureId: string;
  photoSha256: string;
  kind: PhysicalKind;
  linkedRefId: string | null;
  pageLabel: string;
  rowCropSha256: string | null;
  confirmedByAuthorAt: number | null;
  entailmentConfirmedByAuthorAt: number | null;
}

export interface PhysicalResult {
  resultKey: string;
  normalizedClaimHash: string;
  refId: string | null;
  verdict: PhysicalVerdict;
  capture: PhysicalSource;
  inferenceSource: InferenceSourceTag;
  decidedAt: number;
}

export interface RefFacts {
  refId: string;
  bibStatus: BibStatus;
  retracted: boolean;
  checkMetadata: boolean;
  evidenceVersion: string;
  hasEvidence: boolean;
  updatedSeq: number;
}

export interface Selection {
  evidenceVersion: string;
  candidates: number;
  suspicious: boolean;
  seq: number;
}

export interface ClauseRef {
  refId: string;
  selection: Selection | null;
  local: LocalResult | null;
  cloud: CloudResult | null;
  physical: PhysicalResult | null;
}

export interface Versioned<T> {
  value: T;
  seq: number;
}

export interface AuthorOverride {
  dismissedState: ClauseState;
  basis: OverrideBasis;
  captureId: string | null;
  normalizedClaimHash: string;
  refIdsKey: string;
  note: string;
  createdAt: number;
}

export interface LabNoteFlag {
  pageLabel: string;
  confirmedByAuthorAt: number;
}

export interface LabNoteMismatchItem {
  captureId: string;
  flag: Versioned<LabNoteFlag | null>;
}

export interface ClaimLedgerEntry {
  claimId: string;
  docId: string;
  sentenceHash: string;
  occurrenceIndex: number;
  clauseIndex: number;
  section: string;
  subsection: string | null;
  span: TextRange;
  claimText: string;
  normalizedClaimHash: string;
  baseline: BaselineTriage;
  stage1: Stage1Result | null;
  citationKeys: string[];
  possibleCitations: TextRange[];
  refs: ClauseRef[];
  heldNei: Versioned<{ since: number } | null>;
  job: Versioned<boolean>;
  l0Error: L0Error | null;
  b5: { inconsistentWith: string[] };
  labNoteMismatch: LabNoteMismatchItem[];
  suggestedRefIds: string[];
  override: Versioned<AuthorOverride | null>;
  archived: boolean;
  updatedAt: number;
}

export interface ProfilePolicy {
  path: "A" | "B";
  authority: Readonly<Record<Task, Authority>>;
  supportVerdicts: Authority;
  calibratedVariant: { schemaId: string; reasoningCap: number };
}

export interface PolicySnapshot {
  deviceProfile: string;
  profiles: Readonly<Record<string, ProfilePolicy>>;
  b4CountsAsReview: boolean;
}

export interface PrivacyContext {
  mode: "CONFIDENTIAL" | "STANDARD";
  cloudAvailable: boolean;
  quotaExhausted: boolean;
  quotaResetAt: number | null;
}

export interface SessionFacts {
  localUnavailable: boolean;
  transient: ReadonlyMap<string, { reason: TransientReason; attempts: number }>;
}

export interface EffectiveTriage {
  atoms: Stage1Atom[];
  worth: Worth;
  claimType: ClaimType;
  uncited: boolean;
}

export interface DerivedClause {
  claimId: string;
  triage: EffectiveTriage;
  refStates: Array<{ refId: string; state: RefState }>;
  state: ClauseState;
  category: MeterCategory | null;
  provenance: Provenance;
}

export interface CoverageMeter {
  total: number;
  supported: number;
  reviewed: number;
  local: number;
  problems: number;
  to_review: number;
  waiting: number;
  unverifiable: number;
  unchecked: number;
  notYetChecked: number;
  notCheckable: number;
  numberMismatches: number;
  quotaExhausted: boolean;
  quotaResetAt: number | null;
  byProvenance: Record<Exclude<Provenance, "NONE">, number>;
}

export type LedgerEvent =
  | { readonly type: "ClauseCreated"; readonly entry: ClaimLedgerEntry }
  | {
      readonly type: "BibResolved";
      readonly refId: string;
      readonly bibStatus: BibStatus;
      readonly retracted: boolean;
      readonly checkMetadata: boolean;
      readonly seq: number;
    }
  | { readonly type: "RetractionSnapshot"; readonly refIds: string[] }
  | { readonly type: "Stage1ResultArrived"; readonly result: Stage1Result }
  | {
      readonly type: "LocalResultArrived";
      readonly claimId: string;
      readonly refId: string;
      readonly result: LocalResult;
    }
  | {
      readonly type: "EvidenceChanged";
      readonly refId: string;
      readonly evidenceVersion: string;
      readonly hasEvidence: boolean;
      readonly seq: number;
    }
  | {
      readonly type: "SelectionComputed";
      readonly claimId: string;
      readonly refId: string;
      readonly selection: Selection;
    }
  | {
      readonly type: "CloudResultArrived";
      readonly claimId: string;
      readonly refId: string;
      readonly result: CloudResult;
    }
  | {
      readonly type: "PhysicalResultArrived";
      readonly claimId: string;
      readonly result: PhysicalResult;
    }
  | {
      readonly type: "ClauseEdited";
      readonly oldClaimIds: string[];
      readonly newSegmentation: ClaimLedgerEntry[];
    }
  | {
      readonly type: "JobState";
      readonly claimId: string;
      readonly inFlight: boolean;
      readonly seq: number;
    }
  | {
      readonly type: "HeldNei";
      readonly claimId: string;
      readonly value: { since: number } | null;
      readonly seq: number;
    }
  | {
      readonly type: "Override";
      readonly claimId: string;
      readonly value: AuthorOverride | null;
      readonly seq: number;
    }
  | { readonly type: "B5Changed"; readonly claimIds: string[] }
  | { readonly type: "L0Timeout"; readonly claimId: string }
  | { readonly type: "PolicyChanged"; readonly snapshot: PolicySnapshot }
  | {
      readonly type: "LabNoteMismatch";
      readonly claimId: string;
      readonly captureId: string;
      readonly value: LabNoteFlag | null;
      readonly seq: number;
    };

export interface DomainValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly errors: readonly string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function checkAllowedKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  prefix: string,
  errors: string[]
): void {
  const allowed = new Set<string>([...required, ...optional]);
  for (const req of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, req) || obj[req] === undefined) {
      errors.push(`${prefix}.${req}: missing required property`);
    }
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(`${prefix}.${key}: unknown property`);
    }
  }
}

function validateTextRangeInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected TextRange object`);
    return;
  }
  checkAllowedKeys(v, ["start", "end"], [], path, errors);
  if (!isNonNegInt(v["start"])) {
    errors.push(`${path}.start: expected non-negative integer`);
  }
  if (!isNonNegInt(v["end"])) {
    errors.push(`${path}.end: expected non-negative integer`);
  }
  if (isNonNegInt(v["start"]) && isNonNegInt(v["end"]) && v["end"] < v["start"]) {
    errors.push(`${path}: end (${v["end"]}) < start (${v["start"]})`);
  }
}

function validateStage1Atoms(v: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(v)) {
    errors.push(`${path}: expected array`);
    return;
  }
  for (let i = 0; i < v.length; i += 1) {
    const atom = v[i];
    const itemPath = `${path}[${i}]`;
    if (!isRecord(atom)) {
      errors.push(`${itemPath}: expected object`);
      continue;
    }
    checkAllowedKeys(atom, ["start", "end", "claimType"], [], itemPath, errors);
    if (!isNonNegInt(atom["start"])) {
      errors.push(`${itemPath}.start: expected non-negative integer`);
    }
    if (!isNonNegInt(atom["end"])) {
      errors.push(`${itemPath}.end: expected non-negative integer`);
    }
    if (isNonNegInt(atom["start"]) && isNonNegInt(atom["end"]) && atom["end"] < atom["start"]) {
      errors.push(`${itemPath}: end < start`);
    }
    if (!CLAIM_TYPES.includes(atom["claimType"] as ClaimType)) {
      errors.push(`${itemPath}.claimType: invalid ClaimType`);
    }
  }
}

function validateEvidenceAnchorInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected EvidenceAnchor object`);
    return;
  }
  checkAllowedKeys(
    v,
    ["refId", "sourceKind", "chunkId", "evidenceIdx", "snapped", "snippet"],
    [],
    path,
    errors
  );
  if (!isNonEmptyStr(v["refId"])) {
    errors.push(`${path}.refId: expected non-empty string`);
  }
  if (!EVIDENCE_SOURCE_KINDS.includes(v["sourceKind"] as EvidenceSourceKind)) {
    errors.push(`${path}.sourceKind: invalid EvidenceSourceKind`);
  }
  if (!isNonEmptyStr(v["chunkId"])) {
    errors.push(`${path}.chunkId: expected non-empty string`);
  }
  if (!isNonNegInt(v["evidenceIdx"])) {
    errors.push(`${path}.evidenceIdx: expected non-negative integer`);
  }
  validateTextRangeInternal(v["snapped"], `${path}.snapped`, errors);
  if (typeof v["snippet"] !== "string" || v["snippet"].length > 400) {
    errors.push(`${path}.snippet: expected string of length <= 400`);
  }
}

function validateSelectionInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected Selection object`);
    return;
  }
  checkAllowedKeys(v, ["evidenceVersion", "candidates", "suspicious", "seq"], [], path, errors);
  if (!isNonEmptyStr(v["evidenceVersion"])) {
    errors.push(`${path}.evidenceVersion: expected non-empty string`);
  }
  if (!isNonNegInt(v["candidates"]) || v["candidates"] > 5) {
    errors.push(`${path}.candidates: expected integer in 0..5`);
  }
  if (typeof v["suspicious"] !== "boolean") {
    errors.push(`${path}.suspicious: expected boolean`);
  }
  if (!isNonNegInt(v["seq"])) {
    errors.push(`${path}.seq: expected non-negative integer`);
  }
}

function validateLocalResultInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected LocalResult object`);
    return;
  }
  checkAllowedKeys(
    v,
    [
      "resultKey",
      "verdict",
      "rawVerdict",
      "anchor",
      "anchorFailReason",
      "microReasoning",
      "inferenceSource",
      "modelProfile",
      "schemaId",
      "reasoningCap",
      "promptVersion",
      "decidedAt",
    ],
    [],
    path,
    errors
  );
  if (!isNonEmptyStr(v["resultKey"])) {
    errors.push(`${path}.resultKey: expected non-empty string`);
  }
  if (!LOCAL_VERDICTS.includes(v["verdict"] as LocalVerdict)) {
    errors.push(`${path}.verdict: invalid LocalVerdict`);
  }
  if (!LOCAL_VERDICTS.includes(v["rawVerdict"] as LocalVerdict)) {
    errors.push(`${path}.rawVerdict: invalid LocalVerdict`);
  }
  if (v["anchor"] !== null) {
    validateEvidenceAnchorInternal(v["anchor"], `${path}.anchor`, errors);
  }
  if (
    v["anchorFailReason"] !== null &&
    !ANCHOR_FAIL_REASONS.includes(v["anchorFailReason"] as AnchorFailReason)
  ) {
    errors.push(`${path}.anchorFailReason: invalid AnchorFailReason`);
  }
  if (typeof v["microReasoning"] !== "string" || v["microReasoning"].length > 280) {
    errors.push(`${path}.microReasoning: expected string of length <= 280`);
  }
  if (!INFERENCE_SOURCE_TAGS.includes(v["inferenceSource"] as InferenceSourceTag)) {
    errors.push(`${path}.inferenceSource: invalid InferenceSourceTag`);
  }
  if (!isNonEmptyStr(v["modelProfile"])) {
    errors.push(`${path}.modelProfile: expected non-empty string`);
  }
  if (!isNonEmptyStr(v["schemaId"])) {
    errors.push(`${path}.schemaId: expected non-empty string`);
  }
  if (v["reasoningCap"] !== 40 && v["reasoningCap"] !== 30 && v["reasoningCap"] !== 20) {
    errors.push(`${path}.reasoningCap: expected 40, 30, or 20`);
  }
  if (!isNonEmptyStr(v["promptVersion"])) {
    errors.push(`${path}.promptVersion: expected non-empty string`);
  }
  if (!isNonNegInt(v["decidedAt"])) {
    errors.push(`${path}.decidedAt: expected non-negative integer`);
  }
}

function validateStage1ResultInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected Stage1Result object`);
    return;
  }
  checkAllowedKeys(
    v,
    [
      "resultKey",
      "atoms",
      "worth",
      "claimType",
      "uncited",
      "modelProfile",
      "schemaId",
      "promptVersion",
      "decidedAt",
    ],
    [],
    path,
    errors
  );
  if (!isNonEmptyStr(v["resultKey"])) {
    errors.push(`${path}.resultKey: expected non-empty string`);
  }
  validateStage1Atoms(v["atoms"], `${path}.atoms`, errors);
  if (Array.isArray(v["atoms"]) && (v["atoms"].length < 1 || v["atoms"].length > 3)) {
    errors.push(`${path}.atoms: expected 1..3 items`);
  }
  if (!WORTH_VALUES.includes(v["worth"] as Worth)) {
    errors.push(`${path}.worth: invalid Worth`);
  }
  if (!CLAIM_TYPES.includes(v["claimType"] as ClaimType)) {
    errors.push(`${path}.claimType: invalid ClaimType`);
  }
  if (typeof v["uncited"] !== "boolean") {
    errors.push(`${path}.uncited: expected boolean`);
  }
  if (!isNonEmptyStr(v["modelProfile"])) {
    errors.push(`${path}.modelProfile: expected non-empty string`);
  }
  if (!isNonEmptyStr(v["schemaId"])) {
    errors.push(`${path}.schemaId: expected non-empty string`);
  }
  if (!isNonEmptyStr(v["promptVersion"])) {
    errors.push(`${path}.promptVersion: expected non-empty string`);
  }
  if (!isNonNegInt(v["decidedAt"])) {
    errors.push(`${path}.decidedAt: expected non-negative integer`);
  }
}

function validateCloudResultInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected CloudResult object`);
    return;
  }
  checkAllowedKeys(
    v,
    [
      "resultKey",
      "normalizedClaimHash",
      "refId",
      "verdict",
      "quote",
      "quoteAnchor",
      "approvedTextSha256",
      "alternativesDois",
      "noDifferenceNote",
      "adjudicator",
      "inferenceSource",
      "promptVersion",
      "decidedAt",
    ],
    [],
    path,
    errors
  );
  if (!isNonEmptyStr(v["resultKey"])) errors.push(`${path}.resultKey: expected non-empty string`);
  if (!isNonEmptyStr(v["normalizedClaimHash"])) {
    errors.push(`${path}.normalizedClaimHash: expected non-empty string`);
  }
  if (!isNonEmptyStr(v["refId"])) errors.push(`${path}.refId: expected non-empty string`);
  if (!CLOUD_VERDICTS.includes(v["verdict"] as CloudVerdict)) {
    errors.push(`${path}.verdict: invalid CloudVerdict`);
  }
  if (v["quote"] !== null && typeof v["quote"] !== "string") {
    errors.push(`${path}.quote: expected string or null`);
  }
  if (v["quoteAnchor"] !== null) {
    validateEvidenceAnchorInternal(v["quoteAnchor"], `${path}.quoteAnchor`, errors);
  }
  if (!isNonEmptyStr(v["approvedTextSha256"])) {
    errors.push(`${path}.approvedTextSha256: expected non-empty string`);
  }
  if (
    !Array.isArray(v["alternativesDois"]) ||
    !v["alternativesDois"].every((d) => typeof d === "string")
  ) {
    errors.push(`${path}.alternativesDois: expected string[]`);
  }
  if (typeof v["noDifferenceNote"] !== "boolean") {
    errors.push(`${path}.noDifferenceNote: expected boolean`);
  }
  if (v["adjudicator"] !== "l2Adjudicate" && v["adjudicator"] !== "l2AdjudicateProvided") {
    errors.push(`${path}.adjudicator: invalid adjudicator`);
  }
  if (!INFERENCE_SOURCE_TAGS.includes(v["inferenceSource"] as InferenceSourceTag)) {
    errors.push(`${path}.inferenceSource: invalid InferenceSourceTag`);
  }
  if (!isNonEmptyStr(v["promptVersion"])) {
    errors.push(`${path}.promptVersion: expected non-empty string`);
  }
  if (!isNonNegInt(v["decidedAt"])) {
    errors.push(`${path}.decidedAt: expected non-negative integer`);
  }
}

function validatePhysicalResultInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected PhysicalResult object`);
    return;
  }
  checkAllowedKeys(
    v,
    [
      "resultKey",
      "normalizedClaimHash",
      "refId",
      "verdict",
      "capture",
      "inferenceSource",
      "decidedAt",
    ],
    [],
    path,
    errors
  );
  if (!isNonEmptyStr(v["resultKey"])) errors.push(`${path}.resultKey: expected non-empty string`);
  if (!isNonEmptyStr(v["normalizedClaimHash"])) {
    errors.push(`${path}.normalizedClaimHash: expected non-empty string`);
  }
  if (v["refId"] !== null && !isNonEmptyStr(v["refId"])) {
    errors.push(`${path}.refId: expected non-empty string or null`);
  }
  if (!PHYSICAL_VERDICTS.includes(v["verdict"] as PhysicalVerdict)) {
    errors.push(`${path}.verdict: invalid PhysicalVerdict`);
  }
  if (!isRecord(v["capture"])) {
    errors.push(`${path}.capture: expected PhysicalSource object`);
  } else {
    const cap = v["capture"];
    checkAllowedKeys(
      cap,
      [
        "captureId",
        "photoSha256",
        "kind",
        "linkedRefId",
        "pageLabel",
        "rowCropSha256",
        "confirmedByAuthorAt",
        "entailmentConfirmedByAuthorAt",
      ],
      [],
      `${path}.capture`,
      errors
    );
    if (!isNonEmptyStr(cap["captureId"])) {
      errors.push(`${path}.capture.captureId: expected non-empty string`);
    }
    if (!isNonEmptyStr(cap["photoSha256"])) {
      errors.push(`${path}.capture.photoSha256: expected non-empty string`);
    }
    if (!PHYSICAL_KINDS.includes(cap["kind"] as PhysicalKind)) {
      errors.push(`${path}.capture.kind: invalid PhysicalKind`);
    }
    if (cap["linkedRefId"] !== null && !isNonEmptyStr(cap["linkedRefId"])) {
      errors.push(`${path}.capture.linkedRefId: expected non-empty string or null`);
    }
    if (typeof cap["pageLabel"] !== "string") {
      errors.push(`${path}.capture.pageLabel: expected string`);
    }
    if (cap["rowCropSha256"] !== null && !isNonEmptyStr(cap["rowCropSha256"])) {
      errors.push(`${path}.capture.rowCropSha256: expected non-empty string or null`);
    }
    if (cap["confirmedByAuthorAt"] !== null && !isNonNegInt(cap["confirmedByAuthorAt"])) {
      errors.push(`${path}.capture.confirmedByAuthorAt: expected non-negative integer or null`);
    }
    if (
      cap["entailmentConfirmedByAuthorAt"] !== null &&
      !isNonNegInt(cap["entailmentConfirmedByAuthorAt"])
    ) {
      errors.push(
        `${path}.capture.entailmentConfirmedByAuthorAt: expected non-negative integer or null`
      );
    }
  }
  if (!INFERENCE_SOURCE_TAGS.includes(v["inferenceSource"] as InferenceSourceTag)) {
    errors.push(`${path}.inferenceSource: invalid InferenceSourceTag`);
  }
  if (!isNonNegInt(v["decidedAt"])) {
    errors.push(`${path}.decidedAt: expected non-negative integer`);
  }
}

function validateRefFactsInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected RefFacts object`);
    return;
  }
  checkAllowedKeys(
    v,
    [
      "refId",
      "bibStatus",
      "retracted",
      "checkMetadata",
      "evidenceVersion",
      "hasEvidence",
      "updatedSeq",
    ],
    [],
    path,
    errors
  );
  if (!isNonEmptyStr(v["refId"])) errors.push(`${path}.refId: expected non-empty string`);
  if (!BIB_STATUSES.includes(v["bibStatus"] as BibStatus)) {
    errors.push(`${path}.bibStatus: invalid BibStatus`);
  }
  if (typeof v["retracted"] !== "boolean") errors.push(`${path}.retracted: expected boolean`);
  if (typeof v["checkMetadata"] !== "boolean") {
    errors.push(`${path}.checkMetadata: expected boolean`);
  }
  if (!isNonEmptyStr(v["evidenceVersion"])) {
    errors.push(`${path}.evidenceVersion: expected non-empty string`);
  }
  if (typeof v["hasEvidence"] !== "boolean") errors.push(`${path}.hasEvidence: expected boolean`);
  if (!isNonNegInt(v["updatedSeq"])) {
    errors.push(`${path}.updatedSeq: expected non-negative integer`);
  }
}

function validateAuthorOverrideInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected AuthorOverride object`);
    return;
  }
  checkAllowedKeys(
    v,
    [
      "dismissedState",
      "basis",
      "captureId",
      "normalizedClaimHash",
      "refIdsKey",
      "note",
      "createdAt",
    ],
    [],
    path,
    errors
  );
  if (!CLAUSE_STATES.includes(v["dismissedState"] as ClauseState)) {
    errors.push(`${path}.dismissedState: invalid ClauseState`);
  }
  if (!OVERRIDE_BASES.includes(v["basis"] as OverrideBasis)) {
    errors.push(`${path}.basis: invalid OverrideBasis`);
  }
  if (v["captureId"] !== null && !isNonEmptyStr(v["captureId"])) {
    errors.push(`${path}.captureId: expected non-empty string or null`);
  }
  if (v["basis"] === "PRINTED_SOURCE" && !isNonEmptyStr(v["captureId"])) {
    errors.push(`${path}.captureId: required when basis is PRINTED_SOURCE`);
  }
  if (v["basis"] === "REVIEW" && v["captureId"] !== null) {
    errors.push(`${path}.captureId: must be null when basis is REVIEW`);
  }
  if (!isNonEmptyStr(v["normalizedClaimHash"])) {
    errors.push(`${path}.normalizedClaimHash: expected non-empty string`);
  }
  if (typeof v["refIdsKey"] !== "string") {
    errors.push(`${path}.refIdsKey: expected string`);
  }
  if (typeof v["note"] !== "string" || v["note"].length > 200) {
    errors.push(`${path}.note: expected string of length <= 200`);
  }
  if (!isNonNegInt(v["createdAt"])) {
    errors.push(`${path}.createdAt: expected non-negative integer`);
  }
}

function validateLabNoteFlagInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected LabNoteFlag object`);
    return;
  }
  checkAllowedKeys(v, ["pageLabel", "confirmedByAuthorAt"], [], path, errors);
  if (typeof v["pageLabel"] !== "string") {
    errors.push(`${path}.pageLabel: expected string`);
  }
  if (!isNonNegInt(v["confirmedByAuthorAt"])) {
    errors.push(`${path}.confirmedByAuthorAt: expected non-negative integer`);
  }
}

function validateClaimLedgerEntryInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected ClaimLedgerEntry object`);
    return;
  }
  checkAllowedKeys(
    v,
    [
      "claimId",
      "docId",
      "sentenceHash",
      "occurrenceIndex",
      "clauseIndex",
      "section",
      "subsection",
      "span",
      "claimText",
      "normalizedClaimHash",
      "baseline",
      "stage1",
      "citationKeys",
      "possibleCitations",
      "refs",
      "heldNei",
      "job",
      "l0Error",
      "b5",
      "labNoteMismatch",
      "suggestedRefIds",
      "override",
      "archived",
      "updatedAt",
    ],
    [],
    path,
    errors
  );
  if (!isNonEmptyStr(v["claimId"])) errors.push(`${path}.claimId: expected non-empty string`);
  if (!isNonEmptyStr(v["docId"])) errors.push(`${path}.docId: expected non-empty string`);
  if (!isNonEmptyStr(v["sentenceHash"])) {
    errors.push(`${path}.sentenceHash: expected non-empty string`);
  }
  if (!isNonNegInt(v["occurrenceIndex"])) {
    errors.push(`${path}.occurrenceIndex: expected non-negative integer`);
  }
  if (!isNonNegInt(v["clauseIndex"])) {
    errors.push(`${path}.clauseIndex: expected non-negative integer`);
  }
  if (!isNonEmptyStr(v["section"])) errors.push(`${path}.section: expected non-empty string`);
  if (v["subsection"] !== null && typeof v["subsection"] !== "string") {
    errors.push(`${path}.subsection: expected string or null`);
  }
  validateTextRangeInternal(v["span"], `${path}.span`, errors);
  if (typeof v["claimText"] !== "string") errors.push(`${path}.claimText: expected string`);
  if (!isNonEmptyStr(v["normalizedClaimHash"])) {
    errors.push(`${path}.normalizedClaimHash: expected non-empty string`);
  }

  if (!isRecord(v["baseline"])) {
    errors.push(`${path}.baseline: expected BaselineTriage object`);
  } else {
    const bl = v["baseline"];
    checkAllowedKeys(bl, ["atoms", "worth", "claimType", "uncited"], [], `${path}.baseline`, errors);
    validateStage1Atoms(bl["atoms"], `${path}.baseline.atoms`, errors);
    if (!WORTH_VALUES.includes(bl["worth"] as Worth)) {
      errors.push(`${path}.baseline.worth: invalid Worth`);
    }
    if (!CLAIM_TYPES.includes(bl["claimType"] as ClaimType)) {
      errors.push(`${path}.baseline.claimType: invalid ClaimType`);
    }
    if (typeof bl["uncited"] !== "boolean") {
      errors.push(`${path}.baseline.uncited: expected boolean`);
    }
  }

  if (v["stage1"] !== null) {
    validateStage1ResultInternal(v["stage1"], `${path}.stage1`, errors);
  }
  if (!Array.isArray(v["citationKeys"]) || !v["citationKeys"].every((k) => typeof k === "string")) {
    errors.push(`${path}.citationKeys: expected string[]`);
  }
  if (!Array.isArray(v["possibleCitations"])) {
    errors.push(`${path}.possibleCitations: expected TextRange[]`);
  } else {
    for (let i = 0; i < v["possibleCitations"].length; i += 1) {
      validateTextRangeInternal(v["possibleCitations"][i], `${path}.possibleCitations[${i}]`, errors);
    }
  }

  if (!Array.isArray(v["refs"])) {
    errors.push(`${path}.refs: expected ClauseRef[]`);
  } else {
    for (let i = 0; i < v["refs"].length; i += 1) {
      const ref = v["refs"][i];
      const refPath = `${path}.refs[${i}]`;
      if (!isRecord(ref)) {
        errors.push(`${refPath}: expected ClauseRef object`);
        continue;
      }
      checkAllowedKeys(ref, ["refId", "selection", "local", "cloud", "physical"], [], refPath, errors);
      if (!isNonEmptyStr(ref["refId"])) errors.push(`${refPath}.refId: expected non-empty string`);
      if (ref["selection"] !== null) {
        validateSelectionInternal(ref["selection"], `${refPath}.selection`, errors);
      }
      if (ref["local"] !== null) {
        validateLocalResultInternal(ref["local"], `${refPath}.local`, errors);
      }
      if (ref["cloud"] !== null) {
        validateCloudResultInternal(ref["cloud"], `${refPath}.cloud`, errors);
      }
      if (ref["physical"] !== null) {
        validatePhysicalResultInternal(ref["physical"], `${refPath}.physical`, errors);
      }
    }
  }

  if (!isRecord(v["heldNei"])) {
    errors.push(`${path}.heldNei: expected Versioned object`);
  } else {
    checkAllowedKeys(v["heldNei"], ["value", "seq"], [], `${path}.heldNei`, errors);
    if (!isNonNegInt(v["heldNei"]["seq"])) {
      errors.push(`${path}.heldNei.seq: expected non-negative integer`);
    }
    const hv = v["heldNei"]["value"];
    if (hv !== null) {
      if (!isRecord(hv)) {
        errors.push(`${path}.heldNei.value: expected { since } or null`);
      } else {
        checkAllowedKeys(hv, ["since"], [], `${path}.heldNei.value`, errors);
        if (!isNonNegInt(hv["since"])) {
          errors.push(`${path}.heldNei.value.since: expected non-negative integer`);
        }
      }
    }
  }

  if (!isRecord(v["job"])) {
    errors.push(`${path}.job: expected Versioned<boolean>`);
  } else {
    checkAllowedKeys(v["job"], ["value", "seq"], [], `${path}.job`, errors);
    if (typeof v["job"]["value"] !== "boolean") {
      errors.push(`${path}.job.value: expected boolean`);
    }
    if (!isNonNegInt(v["job"]["seq"])) {
      errors.push(`${path}.job.seq: expected non-negative integer`);
    }
  }

  if (v["l0Error"] !== null && !L0_ERRORS.includes(v["l0Error"] as L0Error)) {
    errors.push(`${path}.l0Error: invalid L0Error`);
  }

  if (!isRecord(v["b5"])) {
    errors.push(`${path}.b5: expected object`);
  } else {
    checkAllowedKeys(v["b5"], ["inconsistentWith"], [], `${path}.b5`, errors);
    if (
      !Array.isArray(v["b5"]["inconsistentWith"]) ||
      !v["b5"]["inconsistentWith"].every((c) => typeof c === "string")
    ) {
      errors.push(`${path}.b5.inconsistentWith: expected string[]`);
    }
  }

  if (!Array.isArray(v["labNoteMismatch"])) {
    errors.push(`${path}.labNoteMismatch: expected array`);
  } else {
    for (let i = 0; i < v["labNoteMismatch"].length; i += 1) {
      const item = v["labNoteMismatch"][i];
      const itemPath = `${path}.labNoteMismatch[${i}]`;
      if (!isRecord(item)) {
        errors.push(`${itemPath}: expected object`);
        continue;
      }
      checkAllowedKeys(item, ["captureId", "flag"], [], itemPath, errors);
      if (!isNonEmptyStr(item["captureId"])) {
        errors.push(`${itemPath}.captureId: expected non-empty string`);
      }
      if (!isRecord(item["flag"])) {
        errors.push(`${itemPath}.flag: expected Versioned<LabNoteFlag | null>`);
      } else {
        checkAllowedKeys(item["flag"], ["value", "seq"], [], `${itemPath}.flag`, errors);
        if (!isNonNegInt(item["flag"]["seq"])) {
          errors.push(`${itemPath}.flag.seq: expected non-negative integer`);
        }
        if (item["flag"]["value"] !== null) {
          validateLabNoteFlagInternal(item["flag"]["value"], `${itemPath}.flag.value`, errors);
        }
      }
    }
  }

  if (
    !Array.isArray(v["suggestedRefIds"]) ||
    !v["suggestedRefIds"].every((s) => typeof s === "string")
  ) {
    errors.push(`${path}.suggestedRefIds: expected string[]`);
  }

  if (!isRecord(v["override"])) {
    errors.push(`${path}.override: expected Versioned<AuthorOverride | null>`);
  } else {
    checkAllowedKeys(v["override"], ["value", "seq"], [], `${path}.override`, errors);
    if (!isNonNegInt(v["override"]["seq"])) {
      errors.push(`${path}.override.seq: expected non-negative integer`);
    }
    if (v["override"]["value"] !== null) {
      validateAuthorOverrideInternal(v["override"]["value"], `${path}.override.value`, errors);
    }
  }

  if (typeof v["archived"] !== "boolean") errors.push(`${path}.archived: expected boolean`);
  if (!isNonNegInt(v["updatedAt"])) {
    errors.push(`${path}.updatedAt: expected non-negative integer`);
  }
}

export function validateQuantTuple(v: unknown): DomainValidationResult<QuantTuple> {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ["$: expected QuantTuple object"] };
  }
  checkAllowedKeys(
    v,
    [
      "tupleId",
      "valueRaw",
      "unitRaw",
      "metricClass",
      "pComparator",
      "valueNorm",
      "valueLo",
      "valueHi",
      "sigDigits",
      "unitCanon",
      "keyLemmas",
      "section",
      "source",
      "span",
    ],
    [],
    "$",
    errors
  );
  if (!isNonEmptyStr(v["tupleId"])) errors.push("$.tupleId: expected non-empty string");
  if (!isNonEmptyStr(v["valueRaw"])) errors.push("$.valueRaw: expected non-empty string");
  if (typeof v["unitRaw"] !== "string") errors.push("$.unitRaw: expected string");
  if (!METRIC_CLASSES.includes(v["metricClass"] as MetricClass)) {
    errors.push("$.metricClass: invalid MetricClass");
  }
  if (
    v["pComparator"] !== null &&
    !P_COMPARATORS.includes(v["pComparator"] as PComparator)
  ) {
    errors.push("$.pComparator: invalid PComparator");
  }
  if (v["valueNorm"] !== null && !isFiniteNum(v["valueNorm"])) {
    errors.push("$.valueNorm: expected finite number or null");
  }
  if (v["valueLo"] !== null && !isFiniteNum(v["valueLo"])) {
    errors.push("$.valueLo: expected finite number or null");
  }
  if (v["valueHi"] !== null && !isFiniteNum(v["valueHi"])) {
    errors.push("$.valueHi: expected finite number or null");
  }
  if (
    isFiniteNum(v["valueLo"]) &&
    isFiniteNum(v["valueHi"]) &&
    v["valueHi"] < v["valueLo"]
  ) {
    errors.push("$.valueHi: valueHi < valueLo");
  }
  if (!isNonNegInt(v["sigDigits"])) errors.push("$.sigDigits: expected non-negative integer");
  if (typeof v["unitCanon"] !== "string") errors.push("$.unitCanon: expected string");
  if (!Array.isArray(v["keyLemmas"]) || !v["keyLemmas"].every((k) => typeof k === "string")) {
    errors.push("$.keyLemmas: expected string[]");
  }
  if (!isNonEmptyStr(v["section"])) errors.push("$.section: expected non-empty string");
  if (!TUPLE_SOURCES.includes(v["source"] as TupleSource)) {
    errors.push("$.source: invalid TupleSource");
  }
  validateTextRangeInternal(v["span"], "$.span", errors);
  return errors.length === 0
    ? { ok: true, value: v as unknown as QuantTuple, errors: [] }
    : { ok: false, errors };
}

export function validateEvidenceAnchor(v: unknown): DomainValidationResult<EvidenceAnchor> {
  const errors: string[] = [];
  validateEvidenceAnchorInternal(v, "$", errors);
  return errors.length === 0
    ? { ok: true, value: v as EvidenceAnchor, errors: [] }
    : { ok: false, errors };
}

export function validateLocalResult(v: unknown): DomainValidationResult<LocalResult> {
  const errors: string[] = [];
  validateLocalResultInternal(v, "$", errors);
  return errors.length === 0
    ? { ok: true, value: v as LocalResult, errors: [] }
    : { ok: false, errors };
}

export function validateStage1Result(v: unknown): DomainValidationResult<Stage1Result> {
  const errors: string[] = [];
  validateStage1ResultInternal(v, "$", errors);
  return errors.length === 0
    ? { ok: true, value: v as Stage1Result, errors: [] }
    : { ok: false, errors };
}

export function validateCloudResult(v: unknown): DomainValidationResult<CloudResult> {
  const errors: string[] = [];
  validateCloudResultInternal(v, "$", errors);
  return errors.length === 0
    ? { ok: true, value: v as CloudResult, errors: [] }
    : { ok: false, errors };
}

export function validatePhysicalResult(v: unknown): DomainValidationResult<PhysicalResult> {
  const errors: string[] = [];
  validatePhysicalResultInternal(v, "$", errors);
  return errors.length === 0
    ? { ok: true, value: v as PhysicalResult, errors: [] }
    : { ok: false, errors };
}

export function validateRefFacts(v: unknown): DomainValidationResult<RefFacts> {
  const errors: string[] = [];
  validateRefFactsInternal(v, "$", errors);
  return errors.length === 0
    ? { ok: true, value: v as RefFacts, errors: [] }
    : { ok: false, errors };
}

export function validateSelection(v: unknown): DomainValidationResult<Selection> {
  const errors: string[] = [];
  validateSelectionInternal(v, "$", errors);
  return errors.length === 0
    ? { ok: true, value: v as Selection, errors: [] }
    : { ok: false, errors };
}

export function validateClaimLedgerEntry(v: unknown): DomainValidationResult<ClaimLedgerEntry> {
  const errors: string[] = [];
  validateClaimLedgerEntryInternal(v, "$", errors);
  return errors.length === 0
    ? { ok: true, value: v as ClaimLedgerEntry, errors: [] }
    : { ok: false, errors };
}

export function validateCoverageMeter(v: unknown): DomainValidationResult<CoverageMeter> {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ["$: expected CoverageMeter object"] };
  }
  checkAllowedKeys(
    v,
    [
      "total",
      "supported",
      "reviewed",
      "local",
      "problems",
      "to_review",
      "waiting",
      "unverifiable",
      "unchecked",
      "notYetChecked",
      "notCheckable",
      "numberMismatches",
      "quotaExhausted",
      "quotaResetAt",
      "byProvenance",
    ],
    [],
    "$",
    errors
  );

  const countFields = [
    "total",
    "supported",
    "reviewed",
    "local",
    "problems",
    "to_review",
    "waiting",
    "unverifiable",
    "unchecked",
    "notYetChecked",
    "notCheckable",
    "numberMismatches",
  ] as const;
  for (const field of countFields) {
    if (!isNonNegInt(v[field])) {
      errors.push(`$.${field}: expected non-negative integer`);
    }
  }
  if (typeof v["quotaExhausted"] !== "boolean") {
    errors.push("$.quotaExhausted: expected boolean");
  }
  if (v["quotaResetAt"] !== null && !isNonNegInt(v["quotaResetAt"])) {
    errors.push("$.quotaResetAt: expected non-negative integer or null");
  }

  const provKeys = [
    "DETERMINISTIC",
    "ON_DEVICE",
    "CLOUD",
    "PHYSICAL_SOURCE",
    "AUTHOR",
  ] as const;
  if (!isRecord(v["byProvenance"])) {
    errors.push("$.byProvenance: expected object");
  } else {
    checkAllowedKeys(v["byProvenance"], provKeys, [], "$.byProvenance", errors);
    for (const pk of provKeys) {
      if (!isNonNegInt(v["byProvenance"][pk])) {
        errors.push(`$.byProvenance.${pk}: expected non-negative integer`);
      }
    }
  }

  if (errors.length === 0) {
    const bucketSum =
      (v["supported"] as number) +
      (v["reviewed"] as number) +
      (v["local"] as number) +
      (v["problems"] as number) +
      (v["to_review"] as number) +
      (v["waiting"] as number) +
      (v["unverifiable"] as number) +
      (v["unchecked"] as number);
    if (bucketSum !== (v["total"] as number)) {
      errors.push(`$.total: 8-bucket sum (${bucketSum}) !== total (${v["total"] as number})`);
    }
    const expectedNotYet = (v["local"] as number) + (v["unchecked"] as number);
    if ((v["notYetChecked"] as number) !== expectedNotYet) {
      errors.push(
        `$.notYetChecked: expected local + unchecked (${expectedNotYet}), got ${v["notYetChecked"] as number}`
      );
    }
    const bp = v["byProvenance"] as Record<string, number>;
    const provSum =
      bp["DETERMINISTIC"]! +
      bp["ON_DEVICE"]! +
      bp["CLOUD"]! +
      bp["PHYSICAL_SOURCE"]! +
      bp["AUTHOR"]!;
    const maxProvenanceCount = (v["total"] as number) - (v["unchecked"] as number);
    if (provSum > maxProvenanceCount) {
      errors.push(
        `$.byProvenance: sum (${provSum}) exceeds total - unchecked (${maxProvenanceCount})`
      );
    }
  }

  return errors.length === 0
    ? { ok: true, value: v as unknown as CoverageMeter, errors: [] }
    : { ok: false, errors };
}

function validatePolicySnapshotInternal(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected PolicySnapshot object`);
    return;
  }
  checkAllowedKeys(v, ["deviceProfile", "profiles", "b4CountsAsReview"], [], path, errors);
  if (!isNonEmptyStr(v["deviceProfile"])) {
    errors.push(`${path}.deviceProfile: expected non-empty string`);
  }
  if (typeof v["b4CountsAsReview"] !== "boolean") {
    errors.push(`${path}.b4CountsAsReview: expected boolean`);
  }
  if (!isRecord(v["profiles"])) {
    errors.push(`${path}.profiles: expected object`);
  } else {
    for (const profileKey of Object.keys(v["profiles"])) {
      const pp = v["profiles"][profileKey];
      const ppPath = `${path}.profiles.${profileKey}`;
      if (!isRecord(pp)) {
        errors.push(`${ppPath}: expected ProfilePolicy object`);
        continue;
      }
      checkAllowedKeys(
        pp,
        ["path", "authority", "supportVerdicts", "calibratedVariant"],
        [],
        ppPath,
        errors
      );
      if (pp["path"] !== "A" && pp["path"] !== "B") {
        errors.push(`${ppPath}.path: expected "A" or "B"`);
      }
      if (!AUTHORITIES.includes(pp["supportVerdicts"] as Authority)) {
        errors.push(`${ppPath}.supportVerdicts: invalid Authority`);
      }
      if (!isRecord(pp["authority"])) {
        errors.push(`${ppPath}.authority: expected Task -> Authority map`);
      } else {
        checkAllowedKeys(pp["authority"], TASKS, [], `${ppPath}.authority`, errors);
        for (const t of TASKS) {
          if (!AUTHORITIES.includes(pp["authority"][t] as Authority)) {
            errors.push(`${ppPath}.authority.${t}: invalid Authority`);
          }
        }
      }
      if (!isRecord(pp["calibratedVariant"])) {
        errors.push(`${ppPath}.calibratedVariant: expected object`);
      } else {
        checkAllowedKeys(
          pp["calibratedVariant"],
          ["schemaId", "reasoningCap"],
          [],
          `${ppPath}.calibratedVariant`,
          errors
        );
        if (typeof pp["calibratedVariant"]["schemaId"] !== "string") {
          errors.push(`${ppPath}.calibratedVariant.schemaId: expected string`);
        }
        if (!isNonNegInt(pp["calibratedVariant"]["reasoningCap"])) {
          errors.push(`${ppPath}.calibratedVariant.reasoningCap: expected non-negative integer`);
        }
      }
    }
  }
}

export function validateLedgerEvent(v: unknown): DomainValidationResult<LedgerEvent> {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ["$: expected LedgerEvent object"] };
  }
  const type = v["type"];
  switch (type) {
    case "ClauseCreated":
      checkAllowedKeys(v, ["type", "entry"], [], "$", errors);
      validateClaimLedgerEntryInternal(v["entry"], "$.entry", errors);
      break;
    case "BibResolved":
      checkAllowedKeys(v, ["type", "refId", "bibStatus", "retracted", "checkMetadata", "seq"], [], "$", errors);
      if (!isNonEmptyStr(v["refId"])) errors.push("$.refId: expected non-empty string");
      if (!BIB_STATUSES.includes(v["bibStatus"] as BibStatus)) {
        errors.push("$.bibStatus: invalid BibStatus");
      }
      if (typeof v["retracted"] !== "boolean") errors.push("$.retracted: expected boolean");
      if (typeof v["checkMetadata"] !== "boolean") errors.push("$.checkMetadata: expected boolean");
      if (!isNonNegInt(v["seq"])) errors.push("$.seq: expected non-negative integer");
      break;
    case "RetractionSnapshot":
      checkAllowedKeys(v, ["type", "refIds"], [], "$", errors);
      if (!Array.isArray(v["refIds"]) || !v["refIds"].every((r) => isNonEmptyStr(r))) {
        errors.push("$.refIds: expected non-empty string[]");
      }
      break;
    case "Stage1ResultArrived":
      checkAllowedKeys(v, ["type", "result"], [], "$", errors);
      validateStage1ResultInternal(v["result"], "$.result", errors);
      break;
    case "LocalResultArrived":
      checkAllowedKeys(v, ["type", "claimId", "refId", "result"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      if (!isNonEmptyStr(v["refId"])) errors.push("$.refId: expected non-empty string");
      validateLocalResultInternal(v["result"], "$.result", errors);
      break;
    case "EvidenceChanged":
      checkAllowedKeys(v, ["type", "refId", "evidenceVersion", "hasEvidence", "seq"], [], "$", errors);
      if (!isNonEmptyStr(v["refId"])) errors.push("$.refId: expected non-empty string");
      if (!isNonEmptyStr(v["evidenceVersion"])) {
        errors.push("$.evidenceVersion: expected non-empty string");
      }
      if (typeof v["hasEvidence"] !== "boolean") errors.push("$.hasEvidence: expected boolean");
      if (!isNonNegInt(v["seq"])) errors.push("$.seq: expected non-negative integer");
      break;
    case "SelectionComputed":
      checkAllowedKeys(v, ["type", "claimId", "refId", "selection"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      if (!isNonEmptyStr(v["refId"])) errors.push("$.refId: expected non-empty string");
      validateSelectionInternal(v["selection"], "$.selection", errors);
      break;
    case "CloudResultArrived":
      checkAllowedKeys(v, ["type", "claimId", "refId", "result"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      if (!isNonEmptyStr(v["refId"])) errors.push("$.refId: expected non-empty string");
      validateCloudResultInternal(v["result"], "$.result", errors);
      break;
    case "PhysicalResultArrived":
      checkAllowedKeys(v, ["type", "claimId", "result"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      validatePhysicalResultInternal(v["result"], "$.result", errors);
      break;
    case "ClauseEdited":
      checkAllowedKeys(v, ["type", "oldClaimIds", "newSegmentation"], [], "$", errors);
      if (!Array.isArray(v["oldClaimIds"]) || !v["oldClaimIds"].every((id) => isNonEmptyStr(id))) {
        errors.push("$.oldClaimIds: expected non-empty string[]");
      }
      if (!Array.isArray(v["newSegmentation"])) {
        errors.push("$.newSegmentation: expected ClaimLedgerEntry[]");
      } else {
        for (let i = 0; i < v["newSegmentation"].length; i += 1) {
          validateClaimLedgerEntryInternal(
            v["newSegmentation"][i],
            `$.newSegmentation[${i}]`,
            errors
          );
        }
      }
      break;
    case "JobState":
      checkAllowedKeys(v, ["type", "claimId", "inFlight", "seq"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      if (typeof v["inFlight"] !== "boolean") errors.push("$.inFlight: expected boolean");
      if (!isNonNegInt(v["seq"])) errors.push("$.seq: expected non-negative integer");
      break;
    case "HeldNei":
      checkAllowedKeys(v, ["type", "claimId", "value", "seq"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      if (!isNonNegInt(v["seq"])) errors.push("$.seq: expected non-negative integer");
      if (v["value"] !== null) {
        if (!isRecord(v["value"])) {
          errors.push("$.value: expected { since } or null");
        } else {
          checkAllowedKeys(v["value"], ["since"], [], "$.value", errors);
          if (!isNonNegInt(v["value"]["since"])) {
            errors.push("$.value.since: expected non-negative integer");
          }
        }
      }
      break;
    case "Override":
      checkAllowedKeys(v, ["type", "claimId", "value", "seq"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      if (!isNonNegInt(v["seq"])) errors.push("$.seq: expected non-negative integer");
      if (v["value"] !== null) {
        validateAuthorOverrideInternal(v["value"], "$.value", errors);
      }
      break;
    case "B5Changed":
      checkAllowedKeys(v, ["type", "claimIds"], [], "$", errors);
      if (!Array.isArray(v["claimIds"]) || !v["claimIds"].every((id) => isNonEmptyStr(id))) {
        errors.push("$.claimIds: expected non-empty string[]");
      }
      break;
    case "L0Timeout":
      checkAllowedKeys(v, ["type", "claimId"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      break;
    case "PolicyChanged":
      checkAllowedKeys(v, ["type", "snapshot"], [], "$", errors);
      validatePolicySnapshotInternal(v["snapshot"], "$.snapshot", errors);
      break;
    case "LabNoteMismatch":
      checkAllowedKeys(v, ["type", "claimId", "captureId", "value", "seq"], [], "$", errors);
      if (!isNonEmptyStr(v["claimId"])) errors.push("$.claimId: expected non-empty string");
      if (!isNonEmptyStr(v["captureId"])) errors.push("$.captureId: expected non-empty string");
      if (!isNonNegInt(v["seq"])) errors.push("$.seq: expected non-negative integer");
      if (v["value"] !== null) {
        validateLabNoteFlagInternal(v["value"], "$.value", errors);
      }
      break;
    default:
      errors.push(`$.type: unknown LedgerEvent type "${String(type)}"`);
      break;
  }
  return errors.length === 0
    ? { ok: true, value: v as LedgerEvent, errors: [] }
    : { ok: false, errors };
}
