import { describe, expect, it } from "vitest";
import { BIB_STATUSES, CLAUSE_STATES, PROVENANCE_VALUES } from "@toulmin/schemas";
import {
  ANDROID_FILTER_CHIPS,
  BIB_STATUS_LABELS,
  CLAUSE_STATUS_LABELS,
  DISCLAIMER_LINES,
  EN_COPY,
  PROVENANCE_CHIP_LABELS,
  WEB_FILTER_CHIPS,
  formatB5Aria,
  formatB5Badge,
  formatBatchSendButton,
  formatBatchSendHeading,
  formatCheckCitationAria,
  formatCloudReloadLabel,
  formatCopy,
  formatCoverageMeterHeader,
  formatDownloadingCopy,
  formatJudgeAccessSuccess,
  formatLabNoteAria,
  formatMixedSupportAria,
  formatMixedSupportLabel,
  formatOfflineReadinessMeter,
  formatQuotaExhausted,
  formatQuotaIndicator,
  formatReferenceProblemAria,
  formatReimportToast,
} from "../src/index.js";

describe("@toulmin/copy canonical English copy & typed formatters", () => {
  it("provides non-empty canonical labels for every ClauseState, BibStatus, and Provenance", () => {
    for (const state of CLAUSE_STATES) {
      expect(CLAUSE_STATUS_LABELS[state]).toBeTypeOf("string");
      expect(CLAUSE_STATUS_LABELS[state].length).toBeGreaterThan(0);
    }
    for (const bib of BIB_STATUSES) {
      expect(BIB_STATUS_LABELS[bib]).toBeTypeOf("string");
      expect(BIB_STATUS_LABELS[bib].length).toBeGreaterThan(0);
    }
    for (const prov of PROVENANCE_VALUES) {
      if (prov === "NONE") continue;
      expect(PROVENANCE_CHIP_LABELS[prov]).toBeTypeOf("string");
      expect(PROVENANCE_CHIP_LABELS[prov].length).toBeGreaterThan(0);
    }
    expect(WEB_FILTER_CHIPS).toEqual([
      "All",
      "Problems",
      "To review",
      "Waiting",
      "Can't verify",
      "Not yet checked",
    ]);
    expect(ANDROID_FILTER_CHIPS).toEqual([
      "Waiting",
      "Possible conflicts",
      "Unresolved",
      "All",
    ]);
  });

  it("matches exact normative disclaimers, accessibility labels, and non-hype wording", () => {
    expect(DISCLAIMER_LINES).toEqual([
      "On-device results are not verdicts.",
      "Unmarked text has not been verified.",
    ]);
    expect(EN_COPY.product.singlePromise).toBe(
      "Know which of your claims your sources actually support — while you write."
    );
    expect(EN_COPY.clauseAria.SUPPORTED_CLOUD).toContain("checked in the cloud");
    expect(EN_COPY.clauseAria.SUPPORTED_PRINTED).toContain("confirmed from a printed source");
    expect(EN_COPY.document.scopeMultiFile).toBe(
      "Multi-file projects open as a read-only audit copy: keep editing in your own editor and re-import to refresh."
    );
    expect(EN_COPY.devpost.testingInstructions).toContain("https://toulmin.web.app/");
    expect(EN_COPY.devpost.testingInstructions).toContain("{CODE_10}");

    const allJsonText = JSON.stringify(EN_COPY).toLowerCase();
    expect(allJsonText).not.toContain("no false alarms");
    expect(allJsonText).not.toContain("sub-second");
  });

  it("formats Coverage Meter 7-count header, Offline Readiness Meter, and all parameterized strings", () => {
    const headerNormal = formatCoverageMeterHeader({
      supported: 2,
      reviewed: 1,
      problems: 3,
      to_review: 1,
      waiting: 2,
      unverifiable: 1,
      notYetChecked: 4,
      total: 14,
      quotaExhausted: false,
    });
    expect(headerNormal).toBe(
      "2 supported · 1 reviewed · 3 problems · 1 to review · 2 waiting · 1 can't verify · 4 not yet checked — of 14 claims"
    );

    const headerExhausted = formatCoverageMeterHeader(
      {
        supported: 2,
        reviewed: 1,
        problems: 3,
        to_review: 1,
        waiting: 2,
        unverifiable: 1,
        notYetChecked: 4,
        total: 14,
        quotaExhausted: true,
      },
      "12:00 AM"
    );
    expect(headerExhausted).toBe(
      "2 supported · 1 reviewed · 3 problems · 1 to review · 2 waiting · 1 can't verify · 4 not yet checked — of 14 claims · cloud checks resume at 12:00 AM"
    );

    expect(
      formatOfflineReadinessMeter({
        nAbs: 8,
        nRefs: 10,
        nFt: 5,
        snapshotDate: "2026-11-25",
        tier: "Stable",
        baseModelName: "gemini-nano",
      })
    ).toBe(
      "Offline ready: 8/10 references with abstract · 5/10 with full text · retraction snapshot 2026-11-25 · model: Stable (gemini-nano)"
    );

    expect(formatMixedSupportLabel(2, 3)).toBe("Supported by 2 of 3 · others not verifiable");
    expect(formatMixedSupportAria(2, 3)).toBe(
      "Supported by 2 of 3 cited sources; the others could not be verified"
    );
    expect(formatReferenceProblemAria("doiNotFound")).toBe("Reference problem: DOI not found");
    expect(formatCheckCitationAria("AMBIGUOUS")).toBe(
      "Check this citation: This citation matches more than one reference"
    );
    expect(formatQuotaIndicator(10, "shared preview")).toBe(
      "Cloud checks left today: 10 (shared preview)"
    );
    expect(formatQuotaExhausted("12:00 AM")).toBe(
      "No cloud checks left today — resets at 12:00 AM"
    );
    expect(formatDownloadingCopy(42)).toBe(
      "Downloading the on-device model (42%). Reference checks are running; claim checks start when the download finishes."
    );
    expect(formatReimportToast(12, 3, 1)).toBe(
      "Re-imported: 12 claims kept their results, 3 changed and will be re-checked, 1 are no longer in the document."
    );
    expect(formatB5Badge("methods")).toBe("≠ methods");
    expect(formatB5Aria("methods", "48")).toBe("This number differs from methods (48)");
    expect(formatLabNoteAria("Logbook 3, p. 27")).toBe(
      "Differs from your lab note (Logbook 3, p. 27)"
    );
    expect(formatCloudReloadLabel("Nov 25, 2026")).toBe(
      "Checked in the cloud on Nov 25, 2026 — re-run to see sources"
    );
    expect(formatJudgeAccessSuccess("December 31, 2026")).toBe(
      "Judge access active until December 31, 2026. Your checks now use the reserved judge quota."
    );
    expect(formatBatchSendButton(5)).toBe("Send 5 claims");
    expect(formatBatchSendHeading(5)).toBe("Send 5 claims to cloud check?");
    expect(formatCopy("Keep {unknown} as literal {x}", { x: 7 })).toBe(
      "Keep {unknown} as literal 7"
    );
  });
});
