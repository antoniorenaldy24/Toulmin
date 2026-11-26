/**
 * Pure, deterministic, commutative event-sourced Claim Ledger Reducer and
 * 8-bucket Coverage Meter (`docs/spec/01_DATA_REDUCER_AND_METER.md` §1–§5).
 *
 * Tier B module (`packages/core-l0/src/ledger.ts`, D-30):
 * - Zero Firebase, DOM, network, Node I/O, clock, unseeded randomness, or regex usage.
 * - Zero mutation of caller-owned input objects.
 * - Reuses canonical domain types and `validateCoverageMeter` from `@toulmin/schemas`.
 */

import { sha256hex } from "./norm.js";
import type {
  AnchorFailReason,
  AuthorOverride,
  Authority,
  BaselineTriage,
  BibStatus,
  ClaimLedgerEntry,
  ClaimType,
  ClauseRef,
  ClauseState,
  CloudResult,
  CloudVerdict,
  CoverageMeter,
  DerivedClause,
  EffectiveTriage,
  EvidenceAnchor,
  EvidenceSourceKind,
  InferenceSourceTag,
  L0Error,
  LabNoteFlag,
  LabNoteMismatchItem,
  LedgerEvent,
  LocalResult,
  LocalVerdict,
  MarkerKind,
  MeterCategory,
  MetricClass,
  OverrideBasis,
  PComparator,
  PhysicalKind,
  PhysicalResult,
  PhysicalSource,
  PhysicalVerdict,
  PolicySnapshot,
  PrivacyContext,
  ProfilePolicy,
  Provenance,
  QuantTuple,
  RefFacts,
  RefState,
  Selection,
  SessionFacts,
  Stage1Atom,
  Stage1Result,
  Task,
  TextRange,
  TransientReason,
  Versioned,
  Worth,
} from "@toulmin/schemas";
import { TASKS, validateCoverageMeter } from "@toulmin/schemas";

export type {
  AnchorFailReason,
  AuthorOverride,
  Authority,
  BaselineTriage,
  BibStatus,
  ClaimLedgerEntry,
  ClaimType,
  ClauseRef,
  ClauseState,
  CloudResult,
  CloudVerdict,
  CoverageMeter,
  DerivedClause,
  EffectiveTriage,
  EvidenceAnchor,
  EvidenceSourceKind,
  InferenceSourceTag,
  L0Error,
  LabNoteFlag,
  LabNoteMismatchItem,
  LedgerEvent,
  LocalResult,
  LocalVerdict,
  MarkerKind,
  MeterCategory,
  MetricClass,
  OverrideBasis,
  PComparator,
  PhysicalKind,
  PhysicalResult,
  PhysicalSource,
  PhysicalVerdict,
  PolicySnapshot,
  PrivacyContext,
  ProfilePolicy,
  Provenance,
  QuantTuple,
  RefFacts,
  RefState,
  Selection,
  SessionFacts,
  Stage1Atom,
  Stage1Result,
  Task,
  TextRange,
  TransientReason,
  Versioned,
  Worth,
};
export { validateCoverageMeter };

export const DEFAULT_PROMPT_VERSION = "p2.1";
export const EMPTY_EVIDENCE_VERSION = sha256hex("");

export const CONSERVATIVE_PROFILE: ProfilePolicy = {
  path: "B",
  authority: {
    B1: "advisory",
    B2: "advisory",
    B3: "advisory",
    B5: "advisory",
    O2: "advisory",
  },
  supportVerdicts: "advisory",
  calibratedVariant: {
    schemaId: "",
    reasoningCap: 0,
  },
};

export const BUNDLED_SAMPLE_PRIVACY_CONTEXT: PrivacyContext = {
  mode: "CONFIDENTIAL",
  cloudAvailable: false,
  quotaExhausted: false,
  quotaResetAt: null,
};

export interface ResultCache {
  readonly stage1: ReadonlyMap<string, Stage1Result>;
  readonly local: ReadonlyMap<string, LocalResult>;
  readonly cloud: ReadonlyMap<string, CloudResult>;
  readonly physical: ReadonlyMap<string, PhysicalResult>;
}

interface RefFactInternal {
  readonly refId: string;
  readonly bib: Versioned<{ readonly bibStatus: BibStatus; readonly checkMetadata: boolean }> | null;
  readonly evidence: Versioned<{ readonly evidenceVersion: string; readonly hasEvidence: boolean }> | null;
  readonly retracted: boolean;
}

interface ClaimSideFacts {
  readonly job: Versioned<boolean> | null;
  readonly heldNei: Versioned<{ readonly since: number } | null> | null;
  readonly override: Versioned<AuthorOverride | null> | null;
  readonly validOverridesByTarget: ReadonlyMap<string, Versioned<AuthorOverride | null>>;
  readonly overrideUndo: Versioned<AuthorOverride | null> | null;
  readonly selections: ReadonlyMap<string, Selection>;
  readonly labNoteMismatch: ReadonlyMap<string, Versioned<LabNoteFlag | null>>;
  readonly archived: boolean;
  readonly l0Error: L0Error | null;
  readonly b5InconsistentWith: readonly string[] | null;
}

export interface LedgerState {
  readonly policy: PolicySnapshot;
  readonly promptVersion: string;
  readonly results: ResultCache;
  readonly refFacts: ReadonlyMap<string, RefFacts>;
  readonly entries: ReadonlyMap<string, ClaimLedgerEntry>;
  readonly overridesByKey: ReadonlyMap<string, Versioned<AuthorOverride | null>>;
  readonly _refInternals: ReadonlyMap<string, RefFactInternal>;
  readonly _claimFacts: ReadonlyMap<string, ClaimSideFacts>;
}

export interface CreateLedgerStateOptions {
  readonly policy?: PolicySnapshot;
  readonly promptVersion?: string;
}

export type B5PartnerResolver = (claimId: string, state: LedgerState) => readonly string[];

export interface ApplyEventOptions {
  readonly b5Resolver?: B5PartnerResolver;
}

export type StateFamily =
  | "unresolved"
  | Exclude<
      ClauseState,
      "WAITING" | "UNVERIFIABLE" | "SOURCE_FLAGGED" | "MIXED_SUPPORT"
    >;

// ───────────────────────── Pure utilities & RFC 8785 JCS ─────────────────────────

/**
 * Deterministic UTF-16 code-unit order comparator (locale-independent).
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Canonical JSON serialization following RFC 8785 (JSON Canonicalization Scheme):
 * - object keys sorted ascending by UTF-16 code units (`compareCodeUnits`)
 * - no insignificant whitespace
 * - `-0` serialized as `"0"`, finite ECMAScript numbers via `JSON.stringify`
 */
export function jcsSerialize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    const num = value as number;
    if (!Number.isFinite(num)) {
      throw new RangeError(`JCS cannot serialize non-finite number: ${String(num)}`);
    }
    return Object.is(num, -0) ? "0" : JSON.stringify(num);
  }
  if (t === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = new Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      parts[i] = item === undefined || typeof item === "function" || typeof item === "symbol"
        ? "null"
        : jcsSerialize(item);
    }
    return `[${parts.join(",")}]`;
  }
  if (isPlainRecord(value)) {
    const keys = Object.keys(value)
      .filter((k) => {
        const v = value[k];
        return v !== undefined && typeof v !== "function" && typeof v !== "symbol";
      })
      .sort(compareCodeUnits);
    const parts: string[] = new Array(keys.length);
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i]!;
      parts[i] = `${JSON.stringify(k)}:${jcsSerialize(value[k])}`;
    }
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`Unsupported JCS value type: ${t}`);
}

export function jcsHash(value: unknown): string {
  return sha256hex(jcsSerialize(value));
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    out[key] = deepClone(src[key]);
  }
  return out as T;
}

function clonePolicySnapshot(policy: PolicySnapshot): PolicySnapshot {
  const clonedProfiles: Record<string, ProfilePolicy> = {};
  const profileKeys = Object.keys(policy.profiles).sort(compareCodeUnits);
  for (const key of profileKeys) {
    const src = policy.profiles[key];
    if (src === undefined) continue;
    clonedProfiles[key] = {
      path: src.path,
      authority: {
        B1: src.authority.B1 ?? "advisory",
        B2: src.authority.B2 ?? "advisory",
        B3: src.authority.B3 ?? "advisory",
        B5: src.authority.B5 ?? "advisory",
        O2: src.authority.O2 ?? "advisory",
      },
      supportVerdicts: src.supportVerdicts,
      calibratedVariant: {
        schemaId: src.calibratedVariant.schemaId,
        reasoningCap: src.calibratedVariant.reasoningCap,
      },
    };
  }
  return {
    deviceProfile: policy.deviceProfile,
    profiles: clonedProfiles,
    b4CountsAsReview: policy.b4CountsAsReview,
  };
}

function dedupeAndSortStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  out.sort(compareCodeUnits);
  return out;
}

