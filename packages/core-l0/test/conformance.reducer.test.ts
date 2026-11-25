import { describe, expect, it } from "vitest";
import reducerVectors from "../../../conformance/l0/reducer.json" with { type: "json" };
import meterVectors from "../../../conformance/l0/meter.json" with { type: "json" };
import {
  BUNDLED_SAMPLE_PRIVACY_CONTEXT,
  type AuthorOverride,
  type BibStatus,
  type ClaimLedgerEntry,
  type ClaimType,
  type CloudResult,
  type CloudVerdict,
  type CoverageMeter,
  type L0Error,
  type LabNoteMismatchItem,
  type LedgerEvent,
  type LocalResult,
  type LocalVerdict,
  type MeterCategory,
  type PhysicalKind,
  type PhysicalResult,
  type PhysicalVerdict,
  type PolicySnapshot,
  type PrivacyContext,
  type Provenance,
  type RefFacts,
  type RefState,
  type Selection,
  type SessionFacts,
  type Versioned,
  type Worth,
  derive,
  formatCoverageHeader,
  meter,
  reduceLedger,
  validateCoverageMeter,
} from "../src/ledger.js";

const DEFAULT_CLAIM_HASH = "362798e22ccc7ab5a2d1bce94290b1559c90e4ff0e8286e40326afef6c09e703";
const DEFAULT_SENTENCE_HASH = "6f07f50a092a01d82c6a7bd7afa23a0740fc7776b2b0ef22adfdecef3da04a20";
const DEFAULT_APPROVED_SHA = "0a2e2b9bd18b05ad0bb697c6ddb6317b83e22f7cee3bee59a91c1ad7b7de7f91";
const DEFAULT_PHOTO_SHA = "cd3373a42702dc6795f9b84fdbc181452857b676b97d3964f04a22660cf5159a";

