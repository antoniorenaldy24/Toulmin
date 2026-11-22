# 01 — Data Model, Ledger Reducer & Coverage Meter

**Owns:** canonical enumerations and display mapping; the canonical data structures in TypeScript, Kotlin and Swift; identity hashing; the persisted result cache and the in-memory session cache; the pure, commutative ledger reducer `derive()`; the 8-bucket Coverage Meter, its header, drill-down and drawers.

**Load with:** `AGENTS.md` (always). Algorithms that produce the facts consumed here are owned elsewhere:
- segmentation, citation scanning, clause partitioning, the value grammar, BM25 selection and the sanitizer: `02_L0_TIER_A_PRE_DECODE.md`;
- the anchor validator, the triage baseline and B5 pairing: `03_L0_TIER_B_VALIDATOR_B5_INGEST.md`;
- queue semantics, L1/L2 runtimes and Remote Config: `04_AI_RUNTIME_PROMPTS_AND_L3.md`.

**Cross-reference notation.** `[0n › Topic]` names the owning specification file `docs/spec/0n_*.md` and the topic heading inside it.

**Tier.** `packages/core-l0/src/ledger.ts` (types, reducer, Coverage Meter) and its Kotlin port `Ledger.kt` are **Tier B** modules (D-30). Every change to them after the first benchmark run requires a committed replay report. Their outputs are checked by `conformance/l0/reducer.json`, `meter.json` and `claimhash.json`, and by the reducer property test `packages/core-l0/test/prop/reducer.prop.test.ts`.

**Per-device scope.** Every ledger lives on exactly one device (D-10). The data model contains no cross-device fields. Each device holds, per (clause, reference) pair, at most one local result: the one produced by its own active profile.

---

## 1. Enumerations & Canonical Display Mapping

### 1.1 Enumerations

Values are written exactly as below in every language. Kotlin enums serialize to these exact strings (through `@SerialName` where a Kotlin identifier cannot match). Swift enums use them as `String` raw values.

| Enum | Values | Meaning |
|---|---|---|
| `BibStatus` | `PENDING`, `RESOLVED`, `DOI_NOT_FOUND`, `NOT_INDEXED`, `AMBIGUOUS`, `METADATA_MISMATCH`, `UNRESOLVED_KEY`, `UPSTREAM_UNAVAILABLE`, `RATE_LIMITED` | Resolution status of one reference. See §1.1.1 for the meaning of each value. |
| `MarkerKind` | `EXPLICIT`, `HEURISTIC` | **`EXPLICIT`:** the `\cite` family, a Pandoc key, a `.docx` field code, or a numeric bracket with a known bibliography order. **`HEURISTIC`:** an author–year parenthetical or narrative pattern, or a numeric bracket without a known bibliography order [02 › Linear-Time Citation-Marker Scanner & Key Resolution]. Only `EXPLICIT` markers can produce `UNRESOLVED_KEY`. |
| `LocalVerdict` | `SUPPORTED`, `CONTRADICTS`, `NEI_SILENT_ESCALATE` | Stage 2 on-device output after anchor validation and the calibrated-variant rule. |
| `CloudVerdict` | `SUPPORTED`, `PARTIAL`, `CONTRADICTED`, `NEI` | L2 output after post-checks [04 › Seven L0 post-checks on `L2Verdict` (applied in order)]. `PARTIAL` requires an anchored quote. A verdict based only on web sources (`WEB_SOURCE` quote origin) is stored as `NEI` with `quote = null`. |
| `PhysicalVerdict` | `SUPPORTED`, `CONTRADICTS`, `NEI` | Stage 2 over an author-confirmed physical extract (Android O2/O3). |
| `ClaimType` | `QUANTITATIVE`, `CAUSAL`, `COMPARATIVE`, `EXISTENCE`, `METHODOLOGICAL`, `NON_EMPIRICAL` | From Stage 1, or from the deterministic baseline when B1/B2 are advisory. |
| `Worth` | `HIGH`, `LOW`, `UNKNOWN` | Check-worthiness. `UNKNOWN` until Stage 1 or the baseline has run. |
| `EvidenceSourceKind` | `ABSTRACT`, `FULLTEXT`, `USER_PDF`, `PHYSICAL_TABLE`, `PHYSICAL_TEXT`, `LAB_NOTE`, `MANUSCRIPT` | Kind of evidence an anchor points to. `USER_PDF` is text extracted from a PDF the author attached; it is sent to the cloud only when the author ticks "Include text from my PDFs". `MANUSCRIPT` is used only by B5 anchors into the author's own text. |
| `PhysicalKind` | `PHYSICAL_TABLE`, `PHYSICAL_TEXT`, `LAB_NOTE` | The subset of `EvidenceSourceKind` that a photographed capture can have. |
| `InferenceSourceTag` | `ON_DEVICE`, `IN_CLOUD`, `NONE` | Copied from `response.inferenceSource` (Web, Android) or derived from `rawResponse.modelVersion` (iOS). `NONE` for deterministic results. |
| `RefState` | `REF_PROBLEM`, `CONTRADICTED_CONFIRMED`, `PARTIAL_CONFIRMED`, `SUPPORTED_CONFIRMED`, `HINT`, `SUPPORTED_LOCAL`, `EVIDENCE_FOUND_LOCAL`, `ALIGNED_ESCALATING`, `SOURCE_FLAGGED`, `WAITING`, `UNVERIFIABLE`, `CHECKING`, `UNCHECKED` (13 states) | Derived per (clause, reference) pair by rules R1–R14 (§4.6). |
| `ClauseState` | `REFERENCE_PROBLEM`, `CONTRADICTED`, `HINT`, `PARTLY_SUPPORTED`, `MIXED_SUPPORT`, `UNCITED_EMPIRICAL`, `CHECK_METADATA`, `WAITING`, `SOURCE_FLAGGED`, `UNVERIFIABLE`, `LOCAL_EVIDENCE`, `SUPPORTED_LOCAL`, `SUPPORTED`, `REVIEWED_BY_AUTHOR`, `CHECKING`, `UNCHECKED`, `NOT_CHECKABLE` (17 states) | Derived per clause by rules C0–C16 (§4.7). |
| `MeterCategory` | `supported`, `reviewed`, `local`, `problems`, `to_review`, `waiting`, `unverifiable`, `unchecked` (8 buckets) | The Coverage Meter partition (§5). |
| `TransientReason` | `DEADLINE`, `TRUNCATED`, `BUSY`, `NETWORK`, `SLOT_LOST`, `OTHER` | Why an L1 job ended without a usable output. Transient outcomes live only in the session cache (§3.4). |
| `OverrideBasis` | `REVIEW`, `PRINTED_SOURCE` | Why the author overrode a clause. **`REVIEW`:** "Mark reviewed" or "Reviewed — cited intentionally". **`PRINTED_SOURCE`:** the author tapped "This row supports my claim" on a printed-source row that the model did not judge `SUPPORTED`. |
| `AnchorFailReason` | `IDX_OUT_OF_BOUNDS`, `EMPTY_SPAN`, `FRAGMENT_TOO_SHORT`, `CONTAINMENT_BELOW_THRESHOLD`, `WINDOW_TOO_WIDE`, `FRAGMENT_ORDER_VIOLATION`, `NUMERIC_PARITY`, `NEGATION_PARITY`, `DIRECTION_PARITY`, `CLAIM_SPAN_MISMATCH`, `LOW_CLAIM_OVERLAP`, `REASONING_VERDICT_CONFLICT`, `UNCALIBRATED_VARIANT`, `NO_DIFFERENCE_SIGNAL` (14 reasons) | Why anchor validation or the calibrated-variant rule changed a verdict [03 › Post-Decode Evidence Anchor Validator (L1 & L2)]. **`NO_DIFFERENCE_SIGNAL`:** an L1 `CONTRADICTS` whose claim and anchored span show no value, negation or direction difference. **`UNCALIBRATED_VARIANT`:** a `CONTRADICTS` from a schema variant other than the profile's calibrated `{ schemaId, reasoningCap }`. |
| `L0Error` | `PARSE_TIMEOUT` | The 250 ms watchdog terminated an L0 job for this input (D-27). |
| `Provenance` | `DETERMINISTIC`, `ON_DEVICE`, `CLOUD`, `PHYSICAL_SOURCE`, `AUTHOR`, `NONE` | Origin of the deciding fact of a derived clause (§4.8). |
| `Task` | `B1`, `B2`, `B3`, `B5`, `O2` | Local tasks that carry task authority. B4 follows B2. |
| `Authority` | `authoritative`, `advisory` | Task authority and support-verdict authority. |

#### 1.1.1 `BibStatus` values in detail

| Value | Meaning | Red? |
|---|---|---|
| `PENDING` | Resolution has not finished. | No |
| `RESOLVED` | An index resolved the reference. | No |
| `DOI_NOT_FOUND` | The reference carries an **explicit DOI** that no index resolves **and** that the `doi.org` handle API reports as unregistered (`responseCode = 100`). | **Yes** |
| `NOT_INDEXED` | Either the reference has **no DOI** and no index matched it (books, reports, theses, non-English literature), or it has a DOI that `doi.org` reports as registered (`responseCode` 1 or 200) but no index resolves. | No (grey "Check this citation") |
| `AMBIGUOUS` | A citation key or reference string matches more than one bibliography entry. | No (grey "Check this citation"; opens the reference picker) |
| `METADATA_MISMATCH` | The resolved record's metadata (title, first author, year, venue) disagrees with the bibliography entry beyond tolerance [05 › `bibResolve` and `bibResolveJudge`]. | No (amber "Check metadata") |
| `UNRESOLVED_KEY` | An **explicit** citation key that is not present in any loaded bibliography. | **Yes** |
| `UPSTREAM_UNAVAILABLE` | Every bibliographic upstream failed or timed out, or lookup is impossible in this build (the Android `bundledSample` build has no network). Transient. | No |
| `RATE_LIMITED` | An upstream or Toulmin's own pool refused the lookup for rate reasons. Transient. | No |

`DOI_NOT_FOUND` and `NOT_INDEXED` are never confused: a reference becomes `DOI_NOT_FOUND` only after the `doi.org` check has positively reported that its explicit DOI is unregistered.

### 1.2 Canonical display mapping

This is the only mapping from clause state to inline mark and meter category. One meaning per mark. Colour tokens and glyph assets are owned by [06 › Status mark table].