function sortedMapFrom<V>(map: ReadonlyMap<string, V>): Map<string, V> {
  const keys = Array.from(map.keys()).sort(compareCodeUnits);
  const out = new Map<string, V>();
  for (const k of keys) {
    out.set(k, map.get(k)!);
  }
  return out;
}

// ───────────────────────── Identity & result keys (`01` §3.3) ─────────────────────────

export function localResultKey(
  normalizedClaimHash: string,
  refId: string,
  evidenceVersion: string,
  promptVersion: string,
  modelProfile: string,
  schemaId: string,
  reasoningCap: number,
): string {
  return sha256hex(
    `L|${normalizedClaimHash}|${refId}|${evidenceVersion}|${promptVersion}|${modelProfile}|${schemaId}|${reasoningCap}`,
  );
}

export function cloudResultKey(
  normalizedClaimHash: string,
  approvedTextSha256: string,
  refId: string,
  promptVersion: string,
  adjudicator: "l2Adjudicate" | "l2AdjudicateProvided",
): string {
  return sha256hex(
    `C|${normalizedClaimHash}|${approvedTextSha256}|${refId}|${promptVersion}|${adjudicator}`,
  );
}

export function physicalResultKey(
  normalizedClaimHash: string,
  refId: string | null,
  photoSha256: string,
): string {
  return sha256hex(`P|${normalizedClaimHash}|${refId ?? "LAB"}|${photoSha256}`);
}

export function stage1ResultKey(
  sentenceHash: string,
  promptVersion: string,
  modelProfile: string,
  schemaId: string,
): string {
  return sha256hex(`S1|${sentenceHash}|${promptVersion}|${modelProfile}|${schemaId}`);
}

export function policyOf(policy: PolicySnapshot, profileName: string): ProfilePolicy {
  if (!Object.prototype.hasOwnProperty.call(policy.profiles, profileName)) {
    return CONSERVATIVE_PROFILE;
  }
  const found = policy.profiles[profileName];
  if (found === undefined) {
    return CONSERVATIVE_PROFILE;
  }
  const normalizedAuth: Record<Task, Authority> = {
    B1: found.authority.B1 ?? "advisory",
    B2: found.authority.B2 ?? "advisory",
    B3: found.authority.B3 ?? "advisory",
    B5: found.authority.B5 ?? "advisory",
    O2: found.authority.O2 ?? "advisory",
  };
  for (const t of TASKS) {
    if (normalizedAuth[t] !== "authoritative" && normalizedAuth[t] !== "advisory") {
      normalizedAuth[t] = "advisory";
    }
  }
  return {
    path: found.path,
    authority: normalizedAuth,
    supportVerdicts: found.supportVerdicts,
    calibratedVariant: {
      schemaId: found.calibratedVariant.schemaId,
      reasoningCap: found.calibratedVariant.reasoningCap,
    },
  };
}

export function expectedStage1Key(
  sentenceHash: string,
  deviceProfile: string,
  promptVersion: string = DEFAULT_PROMPT_VERSION,
): string {
  return stage1ResultKey(sentenceHash, promptVersion, deviceProfile, "TriageV1");
}

export function expectedLocalKeys(
  normalizedClaimHash: string,
  refId: string,
  evidenceVersion: string,
  policy: PolicySnapshot,
  promptVersion: string = DEFAULT_PROMPT_VERSION,
): ReadonlySet<string> {
  const p = policy.deviceProfile;
  const pp = policyOf(policy, p);
  const keys = new Set<string>();
  if (pp.calibratedVariant.schemaId.length > 0 && pp.calibratedVariant.reasoningCap > 0) {
    keys.add(
      localResultKey(
        normalizedClaimHash,
        refId,
        evidenceVersion,
        promptVersion,
        p,
        pp.calibratedVariant.schemaId,
        pp.calibratedVariant.reasoningCap,
      ),
    );
  }
  keys.add(
    localResultKey(
      normalizedClaimHash,
      refId,
      evidenceVersion,
      promptVersion,
      p,
      "VerdictV1_cap20",
      20,
    ),
  );
  if (pp.calibratedVariant.reasoningCap > 0) {
    keys.add(
      localResultKey(
        normalizedClaimHash,
        refId,
        evidenceVersion,
        promptVersion,
        p,
        "VerdictFlatV1",
        pp.calibratedVariant.reasoningCap,
      ),
    );
  }
  return keys;
}

export function refIdsKeyOf(refs: readonly { readonly refId: string }[]): string {
  return dedupeAndSortStrings(refs.map((r) => r.refId)).join("|");
}

export function overrideKeyOf(
  docId: string,
  normalizedClaimHash: string,
  refIdsKey: string,
): string {
  return `${docId}|${normalizedClaimHash}|${refIdsKey}`;
}

// ───────────────────────── Commutative merge primitives (`01` §4.3) ─────────────────────────

function pickWinningResult<T extends { readonly decidedAt: number }>(
  existing: T | undefined,
  incoming: T,
): T {
  if (existing === undefined) {
    return incoming;
  }
  if (incoming.decidedAt !== existing.decidedAt) {
    return incoming.decidedAt > existing.decidedAt ? incoming : existing;
  }
  return compareCodeUnits(jcsHash(incoming), jcsHash(existing)) > 0 ? incoming : existing;
}

function mergeVersioned<T>(stored: Versioned<T> | null, incoming: Versioned<T>): Versioned<T> {
  if (stored === null) {
    return incoming;
  }
  if (incoming.seq !== stored.seq) {
    return incoming.seq > stored.seq ? incoming : stored;
  }
  return compareCodeUnits(jcsHash(incoming.value), jcsHash(stored.value)) > 0 ? incoming : stored;
}

function mergeSelection(stored: Selection | null, incoming: Selection): Selection {
  if (stored === null) {
    return incoming;
  }
  if (incoming.seq !== stored.seq) {
    return incoming.seq > stored.seq ? incoming : stored;
  }
  const incomingPayload = {
    evidenceVersion: incoming.evidenceVersion,
    candidates: incoming.candidates,
    suspicious: incoming.suspicious,
  };
  const storedPayload = {
    evidenceVersion: stored.evidenceVersion,
    candidates: stored.candidates,
    suspicious: stored.suspicious,
  };
  return compareCodeUnits(jcsHash(incomingPayload), jcsHash(storedPayload)) > 0
    ? incoming
    : stored;
}

function defaultRefFacts(refId: string): RefFacts {
  return {
    refId,
    bibStatus: "PENDING",
    retracted: false,
    checkMetadata: false,
    evidenceVersion: EMPTY_EVIDENCE_VERSION,
    hasEvidence: false,
    updatedSeq: 0,
  };
}

function projectRefFacts(internal: RefFactInternal): RefFacts {
  const bibVal = internal.bib?.value;
  const evVal = internal.evidence?.value;
  const bibSeq = internal.bib?.seq ?? 0;
  const evSeq = internal.evidence?.seq ?? 0;
  return {
    refId: internal.refId,
    bibStatus: bibVal?.bibStatus ?? "PENDING",
    retracted: internal.retracted,
    checkMetadata: bibVal?.checkMetadata ?? false,
    evidenceVersion: evVal?.evidenceVersion ?? EMPTY_EVIDENCE_VERSION,
    hasEvidence: evVal?.hasEvidence ?? false,
    updatedSeq: Math.max(bibSeq, evSeq),
  };
}

// ───────────────────────── Materialization (`01` §4.3) ─────────────────────────

function getOrCreateSideFacts(
  claimFacts: Map<string, ClaimSideFacts>,
  claimId: string,
): ClaimSideFacts {
  const existing = claimFacts.get(claimId);
  if (existing !== undefined) {
    return existing;
  }
  const empty: ClaimSideFacts = {
    job: null,
    heldNei: null,
    override: null,
    validOverridesByTarget: new Map<string, Versioned<AuthorOverride | null>>(),
    overrideUndo: null,
    selections: new Map<string, Selection>(),
    labNoteMismatch: new Map<string, Versioned<LabNoteFlag | null>>(),
    archived: false,
    l0Error: null,
    b5InconsistentWith: null,
  };
  claimFacts.set(claimId, empty);
  return empty;
}

function overrideTargetKey(normalizedClaimHash: string, refIdsKey: string): string {
  return `${normalizedClaimHash}|${refIdsKey}`;
}

