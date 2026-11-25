/**
 * Canonical user-facing copy, typed enum label maps, and linear-time string interpolation helpers
 * (`docs/spec/01_DATA_REDUCER_AND_METER.md`, `04`, `05`, `06`, `08`).
 *
 * Pure module: zero Firebase, DOM, network, Node I/O, clock, or regex usage.
 */

import type {
  BibStatus,
  ClauseState,
  CoverageMeter,
  Provenance,
} from "@toulmin/schemas";
import rawEnCopy from "../en.json" with { type: "json" };

export interface EnCopy {
  readonly product: {
    readonly name: string;
    readonly shortName: string;
    readonly singlePromise: string;
    readonly onDeviceRole: string;
    readonly license: string;
    readonly endCardRequirements: string;
    readonly emptyStateHeading: string;
    readonly emptyStateDropZone: string;
    readonly trySampleButton: string;
    readonly startBlankButton: string;
    readonly untitledTitle: string;
    readonly mobileWorkbenchNotice: string;
  };
  readonly disclaimers: {
    readonly onDeviceNotVerdicts: string;
    readonly unmarkedNotVerified: string;
  };
  readonly clauseStatus: Readonly<Record<ClauseState, string>> & {
    readonly WAITING_EXHAUSTED: string;
    readonly SUPPORTED_PRINTED_SUFFIX: string;
  };
  readonly clauseAria: {
    readonly REFERENCE_PROBLEM: string;
    readonly referenceProblemReasons: {
      readonly doiNotFound: string;
      readonly retracted: string;
      readonly unresolvedKey: string;
    };
    readonly CONTRADICTED: string;
    readonly HINT: string;
    readonly PARTLY_SUPPORTED: string;
    readonly CHECK_METADATA: string;
    readonly UNCITED_EMPIRICAL: string;
    readonly MIXED_SUPPORT: string;
    readonly SUPPORTED_CLOUD: string;
    readonly SUPPORTED_PRINTED: string;
    readonly REVIEWED_BY_AUTHOR: string;
    readonly SUPPORTED_LOCAL: string;
    readonly LOCAL_EVIDENCE: string;
    readonly CHECKING: string;
    readonly WAITING: string;
    readonly SOURCE_FLAGGED: string;
    readonly UNVERIFIABLE: string;
    readonly UNCHECKED: string;
    readonly NOT_CHECKABLE: string;
  };
  readonly provenance: {
    readonly DETERMINISTIC: string;
    readonly ON_DEVICE: string;
    readonly CLOUD: string;
    readonly PHYSICAL_SOURCE: string;
    readonly PRINTED_SOURCE_AUTHOR: string;
    readonly LAB_NOTE: string;
    readonly AUTHOR: string;
  };
  readonly bibStatus: Readonly<Record<BibStatus, string>>;
  readonly flags: {
    readonly b5Badge: string;
    readonly b5Aria: string;
    readonly labNoteBadge: string;
    readonly labNoteAria: string;
    readonly checkCitationChip: string;
    readonly checkCitationAria: string;
    readonly checkCitationReasons: {
      readonly POSSIBLE_CITATION: string;
      readonly NOT_INDEXED: string;
      readonly AMBIGUOUS: string;
    };
    readonly checkCitationActions: {
      readonly linkToReference: string;
      readonly notACitation: string;
      readonly addDoi: string;
      readonly chooseReference: string;
    };
    readonly checkMetadataChip: string;
    readonly checkMetadataAction: string;
    readonly checkingAgainBadge: string;
    readonly checkingAgainAria: string;
    readonly changedSinceImportBadge: string;
    readonly parseTimeoutReason: string;
  };
  readonly meter: {
    readonly header: string;
    readonly headerExhaustedSuffix: string;
    readonly headerAriaSuffix: string;
    readonly drillDown: {
      readonly supported: string;
      readonly reviewed: string;
      readonly problems: string;
      readonly toReview: string;
      readonly waiting: string;
      readonly unverifiable: string;
      readonly notYetChecked: string;
      readonly onThisDevice: string;
      readonly notCheckedYet: string;
      readonly numberMismatches: string;
      readonly notCheckable: string;
      readonly provenanceDeterministic: string;
      readonly provenanceOnDevice: string;
      readonly provenanceCloud: string;
      readonly provenancePhysicalSource: string;
      readonly provenanceAuthor: string;
    };
  };
  readonly filters: {
    readonly web: readonly string[];
    readonly android: readonly string[];
  };
  readonly drawers: {
    readonly waiting: {
      readonly title: string;
      readonly primaryAction: string;
      readonly empty: string;
    };
    readonly unverifiable: {
      readonly title: string;
      readonly primaryActionAddSource: string;
      readonly secondaryActionMarkReviewed: string;
      readonly primaryActionChooseRef: string;
      readonly empty: string;
    };
    readonly sourceFlagged: {
      readonly title: string;
      readonly primaryAction: string;
      readonly empty: string;
    };
    readonly reviewed: {
      readonly title: string;
      readonly primaryAction: string;
      readonly empty: string;
    };
  };
  readonly l3: {
    readonly PROBE_ENV: { readonly chip: string };
    readonly OFFER_DOWNLOAD: {
      readonly chip: string;
      readonly cardTitle: string;
      readonly cardBody: string;
      readonly enableButton: string;
      readonly notNowButton: string;
    };
    readonly DOWNLOADING: { readonly text: string };
    readonly WARM_PROBING: { readonly chip: string };
    readonly READY_CALIBRATED: { readonly chip: string };
    readonly READY_DRIFTED: {
      readonly chip: string;
      readonly banner: string;
      readonly button: string;
    };
    readonly LOCAL_STALLED: { readonly chip: string };
    readonly LOCAL_LOST: { readonly chip: string; readonly button: string };
    readonly NO_LOCAL_MODEL: {
      readonly confidentialChip: string;
      readonly standardConsentAChip: string;
    };
  };
  readonly environment: {
    readonly NOT_CHROME: string;
    readonly CHROME_TOO_OLD: string;
    readonly API_MISSING: string;
    readonly UNAVAILABLE_HARDWARE_OR_DISK: string;
    readonly LANGUAGE_UNSUPPORTED: string;
    readonly iosUnavailable: string;
  };
  readonly consent: {
    readonly standardReminder: string;
    readonly standardBannerTitle: string;
    readonly standardBannerBody: string;
    readonly standardBannerConfirm: string;
    readonly standardBannerCancel: string;
    readonly confidentialNotice: string;
    readonly confidentialShortcutBlocked: string;
    readonly consentACardTitle: string;
    readonly consentACardConfidential: string;
    readonly consentACardStandard: string;
    readonly consentAButtonConfidential: string;
    readonly consentAButtonStandard: string;
    readonly batchSheetTitle: string;
    readonly batchSheetBody: string;
    readonly batchIncludePdfs: string;
    readonly batchEvidenceKinds: {
      readonly abstract: string;
      readonly fulltext: string;
      readonly userPdf: string;
      readonly none: string;
    };
    readonly batchSuspiciousLabel: string;
    readonly batchReasons: {
      readonly hint: string;
      readonly noEvidence: string;
      readonly fullTextNeeded: string;
      readonly changedSinceImport: string;
    };
    readonly batchMoreAfter: string;
    readonly batchSendButton: string;
    readonly batchCancelButton: string;
    readonly batchNotCheckedRow: string;
    readonly localStorageNotice: string;
    readonly localStorageWebWarning: string;
    readonly localStorageWebDetailWarning: string;
    readonly positioningLine: string;
  };
  readonly quota: {
    readonly indicator: string;
    readonly pools: {
      readonly sharedPreview: string;
      readonly sample: string;
      readonly judgeAccess: string;
    };
    readonly resetsTooltip: string;
    readonly exhausted: string;
    readonly exhaustedJudgeTooltip: string;
    readonly batchExhausted: string;
    readonly killSwitchChip: string;
    readonly killSwitchSheet: string;
    readonly functionsCapBanner: string;
    readonly degradedChip: string;
  };
  readonly sample: {
    readonly badge: string;
    readonly checkButton: string;
    readonly checkedButton: string;
    readonly poolExhaustedTooltip: string;
    readonly confidentialTooltip: string;
  };
  readonly document: {
    readonly auditBadge: string;
    readonly auditReadOnlyHint: string;
    readonly auditBanner: string;
    readonly docxAuditBanner: string;
    readonly scopeMultiFile: string;
    readonly scopeSingleFile: string;
  };
  readonly cloud: {
    readonly quoteFromPaper: string;
    readonly quoteFromWeb: string;
    readonly webSourcesOnly: string;
    readonly noDifferenceNote: string;
    readonly providedEvidenceOnly: string;
    readonly recheckAfterReload: string;
    readonly sourceNotConfirmed: string;
    readonly unreadableJson: string;
    readonly rerunCheck: string;
    readonly thisPaperBadge: string;
    readonly findAlternativeSources: string;
    readonly fromYourLibrary: string;
    readonly noPassageMatches: string;
    readonly orientationNote: string;
  };
  readonly overflowMenu: {
    readonly judgeAccess: string;
    readonly judgeAccessSuccess: string;
    readonly judgeAccessInvalid: string;
    readonly proofMode: string;
    readonly showLocalSupports: string;
    readonly keyboardShortcuts: string;
    readonly deleteLocalData: string;
    readonly deleteLocalDataConfirm: string;
    readonly deleteEverythingButton: string;
    readonly cancelButton: string;
    readonly aboutAndLicences: string;
  };
  readonly importExport: {
    readonly progress: readonly string[];
    readonly quotaExpectation: string;
    readonly quotaExpectationRest: string;
    readonly reimportToast: string;
    readonly startAudit: string;
    readonly auditButton: string;
    readonly auditProgress: string;
    readonly startWriting: string;
    readonly openAuditCopy: string;
    readonly downloadSource: string;
    readonly reimport: string;
    readonly exportMenu: {
      readonly integrityReportMd: string;
      readonly integrityReportPdf: string;
      readonly correctedBib: string;
      readonly onDeviceHeader: string;
      readonly reviewedByAuthorHeader: string;
      readonly zoteroOverwriteWarning: string;
      readonly sections: {
        readonly fixReferences: string;
        readonly rewriteClaims: string;
        readonly addSources: string;
        readonly waiting: string;
        readonly reviewedByAuthor: string;
        readonly supported: string;
      };
    };
    readonly errors: {
      readonly archiveTooLarge: string;
      readonly inputExpansionLimit: string;
      readonly noMainFile: string;
      readonly unsupportedFile: string;
    };
  };
  readonly proof: {
    readonly foundContradictions: string;
    readonly supportGateStatus: string;
    readonly supportGateHudRule: string;
    readonly b3AuthorityNote: string;
    readonly sanityCheckNote: string;
    readonly notMeasuredOnProfile: string;
    readonly notMeasuredShort: string;
    readonly reportedNotGated: string;
    readonly counterStrip: string;
  };
  readonly android: {
    readonly settings: {
      readonly privacyMode: string;
      readonly privacyModeLine: string;
      readonly showLocalSupports: string;
      readonly onDeviceModel: string;
      readonly deleteLocalData: string;
      readonly deleteConfirm: string;
      readonly aboutAndLicences: string;
    };
    readonly offlineReadinessMeter: string;
    readonly networkUnavailable: string;
    readonly canCheckOfflineBadge: string;
    readonly quotaLimitReachedToday: string;
    readonly o1: {
      readonly keepScreenOpen: string;
      readonly checkedOnPhone: string;
    };
    readonly o2: {
      readonly findDoiOnPage: string;
      readonly captureGuide: string;
      readonly ocrSpinner: string;
      readonly tiltRejected: string;
      readonly tapRowPrompt: string;
      readonly confirmHeaderPrompt: string;
      readonly confirmHeaderYes: string;
      readonly pickAnotherRow: string;
      readonly addRowAbove: string;
      readonly numericSanityWarning: string;
      readonly matchesPhotoButton: string;
      readonly editValueButton: string;
      readonly entailmentPrompt: string;
      readonly rowSupportsClaimButton: string;
      readonly notSureButton: string;
      readonly supportedPrintedLabel: string;
      readonly neiRowPrompt: string;
      readonly reviewedByYouLabel: string;
      readonly readWholeTableToggle: string;
    };
    readonly o3: {
      readonly typedOrPrintedOnly: string;
      readonly differsFromLabNote: string;
      readonly matchesLabNote: string;
      readonly confirmDifferenceButton: string;
    };
    readonly o4: {
      readonly copyCitationButton: string;
      readonly honestyLine: string;
    };
  };
  readonly ios: {
    readonly modelChip: string;
    readonly confidentialDisabled: string;
    readonly cloudAnsweredLine: string;
  };
  readonly devpost: {
    readonly testingInstructions: string;
  };
}