| Clause state | Inline mark | Meter category |
|---|---|---|
| `REFERENCE_PROBLEM` (a mapped reference is `DOI_NOT_FOUND`, retracted, or `UNRESOLVED_KEY` from an explicit marker) | red flag icon in the gutter + red chip on the citation marker; **no** underline on the claim text | `problems` |
| `CONTRADICTED` (L2-confirmed only; no on-device, physical or lab-note result can produce it) | solid red underline | `problems` |
| `HINT` (Path A local contradiction, or an author-confirmed printed-source contradiction under Path A; unconfirmed) | amber-grey dotted underline + label "On-device hint · unconfirmed" on hover and focus | `to_review` |
| `PARTLY_SUPPORTED` (L2 `PARTIAL`) | amber outline chip "Partly supported" (glyph ◐) on the citation marker | `to_review` |
| `UNCITED_EMPIRICAL` | blue chip "Uncited empirical claim" | `to_review` iff `policy.b4CountsAsReview`; otherwise `unchecked` |
| `CHECK_METADATA` (only state of a clause whose reference has `METADATA_MISMATCH`) | amber outline chip "Check metadata" (icon ⓜ) on **that reference's** citation marker; no mark on the claim text | `to_review` |
| `MIXED_SUPPORT` (at least one mapped reference supports; at least one other cannot be verified) | grey outline chip "Supported by k of n · others not verifiable" (glyph ✓?) on the citation marker group | `unverifiable` |
| `WAITING` | none inline; progress chip while a job is in flight; listed in the drawer *Waiting for cloud check* | `waiting` |
| `SOURCE_FLAGGED` | none inline; listed in the drawer *Source flagged* with the sanitizer reasons | `waiting` in Standard mode; `unverifiable` in Confidential mode |
| `UNVERIFIABLE` | none inline; listed in the drawer *Can't verify with available sources* | `unverifiable` |
| `LOCAL_EVIDENCE` (on-device evidence found; support not authorized as a verdict; no cloud available) | none inline; the inspector shows "Evidence found on this device · not a verdict" | `local` |
| `SUPPORTED_LOCAL` (calibrated on-device `SUPPORTED`; support verdicts authoritative for the profile) | grey hollow check in the margin **only** when the setting "Show on-device supports" is on (default **off**); tooltip "Supported on this device · unconfirmed" | `local` |
| `SUPPORTED` (L2 `SUPPORTED`, or a printed-source result that the model judged `SUPPORTED` and whose values **and** entailment the author confirmed) | green check in the margin | `supported` |
| `REVIEWED_BY_AUTHOR` (any author override) | grey "reviewed" glyph in the margin; tooltip "Reviewed by you · not a verdict" | `reviewed` (never counted as supported) |
| `CHECKING` | small progress chip "Checking…", shown after the job has been in flight for 400 ms | `unchecked` |
| `UNCHECKED` | none | `unchecked` |
| `NOT_CHECKABLE` (no resolved citation and not flagged as uncited empirical; or a cited `METHODOLOGICAL` statement without a support result) | none | excluded from the meter (counted in the drill-down line "Not checkable") |

### 1.3 Independent flags

Flags are independent of the clause state and of the meter category. They never change either.

| Flag | Source | Mark | Counted in |
|---|---|---|---|
| B5 manuscript inconsistency | `e.b5.inconsistentWith ≠ []` | **purple** outline badge **"≠"** on both numeric spans; hover names the other section ("≠ {section}") | drill-down line "Number mismatches" |
| Lab-note mismatch confirmed by the author | any `e.labNoteMismatch[i].flag.value ≠ null` | **purple** outline badge **"≠ lab note"** on the manuscript span; never red | drill-down line "Number mismatches" |
| Heuristic marker not matched (`POSSIBLE_CITATION`) | `e.possibleCitations ≠ []` | **grey** outline chip "Check this citation" on the marker; reason "Possible citation — it matches no reference in your bibliography". The marker is not a reference and does not change `n` | — |
| Reference `NOT_INDEXED` | `refFacts[refId].bibStatus = NOT_INDEXED` | **grey** outline chip "Check this citation" on that reference's citation marker; reason "No DOI, and not found in the bibliographic indexes" | — |
| Reference `AMBIGUOUS` | `refFacts[refId].bibStatus = AMBIGUOUS` | **grey** outline chip "Check this citation"; reason "This citation matches more than one reference"; click opens the reference picker | — |
| Job in flight while a result is already shown | `e.job.value = true` ∧ a mark is shown | small **"Checking…"** badge next to the existing mark; the existing mark stays visible | — |

The hover and accessibility text of every "Check this citation" chip is `"Check this citation: {reason}"`.

---

## 2. Canonical Multi-Platform Data Structures

All three files use the same field names and the same enum values. TypeScript is canonical. A difference between the TypeScript and Kotlin definitions is a build failure: `packages/schemas/tools/check-kotlin-mirror.ts` compares field names, order and enum values.

### 2.1 TypeScript — `packages/core-l0/src/ledger.ts`