function recordOverrideIntoFacts(
  cf: ClaimSideFacts,
  incomingOv: Versioned<AuthorOverride | null>,
): ClaimSideFacts {
  const mergedOverride = mergeVersioned(cf.override, incomingOv);
  if (incomingOv.value === null) {
    if (incomingOv.seq === 0) {
      return { ...cf, override: mergedOverride };
    }
    const mergedUndo = mergeVersioned(cf.overrideUndo, incomingOv);
    return { ...cf, override: mergedOverride, overrideUndo: mergedUndo };
  }
  const nextByTarget = new Map<string, Versioned<AuthorOverride | null>>(cf.validOverridesByTarget);
  const tKey = overrideTargetKey(incomingOv.value.normalizedClaimHash, incomingOv.value.refIdsKey);
  const prevTarget = nextByTarget.get(tKey) ?? null;
  nextByTarget.set(tKey, mergeVersioned(prevTarget, incomingOv));
  return {
    ...cf,
    override: mergedOverride,
    validOverridesByTarget: sortedMapFrom(nextByTarget),
  };
}

function effectiveOverrideForEntry(
  cf: ClaimSideFacts,
  normalizedClaimHash: string,
  refIdsKey: string,
): Versioned<AuthorOverride | null> | null {
  const targeted = cf.validOverridesByTarget.get(overrideTargetKey(normalizedClaimHash, refIdsKey)) ?? null;
  if (targeted !== null && cf.overrideUndo !== null) {
    return mergeVersioned(targeted, cf.overrideUndo);
  }
  return targeted ?? cf.overrideUndo;
}

function isValidOverrideForEntry(
  ov: Versioned<AuthorOverride | null>,
  normalizedClaimHash: string,
  refIdsKey: string,
): boolean {
  if (ov.value === null) {
    return true;
  }
  return ov.value.normalizedClaimHash === normalizedClaimHash && ov.value.refIdsKey === refIdsKey;
}

function projectLabNoteMismatch(
  map: ReadonlyMap<string, Versioned<LabNoteFlag | null>>,
): LabNoteMismatchItem[] {
  const keys = Array.from(map.keys()).sort(compareCodeUnits);
  const items: LabNoteMismatchItem[] = [];
  for (const captureId of keys) {
    const flag = map.get(captureId)!;
    items.push({
      captureId,
      flag: deepClone(flag),
    });
  }
  return items;
}

function materializeEntry(
  entry: ClaimLedgerEntry,
  sideFacts: ClaimSideFacts,
  results: ResultCache,
  refFacts: ReadonlyMap<string, RefFacts>,
  policy: PolicySnapshot,
  promptVersion: string,
  overridesByKey: ReadonlyMap<string, Versioned<AuthorOverride | null>>,
): ClaimLedgerEntry {
  const activeProfile = policy.deviceProfile;
  const s1Key = expectedStage1Key(entry.sentenceHash, activeProfile, promptVersion);
  const rawS1 = results.stage1.get(s1Key);
  const stage1: Stage1Result | null =
    rawS1 !== undefined &&
    rawS1.resultKey === s1Key &&
    rawS1.promptVersion === promptVersion &&
    rawS1.schemaId === "TriageV1" &&
    rawS1.modelProfile === activeProfile
      ? deepClone(rawS1)
      : null;

  const refIdsKey = refIdsKeyOf(entry.refs);
  const ovKey = overrideKeyOf(entry.docId, entry.normalizedClaimHash, refIdsKey);
  const sharedOv = overridesByKey.get(ovKey);
  const fromSideFacts = effectiveOverrideForEntry(
    sideFacts,
    entry.normalizedClaimHash,
    refIdsKey,
  );
  const entryOvValid = isValidOverrideForEntry(
    entry.override,
    entry.normalizedClaimHash,
    refIdsKey,
  );
  let effectiveOverride: Versioned<AuthorOverride | null> =
    fromSideFacts !== null
      ? deepClone(fromSideFacts)
      : entryOvValid
        ? deepClone(entry.override)
        : { value: null, seq: 0 };
  if (fromSideFacts !== null && entryOvValid) {
    effectiveOverride = mergeVersioned(effectiveOverride, deepClone(entry.override));
  }
  if (sharedOv !== undefined && isValidOverrideForEntry(sharedOv, entry.normalizedClaimHash, refIdsKey)) {
    effectiveOverride = mergeVersioned(effectiveOverride, deepClone(sharedOv));
  }

  const sortedRefs = [...entry.refs].sort((a, b) => compareCodeUnits(a.refId, b.refId));
  const materializedRefs: ClauseRef[] = [];
  const seenRefIds = new Set<string>();

  for (const rawRef of sortedRefs) {
    if (seenRefIds.has(rawRef.refId)) continue;
    seenRefIds.add(rawRef.refId);

    const rf = refFacts.get(rawRef.refId) ?? defaultRefFacts(rawRef.refId);
    const sideSel = sideFacts.selections.get(rawRef.refId) ?? null;
    let selection: Selection | null = rawRef.selection !== null ? deepClone(rawRef.selection) : null;
    if (sideSel !== null) {
      selection = mergeSelection(selection, deepClone(sideSel));
    }

    const localKeys = expectedLocalKeys(
      entry.normalizedClaimHash,
      rawRef.refId,
      rf.evidenceVersion,
      policy,
      promptVersion,
    );
    let winningLocal: LocalResult | undefined;
    for (const k of localKeys) {
      const candidate = results.local.get(k);
      if (
        candidate !== undefined &&
        candidate.resultKey === k &&
        candidate.promptVersion === promptVersion &&
        candidate.modelProfile === activeProfile &&
        candidate.resultKey ===
          localResultKey(
            entry.normalizedClaimHash,
            rawRef.refId,
            rf.evidenceVersion,
            candidate.promptVersion,
            candidate.modelProfile,
            candidate.schemaId,
            candidate.reasoningCap,
          )
      ) {
        winningLocal = pickWinningResult(winningLocal, candidate);
      }
    }

    let winningCloud: CloudResult | undefined;
    for (const c of results.cloud.values()) {
      if (
        c.normalizedClaimHash === entry.normalizedClaimHash &&
        c.refId === rawRef.refId &&
        c.resultKey ===
          cloudResultKey(
            c.normalizedClaimHash,
            c.approvedTextSha256,
            c.refId,
            c.promptVersion,
            c.adjudicator,
          )
      ) {
        winningCloud = pickWinningResult(winningCloud, c);
      }
    }

    let winningPhysical: PhysicalResult | undefined;
    for (const ph of results.physical.values()) {
      if (
        ph.normalizedClaimHash === entry.normalizedClaimHash &&
        ph.refId === rawRef.refId &&
        ph.capture.kind !== "LAB_NOTE" &&
        ph.resultKey ===
          physicalResultKey(ph.normalizedClaimHash, ph.refId, ph.capture.photoSha256)
      ) {
        winningPhysical = pickWinningResult(winningPhysical, ph);
      }
    }

    materializedRefs.push({
      refId: rawRef.refId,
      selection,
      local: winningLocal !== undefined ? deepClone(winningLocal) : null,
      cloud: winningCloud !== undefined ? deepClone(winningCloud) : null,
      physical: winningPhysical !== undefined ? deepClone(winningPhysical) : null,
    });
  }

  const b5List =
    sideFacts.b5InconsistentWith !== null
      ? dedupeAndSortStrings(sideFacts.b5InconsistentWith)
      : dedupeAndSortStrings(entry.b5.inconsistentWith);

  const labMap = new Map<string, Versioned<LabNoteFlag | null>>();
  for (const item of entry.labNoteMismatch) {
    const existing = labMap.get(item.captureId) ?? null;
    labMap.set(item.captureId, mergeVersioned(existing, deepClone(item.flag)));
  }
  for (const [cid, flag] of sideFacts.labNoteMismatch) {
    const existing = labMap.get(cid) ?? null;
    labMap.set(cid, mergeVersioned(existing, deepClone(flag)));
  }

  return {
    claimId: entry.claimId,
    docId: entry.docId,
    sentenceHash: entry.sentenceHash,
    occurrenceIndex: entry.occurrenceIndex,
    clauseIndex: entry.clauseIndex,
    section: entry.section,
    subsection: entry.subsection,
    span: { start: entry.span.start, end: entry.span.end },
    claimText: entry.claimText,
    normalizedClaimHash: entry.normalizedClaimHash,
    baseline: deepClone(entry.baseline),
    stage1,
    citationKeys: [...entry.citationKeys],
    possibleCitations: entry.possibleCitations.map((r) => ({ start: r.start, end: r.end })),
    refs: materializedRefs,
    heldNei: deepClone(sideFacts.heldNei ?? entry.heldNei),
    job: deepClone(sideFacts.job ?? entry.job),
    l0Error: sideFacts.l0Error ?? entry.l0Error,
    b5: { inconsistentWith: b5List },
    labNoteMismatch: projectLabNoteMismatch(labMap),
    suggestedRefIds: dedupeAndSortStrings(entry.suggestedRefIds),
    override: deepClone(effectiveOverride),
    archived: sideFacts.archived || entry.archived,
    updatedAt: entry.updatedAt,
  };
}

// ───────────────────────── State initialization & event reducer (`01` §4.4) ─────────────────────────