export const EN_COPY: EnCopy = rawEnCopy as unknown as EnCopy;

export const CLAUSE_STATUS_LABELS: Readonly<Record<ClauseState, string>> = {
  REFERENCE_PROBLEM: EN_COPY.clauseStatus.REFERENCE_PROBLEM,
  CONTRADICTED: EN_COPY.clauseStatus.CONTRADICTED,
  HINT: EN_COPY.clauseStatus.HINT,
  PARTLY_SUPPORTED: EN_COPY.clauseStatus.PARTLY_SUPPORTED,
  MIXED_SUPPORT: EN_COPY.clauseStatus.MIXED_SUPPORT,
  UNCITED_EMPIRICAL: EN_COPY.clauseStatus.UNCITED_EMPIRICAL,
  CHECK_METADATA: EN_COPY.clauseStatus.CHECK_METADATA,
  WAITING: EN_COPY.clauseStatus.WAITING,
  SOURCE_FLAGGED: EN_COPY.clauseStatus.SOURCE_FLAGGED,
  UNVERIFIABLE: EN_COPY.clauseStatus.UNVERIFIABLE,
  LOCAL_EVIDENCE: EN_COPY.clauseStatus.LOCAL_EVIDENCE,
  SUPPORTED_LOCAL: EN_COPY.clauseStatus.SUPPORTED_LOCAL,
  SUPPORTED: EN_COPY.clauseStatus.SUPPORTED,
  REVIEWED_BY_AUTHOR: EN_COPY.clauseStatus.REVIEWED_BY_AUTHOR,
  CHECKING: EN_COPY.clauseStatus.CHECKING,
  UNCHECKED: EN_COPY.clauseStatus.UNCHECKED,
  NOT_CHECKABLE: EN_COPY.clauseStatus.NOT_CHECKABLE,
};