```ts
// packages/core-l0/src/ledger.ts — canonical definitions.
// Kotlin (Ledger.kt) and Swift (Ledger.swift) MUST use the same field names and enum values.
// Pure module: no Firebase, DOM, network or clock access (AGENTS.md §7.1).

// ───────────────────────── Enumerations ─────────────────────────
export type BibStatus =
  | "PENDING" | "RESOLVED" | "DOI_NOT_FOUND" | "NOT_INDEXED" | "AMBIGUOUS" | "METADATA_MISMATCH"
  | "UNRESOLVED_KEY" | "UPSTREAM_UNAVAILABLE" | "RATE_LIMITED";
export type MarkerKind = "EXPLICIT" | "HEURISTIC";
export type LocalVerdict = "SUPPORTED" | "CONTRADICTS" | "NEI_SILENT_ESCALATE";
export type CloudVerdict = "SUPPORTED" | "PARTIAL" | "CONTRADICTED" | "NEI";
export type PhysicalVerdict = "SUPPORTED" | "CONTRADICTS" | "NEI";
export type ClaimType = "QUANTITATIVE" | "CAUSAL" | "COMPARATIVE" | "EXISTENCE" | "METHODOLOGICAL" | "NON_EMPIRICAL";
export type Worth = "HIGH" | "LOW" | "UNKNOWN";
export type EvidenceSourceKind =
  | "ABSTRACT" | "FULLTEXT" | "USER_PDF" | "PHYSICAL_TABLE" | "PHYSICAL_TEXT" | "LAB_NOTE" | "MANUSCRIPT";
export type PhysicalKind = "PHYSICAL_TABLE" | "PHYSICAL_TEXT" | "LAB_NOTE";
export type InferenceSourceTag = "ON_DEVICE" | "IN_CLOUD" | "NONE";
export type AnchorFailReason =
  | "IDX_OUT_OF_BOUNDS" | "EMPTY_SPAN" | "FRAGMENT_TOO_SHORT" | "CONTAINMENT_BELOW_THRESHOLD"
  | "WINDOW_TOO_WIDE" | "FRAGMENT_ORDER_VIOLATION" | "NUMERIC_PARITY" | "NEGATION_PARITY"
  | "DIRECTION_PARITY" | "CLAIM_SPAN_MISMATCH" | "LOW_CLAIM_OVERLAP" | "REASONING_VERDICT_CONFLICT"
  | "UNCALIBRATED_VARIANT" | "NO_DIFFERENCE_SIGNAL";
export type RefState =
  | "REF_PROBLEM" | "CONTRADICTED_CONFIRMED" | "PARTIAL_CONFIRMED" | "SUPPORTED_CONFIRMED" | "HINT"
  | "SUPPORTED_LOCAL" | "EVIDENCE_FOUND_LOCAL" | "ALIGNED_ESCALATING" | "SOURCE_FLAGGED" | "WAITING"
  | "UNVERIFIABLE" | "CHECKING" | "UNCHECKED";
export type ClauseState =
  | "REFERENCE_PROBLEM" | "CONTRADICTED" | "HINT" | "PARTLY_SUPPORTED" | "MIXED_SUPPORT" | "UNCITED_EMPIRICAL"
  | "CHECK_METADATA" | "WAITING" | "SOURCE_FLAGGED" | "UNVERIFIABLE" | "LOCAL_EVIDENCE" | "SUPPORTED_LOCAL"
  | "SUPPORTED" | "REVIEWED_BY_AUTHOR" | "CHECKING" | "UNCHECKED" | "NOT_CHECKABLE";
export type MeterCategory =
  | "supported" | "reviewed" | "local" | "problems" | "to_review" | "waiting" | "unverifiable" | "unchecked";
/** Reasons for which an L1 job ended without a usable output. Such outcomes are TRANSIENT: they live only in the
 *  in-memory session cache, never in the persisted results table, and never satisfy deduplication (§3.5). */
export type TransientReason = "DEADLINE" | "TRUNCATED" | "BUSY" | "NETWORK" | "SLOT_LOST" | "OTHER";
export type OverrideBasis = "REVIEW" | "PRINTED_SOURCE";
export type L0Error = "PARSE_TIMEOUT";
export type Provenance = "DETERMINISTIC" | "ON_DEVICE" | "CLOUD" | "PHYSICAL_SOURCE" | "AUTHOR" | "NONE";
export type Task = "B1" | "B2" | "B3" | "B5" | "O2";
export type Authority = "authoritative" | "advisory";

// ───────────────────────── Text and quantities ─────────────────────────
/** UTF-16 code-unit offsets into the source text, end exclusive (Swift MUST use the String.utf16 view). */
export interface TextRange { start: number; end: number }

export type MetricClass =
  | "sample_size" | "percentage" | "effect_size" | "p_value" | "duration"
  | "dose" | "concentration" | "currency" | "count" | "ratio" | "other";

export type PComparator = "<" | "<=" | "=" | ">" | ">=";

export interface QuantTuple {
  tupleId: string;              // sha256hex(docId|sentenceHash|occurrenceIndex|tupleOrdinal|metricClass|valueRaw), first 32 chars
  valueRaw: string;             // exact source substring of the value [02 › Value Grammar, Units & Metric Classes]
  unitRaw: string;              // exact source substring of the unit ("" if none)
  metricClass: MetricClass;     // [02 › Unit families and canonical conversion table]
  pComparator: PComparator | null; // p-values only
  valueNorm: number | null;     // canonical point value
  valueLo: number | null;       // CI or range low; equals valueNorm for point values
  valueHi: number | null;       // CI or range high; equals valueNorm for point values
  sigDigits: number;            // significant digits of valueRaw (rounding tolerance) [03 › Deterministic incremental pairing]
  unitCanon: string;            // canonical unit; "unknown:<raw>" when not in the unit table
  keyLemmas: string[];          // stemmed content lemmas in the ±6-token window [03 › Key lemmas]
  section: string;              // canonical hierarchical section label
  source: "manuscript" | "lab_note" | "print_page";
  span: TextRange;              // span of valueRaw+unitRaw in the manuscript source, or in the OCR text for physical sources
}

// ───────────────────────── Results ─────────────────────────
export interface EvidenceAnchor {
  refId: string;
  sourceKind: EvidenceSourceKind;
  chunkId: string;              // [02 › Evidence chunking] (includes a content hash)
  evidenceIdx: number;          // index into the EVIDENCE[] array sent to the model
  snapped: TextRange;           // exact substring range inside the chunk text (raw, unsanitized coordinates)
  snippet: string;              // exact original substring (≤ 400 chars)
}

/** One validated on-device Stage 2 result for one (clause, reference) pair, produced by this device's active profile. */
export interface LocalResult {
  resultKey: string;            // §3.3, form "L|"
  verdict: LocalVerdict;        // after anchor validation, parity checks and the calibrated-variant rule
  rawVerdict: LocalVerdict;     // as decoded, before validation
  anchor: EvidenceAnchor | null;
  anchorFailReason: AnchorFailReason | null;
  microReasoning: string;       // ≤ 280 chars
  inferenceSource: InferenceSourceTag;
  modelProfile: string;         // "web_chrome_nano" | "android_aicore_stable" | "android_aicore_preview" | "apple_slm" | "no_local_model"
  schemaId: string;             // e.g. "VerdictV1"; must equal the profile's calibrated schema to be authoritative
  reasoningCap: number;         // 40, 30 or 20
  promptVersion: string;        // e.g. "p2.1"
  decidedAt: number;            // epoch ms
}

/** Stage 1 output for one sentence, cached by resultKey like every other result (§3.3). Whether it is applied is
 *  decided in derive() from the current task authority, never when the event arrives (§4.2). */
export interface Stage1Result {
  resultKey: string;            // §3.3, form "S1|"
  atoms: Array<{ start: number; end: number; claimType: ClaimType }>; // word-index ranges into the sentence, ≤ 3
  worth: Worth;
  claimType: ClaimType;
  uncited: boolean;
  modelProfile: string;
  schemaId: string;             // "TriageV1" (only TriageV1 results are materialized into entry.stage1)
  promptVersion: string;
  decidedAt: number;
}

/** Deterministic baseline triage [03 › Deterministic triage baseline (`baselineTriage(S, c)`)]: a pure function of the clause, its sentence
 *  and its section label. */
export interface BaselineTriage {
  atoms: Array<{ start: number; end: number; claimType: ClaimType }>;
  worth: Worth;
  claimType: ClaimType;
  uncited: boolean;
}

/** One L2 result for one (clause, reference) pair. Grounded web text and links are never stored. */
export interface CloudResult {
  resultKey: string;            // §3.3, form "C|"
  normalizedClaimHash: string;  // normalizedClaimHash of the clause the check was sent for (§3.2)
  refId: string;
  verdict: CloudVerdict;        // a WEB_SOURCE-only verdict is stored as NEI with quote = null
  quote: string | null;         // anchored quote from PROVIDED evidence only; null otherwise (never grounded web text)
  quoteAnchor: EvidenceAnchor | null;
  approvedTextSha256: string;   // sha256hex of the exact text sent after author approval (or the sample claim text)
  alternativesDois: string[];   // only DOIs that resolved through bibResolve
  noDifferenceNote: boolean;    // CONTRADICTED kept although no value/negation/direction difference was detected
  adjudicator: "l2Adjudicate" | "l2AdjudicateProvided";
  inferenceSource: InferenceSourceTag;
  promptVersion: string;
  decidedAt: number;
}

/** A photographed physical source on the Android Pocket Ledger. */
export interface PhysicalSource {
  captureId: string;            // UUID v4
  photoSha256: string;          // sha256hex of the original JPEG bytes
  kind: PhysicalKind;
  linkedRefId: string | null;   // null for LAB_NOTE
  pageLabel: string;            // e.g. "p. 412, Table 2" (pre-filled from OCR when a "Table n" caption is detected)
  rowCropSha256: string | null; // composite crop of the selected row plus the column-header strip(s)
  confirmedByAuthorAt: number | null;            // values confirmed: "Matches the photo"
  entailmentConfirmedByAuthorAt: number | null;  // "This row supports my claim" (PHYSICAL_TABLE / PHYSICAL_TEXT only)
}

export interface PhysicalResult {
  resultKey: string;            // §3.3, form "P|"
  normalizedClaimHash: string;  // normalizedClaimHash of the clause the capture was checked for
  refId: string | null;         // null for LAB_NOTE (applies to the clause, never to a reference)
  verdict: PhysicalVerdict;
  capture: PhysicalSource;
  inferenceSource: InferenceSourceTag;
  decidedAt: number;
}

// ───────────────────────── Facts ─────────────────────────
/** Document-level facts about one reference. Stored once per (docId, refId) in the table refFacts; never copied into
 *  ledger entries, so creating or re-creating an entry can never overwrite them (§4.3). */
export interface RefFacts {
  refId: string;
  bibStatus: BibStatus;
  retracted: boolean;           // from bibResolve or the retraction snapshot (monotone)
  checkMetadata: boolean;       // true iff bibStatus = METADATA_MISMATCH was reported for this reference
  evidenceVersion: string;      // §3.2
  hasEvidence: boolean;         // at least one evidence unit exists for this REFERENCE on this device (per-reference fact)
  updatedSeq: number;           // Lamport counter per (docId, refId); versioned merge (§4.3)
}

/** Result of evidence selection for one (clause, reference) pair [02 › Top-5 selection and the per-pair `Selection` fact]: a pure function of
 *  the clause's claim text, its sentence, the reference's evidence units at evidenceVersion and bm25_min_cov.
 *  Valid only while evidenceVersion equals refFacts[refId].evidenceVersion (§3.6). */
export interface Selection {
  evidenceVersion: string;
  candidates: number;           // unblocked evidence units kept for THIS CLAUSE (0..5); per-pair fact
  suspicious: boolean;          // at least one kept top-5 unit was blocked by the sanitizer
  seq: number;                  // Lamport counter (versioned merge, §4.3)
}

/** Per-(clause, reference) results. local/cloud/physical are materialized views of the results cache (§4.3). */
export interface ClauseRef {
  refId: string;
  selection: Selection | null;  // null until selection has run for the current evidenceVersion
  local: LocalResult | null;    // the single local result of this device's active profile, or null
  cloud: CloudResult | null;
  physical: PhysicalResult | null; // never a LAB_NOTE result
}

/** A set/clear fact with a Lamport sequence number (per claimId; per refId for RefFacts). */
export interface Versioned<T> { value: T; seq: number }

export interface AuthorOverride {
  dismissedState: ClauseState;  // the derived state the author reviewed
  basis: OverrideBasis;
  captureId: string | null;     // set iff basis = "PRINTED_SOURCE"
  normalizedClaimHash: string;  // survives trivial edits (§3.2)
  refIdsKey: string;            // sorted refIds of the clause joined by "|"
  note: string;                 // optional, ≤ 200 chars
  createdAt: number;
}

export interface LabNoteFlag { pageLabel: string; confirmedByAuthorAt: number }

export interface ClaimLedgerEntry {
  claimId: string;              // §3.1
  docId: string;                // random UUID v4 per document (never a file name or title)
  sentenceHash: string;         // §3.1
  occurrenceIndex: number;      // §3.1
  clauseIndex: number;          // index within the sentence partition [02 › Non-Overlapping Clause Partitioner]
  section: string;              // canonical hierarchical section label [02 › Hierarchical section label canonicalization]
  subsection: string | null;    // raw sub-heading text, if any
  span: TextRange;              // clause span in the manuscript source (mapped through edits) [04 › Result binding and incremental block-state scan (Web)]
  claimText: string;            // clause text built by the clause partitioner (markers and reporting frames stripped, trimmed)
  normalizedClaimHash: string;  // §3.2
  baseline: BaselineTriage;     // pure function, recomputed by E1
  stage1: Stage1Result | null;  // materialized from the cache by the expected Stage 1 key; applied per authority in derive()
  citationKeys: string[];       // keys of EXPLICIT markers and of resolved HEURISTIC markers
  possibleCitations: TextRange[]; // HEURISTIC markers that did not resolve (grey chips; not references)
  refs: ClauseRef[];            // one per mapped reference, sorted by refId
  heldNei: Versioned<{ since: number } | null>; // fast-path NEI hold (D-14)
  job: Versioned<boolean>;      // true while a job for this clause is executing
  l0Error: L0Error | null;
  b5: { inconsistentWith: string[] };  // other claimIds, sorted; recomputed from the B5 index by E13
  labNoteMismatch: Array<{ captureId: string; flag: Versioned<LabNoteFlag | null> }>; // sorted by captureId; purple flag only
  suggestedRefIds: string[];    // B4/O4 suggestions from the local library (sorted)
  override: Versioned<AuthorOverride | null>;
  archived: boolean;            // monotone
  updatedAt: number;            // epoch ms of the last fact change (informational; never read by derive())
}

// ───────────────────────── Policy and context (inputs of derive) ─────────────────────────
export interface ProfilePolicy {
  path: "A" | "B";
  authority: Readonly<Record<Task, Authority>>;        // B4 follows B2
  supportVerdicts: Authority;
  calibratedVariant: { schemaId: string; reasoningCap: number };
}

export interface PolicySnapshot {
  deviceProfile: string;                               // this device's active modelProfile ("no_local_model" without a usable model)
  profiles: Readonly<Record<string, ProfilePolicy>>;   // every profile in routing_table
  b4CountsAsReview: boolean;                           // Remote Config b4_counts_in_review
}

export interface PrivacyContext {
  mode: "CONFIDENTIAL" | "STANDARD";
  cloudAvailable: boolean;     // STANDARD ∧ ¬kill_switch_cloud ∧ network online ∧ cloud stack initialized; independent of quota
  quotaExhausted: boolean;     // the user's current pool (anonymous | judge | sample) has no runs left today
  quotaResetAt: number | null; // epoch ms of the next pool reset (00:00 Asia/Jakarta), shown in the user's local time
}

export interface SessionFacts {
  localUnavailable: boolean;   // no on-device stage can run for this document in this session (§4.1)
  transient: ReadonlyMap<string, { reason: TransientReason; attempts: number }>; // key = claimId + "|" + refId
}

// ───────────────────────── Outputs ─────────────────────────
/** Effective triage values, computed inside derive() (§4.2). */
export interface EffectiveTriage {
  atoms: BaselineTriage["atoms"];
  worth: Worth;
  claimType: ClaimType;
  uncited: boolean;
}

export interface DerivedClause {
  claimId: string;
  triage: EffectiveTriage;
  refStates: Array<{ refId: string; state: RefState }>; // sorted by refId
  state: ClauseState;
  category: MeterCategory | null; // null for NOT_CHECKABLE
  provenance: Provenance;
}

export interface CoverageMeter {
  total: number;               // non-archived, non-NOT_CHECKABLE clauses
  supported: number;
  reviewed: number;            // REVIEWED_BY_AUTHOR (own bucket; never counted as supported)
  local: number;
  problems: number;
  to_review: number;
  waiting: number;
  unverifiable: number;
  unchecked: number;
  notYetChecked: number;       // local + unchecked (never includes reviewed)
  notCheckable: number;        // NOT_CHECKABLE clauses (drill-down only; not part of total)
  numberMismatches: number;    // clauses with a B5 or lab-note flag (drill-down only; not a bucket)
  quotaExhausted: boolean;     // display only
  quotaResetAt: number | null; // display only
  byProvenance: Record<Exclude<Provenance, "NONE">, number>; // over clauses whose category is not "unchecked"
}

export declare function derive(
  entry: ClaimLedgerEntry,
  refFacts: ReadonlyMap<string, RefFacts>,
  policy: PolicySnapshot,
  mode: PrivacyContext,
  session: SessionFacts,
): DerivedClause;

export declare function category(state: ClauseState, policy: PolicySnapshot, mode: PrivacyContext): MeterCategory | null;

export declare function meter(
  entries: readonly ClaimLedgerEntry[],
  refFacts: ReadonlyMap<string, RefFacts>,
  policy: PolicySnapshot,
  mode: PrivacyContext,
  session: SessionFacts,
): CoverageMeter;
```

### 2.2 Kotlin — `apps/android/core-l0/src/main/kotlin/app/toulmin/core/Ledger.kt`