const DEFAULT_INITIAL_POLICY: PolicySnapshot = {
  deviceProfile: "no_local_model",
  profiles: {
    no_local_model: CONSERVATIVE_PROFILE,
  },
  b4CountsAsReview: true,
};

export function createInitialLedgerState(options?: CreateLedgerStateOptions): LedgerState {
  return {
    policy: clonePolicySnapshot(options?.policy ?? DEFAULT_INITIAL_POLICY),
    promptVersion: options?.promptVersion ?? DEFAULT_PROMPT_VERSION,
    results: {
      stage1: new Map(),
      local: new Map(),
      cloud: new Map(),
      physical: new Map(),
    },
    refFacts: new Map(),
    entries: new Map(),
    overridesByKey: new Map(),
    _refInternals: new Map(),
    _claimFacts: new Map(),
  };
}

function cloneResultCache(results: ResultCache): {
  stage1: Map<string, Stage1Result>;
  local: Map<string, LocalResult>;
  cloud: Map<string, CloudResult>;
  physical: Map<string, PhysicalResult>;
} {
  const stage1 = new Map<string, Stage1Result>();
  for (const [k, v] of results.stage1) stage1.set(k, deepClone(v));
  const local = new Map<string, LocalResult>();
  for (const [k, v] of results.local) local.set(k, deepClone(v));
  const cloud = new Map<string, CloudResult>();
  for (const [k, v] of results.cloud) cloud.set(k, deepClone(v));
  const physical = new Map<string, PhysicalResult>();
  for (const [k, v] of results.physical) physical.set(k, deepClone(v));
  return { stage1, local, cloud, physical };
}

function cloneClaimFacts(
  src: ReadonlyMap<string, ClaimSideFacts>,
): Map<string, ClaimSideFacts> {
  const out = new Map<string, ClaimSideFacts>();
  for (const [cid, cf] of src) {
    const validOverridesByTarget = new Map<string, Versioned<AuthorOverride | null>>();
    for (const [tk, ov] of cf.validOverridesByTarget) {
      validOverridesByTarget.set(tk, deepClone(ov));
    }
    const selections = new Map<string, Selection>();
    for (const [rid, sel] of cf.selections) {
      selections.set(rid, deepClone(sel));
    }
    const labNoteMismatch = new Map<string, Versioned<LabNoteFlag | null>>();
    for (const [capId, flag] of cf.labNoteMismatch) {
      labNoteMismatch.set(capId, deepClone(flag));
    }
    out.set(cid, {
      job: cf.job !== null ? deepClone(cf.job) : null,
      heldNei: cf.heldNei !== null ? deepClone(cf.heldNei) : null,
      override: cf.override !== null ? deepClone(cf.override) : null,
      validOverridesByTarget,
      overrideUndo: cf.overrideUndo !== null ? deepClone(cf.overrideUndo) : null,
      selections,
      labNoteMismatch,
      archived: cf.archived,
      l0Error: cf.l0Error,
      b5InconsistentWith:
        cf.b5InconsistentWith !== null ? [...cf.b5InconsistentWith] : null,
    });
  }
  return out;
}

function cloneRefInternals(
  src: ReadonlyMap<string, RefFactInternal>,
): Map<string, RefFactInternal> {
  const out = new Map<string, RefFactInternal>();
  for (const [rid, rf] of src) {
    out.set(rid, {
      refId: rf.refId,
      bib: rf.bib !== null ? deepClone(rf.bib) : null,
      evidence: rf.evidence !== null ? deepClone(rf.evidence) : null,
      retracted: rf.retracted,
    });
  }
  return out;
}

function applyClauseCreatedInPlace(
  rawEntry: ClaimLedgerEntry,
  entries: Map<string, ClaimLedgerEntry>,
  claimFacts: Map<string, ClaimSideFacts>,
  overridesByKey: Map<string, Versioned<AuthorOverride | null>>,
  results: ResultCache,
  refFacts: ReadonlyMap<string, RefFacts>,
  policy: PolicySnapshot,
  promptVersion: string,
): void {
  const entry = deepClone(rawEntry);
  const cid = entry.claimId;
  const existingEntry = entries.get(cid);
  const prevFacts = getOrCreateSideFacts(claimFacts, cid);

  const mergedSelections = new Map<string, Selection>(prevFacts.selections);
  if (existingEntry !== undefined) {
    for (const r of existingEntry.refs) {
      if (r.selection !== null) {
        const cur = mergedSelections.get(r.refId) ?? null;
        mergedSelections.set(r.refId, mergeSelection(cur, r.selection));
      }
    }
  }
  for (const r of entry.refs) {
    if (r.selection !== null) {
      const cur = mergedSelections.get(r.refId) ?? null;
      mergedSelections.set(r.refId, mergeSelection(cur, r.selection));
    }
  }

  const combinedRefsById = new Map<string, ClauseRef>();
  for (const r of existingEntry?.refs ?? []) {
    combinedRefsById.set(r.refId, r);
  }
  for (const r of entry.refs) {
    combinedRefsById.set(r.refId, r);
  }
  const combinedRefs = Array.from(combinedRefsById.values()).sort((a, b) =>
    compareCodeUnits(a.refId, b.refId),
  );

  const mergedJob = mergeVersioned(
    prevFacts.job ?? existingEntry?.job ?? null,
    entry.job,
  );
  const mergedHeldNei = mergeVersioned(
    prevFacts.heldNei ?? existingEntry?.heldNei ?? null,
    entry.heldNei,
  );

  const refIdsKey = refIdsKeyOf(combinedRefs);
  const ovKey = overrideKeyOf(entry.docId, entry.normalizedClaimHash, refIdsKey);

  const ovFacts = recordOverrideIntoFacts(prevFacts, deepClone(entry.override));

  const validOvForKey = effectiveOverrideForEntry(ovFacts, entry.normalizedClaimHash, refIdsKey);
  if (validOvForKey !== null) {
    const prevByKey = overridesByKey.get(ovKey) ?? null;
    overridesByKey.set(ovKey, mergeVersioned(prevByKey, deepClone(validOvForKey)));
  }

  const mergedLabMap = new Map<string, Versioned<LabNoteFlag | null>>(prevFacts.labNoteMismatch);
  for (const item of existingEntry?.labNoteMismatch ?? []) {
    const cur = mergedLabMap.get(item.captureId) ?? null;
    mergedLabMap.set(item.captureId, mergeVersioned(cur, item.flag));
  }
  for (const item of entry.labNoteMismatch) {
    const cur = mergedLabMap.get(item.captureId) ?? null;
    mergedLabMap.set(item.captureId, mergeVersioned(cur, item.flag));
  }

  const mergedArchived = prevFacts.archived || (existingEntry?.archived ?? false) || entry.archived;
  const mergedL0Error: L0Error | null =
    prevFacts.l0Error ?? existingEntry?.l0Error ?? entry.l0Error;

  const updatedFacts: ClaimSideFacts = {
    job: mergedJob,
    heldNei: mergedHeldNei,
    override: ovFacts.override,
    validOverridesByTarget: ovFacts.validOverridesByTarget,
    overrideUndo: ovFacts.overrideUndo,
    selections: sortedMapFrom(mergedSelections),
    labNoteMismatch: sortedMapFrom(mergedLabMap),
    archived: mergedArchived,
    l0Error: mergedL0Error,
    b5InconsistentWith: prevFacts.b5InconsistentWith,
  };
  claimFacts.set(cid, updatedFacts);

  const skeletonForMaterialize: ClaimLedgerEntry = {
    ...entry,
    refs: combinedRefs,
    updatedAt:
      existingEntry !== undefined ? Math.max(existingEntry.updatedAt, entry.updatedAt) : entry.updatedAt,
  };

  entries.set(
    cid,
    materializeEntry(
      skeletonForMaterialize,
      updatedFacts,
      results,
      refFacts,
      policy,
      promptVersion,
      overridesByKey,
    ),
  );

  // Propagate any updated persisted override across sibling entries sharing the same key.
  const latestByKey = overridesByKey.get(ovKey);
  if (latestByKey !== undefined) {
    for (const [otherId, otherEntry] of entries) {
      if (otherId === cid) continue;
      const otherKey = overrideKeyOf(
        otherEntry.docId,
        otherEntry.normalizedClaimHash,
        refIdsKeyOf(otherEntry.refs),
      );
      if (otherKey === ovKey) {
        const otherFacts = getOrCreateSideFacts(claimFacts, otherId);
        entries.set(
          otherId,
          materializeEntry(
            otherEntry,
            otherFacts,
            results,
            refFacts,
            policy,
            promptVersion,
            overridesByKey,
          ),
        );
      }
    }
  }
}