export const PROVENANCE_CHIP_LABELS: Readonly<Record<Exclude<Provenance, "NONE">, string>> = {
  DETERMINISTIC: EN_COPY.provenance.DETERMINISTIC,
  ON_DEVICE: EN_COPY.provenance.ON_DEVICE,
  CLOUD: EN_COPY.provenance.CLOUD,
  PHYSICAL_SOURCE: EN_COPY.provenance.PHYSICAL_SOURCE,
  AUTHOR: EN_COPY.provenance.AUTHOR,
};

export const BIB_STATUS_LABELS: Readonly<Record<BibStatus, string>> = EN_COPY.bibStatus;

export const DISCLAIMER_LINES: readonly [string, string] = [
  EN_COPY.disclaimers.onDeviceNotVerdicts,
  EN_COPY.disclaimers.unmarkedNotVerified,
];

export const WEB_FILTER_CHIPS: readonly string[] = EN_COPY.filters.web;
export const ANDROID_FILTER_CHIPS: readonly string[] = EN_COPY.filters.android;

/**
 * Pure linear-time `{placeholder}` interpolator (zero regexes).
 */
export function formatCopy(
  template: string,
  params: Readonly<Record<string, string | number>>
): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < template.length) {
    const open = template.indexOf("{", cursor);
    if (open === -1) {
      parts.push(template.slice(cursor));
      break;
    }
    const close = template.indexOf("}", open + 1);
    if (close === -1) {
      parts.push(template.slice(cursor));
      break;
    }
    if (open > cursor) {
      parts.push(template.slice(cursor, open));
    }
    const key = template.slice(open + 1, close);
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      parts.push(String(params[key]));
    } else {
      parts.push(template.slice(open, close + 1));
    }
    cursor = close + 1;
  }
  return parts.join("");
}