```kotlin
// apps/android/core-l0/src/main/kotlin/app/toulmin/core/Ledger.kt
// Mirror of packages/core-l0/src/ledger.ts. Field names, order and serialized enum values MUST be identical
// (checked by packages/schemas/tools/check-kotlin-mirror.ts). Pure module: no Android, Firebase or I/O imports.
package app.toulmin.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ───────────────────────── Enumerations ─────────────────────────
@Serializable enum class BibStatus { PENDING, RESOLVED, DOI_NOT_FOUND, NOT_INDEXED, AMBIGUOUS, METADATA_MISMATCH,
    UNRESOLVED_KEY, UPSTREAM_UNAVAILABLE, RATE_LIMITED }
@Serializable enum class MarkerKind { EXPLICIT, HEURISTIC }
@Serializable enum class LocalVerdict { SUPPORTED, CONTRADICTS, NEI_SILENT_ESCALATE }
@Serializable enum class CloudVerdict { SUPPORTED, PARTIAL, CONTRADICTED, NEI }
@Serializable enum class PhysicalVerdict { SUPPORTED, CONTRADICTS, NEI }
@Serializable enum class ClaimType { QUANTITATIVE, CAUSAL, COMPARATIVE, EXISTENCE, METHODOLOGICAL, NON_EMPIRICAL }
@Serializable enum class Worth { HIGH, LOW, UNKNOWN }
@Serializable enum class EvidenceSourceKind { ABSTRACT, FULLTEXT, USER_PDF, PHYSICAL_TABLE, PHYSICAL_TEXT, LAB_NOTE,
    MANUSCRIPT }
@Serializable enum class PhysicalKind { PHYSICAL_TABLE, PHYSICAL_TEXT, LAB_NOTE }
@Serializable enum class InferenceSourceTag { ON_DEVICE, IN_CLOUD, NONE }
@Serializable enum class AnchorFailReason { IDX_OUT_OF_BOUNDS, EMPTY_SPAN, FRAGMENT_TOO_SHORT, CONTAINMENT_BELOW_THRESHOLD,
    WINDOW_TOO_WIDE, FRAGMENT_ORDER_VIOLATION, NUMERIC_PARITY, NEGATION_PARITY, DIRECTION_PARITY, CLAIM_SPAN_MISMATCH,
    LOW_CLAIM_OVERLAP, REASONING_VERDICT_CONFLICT, UNCALIBRATED_VARIANT, NO_DIFFERENCE_SIGNAL }
@Serializable enum class RefState { REF_PROBLEM, CONTRADICTED_CONFIRMED, PARTIAL_CONFIRMED, SUPPORTED_CONFIRMED, HINT,
    SUPPORTED_LOCAL, EVIDENCE_FOUND_LOCAL, ALIGNED_ESCALATING, SOURCE_FLAGGED, WAITING, UNVERIFIABLE, CHECKING, UNCHECKED }
@Serializable enum class ClauseState { REFERENCE_PROBLEM, CONTRADICTED, HINT, PARTLY_SUPPORTED, MIXED_SUPPORT,
    UNCITED_EMPIRICAL, CHECK_METADATA, WAITING, SOURCE_FLAGGED, UNVERIFIABLE, LOCAL_EVIDENCE, SUPPORTED_LOCAL, SUPPORTED,
    REVIEWED_BY_AUTHOR, CHECKING, UNCHECKED, NOT_CHECKABLE }
@Serializable enum class MeterCategory {
    @SerialName("supported") SUPPORTED, @SerialName("reviewed") REVIEWED, @SerialName("local") LOCAL,
    @SerialName("problems") PROBLEMS, @SerialName("to_review") TO_REVIEW, @SerialName("waiting") WAITING,
    @SerialName("unverifiable") UNVERIFIABLE, @SerialName("unchecked") UNCHECKED }
@Serializable enum class TransientReason { DEADLINE, TRUNCATED, BUSY, NETWORK, SLOT_LOST, OTHER }
@Serializable enum class OverrideBasis { REVIEW, PRINTED_SOURCE }
@Serializable enum class L0Error { PARSE_TIMEOUT }
@Serializable enum class Provenance { DETERMINISTIC, ON_DEVICE, CLOUD, PHYSICAL_SOURCE, AUTHOR, NONE }
@Serializable enum class Task { B1, B2, B3, B5, O2 }
@Serializable enum class Authority { @SerialName("authoritative") AUTHORITATIVE, @SerialName("advisory") ADVISORY }
@Serializable enum class Path { A, B }
@Serializable enum class PrivacyMode { CONFIDENTIAL, STANDARD }
@Serializable enum class Adjudicator { l2Adjudicate, l2AdjudicateProvided }
@Serializable enum class MetricClass {
    @SerialName("sample_size") SAMPLE_SIZE, @SerialName("percentage") PERCENTAGE, @SerialName("effect_size") EFFECT_SIZE,
    @SerialName("p_value") P_VALUE, @SerialName("duration") DURATION, @SerialName("dose") DOSE,
    @SerialName("concentration") CONCENTRATION, @SerialName("currency") CURRENCY, @SerialName("count") COUNT,
    @SerialName("ratio") RATIO, @SerialName("other") OTHER }
@Serializable enum class TupleSource {
    @SerialName("manuscript") MANUSCRIPT, @SerialName("lab_note") LAB_NOTE, @SerialName("print_page") PRINT_PAGE }
@Serializable enum class PComparator {
    @SerialName("<") LT, @SerialName("<=") LE, @SerialName("=") EQ, @SerialName(">") GT, @SerialName(">=") GE }

// ───────────────────────── Text and quantities ─────────────────────────
/** UTF-16 code-unit offsets, end exclusive (Kotlin String indices are UTF-16 code units). */
@Serializable data class TextRange(val start: Int, val end: Int)

@Serializable data class QuantTuple(
    val tupleId: String, val valueRaw: String, val unitRaw: String, val metricClass: MetricClass,
    val pComparator: PComparator?, val valueNorm: Double?, val valueLo: Double?, val valueHi: Double?,
    val sigDigits: Int, val unitCanon: String, val keyLemmas: List<String>, val section: String,
    val source: TupleSource, val span: TextRange)

// ───────────────────────── Results ─────────────────────────
@Serializable data class EvidenceAnchor(
    val refId: String, val sourceKind: EvidenceSourceKind, val chunkId: String, val evidenceIdx: Int,
    val snapped: TextRange, val snippet: String)

@Serializable data class LocalResult(
    val resultKey: String, val verdict: LocalVerdict, val rawVerdict: LocalVerdict, val anchor: EvidenceAnchor?,
    val anchorFailReason: AnchorFailReason?, val microReasoning: String, val inferenceSource: InferenceSourceTag,
    val modelProfile: String, val schemaId: String, val reasoningCap: Int, val promptVersion: String,
    val decidedAt: Long)

@Serializable data class Atom(val start: Int, val end: Int, val claimType: ClaimType)

@Serializable data class Stage1Result(
    val resultKey: String, val atoms: List<Atom>, val worth: Worth, val claimType: ClaimType, val uncited: Boolean,
    val modelProfile: String, val schemaId: String, val promptVersion: String, val decidedAt: Long)

@Serializable data class BaselineTriage(
    val atoms: List<Atom>, val worth: Worth, val claimType: ClaimType, val uncited: Boolean)

@Serializable data class CloudResult(
    val resultKey: String, val normalizedClaimHash: String, val refId: String, val verdict: CloudVerdict,
    val quote: String?, val quoteAnchor: EvidenceAnchor?, val approvedTextSha256: String,
    val alternativesDois: List<String>, val noDifferenceNote: Boolean, val adjudicator: Adjudicator,
    val inferenceSource: InferenceSourceTag, val promptVersion: String, val decidedAt: Long)

@Serializable data class PhysicalSource(
    val captureId: String, val photoSha256: String, val kind: PhysicalKind, val linkedRefId: String?,
    val pageLabel: String, val rowCropSha256: String?, val confirmedByAuthorAt: Long?,
    val entailmentConfirmedByAuthorAt: Long?)

@Serializable data class PhysicalResult(
    val resultKey: String, val normalizedClaimHash: String, val refId: String?, val verdict: PhysicalVerdict,
    val capture: PhysicalSource, val inferenceSource: InferenceSourceTag, val decidedAt: Long)

// ───────────────────────── Facts ─────────────────────────
@Serializable data class RefFacts(
    val refId: String, val bibStatus: BibStatus, val retracted: Boolean, val checkMetadata: Boolean,
    val evidenceVersion: String, val hasEvidence: Boolean, val updatedSeq: Long)

@Serializable data class Selection(
    val evidenceVersion: String, val candidates: Int, val suspicious: Boolean, val seq: Long)

@Serializable data class ClauseRef(
    val refId: String, val selection: Selection?, val local: LocalResult?, val cloud: CloudResult?,
    val physical: PhysicalResult?)

@Serializable data class Versioned<T>(val value: T, val seq: Long)

@Serializable data class AuthorOverride(
    val dismissedState: ClauseState, val basis: OverrideBasis, val captureId: String?,
    val normalizedClaimHash: String, val refIdsKey: String, val note: String, val createdAt: Long)

@Serializable data class HeldNei(val since: Long)
@Serializable data class LabNoteFlag(val pageLabel: String, val confirmedByAuthorAt: Long)
@Serializable data class LabNoteMismatchItem(val captureId: String, val flag: Versioned<LabNoteFlag?>)
@Serializable data class B5Flags(val inconsistentWith: List<String> = emptyList())

@Serializable data class ClaimLedgerEntry(
    val claimId: String, val docId: String, val sentenceHash: String, val occurrenceIndex: Int, val clauseIndex: Int,
    val section: String, val subsection: String?, val span: TextRange, val claimText: String,
    val normalizedClaimHash: String, val baseline: BaselineTriage, val stage1: Stage1Result?,
    val citationKeys: List<String>, val possibleCitations: List<TextRange>, val refs: List<ClauseRef>,
    val heldNei: Versioned<HeldNei?>, val job: Versioned<Boolean>, val l0Error: L0Error?, val b5: B5Flags,
    val labNoteMismatch: List<LabNoteMismatchItem>, val suggestedRefIds: List<String>,
    val override: Versioned<AuthorOverride?>, val archived: Boolean, val updatedAt: Long)

// ───────────────────────── Policy and context ─────────────────────────
@Serializable data class CalibratedVariant(val schemaId: String, val reasoningCap: Int)

@Serializable data class ProfilePolicy(
    val path: Path, val authority: Map<Task, Authority>, val supportVerdicts: Authority,
    val calibratedVariant: CalibratedVariant)

@Serializable data class PolicySnapshot(
    val deviceProfile: String, val profiles: Map<String, ProfilePolicy>, val b4CountsAsReview: Boolean)

@Serializable data class PrivacyContext(
    val mode: PrivacyMode, val cloudAvailable: Boolean, val quotaExhausted: Boolean, val quotaResetAt: Long?)

@Serializable data class TransientEntry(val reason: TransientReason, val attempts: Int)

/** In-memory only; never serialized to Room. */
data class SessionFacts(val localUnavailable: Boolean, val transient: Map<String, TransientEntry>)

// ───────────────────────── Outputs ─────────────────────────
@Serializable data class EffectiveTriage(
    val atoms: List<Atom>, val worth: Worth, val claimType: ClaimType, val uncited: Boolean)

@Serializable data class RefStateEntry(val refId: String, val state: RefState)

@Serializable data class DerivedClause(
    val claimId: String, val triage: EffectiveTriage, val refStates: List<RefStateEntry>, val state: ClauseState,
    val category: MeterCategory?, val provenance: Provenance)

@Serializable data class CoverageMeter(
    val total: Int, val supported: Int, val reviewed: Int, val local: Int, val problems: Int,
    @SerialName("to_review") val toReview: Int, val waiting: Int, val unverifiable: Int, val unchecked: Int,
    val notYetChecked: Int, val notCheckable: Int, val numberMismatches: Int, val quotaExhausted: Boolean,
    val quotaResetAt: Long?, val byProvenance: Map<Provenance, Int>)

/** Signatures implemented in Reducer.kt (same package); semantics identical to derive()/category()/meter() in TS. */
interface LedgerReducer {
    fun derive(entry: ClaimLedgerEntry, refFacts: Map<String, RefFacts>, policy: PolicySnapshot,
               mode: PrivacyContext, session: SessionFacts): DerivedClause
    fun category(state: ClauseState, policy: PolicySnapshot, mode: PrivacyContext): MeterCategory?
    fun meter(entries: List<ClaimLedgerEntry>, refFacts: Map<String, RefFacts>, policy: PolicySnapshot,
              mode: PrivacyContext, session: SessionFacts): CoverageMeter
}
```