function rematerializeAll(
  entries: Map<string, ClaimLedgerEntry>,
  claimFacts: Map<string, ClaimSideFacts>,
  results: ResultCache,
  refFacts: ReadonlyMap<string, RefFacts>,
  policy: PolicySnapshot,
  promptVersion: string,
  overridesByKey: ReadonlyMap<string, Versioned<AuthorOverride | null>>,
  predicate?: (entry: ClaimLedgerEntry) => boolean,
): void {
  for (const [cid, entry] of entries) {
    if (predicate !== undefined && !predicate(entry)) continue;
    const cf = getOrCreateSideFacts(claimFacts, cid);
    entries.set(
      cid,
      materializeEntry(entry, cf, results, refFacts, policy, promptVersion, overridesByKey),
    );
  }
}

export function applyEvent(
  state: LedgerState,
  event: LedgerEvent,
  options?: ApplyEventOptions,
): LedgerState {
  const policy = clonePolicySnapshot(state.policy);
  const promptVersion = state.promptVersion;
  const resultsRaw = cloneResultCache(state.results);
  const refInternals = cloneRefInternals(state._refInternals);
  const refFacts = new Map<string, RefFacts>();
  for (const [rid, rf] of state.refFacts) {
    refFacts.set(rid, deepClone(rf));
  }
  const entries = new Map<string, ClaimLedgerEntry>();
  for (const [cid, e] of state.entries) {
    entries.set(cid, deepClone(e));
  }
  const overridesByKey = new Map<string, Versioned<AuthorOverride | null>>();
  for (const [k, v] of state.overridesByKey) {
    overridesByKey.set(k, deepClone(v));
  }
  const claimFacts = cloneClaimFacts(state._claimFacts);

  switch (event.type) {
    case "ClauseCreated": {
      applyClauseCreatedInPlace(
        event.entry,
        entries,
        claimFacts,
        overridesByKey,
        resultsRaw,
        refFacts,
        policy,
        promptVersion,
      );
      break;
    }
    case "BibResolved": {
      const prev = refInternals.get(event.refId) ?? {
        refId: event.refId,
        bib: null,
        evidence: null,
        retracted: false,
      };
      const mergedBib = mergeVersioned(prev.bib, {
        value: { bibStatus: event.bibStatus, checkMetadata: event.checkMetadata },
        seq: event.seq,
      });
      const updated: RefFactInternal = {
        refId: event.refId,
        bib: mergedBib,
        evidence: prev.evidence,
        retracted: prev.retracted || event.retracted,
      };
      refInternals.set(event.refId, updated);
      refFacts.set(event.refId, projectRefFacts(updated));
      // E2 never touches ledger entries (`01` §4.4).
      break;
    }
    case "RetractionSnapshot": {
      for (const refId of event.refIds) {
        const prev = refInternals.get(refId) ?? {
          refId,
          bib: null,
          evidence: null,
          retracted: false,
        };
        const updated: RefFactInternal = {
          refId,
          bib: prev.bib,
          evidence: prev.evidence,
          retracted: true,
        };
        refInternals.set(refId, updated);
        refFacts.set(refId, projectRefFacts(updated));
      }
      break;
    }
    case "Stage1ResultArrived": {
      const r = deepClone(event.result);
      const existing = resultsRaw.stage1.get(r.resultKey);
      resultsRaw.stage1.set(r.resultKey, pickWinningResult(existing, r));
      rematerializeAll(
        entries,
        claimFacts,
        resultsRaw,
        refFacts,
        policy,
        promptVersion,
        overridesByKey,
        (e) => expectedStage1Key(e.sentenceHash, policy.deviceProfile, promptVersion) === r.resultKey,
      );
      break;
    }
    case "LocalResultArrived": {
      const r = deepClone(event.result);
      const existing = resultsRaw.local.get(r.resultKey);
      resultsRaw.local.set(r.resultKey, pickWinningResult(existing, r));
      rematerializeAll(
        entries,
        claimFacts,
        resultsRaw,
        refFacts,
        policy,
        promptVersion,
        overridesByKey,
        (e) => e.claimId === event.claimId || e.refs.some((ref) => ref.refId === event.refId),
      );
      break;
    }
    case "EvidenceChanged": {
      const prev = refInternals.get(event.refId) ?? {
        refId: event.refId,
        bib: null,
        evidence: null,
        retracted: false,
      };
      const mergedEv = mergeVersioned(prev.evidence, {
        value: { evidenceVersion: event.evidenceVersion, hasEvidence: event.hasEvidence },
        seq: event.seq,
      });
      const updated: RefFactInternal = {
        refId: event.refId,
        bib: prev.bib,
        evidence: mergedEv,
        retracted: prev.retracted,
      };
      refInternals.set(event.refId, updated);
      refFacts.set(event.refId, projectRefFacts(updated));
      rematerializeAll(
        entries,
        claimFacts,
        resultsRaw,
        refFacts,
        policy,
        promptVersion,
        overridesByKey,
        (e) => e.refs.some((ref) => ref.refId === event.refId),
      );
      break;
    }
    case "SelectionComputed": {
      const sel = deepClone(event.selection);
      const cf = getOrCreateSideFacts(claimFacts, event.claimId);
      const nextSelections = new Map<string, Selection>(cf.selections);
      const prevSel = nextSelections.get(event.refId) ?? null;
      nextSelections.set(event.refId, mergeSelection(prevSel, sel));
      const updatedCf: ClaimSideFacts = {
        ...cf,
        selections: sortedMapFrom(nextSelections),
      };
      claimFacts.set(event.claimId, updatedCf);
      const existingEntry = entries.get(event.claimId);
      if (existingEntry !== undefined) {
        entries.set(
          event.claimId,
          materializeEntry(
            existingEntry,
            updatedCf,
            resultsRaw,
            refFacts,
            policy,
            promptVersion,
            overridesByKey,
          ),
        );
      }
      break;
    }
    case "CloudResultArrived": {
      const r = deepClone(event.result);
      const existing = resultsRaw.cloud.get(r.resultKey);
      resultsRaw.cloud.set(r.resultKey, pickWinningResult(existing, r));
      rematerializeAll(
        entries,
        claimFacts,
        resultsRaw,
        refFacts,
        policy,
        promptVersion,
        overridesByKey,
        (e) =>
          e.normalizedClaimHash === r.normalizedClaimHash &&
          e.refs.some((ref) => ref.refId === event.refId),
      );
      break;
    }
    case "PhysicalResultArrived": {
      const r = deepClone(event.result);
      const existing = resultsRaw.physical.get(r.resultKey);
      resultsRaw.physical.set(r.resultKey, pickWinningResult(existing, r));
      rematerializeAll(
        entries,
        claimFacts,
        resultsRaw,
        refFacts,
        policy,
        promptVersion,
        overridesByKey,
        (e) =>
          e.claimId === event.claimId ||
          e.normalizedClaimHash === r.normalizedClaimHash,
      );
      break;
    }
    case "ClauseEdited": {
      for (const oldId of event.oldClaimIds) {
        const cf = getOrCreateSideFacts(claimFacts, oldId);
        const updatedCf: ClaimSideFacts = { ...cf, archived: true };
        claimFacts.set(oldId, updatedCf);
        const oldEntry = entries.get(oldId);
        if (oldEntry !== undefined) {
          entries.set(oldId, { ...oldEntry, archived: true });
        }
      }
      for (const newEntry of event.newSegmentation) {
        applyClauseCreatedInPlace(
          newEntry,
          entries,
          claimFacts,
          overridesByKey,
          resultsRaw,
          refFacts,
          policy,
          promptVersion,
        );
      }
      break;
    }
    case "JobState": {
      const cf = getOrCreateSideFacts(claimFacts, event.claimId);
      const existingEntry = entries.get(event.claimId);
      const baseJob = cf.job ?? existingEntry?.job ?? null;
      const mergedJob = mergeVersioned(baseJob, { value: event.inFlight, seq: event.seq });
      const updatedCf: ClaimSideFacts = { ...cf, job: mergedJob };
      claimFacts.set(event.claimId, updatedCf);
      if (existingEntry !== undefined) {
        entries.set(event.claimId, { ...existingEntry, job: deepClone(mergedJob) });
      }
      break;
    }
    case "HeldNei": {
      const cf = getOrCreateSideFacts(claimFacts, event.claimId);
      const existingEntry = entries.get(event.claimId);
      const baseHeld = cf.heldNei ?? existingEntry?.heldNei ?? null;
      const mergedHeld = mergeVersioned(baseHeld, {
        value: event.value !== null ? { since: event.value.since } : null,
        seq: event.seq,
      });
      const updatedCf: ClaimSideFacts = { ...cf, heldNei: mergedHeld };
      claimFacts.set(event.claimId, updatedCf);
      if (existingEntry !== undefined) {
        entries.set(event.claimId, { ...existingEntry, heldNei: deepClone(mergedHeld) });
      }
      break;
    }
    case "Override": {
      const cf = getOrCreateSideFacts(claimFacts, event.claimId);
      const existingEntry = entries.get(event.claimId);
      const incomingOv: Versioned<AuthorOverride | null> = {
        value: event.value !== null ? deepClone(event.value) : null,
        seq: event.seq,
      };
      const updatedCf = recordOverrideIntoFacts(cf, incomingOv);
      claimFacts.set(event.claimId, updatedCf);

      if (existingEntry !== undefined) {
        const refIdsKey = refIdsKeyOf(existingEntry.refs);
        const ovKey = overrideKeyOf(existingEntry.docId, existingEntry.normalizedClaimHash, refIdsKey);
        const validOv = effectiveOverrideForEntry(
          updatedCf,
          existingEntry.normalizedClaimHash,
          refIdsKey,
        );
        if (validOv !== null) {
          const prevKeyOv = overridesByKey.get(ovKey) ?? null;
          const nextKeyOv = mergeVersioned(prevKeyOv, deepClone(validOv));
          overridesByKey.set(ovKey, nextKeyOv);
          for (const [otherId, otherEntry] of entries) {
            const otherKey = overrideKeyOf(
              otherEntry.docId,
              otherEntry.normalizedClaimHash,
              refIdsKeyOf(otherEntry.refs),
            );
            if (otherKey === ovKey) {
              const otherCf = getOrCreateSideFacts(claimFacts, otherId);
              entries.set(
                otherId,
                materializeEntry(
                  otherEntry,
                  otherCf,
                  resultsRaw,
                  refFacts,
                  policy,
                  promptVersion,
                  overridesByKey,
                ),
              );
            }
          }
        } else {
          entries.set(
            event.claimId,
            materializeEntry(
              existingEntry,
              updatedCf,
              resultsRaw,
              refFacts,
              policy,
              promptVersion,
              overridesByKey,
            ),
          );
        }
      }
      break;
    }
    case "B5Changed": {
      const tempState: LedgerState = {
        policy,
        promptVersion,
        results: resultsRaw,
        refFacts,
        entries,
        overridesByKey,
        _refInternals: refInternals,
        _claimFacts: claimFacts,
      };
      for (const cid of event.claimIds) {
        const cf = getOrCreateSideFacts(claimFacts, cid);
        const existingEntry = entries.get(cid);
        if (options?.b5Resolver !== undefined) {
          const resolved = dedupeAndSortStrings(
            options.b5Resolver(cid, tempState).filter((id) => id !== cid),
          );
          claimFacts.set(cid, { ...cf, b5InconsistentWith: resolved });
          if (existingEntry !== undefined) {
            entries.set(cid, { ...existingEntry, b5: { inconsistentWith: resolved } });
          }
        } else if (existingEntry !== undefined) {
          const sorted = dedupeAndSortStrings(existingEntry.b5.inconsistentWith);
          entries.set(cid, { ...existingEntry, b5: { inconsistentWith: sorted } });
        }
      }
      break;
    }
    case "L0Timeout": {
      const cf = getOrCreateSideFacts(claimFacts, event.claimId);
      claimFacts.set(event.claimId, { ...cf, l0Error: "PARSE_TIMEOUT" });
      const existingEntry = entries.get(event.claimId);
      if (existingEntry !== undefined) {
        entries.set(event.claimId, { ...existingEntry, l0Error: "PARSE_TIMEOUT" });
      }
      break;
    }
    case "PolicyChanged": {
      const nextPolicy = clonePolicySnapshot(event.snapshot);
      rematerializeAll(
        entries,
        claimFacts,
        resultsRaw,
        refFacts,
        nextPolicy,
        promptVersion,
        overridesByKey,
      );
      return {
        policy: nextPolicy,
        promptVersion,
        results: {
          stage1: sortedMapFrom(resultsRaw.stage1),
          local: sortedMapFrom(resultsRaw.local),
          cloud: sortedMapFrom(resultsRaw.cloud),
          physical: sortedMapFrom(resultsRaw.physical),
        },
        refFacts: sortedMapFrom(refFacts),
        entries: sortedMapFrom(entries),
        overridesByKey: sortedMapFrom(overridesByKey),
        _refInternals: sortedMapFrom(refInternals),
        _claimFacts: sortedMapFrom(claimFacts),
      };
    }
    case "LabNoteMismatch": {
      const cf = getOrCreateSideFacts(claimFacts, event.claimId);
      const nextMap = new Map<string, Versioned<LabNoteFlag | null>>(cf.labNoteMismatch);
      const prevFlag = nextMap.get(event.captureId) ?? null;
      const incomingFlag: Versioned<LabNoteFlag | null> = {
        value: event.value !== null ? deepClone(event.value) : null,
        seq: event.seq,
      };
      nextMap.set(event.captureId, mergeVersioned(prevFlag, incomingFlag));
      const sortedLabMap = sortedMapFrom(nextMap);
      const updatedCf: ClaimSideFacts = { ...cf, labNoteMismatch: sortedLabMap };
      claimFacts.set(event.claimId, updatedCf);
      const existingEntry = entries.get(event.claimId);
      if (existingEntry !== undefined) {
        entries.set(
          event.claimId,
          materializeEntry(
            existingEntry,
            updatedCf,
            resultsRaw,
            refFacts,
            policy,
            promptVersion,
            overridesByKey,
          ),
        );
      }
      break;
    }
  }

  return {
    policy,
    promptVersion,
    results: {
      stage1: sortedMapFrom(resultsRaw.stage1),
      local: sortedMapFrom(resultsRaw.local),
      cloud: sortedMapFrom(resultsRaw.cloud),
      physical: sortedMapFrom(resultsRaw.physical),
    },
    refFacts: sortedMapFrom(refFacts),
    entries: sortedMapFrom(entries),
    overridesByKey: sortedMapFrom(overridesByKey),
    _refInternals: sortedMapFrom(refInternals),
    _claimFacts: sortedMapFrom(claimFacts),
  };
}