const POLICIES: Readonly<Record<string, PolicySnapshot>> = {
  standard_path_a: {
    deviceProfile: "web_chrome_nano",
    b4CountsAsReview: true,
    profiles: {
      web_chrome_nano: {
        path: "A",
        authority: { B1: "advisory", B2: "advisory", B3: "advisory", B5: "advisory", O2: "advisory" },
        supportVerdicts: "advisory",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
  standard_path_a_support_auth: {
    deviceProfile: "web_chrome_nano",
    b4CountsAsReview: true,
    profiles: {
      web_chrome_nano: {
        path: "A",
        authority: { B1: "advisory", B2: "advisory", B3: "authoritative", B5: "advisory", O2: "advisory" },
        supportVerdicts: "authoritative",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
  standard_path_a_b4_false: {
    deviceProfile: "web_chrome_nano",
    b4CountsAsReview: false,
    profiles: {
      web_chrome_nano: {
        path: "A",
        authority: { B1: "advisory", B2: "advisory", B3: "advisory", B5: "advisory", O2: "advisory" },
        supportVerdicts: "advisory",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
  standard_path_b: {
    deviceProfile: "web_chrome_nano",
    b4CountsAsReview: true,
    profiles: {
      web_chrome_nano: {
        path: "B",
        authority: { B1: "advisory", B2: "advisory", B3: "advisory", B5: "advisory", O2: "advisory" },
        supportVerdicts: "advisory",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
  android_path_b: {
    deviceProfile: "android_aicore_stable",
    b4CountsAsReview: true,
    profiles: {
      android_aicore_stable: {
        path: "B",
        authority: { B1: "advisory", B2: "advisory", B3: "advisory", B5: "advisory", O2: "advisory" },
        supportVerdicts: "advisory",
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      },
    },
  },
};

const MODES: Readonly<Record<string, PrivacyContext>> = {
  standard_online: {
    mode: "STANDARD",
    cloudAvailable: true,
    quotaExhausted: false,
    quotaResetAt: null,
  },
  standard_exhausted: {
    mode: "STANDARD",
    cloudAvailable: true,
    quotaExhausted: true,
    quotaResetAt: 1700067600000,
  },
  confidential: {
    mode: "CONFIDENTIAL",
    cloudAvailable: false,
    quotaExhausted: false,
    quotaResetAt: null,
  },
  bundled_sample: BUNDLED_SAMPLE_PRIVACY_CONTEXT,
};

const SESSIONS: Readonly<Record<string, SessionFacts>> = {
  default: {
    localUnavailable: false,
    transient: new Map(),
  },
  local_unavailable: {
    localUnavailable: true,
    transient: new Map(),
  },
  three_attempts_c_tr: {
    localUnavailable: false,
    transient: new Map([["c-tr|ref-1", { reason: "DEADLINE", attempts: 3 }]]),
  },
};

interface FixtureRefInput {
  readonly refId: string;
  readonly selection?: Selection;
  readonly local?: {
    readonly verdict: LocalVerdict;
    readonly rawVerdict: LocalVerdict;
    readonly modelProfile: string;
    readonly schemaId: string;
    readonly reasoningCap: number;
  };
  readonly cloud?: {
    readonly verdict: CloudVerdict;
  };
  readonly physical?: {
    readonly verdict: PhysicalVerdict;
    readonly kind: PhysicalKind;
    readonly confirmedByAuthorAt: number | null;
    readonly entailmentConfirmedByAuthorAt: number | null;
  };
}

interface FixtureEntryInput {
  readonly claimId: string;
  readonly normalizedClaimHash?: string;
  readonly baseline?: {
    readonly claimType: ClaimType;
    readonly worth: Worth;
    readonly uncited: boolean;
  };
  readonly heldNei?: Versioned<{ readonly since: number } | null>;
  readonly job?: Versioned<boolean>;
  readonly l0Error?: L0Error | null;
  readonly b5?: { readonly inconsistentWith: string[] };
  readonly labNoteMismatch?: LabNoteMismatchItem[];
  readonly override?: Versioned<AuthorOverride | null>;
  readonly archived?: boolean;
  readonly refs: readonly FixtureRefInput[];
}

function buildEntry(f: FixtureEntryInput): ClaimLedgerEntry {
  const claimHash = f.normalizedClaimHash ?? DEFAULT_CLAIM_HASH;
  return {
    claimId: f.claimId,
    docId: "doc-1",
    sentenceHash: DEFAULT_SENTENCE_HASH,
    occurrenceIndex: 0,
    clauseIndex: 0,
    section: "results",
    subsection: null,
    span: { start: 0, end: 32 },
    claimText: "Drug X reduced mortality by 30%.",
    normalizedClaimHash: claimHash,
    baseline: {
      atoms: [{ start: 0, end: 5, claimType: f.baseline?.claimType ?? "QUANTITATIVE" }],
      worth: f.baseline?.worth ?? "HIGH",
      claimType: f.baseline?.claimType ?? "QUANTITATIVE",
      uncited: f.baseline?.uncited ?? false,
    },
    stage1: null,
    citationKeys: f.refs.map((r) => r.refId),
    possibleCitations: [],
    refs: f.refs.map((r) => {
      const local: LocalResult | null =
        r.local !== undefined
          ? {
              resultKey: `L-fixture-${f.claimId}-${r.refId}`,
              verdict: r.local.verdict,
              rawVerdict: r.local.rawVerdict,
              anchor: null,
              anchorFailReason: null,
              microReasoning: "Aligned snippet.",
              inferenceSource: "ON_DEVICE",
              modelProfile: r.local.modelProfile,
              schemaId: r.local.schemaId,
              reasoningCap: r.local.reasoningCap,
              promptVersion: "p2.1",
              decidedAt: 1700000000000,
            }
          : null;
      const cloud: CloudResult | null =
        r.cloud !== undefined
          ? {
              resultKey: `C-fixture-${f.claimId}-${r.refId}`,
              normalizedClaimHash: claimHash,
              refId: r.refId,
              verdict: r.cloud.verdict,
              quote: "Evidence quote.",
              quoteAnchor: null,
              approvedTextSha256: DEFAULT_APPROVED_SHA,
              alternativesDois: [],
              noDifferenceNote: false,
              adjudicator: "l2AdjudicateProvided",
              inferenceSource: "IN_CLOUD",
              promptVersion: "p2.1",
              decidedAt: 1700000000000,
            }
          : null;
      const physical: PhysicalResult | null =
        r.physical !== undefined
          ? {
              resultKey: `P-fixture-${f.claimId}-${r.refId}`,
              normalizedClaimHash: claimHash,
              refId: r.refId,
              verdict: r.physical.verdict,
              capture: {
                captureId: `cap-${f.claimId}-${r.refId}`,
                photoSha256: DEFAULT_PHOTO_SHA,
                kind: r.physical.kind,
                linkedRefId: r.refId,
                pageLabel: "p. 12, Table 1",
                rowCropSha256: null,
                confirmedByAuthorAt: r.physical.confirmedByAuthorAt,
                entailmentConfirmedByAuthorAt: r.physical.entailmentConfirmedByAuthorAt,
              },
              inferenceSource: "ON_DEVICE",
              decidedAt: 1700000000000,
            }
          : null;
      return {
        refId: r.refId,
        selection: r.selection ?? null,
        local,
        cloud,
        physical,
      };
    }),
    heldNei: f.heldNei ?? { value: null, seq: 0 },
    job: f.job ?? { value: false, seq: 0 },
    l0Error: f.l0Error ?? null,
    b5: f.b5 ?? { inconsistentWith: [] },
    labNoteMismatch: f.labNoteMismatch ?? [],
    suggestedRefIds: [],
    override: f.override ?? { value: null, seq: 0 },
    archived: f.archived ?? false,
    updatedAt: 1700000000000,
  };
}

function buildRefMap(
  list: ReadonlyArray<{
    readonly refId: string;
    readonly bibStatus: BibStatus;
    readonly retracted: boolean;
    readonly checkMetadata: boolean;
    readonly evidenceVersion: string;
    readonly hasEvidence: boolean;
    readonly updatedSeq: number;
  }>,
): Map<string, RefFacts> {
  const m = new Map<string, RefFacts>();
  for (const item of list) {
    m.set(item.refId, item);
  }
  return m;
}

describe("conformance/l0/reducer.json (AC-L0-14, AC-L0-18, AC-L0-20)", () => {
  for (const tc of reducerVectors.deriveCases) {
    it(`derive: ${tc.id}`, () => {
      const policy = POLICIES[tc.policy]!;
      const mode = MODES[tc.mode]!;
      const session = SESSIONS[tc.session]!;
      const refFacts = buildRefMap(tc.refFacts as readonly RefFacts[]);
      const entry = buildEntry(tc.entry as unknown as FixtureEntryInput);

      const actual = derive(entry, refFacts, policy, mode, session);
      expect(actual.refStates).toStrictEqual(
        tc.expected.refStates as Array<{ refId: string; state: RefState }>,
      );
      expect(actual.state).toBe(tc.expected.state);
      expect(actual.category).toBe(tc.expected.category as MeterCategory | null);
      expect(actual.provenance).toBe(tc.expected.provenance as Provenance);
    });
  }

  for (const tc of reducerVectors.reduceCases) {
    it(`reduceLedger: ${tc.id}`, () => {
      const policy = POLICIES[tc.policy]!;
      const mode = MODES[tc.mode]!;
      const session = SESSIONS[tc.session]!;
      const state = reduceLedger(tc.events as unknown as LedgerEvent[], { policy });
      const entry = state.entries.get(tc.expected.claimId)!;
      expect(entry).toBeDefined();
      const derived = derive(entry, state.refFacts, state.policy, mode, session);
      expect(derived.state).toBe(tc.expected.state);

      if ("localNull" in tc.expected && tc.expected.localNull) {
        expect(entry.refs[0]!.local).toBeNull();
      }
      if ("cloudNull" in tc.expected && tc.expected.cloudNull) {
        expect(entry.refs[0]!.cloud).toBeNull();
      }
      if ("localVerdict" in tc.expected) {
        expect(entry.refs[0]!.local?.verdict).toBe(tc.expected.localVerdict);
        expect(entry.refs[0]!.local?.microReasoning).toBe(tc.expected.localReasoning);
      }
      if ("refBibStatus" in tc.expected) {
        expect(state.refFacts.get("ref-1")?.bibStatus).toBe(tc.expected.refBibStatus);
      }
      if ("labNoteCount" in tc.expected) {
        expect(entry.labNoteMismatch.length).toBe(tc.expected.labNoteCount);
      }
    });
  }
});

describe("conformance/l0/meter.json (AC-L0-19)", () => {
  for (const tc of meterVectors.cases) {
    it(`meter: ${tc.id}`, () => {
      const policy = POLICIES[tc.policy]!;
      const mode = MODES[tc.mode]!;
      const session = SESSIONS[tc.session]!;
      const refFacts = buildRefMap(tc.refFacts as readonly RefFacts[]);
      const entries = (tc.entries as unknown as readonly FixtureEntryInput[]).map(buildEntry);

      const actual = meter(entries, refFacts, policy, mode, session);
      const validation = validateCoverageMeter(actual);
      expect(validation.ok).toBe(true);

      const expectedMeter: CoverageMeter = {
        total: tc.expected.total,
        supported: tc.expected.supported,
        reviewed: tc.expected.reviewed,
        local: tc.expected.local,
        problems: tc.expected.problems,
        to_review: tc.expected.to_review,
        waiting: tc.expected.waiting,
        unverifiable: tc.expected.unverifiable,
        unchecked: tc.expected.unchecked,
        notYetChecked: tc.expected.notYetChecked,
        notCheckable: tc.expected.notCheckable,
        numberMismatches: tc.expected.numberMismatches,
        quotaExhausted: tc.expected.quotaExhausted,
        quotaResetAt: tc.expected.quotaResetAt,
        byProvenance: tc.expected.byProvenance,
      };
      expect(actual).toStrictEqual(expectedMeter);

      const header = formatCoverageHeader(
        actual,
        "resetLocalTime" in tc ? tc.resetLocalTime : undefined,
      );
      expect(header).toBe(tc.expected.header);
    });
  }
});