Kotlin notes:
- `Map<Task, Authority>` MUST contain all five keys. A missing key is treated as `ADVISORY`.
- `CoverageMeter.toReview` is the only Kotlin property whose name differs from TypeScript (`to_review`), because of Kotlin naming rules. Its serialized name is `"to_review"`. The mirror check compares serialized names.
- `SessionFacts` has no `@Serializable` annotation, so it can never be written to Room by accident.

### 2.3 Swift — `apps/ios/ToulminCore/Ledger.swift` (thin-client subset)

The iOS Thin Client holds no ledger. It uses only the types needed for one "Check this claim" result. It implements the `norm`, `segment`, `anchor` and `reducer` conformance subsets; the reducer subset covers only the mapping from a single `ThinCheckResult` to its display.

```swift
// apps/ios/ToulminCore/Ledger.swift — thin-client subset of packages/core-l0/src/ledger.ts
import Foundation

enum LocalVerdict: String, Codable { case SUPPORTED, CONTRADICTS, NEI_SILENT_ESCALATE }
enum InferenceSourceTag: String, Codable { case ON_DEVICE, IN_CLOUD, NONE }
enum AnchorFailReason: String, Codable {
  case IDX_OUT_OF_BOUNDS, EMPTY_SPAN, FRAGMENT_TOO_SHORT, CONTAINMENT_BELOW_THRESHOLD,
       WINDOW_TOO_WIDE, FRAGMENT_ORDER_VIOLATION, NUMERIC_PARITY, NEGATION_PARITY, DIRECTION_PARITY,
       CLAIM_SPAN_MISMATCH, LOW_CLAIM_OVERLAP, REASONING_VERDICT_CONFLICT, UNCALIBRATED_VARIANT,
       NO_DIFFERENCE_SIGNAL
}

/// UTF-16 code-unit offsets, end exclusive. Conversions MUST go through String.utf16
/// (never Character or unicodeScalars counts).
struct TextRange: Codable, Hashable { var start: Int; var end: Int }

/// Anchor into the user-supplied evidence text of one check.
struct EvidenceAnchor: Codable, Hashable {
  var evidenceIdx: Int
  var snapped: TextRange
  var snippet: String
}

/// One completed check of the "Check this claim" flow. Stored with SwiftData, excluded from backups (D-10).
struct ThinCheckResult: Codable, Identifiable {
  var id: UUID
  var claimText: String
  var verdict: LocalVerdict          // after anchor validation
  var rawVerdict: LocalVerdict       // as decoded
  var anchor: EvidenceAnchor?
  var anchorFailReason: AnchorFailReason?
  var microReasoning: String         // ≤ 280 chars
  var inferenceSource: InferenceSourceTag
  var modelVersion: String           // rawResponse.modelVersion, recorded verbatim
  var decidedAt: Int64               // epoch ms
}
```

---

## 3. Identity Hashing, `normalizedClaim`, Result Cache & Transient Outcomes

### 3.1 Document and clause identity

| Identifier | Definition |
|---|---|
| `docId` | Random **UUID v4** created when a document is created or imported. Never derived from a file name or title. A re-import of the same project keeps the `docId` of the audit copy it refreshes. |
| `sentenceHash` | `sha256hex(normSentence(s))`. `normSentence(s)` = `normLower(s)` [02 › `norm(x) → { text, map }`] with masked regions deleted **except** normalized math tokens [02 › Format-scoped pre-masking], every citation marker substituted by the token `⟦c⟧`, and runs of whitespace collapsed to one U+0020 space, then trimmed. |
| `occurrenceIndex` | The number of earlier sentences in document order with the same `sentenceHash`. It keeps identical boilerplate sentences from colliding. |
| `claimId` | `sha256hex(docId + "\|" + sentenceHash + "\|" + occurrenceIndex + "\|" + clauseIndex)`, first 32 hex characters. Numbers are written in base-10 ASCII without padding. |
| `tupleId` | `sha256hex(docId + "\|" + sentenceHash + "\|" + occurrenceIndex + "\|" + tupleOrdinal + "\|" + metricClass + "\|" + valueRaw)`, first 32 hex characters. |

### 3.2 `normalizedClaim`, `normalizedClaimHash` and `evidenceVersion`

**`normalizedClaim(t)`** is defined over **tokens**, never over raw punctuation. Steps, in order:

1. **Canonical values.** Run the value parser [02 › Value Grammar, Units & Metric Classes] over `t`. Replace every recognized number by the token `⟨v:` + canonical value + canonical unit + `⟩`. A recognized number includes its sign, decimal point or decimal comma, thousands separators, exponent and an attached `%`.
   - The canonical value is the shortest round-trip decimal string of the parsed IEEE-754 double. A negative value keeps its `-` sign (U+2212 MINUS SIGN is parsed as a sign). The decimal separator is always `.`, and there is never a leading `+`.
   - The canonical unit is the unit table's canonical spelling, or nothing when there is no unit. `%` is a unit.
   - Examples:

     | Source text | Token |
     |---|---|
     | `.5%` | `⟨v:0.5%⟩` |
     | `5%` | `⟨v:5%⟩` |
     | `1,5 mg` (decimal-comma document) | `⟨v:1.5mg⟩` |
     | `15 mg` | `⟨v:15mg⟩` |
     | `−5 °C` | `⟨v:-5°C⟩` |
     | `5 °C` | `⟨v:5°C⟩` |
     | `2.50` | `⟨v:2.5⟩` |
     | `1e-3` | `⟨v:0.001⟩` |

   - Consequently `.5%` ≠ `5%` and `-5` ≠ `5`, while `2.50` = `2.5`.
2. **Lowercase the rest.** Apply `normLower` to the remaining text.
3. **Keep comparators.** The comparators `<`, `≤`, `>`, `≥`, `=` and `±` are kept as separate tokens. `<=` and `>=` are folded to `≤` and `≥`.
4. **Delete punctuation.** Delete every other character of Unicode general category P (punctuation). The `⟨v:…⟩` tokens are atomic and are never altered by this step.
5. **Whitespace.** Collapse whitespace runs to one U+0020 space and trim.

Golden cases are in `conformance/l0/claimhash.json`. They MUST include the pairs `.5%`/`5%`, `-5`/`5`, `2.50`/`2.5` and `1,5`/`15`, a comma-only edit, and a quote-style-only edit.

**`normalizedClaimHash`** = `sha256hex(normalizedClaim(claimText))`. It is used by overrides, by `resultKey` and by the materialization of cloud and physical results.

**`evidenceVersion`** = `sha256hex(join("|", sort(chunkIds)))`. `chunkIds` are the IDs of all evidence units available **for that reference** on this device; `sort` is lexicographic by UTF-8 bytes.
- This is the only definition.
- A new abstract, full text, user PDF or physical source **for that reference** changes it.
- Corpus-wide statistics (BM25 IDF and `avgdl`) are **excluded**. Adding or deleting another reference never invalidates results for this one: ranking may change, but stored results remain valid for their own candidate set.
- A reference with no evidence units has `evidenceVersion = sha256hex("")` and `hasEvidence = false`.

### 3.3 `resultKey` forms

Every expensive result is content-addressed. All four forms are `sha256hex` of a `"|"`-joined string with a form prefix:

| Form | Definition |
|---|---|
| **Local** `L\|` | `sha256hex("L\|" + normalizedClaimHash + "\|" + refId + "\|" + evidenceVersion + "\|" + promptVersion + "\|" + modelProfile + "\|" + schemaId + "\|" + reasoningCap)` |
| **Cloud** `C\|` | `sha256hex("C\|" + normalizedClaimHash + "\|" + approvedTextSha256 + "\|" + refId + "\|" + promptVersion + "\|" + adjudicator)`. `approvedTextSha256` = `sha256hex(exact text sent)`. `adjudicator` ∈ {`l2Adjudicate`, `l2AdjudicateProvided`} |
| **Physical** `P\|` | `sha256hex("P\|" + normalizedClaimHash + "\|" + (refId ?? "LAB") + "\|" + photoSha256)` |
| **Stage 1** `S1\|` | `sha256hex("S1\|" + sentenceHash + "\|" + promptVersion + "\|" + modelProfile + "\|" + schemaId)` |

**Expected keys.** Materialization (§4.3) looks results up through expected keys, computed from the current facts:

- **`expectedLocalKeys(e, r, p, promptVersion)`** is the set of local keys formed with:
  - `e.normalizedClaimHash` and `r.refId`;
  - `refFacts[r.refId].evidenceVersion`;
  - the active prompt version `promptVersion` (Remote Config `prompt_version`, verified by the prompt hash check [04 › General rules]);
  - the active profile `p = policy.deviceProfile`;
  - each `{ schemaId, reasoningCap }` of `p`'s **variant ladder**: the calibrated variant, `VerdictV1_cap20` with cap 20, and `VerdictFlatV1` with the calibrated cap [04 › Token and output budgets].
- **`expectedStage1Key(e, p, promptVersion)`** is the Stage 1 key with `e.sentenceHash`, `promptVersion`, `p` and `schemaId = "TriageV1"`. A `TriageFlatV1` result is cached but never materialized into `entry.stage1`; it is a suggestion only.
- **Cloud and physical results** are not looked up by a precomputed key, because their keys contain values chosen at send or capture time (`approvedTextSha256`, `photoSha256`). They are found through the results-table index `(kind, normalizedClaimHash, refId)` (§3.4).

### 3.4 Persisted result cache

Every `LocalResult`, `CloudResult`, `PhysicalResult` and `Stage1Result` is stored in the persisted **`results`** table, keyed by `resultKey`:
- Web: Dexie store `results`, primary key `resultKey`, compound index `[kind+normalizedClaimHash+refId]`;
- Android: Room table `results` with the same primary key and index.

`kind` ∈ {`L`, `C`, `P`, `S1`}. The table is grow-only: a row is never updated in place. Two rows can never share a key, because a later arrival with the same key is resolved by the result tie rule (§4.3) before it is written.

When a clause is created or re-created (E1), L0 computes its expected keys and the index lookups and materializes matching results (§4.3). Consequences:

1. **Trivial edits keep verdicts.** A punctuation, quote-style or spacing edit that does not touch a number keeps `normalizedClaimHash`. All verdicts therefore survive, including paid cloud verdicts.
2. **Numeric edits drop verdicts.** Any change to a number's value, sign, decimal position or unit changes the hash, so no verdict and no override survives a numeric change.
3. **Re-import restores verdicts.** Re-importing the same manuscript, or a project of another multi-file kind with the same clauses, restores every verdict whose keys still match. Clauses whose `normalizedClaimHash` changed are queued first.
4. **Temporary masking.** While the author types an unclosed math or code delimiter, the affected entries are archived (E9). Closing the delimiter re-creates them (E1) and restores their results from the cache.
5. **Deletion.** "Delete local data" deletes the `results` table together with the ledger, `refFacts` and the evidence cache [06 › Lifecycle and storage].

### 3.5 Session cache for transient outcomes (normative)

An L1 job that ends with a `TransientReason` produces **no** `LocalResult`, **no** `Stage1Result` and **no** row in `results`. Transient reasons are: `DEADLINE`, `TRUNCATED` after its strategy is exhausted, `BUSY`, `NETWORK`, `SLOT_LOST` and `OTHER`.