export function reduceLedger(
  events: readonly LedgerEvent[],
  initialOrOptions?: LedgerState | CreateLedgerStateOptions,
  applyOptions?: ApplyEventOptions,
): LedgerState {
  let state: LedgerState =
    initialOrOptions !== undefined && "entries" in initialOrOptions
      ? initialOrOptions
      : createInitialLedgerState(initialOrOptions);
  for (const event of events) {
    state = applyEvent(state, event, applyOptions);
  }
  return state;
}

// ───────────────────────── Pure derivation (`derive`, `R1`–`R14`, `C0`–`C16`) ─────────────────────────

interface RefEval {
  readonly refId: string;
  readonly state: RefState;
  readonly rule: "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12" | "R13" | "R14";
  readonly r4Source: "CLOUD" | "PHYSICAL_SOURCE" | null;
  readonly r12SubA: boolean;
}

function valuesOk(ph: PhysicalResult | null): boolean {
  return (
    ph !== null &&
    (ph.capture.kind === "PHYSICAL_TABLE" || ph.capture.kind === "PHYSICAL_TEXT") &&
    ph.capture.confirmedByAuthorAt !== null
  );
}

function entailOk(ph: PhysicalResult | null): boolean {
  return valuesOk(ph) && ph !== null && ph.capture.entailmentConfirmedByAuthorAt !== null;
}

function isCalibrated(l: LocalResult | null, pl: ProfilePolicy | null): boolean {
  return (
    l !== null &&
    pl !== null &&
    l.schemaId === pl.calibratedVariant.schemaId &&
    l.reasoningCap === pl.calibratedVariant.reasoningCap
  );
}