export function formatCoverageMeterHeader(
  meter: Pick<
    CoverageMeter,
    | "supported"
    | "reviewed"
    | "problems"
    | "to_review"
    | "waiting"
    | "unverifiable"
    | "notYetChecked"
    | "total"
    | "quotaExhausted"
  >,
  quotaResetLocalTime?: string
): string {
  const base = formatCopy(EN_COPY.meter.header, {
    supported: meter.supported,
    reviewed: meter.reviewed,
    problems: meter.problems,
    to_review: meter.to_review,
    waiting: meter.waiting,
    unverifiable: meter.unverifiable,
    notYetChecked: meter.notYetChecked,
    total: meter.total,
  });
  if (meter.quotaExhausted && quotaResetLocalTime !== undefined && quotaResetLocalTime.length > 0) {
    return (
      base +
      formatCopy(EN_COPY.meter.headerExhaustedSuffix, {
        "local time": quotaResetLocalTime,
      })
    );
  }
  return base;
}

export function formatMixedSupportLabel(k: number, n: number): string {
  return formatCopy(EN_COPY.clauseStatus.MIXED_SUPPORT, { k, n });
}

export function formatMixedSupportAria(k: number, n: number): string {
  return formatCopy(EN_COPY.clauseAria.MIXED_SUPPORT, { k, n });
}