1. **Never persisted.** A transient outcome NEVER writes to the persisted `results` table, to `refFacts`, to any ledger entry, to Dexie, to Room or to Remote Config.
2. **Session memory only.** It is recorded only in `SessionFacts.transient`, an in-memory map keyed by `claimId + "|" + refId` with value `{ reason, attempts }`. `attempts` counts every attempt of the job in this session, the first one included. The map is discarded when the tab or the app process ends.
3. **Never deduplicates.** A transient outcome NEVER satisfies deduplication [04 › Queue semantics]. A job whose last outcome was transient is eligible again.
4. **Retry limit.** The job is retried up to **2 times per session**, so there are **3 attempts in total**. After the third transient attempt (`attempts ≥ 3`), the pair is handled by rule R12 (§4.6) and is never stuck in `UNCHECKED`.
5. **Late outputs.** An output that arrives after its deadline is validated and cached under its own `resultKey` (`putLate` [04 › Queue semantics]). It is matched by `resultKey`, never by job identity, and then materializes normally.
6. **No restoration.** `SessionFacts` are never restored from persistent storage and never shared between tabs or processes.

### 3.6 Per-pair selection validity

`ClauseRef.selection` is a fact about the **(clause, reference) pair**. `RefFacts.hasEvidence` is a fact about the **reference**.

The reducer reads a selection **only while `selection.evidenceVersion === refFacts[refId].evidenceVersion`**. Otherwise it treats the selection as absent (`sel = null`). A selection computed for older evidence can therefore never be applied to newer evidence, whatever the arrival order. A stale selection is not deleted: it is superseded by the next `SelectionComputed` with a larger `seq` (E6b).

---

## 4. Pure Commutative Ledger Reducer (`derive`)

### 4.1 Signature, inputs and helpers

```ts
derive(entry: ClaimLedgerEntry, refFacts: ReadonlyMap<string, RefFacts>, policy: PolicySnapshot,
       mode: PrivacyContext, session: SessionFacts): DerivedClause
```

`derive` reads only its arguments, performs no I/O, reads no clock and has no side effects. Events change facts; `derive` maps facts to display. The input types `ProfilePolicy`, `PolicySnapshot`, `PrivacyContext` and `SessionFacts` are defined in §2.1.

**Input semantics.**
- `refFacts` is the document-level table of reference facts, keyed by `refId`. Ledger entries never contain copies of these facts.
- `policy.deviceProfile` is this device's active `modelProfile`: `web_chrome_nano` or `no_local_model` on Web; `android_aicore_stable` or `android_aicore_preview` on Android.
- `policy.profiles` holds every profile of `routing_table`.
- `policyOf(p)` = `policy.profiles[p]` if present; otherwise the **conservative profile** `{ path: "B", authority: every task "advisory", supportVerdicts: "advisory", calibratedVariant: { schemaId: "", reasoningCap: 0 } }`.
- **`mode.cloudAvailable`** = `mode.mode = "STANDARD"` ∧ ¬`kill_switch_cloud` ∧ network online ∧ the cloud stack (App Check and anonymous Authentication) can initialize in this browser. It is **strictly independent of quota**. Quota exhaustion is the separate fact `mode.quotaExhausted`: it changes only drawer copy and whether the send action is enabled (§5.4), and it never moves a clause between categories.
- **Android `bundledSample`.** The build makes no network calls, so its `PrivacyContext` is the constant `{ mode: "CONFIDENTIAL", cloudAvailable: false, quotaExhausted: false, quotaResetAt: null }`.
- **`session.localUnavailable`** is true when no on-device stage can run for this document in this session:
  - (a) the settle ceiling expired (`LOCAL_LOST`) [04 › Queue semantics]; or
  - (b) `policy.deviceProfile = "no_local_model"` and consent class A has not been given for this document; or
  - (c) the session switched to no-local-model handling after three `LOCAL_STALLED` episodes within 10 minutes.
- **`session.transient`** is the session cache of §3.5.

**Helpers** (used in §4.6–§4.7):

| Helper | Definition |
|---|---|
| `f` | `refFacts.get(r.refId)`; if absent, `{ refId: r.refId, bibStatus: "PENDING", retracted: false, checkMetadata: false, evidenceVersion: sha256hex(""), hasEvidence: false, updatedSeq: 0 }` |
| `sel` | `r.selection` if `r.selection ≠ null` ∧ `r.selection.evidenceVersion = f.evidenceVersion`; otherwise `null` |
| `l` | `r.local` |
| `pl` | `policyOf(l.modelProfile)` when `l ≠ null` |
| `calibrated(l)` | `l.schemaId = pl.calibratedVariant.schemaId` ∧ `l.reasoningCap = pl.calibratedVariant.reasoningCap` |
| `pd` | `policyOf(policy.deviceProfile)` |
| `ph` | `r.physical` |
| `valuesOk(ph)` | `ph ≠ null` ∧ `ph.capture.kind ∈ {PHYSICAL_TABLE, PHYSICAL_TEXT}` ∧ `ph.capture.confirmedByAuthorAt ≠ null` |
| `entailOk(ph)` | `valuesOk(ph)` ∧ `ph.capture.entailmentConfirmedByAuthorAt ≠ null` |
| `tr` | `session.transient.get(e.claimId + "\|" + r.refId)` |
| `transientBib(f)` | `f.bibStatus ∈ {UPSTREAM_UNAVAILABLE, RATE_LIMITED}` |
| `t` | the effective triage (§4.2) |

### 4.2 Effective triage

The effective triage `t` is computed **inside `derive()`**, never when an event arrives. Let `pp = policyOf(e.stage1.modelProfile)` when `e.stage1 ≠ null`.

| Field | Value |
|---|---|
| `t.atoms` | `e.stage1.atoms` if `e.stage1 ≠ null` ∧ `pp.authority.B1 = "authoritative"`; otherwise `e.baseline.atoms` |
| `t.worth`, `t.claimType`, `t.uncited` | the Stage 1 values if `e.stage1 ≠ null` ∧ `pp.authority.B2 = "authoritative"`; otherwise the baseline values (B4 follows B2) |

Because authority is applied here, a Stage 1 result that arrives before or after a policy change gives the same output. **E4 (`Stage1ResultArrived`) therefore commutes with E15 (`PolicyChanged`).**

### 4.3 Three commutative fact classes and merge rules

Facts fall into exactly three classes. Their merge rules make every event commutative and idempotent.

| # | Fact class | Where stored | Merge rule |
|---|---|---|---|
| 1 | **Grow-only cached results** (`LocalResult`, `CloudResult`, `PhysicalResult`, `Stage1Result`) | The persisted `results` table, keyed by `resultKey` (§3.4) | Insert. Two results with the same `resultKey` resolve by the **result tie rule**: the larger `decidedAt` wins; if equal, the lexicographically larger `sha256hex(JCS(result))` wins. After every event the affected entries are **re-materialized** (below). |
| 2 | **Versioned set/clear facts** (`job`, `heldNei`, `override`, each `labNoteMismatch[i].flag`, `Selection`, `RefFacts`) | Entry fields of type `Versioned<T>`; `Selection.seq`; `RefFacts.updatedSeq` | Each emitter keeps a Lamport counter per `claimId` (per `refId` for `RefFacts`): `seq = max(seq seen) + 1`. An incoming value supersedes the stored one **iff** `incoming.seq > stored.seq`, or `incoming.seq = stored.seq` ∧ `sha256hex(JCS(incoming.value)) > sha256hex(JCS(stored.value))` (lexicographic). |
| 3 | **Monotone boolean facts** (`RefFacts.retracted = true` from a retraction snapshot; `ClaimLedgerEntry.archived = true`) | Boolean fields | Boolean OR. Once true, never false for that `claimId` or that `(docId, refId)`. |

`JCS` is the JSON Canonicalization Scheme of **RFC 8785**: object keys sorted by UTF-16 code units, no insignificant whitespace, ECMAScript number serialization, UTF-8 output. All tie rules are total orders, so every permutation yields the same value on every platform. Kotlin and Swift MUST use an RFC 8785 implementation verified by `conformance/l0/reducer.json`.

**Re-materialization** (a pure function of the facts and the current `PolicySnapshot`). For an entry `e`, with `p = policy.deviceProfile`:

| View | Value |
|---|---|
| `e.stage1` | the cached `Stage1Result` whose key equals `expectedStage1Key(e, p, promptVersion)`, or `null` |
| `r.local` (each `ClauseRef r`) | among cached `LocalResult`s whose key ∈ `expectedLocalKeys(e, r, p, promptVersion)`, the winner of the result tie rule; `null` if none. At most one local result per pair exists in the view, from the active profile only |
| `r.cloud` | among cached `CloudResult`s with `normalizedClaimHash = e.normalizedClaimHash` ∧ `refId = r.refId`, the winner of the result tie rule; `null` if none |
| `r.physical` | among cached `PhysicalResult`s with `normalizedClaimHash = e.normalizedClaimHash` ∧ `refId = r.refId` ∧ `capture.kind ≠ LAB_NOTE`, the winner of the result tie rule; `null` if none |

Arrival order therefore never matters. A result that arrives before the evidence change that makes its key current is applied as soon as that change arrives. Re-materialization runs after every event for the entries the event touches, and after E15 for every entry.

### 4.4 Event table

Events are numbered E1–E16 with no gaps. `SelectionComputed` is E6b, the companion of E6. Every event is idempotent: applying it twice equals applying it once.

| Event | Payload | Fact update |
|---|---|---|
| **E1** `ClauseCreated` | entry skeleton from the clause partitioner | Insert the entry by `claimId` if absent, with `baseline` = the baseline triage (a pure function of the clause, its sentence and its section label). If present, recompute `baseline` and keep every versioned fact with its `seq` and every monotone fact. E1 never resets `job`, `heldNei`, `override`, any `selection`, `labNoteMismatch`, `archived` or any `RefFacts`. `refs` holds one `ClauseRef` per mapped reference, sorted by `refId`. The persisted override stored under `(docId, normalizedClaimHash, refIdsKey)` [03 › Web (Dexie)] is versioned-merged into `override`, so an override survives a trivial edit that creates a new `claimId`. Re-materialize the entry. |
| **E2** `BibResolved` | `(refId, bibStatus, retracted, checkMetadata, seq)` | Versioned merge into `refFacts[refId]` (`updatedSeq`). `retracted = true` is additionally merged monotonically. Never touches ledger entries. |
| **E3** `RetractionSnapshot` | `(refIds)` | For each listed `refId`: `refFacts[refId].retracted = true` (monotone). |
| **E4** `Stage1ResultArrived` | `(result: Stage1Result)` | Insert into the cache; re-materialize `stage1` of every entry of that sentence. Authority is applied only in `derive()`. |
| **E5** `LocalResultArrived` | `(claimId, refId, result: LocalResult)` | Insert into the cache; re-materialize the entry. |
| **E6** `EvidenceChanged` | `(refId, evidenceVersion, hasEvidence, seq)` | Versioned merge into `refFacts[refId]`. Re-materialize every entry that maps `refId`: the expected local keys change and existing selections become stale. Enqueue selection, then Stage 2, for entries whose new expected keys have no cached result. |
| **E6b** `SelectionComputed` | `(claimId, refId, selection: Selection)` | Versioned merge into `ClauseRef.selection` by `selection.seq`. The reducer reads it only while its `evidenceVersion` equals `refFacts[refId].evidenceVersion` (§3.6). |
| **E7** `CloudResultArrived` | `(claimId, refId, result: CloudResult)` | Insert into the cache; re-materialize every entry with `normalizedClaimHash = result.normalizedClaimHash` that maps `refId`. |
| **E8** `PhysicalResultArrived` | `(claimId, result: PhysicalResult)` | Insert into the cache; re-materialize. A `LAB_NOTE` result never attaches to a reference; it can only lead to E16. |
| **E9** `ClauseEdited` | `(oldClaimIds, newSegmentation)` | Set `archived = true` on every old entry (monotone); emit E1 for each clause of the new segmentation. Results are restored by key (§3.4). |
| **E10** `JobState` | `(claimId, inFlight: boolean, seq)` | Versioned merge into `job`. |
| **E11** `HeldNei` | `(claimId, value: { since } \| null, seq)` | Versioned merge into `heldNei`. |
| **E12** `Override` | `(claimId, value: AuthorOverride \| null, seq)` | Versioned merge into `override`. `value = null` is "Undo review". |
| **E13** `B5Changed` | `(claimIds)` | Recompute `b5.inconsistentWith` for every listed entry from the B5 index [03 › Deterministic incremental pairing]. Both sides of a pair change in the same event. |
| **E14** `L0Timeout` | `(claimId)` | Set `l0Error = "PARSE_TIMEOUT"`. Cleared only by E1 of a re-created entry whose L0 job completed. |
| **E15** `PolicyChanged` | `(snapshot: PolicySnapshot)` | No fact change. Every entry is re-materialized with the new snapshot and re-derived. Hints disappear immediately when a profile changes to Path B or the probe reports drift. |
| **E16** `LabNoteMismatch` | `(claimId, captureId, value: LabNoteFlag \| null, seq)` | Versioned merge into the `labNoteMismatch` item with that `captureId` (inserted if absent; kept sorted by `captureId`). It sets a purple flag only, never a clause state. |