function evaluateRef(
  r: ClauseRef,
  e: ClaimLedgerEntry,
  refFacts: ReadonlyMap<string, RefFacts>,
  policy: PolicySnapshot,
  mode: PrivacyContext,
  session: SessionFacts,
): RefEval {
  const f = refFacts.get(r.refId) ?? defaultRefFacts(r.refId);
  const sel =
    r.selection !== null && r.selection.evidenceVersion === f.evidenceVersion ? r.selection : null;
  const l = r.local;
  const pl = l !== null ? policyOf(policy, l.modelProfile) : null;
  const pd = policyOf(policy, policy.deviceProfile);
  const ph = r.physical;
  const tr = session.transient.get(`${e.claimId}|${r.refId}`);

  // R1
  if (f.bibStatus === "DOI_NOT_FOUND" || f.bibStatus === "UNRESOLVED_KEY" || f.retracted) {
    return { refId: r.refId, state: "REF_PROBLEM", rule: "R1", r4Source: null, r12SubA: false };
  }
  // R2
  if (r.cloud?.verdict === "CONTRADICTED") {
    return {
      refId: r.refId,
      state: "CONTRADICTED_CONFIRMED",
      rule: "R2",
      r4Source: null,
      r12SubA: false,
    };
  }
  // R3
  if (r.cloud?.verdict === "PARTIAL") {
    return {
      refId: r.refId,
      state: "PARTIAL_CONFIRMED",
      rule: "R3",
      r4Source: null,
      r12SubA: false,
    };
  }
  // R4
  if (r.cloud?.verdict === "SUPPORTED" || (ph?.verdict === "SUPPORTED" && entailOk(ph))) {
    return {
      refId: r.refId,
      state: "SUPPORTED_CONFIRMED",
      rule: "R4",
      r4Source: r.cloud?.verdict === "SUPPORTED" ? "CLOUD" : "PHYSICAL_SOURCE",
      r12SubA: false,
    };
  }
  // R5
  if (r.cloud?.verdict === "NEI") {
    return { refId: r.refId, state: "UNVERIFIABLE", rule: "R5", r4Source: null, r12SubA: false };
  }
  // R6
  if (ph?.verdict === "CONTRADICTS" && valuesOk(ph)) {
    return {
      refId: r.refId,
      state: pd.path === "A" ? "HINT" : "ALIGNED_ESCALATING",
      rule: "R6",
      r4Source: null,
      r12SubA: false,
    };
  }
  // R7
  if (sel?.suspicious === true) {
    return { refId: r.refId, state: "SOURCE_FLAGGED", rule: "R7", r4Source: null, r12SubA: false };
  }
  // R8
  if (l?.verdict === "CONTRADICTS") {
    return {
      refId: r.refId,
      state: pl!.path === "A" ? "HINT" : "ALIGNED_ESCALATING",
      rule: "R8",
      r4Source: null,
      r12SubA: false,
    };
  }
  // R9
  if (
    (l?.verdict === "SUPPORTED" && isCalibrated(l, pl) && pl!.supportVerdicts === "authoritative") ||
    (ph?.verdict === "SUPPORTED" &&
      valuesOk(ph) &&
      !entailOk(ph) &&
      pd.supportVerdicts === "authoritative")
  ) {
    return { refId: r.refId, state: "SUPPORTED_LOCAL", rule: "R9", r4Source: null, r12SubA: false };
  }
  // R10
  if (
    l?.verdict === "SUPPORTED" ||
    (ph?.verdict === "SUPPORTED" && valuesOk(ph) && !entailOk(ph))
  ) {
    return {
      refId: r.refId,
      state: mode.cloudAvailable ? "WAITING" : "EVIDENCE_FOUND_LOCAL",
      rule: "R10",
      r4Source: null,
      r12SubA: false,
    };
  }
  // R11
  if (e.job.value === true || e.heldNei.value !== null) {
    return { refId: r.refId, state: "CHECKING", rule: "R11", r4Source: null, r12SubA: false };
  }
  // R12
  const r12a = l?.verdict === "NEI_SILENT_ESCALATE";
  const r12b = ph?.verdict === "NEI" && valuesOk(ph);
  const r12c =
    f.bibStatus === "UPSTREAM_UNAVAILABLE" ||
    f.bibStatus === "RATE_LIMITED" ||
    f.bibStatus === "NOT_INDEXED" ||
    f.bibStatus === "AMBIGUOUS";
  const r12d = f.bibStatus === "RESOLVED" && (!f.hasEvidence || sel?.candidates === 0);
  const r12e = l === null && (session.localUnavailable || (tr !== undefined && tr.attempts >= 3));
  if (r12a || r12b || r12c || r12d || r12e) {
    const state: RefState =
      f.bibStatus === "AMBIGUOUS"
        ? "UNVERIFIABLE"
        : mode.cloudAvailable
          ? "WAITING"
          : "UNVERIFIABLE";
    return { refId: r.refId, state, rule: "R12", r4Source: null, r12SubA: r12a };
  }
  // R13
  if (f.bibStatus === "PENDING" && l === null && r.cloud === null && ph === null) {
    return { refId: r.refId, state: "UNCHECKED", rule: "R13", r4Source: null, r12SubA: false };
  }
  // R14
  return { refId: r.refId, state: "UNCHECKED", rule: "R14", r4Source: null, r12SubA: false };
}

export function stateFamily(state: ClauseState): StateFamily {
  if (
    state === "WAITING" ||
    state === "UNVERIFIABLE" ||
    state === "SOURCE_FLAGGED" ||
    state === "MIXED_SUPPORT"
  ) {
    return "unresolved";
  }
  return state;
}

function computeEffectiveTriage(
  entry: ClaimLedgerEntry,
  policy: PolicySnapshot,
): { readonly triage: EffectiveTriage; readonly uncitedFromStage1: boolean } {
  const s1 = entry.stage1;
  const pp = s1 !== null ? policyOf(policy, s1.modelProfile) : null;
  const b1Auth = s1 !== null && pp !== null && pp.authority.B1 === "authoritative";
  const b2Auth = s1 !== null && pp !== null && pp.authority.B2 === "authoritative";

  const atoms = (b1Auth ? s1!.atoms : entry.baseline.atoms).map((a) => ({
    start: a.start,
    end: a.end,
    claimType: a.claimType,
  }));
  const worth = b2Auth ? s1!.worth : entry.baseline.worth;
  const claimType = b2Auth ? s1!.claimType : entry.baseline.claimType;
  const uncited = b2Auth ? s1!.uncited : entry.baseline.uncited;

  return {
    triage: { atoms, worth, claimType, uncited },
    uncitedFromStage1: b2Auth,
  };
}

function deriveWithoutOverride(
  entry: ClaimLedgerEntry,
  sortedRefs: readonly ClauseRef[],
  refEvals: readonly RefEval[],
  triage: EffectiveTriage,
  uncitedFromStage1: boolean,
  refFacts: ReadonlyMap<string, RefFacts>,
  mode: PrivacyContext,
): { readonly state: ClauseState; readonly provenance: Provenance } {
  const n = sortedRefs.length;

  // C2
  if (refEvals.some((r) => r.state === "REF_PROBLEM")) {
    return { state: "REFERENCE_PROBLEM", provenance: "DETERMINISTIC" };
  }
  // C3
  if (refEvals.some((r) => r.state === "CONTRADICTED_CONFIRMED")) {
    return { state: "CONTRADICTED", provenance: "CLOUD" };
  }
  // C4
  const hintPair = refEvals.find((r) => r.state === "HINT");
  if (hintPair !== undefined) {
    return {
      state: "HINT",
      provenance: hintPair.rule === "R6" ? "PHYSICAL_SOURCE" : "ON_DEVICE",
    };
  }
  // C4b
  if (
    n >= 1 &&
    triage.claimType === "METHODOLOGICAL" &&
    !refEvals.some(
      (r) =>
        r.state === "SUPPORTED_CONFIRMED" ||
        r.state === "SUPPORTED_LOCAL" ||
        r.state === "PARTIAL_CONFIRMED",
    ) &&
    entry.heldNei.value === null
  ) {
    return { state: "NOT_CHECKABLE", provenance: "NONE" };
  }
  // C5
  if (n === 0 && triage.uncited) {
    return {
      state: "UNCITED_EMPIRICAL",
      provenance: uncitedFromStage1 ? "ON_DEVICE" : "DETERMINISTIC",
    };
  }
  // C6
  if (refEvals.some((r) => r.state === "PARTIAL_CONFIRMED")) {
    return { state: "PARTLY_SUPPORTED", provenance: "CLOUD" };
  }
  // C7
  if (
    n >= 2 &&
    refEvals.some((r) => r.state === "SUPPORTED_CONFIRMED" || r.state === "SUPPORTED_LOCAL") &&
    refEvals.some(
      (r) =>
        r.state === "UNVERIFIABLE" || (r.state === "ALIGNED_ESCALATING" && !mode.cloudAvailable),
    )
  ) {
    return { state: "MIXED_SUPPORT", provenance: "NONE" };
  }
  // C8
  if (entry.l0Error === "PARSE_TIMEOUT") {
    return { state: "UNVERIFIABLE", provenance: "DETERMINISTIC" };
  }
  // C9
  if (
    refEvals.some((r) => r.state === "CHECKING") ||
    (refEvals.some((r) => r.state === "UNCHECKED") &&
      refEvals.some((r) => r.state !== "UNCHECKED"))
  ) {
    return { state: "CHECKING", provenance: "NONE" };
  }
  // C10
  const waitingPair = refEvals.find(
    (r) => r.state === "WAITING" || (r.state === "ALIGNED_ESCALATING" && mode.cloudAvailable),
  );
  if (waitingPair !== undefined) {
    const provenance: Provenance =
      waitingPair.rule === "R10" || (waitingPair.rule === "R12" && waitingPair.r12SubA)
        ? "ON_DEVICE"
        : "NONE";
    return { state: "WAITING", provenance };
  }
  // C11
  if (refEvals.some((r) => r.state === "SOURCE_FLAGGED")) {
    return { state: "SOURCE_FLAGGED", provenance: "NONE" };
  }
  // C12
  if (
    refEvals.some(
      (r) =>
        r.state === "UNVERIFIABLE" || (r.state === "ALIGNED_ESCALATING" && !mode.cloudAvailable),
    ) &&
    !refEvals.some((r) => r.state === "SUPPORTED_CONFIRMED" || r.state === "SUPPORTED_LOCAL")
  ) {
    const deciding = refEvals.find(
      (r) =>
        r.state === "UNVERIFIABLE" || (r.state === "ALIGNED_ESCALATING" && !mode.cloudAvailable),
    )!;
    let provenance: Provenance = "NONE";
    if (deciding.rule === "R5") {
      provenance = "CLOUD";
    } else if (deciding.rule === "R10" || (deciding.rule === "R12" && deciding.r12SubA)) {
      provenance = "ON_DEVICE";
    }
    return { state: "UNVERIFIABLE", provenance };
  }
  // C13
  if (n >= 1 && refEvals.every((r) => r.state === "SUPPORTED_CONFIRMED")) {
    const hasPhysical = refEvals.some((r) => r.r4Source === "PHYSICAL_SOURCE");
    return {
      state: "SUPPORTED",
      provenance: hasPhysical ? "PHYSICAL_SOURCE" : "CLOUD",
    };
  }
  // C14
  if (
    n >= 1 &&
    refEvals.every((r) => r.state === "SUPPORTED_CONFIRMED" || r.state === "SUPPORTED_LOCAL")
  ) {
    return { state: "SUPPORTED_LOCAL", provenance: "ON_DEVICE" };
  }
  // C14b
  if (
    n >= 1 &&
    refEvals.every(
      (r) =>
        r.state === "SUPPORTED_CONFIRMED" ||
        r.state === "SUPPORTED_LOCAL" ||
        r.state === "EVIDENCE_FOUND_LOCAL",
    ) &&
    refEvals.some((r) => r.state === "EVIDENCE_FOUND_LOCAL")
  ) {
    return { state: "LOCAL_EVIDENCE", provenance: "ON_DEVICE" };
  }
  // C15
  if (
    sortedRefs.some((r) => {
      const f = refFacts.get(r.refId) ?? defaultRefFacts(r.refId);
      return f.checkMetadata === true;
    })
  ) {
    return { state: "CHECK_METADATA", provenance: "DETERMINISTIC" };
  }
  // C16
  return { state: "UNCHECKED", provenance: "NONE" };
}