export function formatReferenceProblemAria(
  reason: "doiNotFound" | "retracted" | "unresolvedKey"
): string {
  return formatCopy(EN_COPY.clauseAria.REFERENCE_PROBLEM, {
    reason: EN_COPY.clauseAria.referenceProblemReasons[reason],
  });
}

export function formatCheckCitationAria(
  reason: "POSSIBLE_CITATION" | "NOT_INDEXED" | "AMBIGUOUS"
): string {
  return formatCopy(EN_COPY.flags.checkCitationAria, {
    reason: EN_COPY.flags.checkCitationReasons[reason],
  });
}

export function formatQuotaIndicator(
  remaining: number,
  pool: "shared preview" | "judge access" | "sample"
): string {
  return formatCopy(EN_COPY.quota.indicator, { remaining, pool });
}

export function formatQuotaExhausted(localTime: string): string {
  return formatCopy(EN_COPY.quota.exhausted, { "local time": localTime });
}

export function formatDownloadingCopy(pct: number): string {
  return formatCopy(EN_COPY.l3.DOWNLOADING.text, { pct });
}

export function formatOfflineReadinessMeter(params: {
  readonly nAbs: number;
  readonly nRefs: number;
  readonly nFt: number;
  readonly snapshotDate: string;
  readonly tier: "Stable" | "Preview" | "none";
  readonly baseModelName: string;
}): string {
  return formatCopy(EN_COPY.android.offlineReadinessMeter, {
    nAbs: params.nAbs,
    nRefs: params.nRefs,
    nFt: params.nFt,
    "yyyy-mm-dd": params.snapshotDate,
    tier: params.tier,
    baseModelName: params.baseModelName,
  });
}

export function formatReimportToast(kept: number, changed: number, gone: number): string {
  return formatCopy(EN_COPY.importExport.reimportToast, { kept, changed, gone });
}

export function formatB5Badge(section: string): string {
  return formatCopy(EN_COPY.flags.b5Badge, { section });
}

export function formatB5Aria(section: string, value: string): string {
  return formatCopy(EN_COPY.flags.b5Aria, { section, value });
}

export function formatLabNoteAria(pageLabel: string): string {
  return formatCopy(EN_COPY.flags.labNoteAria, { pageLabel });
}

export function formatCloudReloadLabel(date: string): string {
  return formatCopy(EN_COPY.cloud.recheckAfterReload, { date });
}

export function formatJudgeAccessSuccess(localDate: string): string {
  return formatCopy(EN_COPY.overflowMenu.judgeAccessSuccess, { "local date": localDate });
}

export function formatBatchSendButton(k: number): string {
  return formatCopy(EN_COPY.consent.batchSendButton, { k });
}

export function formatBatchSendHeading(k: number): string {
  return formatCopy(EN_COPY.consent.batchSheetTitle, { k });
}