### 4.5 Determinism property (normative)

For any finite multiset of events whose versioned facts carry the `seq` values assigned when they were emitted, **every permutation of arrival** produces:
- identical facts: the results table, versioned facts and monotone facts;
- identical materialized views under the same final `PolicySnapshot`;
- identical `derive()` outputs under every `PolicySnapshot`, `PrivacyContext` and `SessionFacts`.

The property test `packages/core-l0/test/prop/reducer.prop.test.ts`:
- generates events with their emitted `seq` values and permutes only the arrival order;
- includes the permutations **E4 ↔ E15** (Stage 1 result vs policy change), **E6 ↔ E6b** (evidence change vs selection), **E5 ↔ E6**, **E12 ↔ E2** and **E9 ↔ E7** explicitly;
- runs at least 10,000 random cases per CI run with a logged seed.

The Kotlin port runs the same cases from `conformance/l0/reducer.json`.

### 4.6 Per-reference rules `R1`–`R14` (first matching rule wins)

Notation: `r` = the `ClauseRef`, `e` = the entry; helpers as in §4.1.

| # | Condition | `RefState` |
|---|---|---|
| **R1** | `f.bibStatus ∈ {DOI_NOT_FOUND, UNRESOLVED_KEY}` ∨ `f.retracted` | `REF_PROBLEM` |
| **R2** | `r.cloud?.verdict = CONTRADICTED` | `CONTRADICTED_CONFIRMED` |
| **R3** | `r.cloud?.verdict = PARTIAL` | `PARTIAL_CONFIRMED` |
| **R4** | `r.cloud?.verdict = SUPPORTED`, or (`ph?.verdict = SUPPORTED` ∧ `entailOk(ph)`) | `SUPPORTED_CONFIRMED` |
| **R5** | `r.cloud?.verdict = NEI` | `UNVERIFIABLE` |
| **R6** | `ph?.verdict = CONTRADICTS` ∧ `valuesOk(ph)` (author-confirmed printed-source difference) | `HINT` if `pd.path = "A"`; else `ALIGNED_ESCALATING` |
| **R7** | `sel?.suspicious = true` | `SOURCE_FLAGGED` |
| **R8** | `l?.verdict = CONTRADICTS` | `HINT` if `pl.path = "A"`; else `ALIGNED_ESCALATING` |
| **R9** | (`l?.verdict = SUPPORTED` ∧ `calibrated(l)` ∧ `pl.supportVerdicts = "authoritative"`), or (`ph?.verdict = SUPPORTED` ∧ `valuesOk(ph)` ∧ ¬`entailOk(ph)` ∧ `pd.supportVerdicts = "authoritative"`) | `SUPPORTED_LOCAL` |
| **R10** | (`l?.verdict = SUPPORTED`), or (`ph?.verdict = SUPPORTED` ∧ `valuesOk(ph)` ∧ ¬`entailOk(ph)`) — i.e. the support condition of R9 failed on calibration or authority | `WAITING` if `mode.cloudAvailable`; else `EVIDENCE_FOUND_LOCAL` |
| **R11** | `e.job.value = true` ∨ `e.heldNei.value ≠ null` | `CHECKING` |
| **R12** | any of: (a) `l?.verdict = NEI_SILENT_ESCALATE`; (b) `ph?.verdict = NEI` ∧ `valuesOk(ph)`; (c) `f.bibStatus ∈ {UPSTREAM_UNAVAILABLE, RATE_LIMITED, NOT_INDEXED, AMBIGUOUS}`; (d) `f.bibStatus = RESOLVED` ∧ (¬`f.hasEvidence` ∨ `sel?.candidates === 0`); (e) `l = null` ∧ (`session.localUnavailable` ∨ `tr?.attempts ≥ 3`) | `UNVERIFIABLE` if `f.bibStatus = AMBIGUOUS`; else `WAITING` if `mode.cloudAvailable`; else `UNVERIFIABLE` |
| **R13** | `f.bibStatus = PENDING` ∧ `l = null` ∧ `r.cloud = null` ∧ `ph = null` | `UNCHECKED` |
| **R14** | otherwise | `UNCHECKED` |

Notes (normative):
1. **Results stay visible during a job.** R11 is placed below R2–R10, so an existing result stays visible while a new job runs. The UI shows the separate "Checking…" badge from `e.job` (§1.3).
2. **`ALIGNED_ESCALATING` aggregation.** It counts as `WAITING` when `mode.cloudAvailable`, and as `UNVERIFIABLE` otherwise (no accusation and no cloud).
3. **Metadata problems never change `RefState`.** `METADATA_MISMATCH` only sets `f.checkMetadata = true`. `NOT_INDEXED` and `AMBIGUOUS` also show the grey "Check this citation" chip (§1.3).
4. **Uncalibrated variants.** A local result produced by a schema variant other than its profile's calibrated `{ schemaId, reasoningCap }`:
   - is converted at validation time to `NEI_SILENT_ESCALATE` with `anchorFailReason = UNCALIBRATED_VARIANT` if it was `CONTRADICTS`, so it can never reach R8 [03 › Post-Decode Evidence Anchor Validator (L1 & L2)];
   - if it was `SUPPORTED`, fails `calibrated(l)` and can reach only R10.
5. **No matching passage.** `sel?.candidates === 0` means BM25 selection kept no evidence unit for this clause, although the reference has evidence. Stage 2 is not run for that pair. The inspector shows "No passage of this source matches the claim".
6. **Local stage unavailable.** When `session.localUnavailable` holds because of (a), the inspector shows "On-device model stopped responding — reload to retry" on every pair without a local result. After three transient attempts it shows "On-device check didn't finish".
7. **No clause is stuck in `UNCHECKED`.** R12 (d) and (e) guarantee this: a pair without a local result leaves `UNCHECKED` as soon as selection finds no candidate, the local stage is unavailable, or three attempts have failed.
8. **No confirmed contradiction from physical sources.** No rule produces `CONTRADICTED_CONFIRMED` from a physical or lab-note result (D-29).
9. **Ambiguous references.** An `AMBIGUOUS` reference never waits for the cloud, because a cloud check of an unidentified reference cannot be anchored. Its primary action is "Choose the reference" (§5.4).

### 4.7 Clause rules `C0`–`C16` (first matching rule wins)

Let `S` be the multiset of `RefState` over `e.refs`, and `n = |e.refs|`. Only references of resolved markers count; possible citations are not counted.

**State families.** `family(s)` = `"unresolved"` if `s ∈ {WAITING, UNVERIFIABLE, SOURCE_FLAGGED, MIXED_SUPPORT}`; otherwise `s` itself.

**Without override.** `deriveWithoutOverride(e)` = the state given by rules C2–C16 (C0 is evaluated first in every case and has already been excluded).

| # | Condition | `ClauseState` |
|---|---|---|
| **C0** | `n = 0` ∧ ¬`t.uncited` | `NOT_CHECKABLE` (a sentence without a resolved citation that the triage did not flag) |
| **C1** | `e.override.value ≠ null` ∧ `e.override.value.normalizedClaimHash = e.normalizedClaimHash` ∧ `e.override.value.refIdsKey = join("\|", sorted refIds of e.refs)` ∧ `family(deriveWithoutOverride(e)) = family(e.override.value.dismissedState)` | `REVIEWED_BY_AUTHOR` |
| **C2** | `REF_PROBLEM ∈ S` | `REFERENCE_PROBLEM` |
| **C3** | `CONTRADICTED_CONFIRMED ∈ S` | `CONTRADICTED` |
| **C4** | `HINT ∈ S` | `HINT` |
| **C4b** | `n ≥ 1` ∧ `t.claimType = METHODOLOGICAL` ∧ `S ∩ {SUPPORTED_CONFIRMED, SUPPORTED_LOCAL, PARTIAL_CONFIRMED} = ∅` ∧ `e.heldNei.value = null` | `NOT_CHECKABLE`. Applies strictly to `METHODOLOGICAL` clauses: a cited method statement such as "We followed the protocol of [3]" is not a claim to verify; it is counted in the drill-down line "Not checkable". No other claim type ever reaches `NOT_CHECKABLE` through this rule. |
| **C5** | `n = 0` ∧ `t.uncited` | `UNCITED_EMPIRICAL` |
| **C6** | `PARTIAL_CONFIRMED ∈ S` | `PARTLY_SUPPORTED` |
| **C7** | `n ≥ 2` ∧ (`SUPPORTED_CONFIRMED ∈ S` ∨ `SUPPORTED_LOCAL ∈ S`) ∧ (`UNVERIFIABLE ∈ S` ∨ (`ALIGNED_ESCALATING ∈ S` ∧ ¬`mode.cloudAvailable`)) | `MIXED_SUPPORT` |
| **C8** | `e.l0Error = PARSE_TIMEOUT` | `UNVERIFIABLE` |
| **C9** | `CHECKING ∈ S`, or (`UNCHECKED ∈ S` ∧ some element of `S` is not `UNCHECKED`) | `CHECKING` |
| **C10** | `WAITING ∈ S`, or (`ALIGNED_ESCALATING ∈ S` ∧ `mode.cloudAvailable`) | `WAITING` |
| **C11** | `SOURCE_FLAGGED ∈ S` | `SOURCE_FLAGGED` |
| **C12** | (`UNVERIFIABLE ∈ S` ∨ (`ALIGNED_ESCALATING ∈ S` ∧ ¬`mode.cloudAvailable`)) ∧ no element of `S` is `SUPPORTED_CONFIRMED` or `SUPPORTED_LOCAL` | `UNVERIFIABLE` |
| **C13** | `n ≥ 1` ∧ every element of `S` is `SUPPORTED_CONFIRMED` | `SUPPORTED` |
| **C14** | `n ≥ 1` ∧ every element of `S` ∈ {`SUPPORTED_CONFIRMED`, `SUPPORTED_LOCAL`} | `SUPPORTED_LOCAL` |
| **C14b** | `n ≥ 1` ∧ every element of `S` ∈ {`SUPPORTED_CONFIRMED`, `SUPPORTED_LOCAL`, `EVIDENCE_FOUND_LOCAL`} ∧ `EVIDENCE_FOUND_LOCAL ∈ S` | `LOCAL_EVIDENCE` |
| **C15** | some mapped reference has `f.checkMetadata = true` | `CHECK_METADATA` |
| **C16** | otherwise | `UNCHECKED` |