export function category(
  state: ClauseState,
  policy: PolicySnapshot,
  mode: PrivacyContext,
): MeterCategory | null {
  switch (state) {
    case "SUPPORTED":
      return "supported";
    case "REVIEWED_BY_AUTHOR":
      return "reviewed";
    case "SUPPORTED_LOCAL":
    case "LOCAL_EVIDENCE":
      return "local";
    case "REFERENCE_PROBLEM":
    case "CONTRADICTED":
      return "problems";
    case "HINT":
    case "PARTLY_SUPPORTED":
    case "CHECK_METADATA":
      return "to_review";
    case "UNCITED_EMPIRICAL":
      return policy.b4CountsAsReview ? "to_review" : "unchecked";
    case "WAITING":
      return "waiting";
    case "SOURCE_FLAGGED":
      return mode.mode === "STANDARD" ? "waiting" : "unverifiable";
    case "UNVERIFIABLE":
    case "MIXED_SUPPORT":
      return "unverifiable";
    case "UNCHECKED":
    case "CHECKING":
      return "unchecked";
    case "NOT_CHECKABLE":
      return null;
  }
}

export function derive(
  entry: ClaimLedgerEntry,
  refFacts: ReadonlyMap<string, RefFacts>,
  policy: PolicySnapshot,
  mode: PrivacyContext,
  session: SessionFacts,
): DerivedClause {
  const sortedRefs = [...entry.refs].sort((a, b) => compareCodeUnits(a.refId, b.refId));
  const { triage, uncitedFromStage1 } = computeEffectiveTriage(entry, policy);
  const refEvals = sortedRefs.map((r) => evaluateRef(r, entry, refFacts, policy, mode, session));
  const refStates = refEvals.map((r) => ({ refId: r.refId, state: r.state }));

  // C0
  if (sortedRefs.length === 0 && !triage.uncited) {
    const state: ClauseState = "NOT_CHECKABLE";
    return {
      claimId: entry.claimId,
      triage,
      refStates,
      state,
      category: category(state, policy, mode),
      provenance: "NONE",
    };
  }

  const withoutOverride = deriveWithoutOverride(
    entry,
    sortedRefs,
    refEvals,
    triage,
    uncitedFromStage1,
    refFacts,
    mode,
  );

  // C1
  const ov = entry.override.value;
  const refIdsKey = refIdsKeyOf(sortedRefs);
  if (
    ov !== null &&
    ov.normalizedClaimHash === entry.normalizedClaimHash &&
    ov.refIdsKey === refIdsKey &&
    stateFamily(withoutOverride.state) === stateFamily(ov.dismissedState)
  ) {
    const state: ClauseState = "REVIEWED_BY_AUTHOR";
    return {
      claimId: entry.claimId,
      triage,
      refStates,
      state,
      category: category(state, policy, mode),
      provenance: "AUTHOR",
    };
  }

  return {
    claimId: entry.claimId,
    triage,
    refStates,
    state: withoutOverride.state,
    category: category(withoutOverride.state, policy, mode),
    provenance: withoutOverride.provenance,
  };
}

// ───────────────────────── Coverage Meter & Header (`01` §5) ─────────────────────────

export function meter(
  entries: readonly ClaimLedgerEntry[],
  refFacts: ReadonlyMap<string, RefFacts>,
  policy: PolicySnapshot,
  mode: PrivacyContext,
  session: SessionFacts,
): CoverageMeter {
  let supported = 0;
  let reviewed = 0;
  let local = 0;
  let problems = 0;
  let to_review = 0;
  let waiting = 0;
  let unverifiable = 0;
  let unchecked = 0;
  let notCheckable = 0;
  let numberMismatches = 0;

  const byProvenance: Record<Exclude<Provenance, "NONE">, number> = {
    DETERMINISTIC: 0,
    ON_DEVICE: 0,
    CLOUD: 0,
    PHYSICAL_SOURCE: 0,
    AUTHOR: 0,
  };

  for (const entry of entries) {
    if (entry.archived) continue;
    const derived = derive(entry, refFacts, policy, mode, session);
    if (derived.category === null) {
      notCheckable += 1;
      continue;
    }

    switch (derived.category) {
      case "supported":
        supported += 1;
        break;
      case "reviewed":
        reviewed += 1;
        break;
      case "local":
        local += 1;
        break;
      case "problems":
        problems += 1;
        break;
      case "to_review":
        to_review += 1;
        break;
      case "waiting":
        waiting += 1;
        break;
      case "unverifiable":
        unverifiable += 1;
        break;
      case "unchecked":
        unchecked += 1;
        break;
    }

    if (
      entry.b5.inconsistentWith.length > 0 ||
      entry.labNoteMismatch.some((item) => item.flag.value !== null)
    ) {
      numberMismatches += 1;
    }

    if (derived.category !== "unchecked" && derived.provenance !== "NONE") {
      byProvenance[derived.provenance] += 1;
    }
  }

  const total =
    supported + reviewed + local + problems + to_review + waiting + unverifiable + unchecked;
  const notYetChecked = local + unchecked;

  return {
    total,
    supported,
    reviewed,
    local,
    problems,
    to_review,
    waiting,
    unverifiable,
    unchecked,
    notYetChecked,
    notCheckable,
    numberMismatches,
    quotaExhausted: mode.quotaExhausted,
    quotaResetAt: mode.quotaResetAt,
    byProvenance,
  };
}

export function computeCoverageMeter(
  state: LedgerState,
  mode: PrivacyContext,
  session: SessionFacts,
): CoverageMeter {
  return meter([...state.entries.values()], state.refFacts, state.policy, mode, session);
}

function formatMeterInt(n: number): string {
  if (n < 10_000) {
    return String(n);
  }
  const raw = String(n);
  const parts: string[] = [];
  for (let i = raw.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    parts.push(raw.slice(start, i));
  }
  return parts.reverse().join(",");
}

export function formatCoverageHeader(
  m: CoverageMeter,
  resetLocalTime?: string,
): string {
  const base =
    `${formatMeterInt(m.supported)} supported · ` +
    `${formatMeterInt(m.reviewed)} reviewed · ` +
    `${formatMeterInt(m.problems)} problems · ` +
    `${formatMeterInt(m.to_review)} to review · ` +
    `${formatMeterInt(m.waiting)} waiting · ` +
    `${formatMeterInt(m.unverifiable)} can't verify · ` +
    `${formatMeterInt(m.notYetChecked)} not yet checked — of ` +
    `${formatMeterInt(m.total)} claims`;

  if (m.quotaExhausted && resetLocalTime !== undefined) {
    return `${base} · cloud checks resume at ${resetLocalTime}`;
  }
  return base;
}