**Override family rule (C1).** C1 compares state **families**. An override made while a clause was `WAITING` therefore still holds when the same clause later becomes `UNVERIFIABLE`, `SOURCE_FLAGGED` or `MIXED_SUPPORT`, and vice versa. This covers the cases where:
- the user's cloud quota is exhausted;
- the network drops;
- Confidential mode is switched on;
- the kill switch is set.

Any change outside the family re-opens the clause: a new contradiction, a new reference problem, a new support, or a numeric edit (which changes `normalizedClaimHash`). An override made over `REFERENCE_PROBLEM` or `CONTRADICTED` yields `REVIEWED_BY_AUTHOR`, which is never counted as supported (§5).

**Printed-source overrides.** An override with `basis = PRINTED_SOURCE` is created on the Pocket Ledger when the author taps "This row supports my claim" on a row whose `PhysicalResult.verdict ≠ SUPPORTED`. Its `dismissedState` is the clause state at the time of the tap, and `captureId` names the capture. The result is grey "reviewed", never green.

### 4.8 Precedence rules, "No dead drawers" invariant and provenance

**Precedence rules (normative).**
1. A deterministic `REFERENCE_PROBLEM` can be cleared only by correcting or substituting the reference (which changes `refFacts`), or by an explicit author override ("Reviewed — cited intentionally"). No L1, L2, physical or lab-note result can clear it.
2. A cloud verdict (R2–R5) takes precedence over every on-device or physical result for the same pair, except that R4 also accepts a fully confirmed printed source.
3. Lab notes never produce `CONTRADICTED`, `HINT` or red. A confirmed lab-note difference is the purple flag "≠ lab note" only (§1.3).
4. Per-reference states are always listed in the claim inspector, so one supporting reference never hides another reference's problem.

**"No dead drawers" invariant (normative property).**
- A clause is in `WAITING` only if `mode.cloudAvailable` is true.
- For every clause that a drawer lists, the drawer offers either an available primary action **or** a stated time at which the action becomes available ("No cloud checks left today — resets at {local time}").
- The property test generates random facts and contexts and asserts both statements for every drawer of §5.4.

**Provenance derivation.**

| Deciding rule | `Provenance` |
|---|---|
| C1 | `AUTHOR` |
| C2, C8, C15; C5 when `t.uncited` came from the baseline | `DETERMINISTIC` |
| C3, C6; C13 when every deciding `SUPPORTED_CONFIRMED` came from `r.cloud`; C10/C12 when the deciding pair state came from R5 | `CLOUD` |
| C13 when at least one deciding `SUPPORTED_CONFIRMED` came from `r.physical`; C4 when the deciding `HINT` came from R6 | `PHYSICAL_SOURCE` |
| C4 when the deciding `HINT` came from R8; C14, C14b; C5 when `t.uncited` came from Stage 1; C10/C12 when the deciding pair state came from R10 or R12 (a) | `ON_DEVICE` |
| C0, C4b, C7, C9, C11, C16 and every remaining case | `NONE` |

The **deciding pair state** is the first reference in `refId` order whose state satisfied the clause rule.

---

## 5. 8-Bucket Coverage Meter & Drawers

### 5.1 Exact partition

Let `E` be the non-archived entries of the active document whose derived state is not `NOT_CHECKABLE`.

```
category(state) =
  supported     if state = SUPPORTED
  reviewed      if state = REVIEWED_BY_AUTHOR
  local         if state ∈ {SUPPORTED_LOCAL, LOCAL_EVIDENCE}
  problems      if state ∈ {REFERENCE_PROBLEM, CONTRADICTED}
  to_review     if state ∈ {HINT, PARTLY_SUPPORTED, CHECK_METADATA},
                or state = UNCITED_EMPIRICAL ∧ policy.b4CountsAsReview
  waiting       if state = WAITING,
                or state = SOURCE_FLAGGED ∧ mode.mode = STANDARD
  unverifiable  if state ∈ {UNVERIFIABLE, MIXED_SUPPORT},
                or state = SOURCE_FLAGGED ∧ mode.mode = CONFIDENTIAL
  unchecked     if state ∈ {UNCHECKED, CHECKING},
                or state = UNCITED_EMPIRICAL ∧ ¬policy.b4CountsAsReview
  null          if state = NOT_CHECKABLE

total      = |E|
k(c)       = |{ e ∈ E : category(derive(e).state) = c }|   for each of the eight categories c

invariant  : k(supported) + k(reviewed) + k(local) + k(problems) + k(to_review)
             + k(waiting) + k(unverifiable) + k(unchecked) = total

notYetChecked    = k(local) + k(unchecked)          (never includes k(reviewed))
notCheckable     = |{ non-archived entries whose derived state is NOT_CHECKABLE }|   (drill-down only; not in total)
numberMismatches = |{ e ∈ E : e.b5.inconsistentWith ≠ [] ∨ ∃i: e.labNoteMismatch[i].flag.value ≠ null }|
                   (drill-down only; not a bucket)
byProvenance[p]  = |{ e ∈ E : category(derive(e).state) ≠ unchecked ∧ derive(e).provenance = p }|
                   for p ∈ {DETERMINISTIC, ON_DEVICE, CLOUD, PHYSICAL_SOURCE, AUTHOR}
```

The invariant MUST hold after every reducer run; a violation is a test failure (`conformance/l0/meter.json`, property test).

**Reviewed is never "not yet checked".** `notYetChecked` excludes `reviewed`. Marking a claim reviewed moves it into `reviewed`: `k(reviewed)` increases by one, and `notYetChecked` never increases. "Undo review" reverses the move exactly.

**`b4CountsAsReview`.** `policy.b4CountsAsReview` mirrors Remote Config `b4_counts_in_review` (default `true`). `publish_routing.ts` sets it to `false` if the measured precision of the uncited-empirical flag on MS-B123 is below 0.60 [07 › B2: Check-worthiness]. The flag is measured with the deterministic baseline, or with Stage 1 when B2 is authoritative. When it is `false`, the blue chip "Uncited empirical claim" is still shown, but the clause counts in `unchecked` (inside "not yet checked"), so an unmeasured heuristic never inflates "to review".

### 5.2 Header (exact format)

The header shows **seven counts** that always sum exactly to `total`:

`"{supported} supported · {reviewed} reviewed · {problems} problems · {to_review} to review · {waiting} waiting · {unverifiable} can't verify · {notYetChecked} not yet checked — of {total} claims"`

- `{supported}` = `k(supported)`, `{reviewed}` = `k(reviewed)`, `{problems}` = `k(problems)`, `{to_review}` = `k(to_review)`, `{waiting}` = `k(waiting)`, `{unverifiable}` = `k(unverifiable)`, `{notYetChecked}` = `k(local) + k(unchecked)`.
- `supported + reviewed + problems + to_review + waiting + unverifiable + notYetChecked = total` holds by the partition invariant.
- **Only cloud-confirmed and printed-source-confirmed clauses count as supported.** On-device results are counted in "not yet checked" and itemized in the drill-down, so they are never presented as supported. Author reviews have their own count. No clause disappears from the header.
- While `mode.quotaExhausted`, the header appends `" · cloud checks resume at {local time}"`, where `{local time}` is `mode.quotaResetAt` formatted in the user's locale and time zone (hours and minutes).
- Numbers are rendered as integers without grouping separators below 10,000, and with the locale's grouping separator otherwise.
- In the `bundledSample` build the `{waiting}` segment is always `0` and is still shown, so the format is identical on every client.

### 5.3 Drill-down

Clicking the header (or pressing Enter on it) opens the drill-down. It lists:

1. The eight category counts, in this order and with these labels:
   - "Supported (checked in the cloud or confirmed from a printed source)"
   - "Reviewed by you"
   - "Problems"
   - "To review"
   - "Waiting for cloud check"
   - "Can't verify"
   - "On this device" (`local`)
   - "Not checked yet" (`unchecked`)

   "On this device" and "Not checked yet" are shown indented under the line "Not yet checked: {notYetChecked}".
2. The line "Number mismatches: {numberMismatches}".
3. The line "Not checkable (method statements and sentences without citations): {notCheckable}".
4. The provenance counts over clauses whose category is not `unchecked`:
   - "Deterministic checks: {DETERMINISTIC}"
   - "On-device model: {ON_DEVICE}"
   - "Cloud model: {CLOUD}"
   - "Printed source: {PHYSICAL_SOURCE}"
   - "Your reviews: {AUTHOR}"
5. The two exact sentences: **"On-device results are not verdicts."** and **"Unmarked text has not been verified."**

### 5.4 Drawers

Each drawer lists clauses with one primary action. Rows are ordered by document position.

| Drawer | Contains | Primary action |
|---|---|---|
| *Waiting for cloud check* | `WAITING` clauses (only possible while `mode.cloudAvailable`; §4.8) | "Send N claims to cloud check", which opens the batch consent sheet (consent class B). While `mode.quotaExhausted`, the button gives way to the label **"No cloud checks left today — resets at {local time}"** (from `mode.quotaResetAt`). |
| *Can't verify with available sources* | `UNVERIFIABLE` and `MIXED_SUPPORT` clauses | Web: "Add a source" (attach a PDF of the cited source) or "Mark reviewed". Android: "Add a source" (photograph a printed page, or open a file) or "Mark reviewed". For a row whose reference is `AMBIGUOUS`: "Choose the reference". |
| *Source flagged* | `SOURCE_FLAGGED` clauses | "View warning" (shows the sanitizer reasons) |
| *Reviewed by you* | `REVIEWED_BY_AUTHOR` clauses | "Undo review" (clears the override: E12 with `value = null`) |

**Quota exhaustion display rule (normative).** When the user's pool is exhausted:
- clauses **remain in `waiting`**, and the header count does not change;
- the *Waiting for cloud check* drawer shows "No cloud checks left today — resets at {local time}" in place of the send button;
- the header appends " · cloud checks resume at {local time}".

Clauses are never moved to `unverifiable` because of quota, because quota is not evidence about the claim. Overrides on such clauses survive by the family rule (C1).

### 5.5 Accessibility labels (exact)

| Mark | Accessible name |
|---|---|
| Green check from `SUPPORTED` with `CLOUD` provenance | **"Supported — checked in the cloud"** |
| Green check from `SUPPORTED` with `PHYSICAL_SOURCE` provenance | **"Supported — confirmed from a printed source"** |
| Grey reviewed glyph (`REVIEWED_BY_AUTHOR`) | **"Reviewed by you — not a verdict"** |
| Amber-grey dotted underline (`HINT`) | "On-device hint — unconfirmed" |
| Grey hollow check (`SUPPORTED_LOCAL`) | "Supported on this device — unconfirmed" |
| Red flag (`REFERENCE_PROBLEM`) | "Reference problem: {reason}" |
| Solid red underline (`CONTRADICTED`) | "Contradicted by the source — checked in the cloud" |
| "Check this citation" chip | "Check this citation: {reason}" |
| Header | the header text of §5.2, followed by "Press Enter for details" |

The words "checked in the cloud" and "confirmed from a printed source" appear in these labels exactly as written. `copy.test.ts` verifies every label against `packages/copy/en.json`.
