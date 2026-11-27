/**
 * Formats Phase 0 spike results into spec-compliant Markdown, RESOLUTION.md rows,
 * and JSON exports (`07` §1.1 rule 2, §1.5, §1.7).
 *
 * Explicitly stamps non-live runs as `MOCKED_CONTRACT_TEST` so offline contract test
 * outputs can never be confused with verified hardware/browser spike evidence.
 */

import type { SpikeRunRecord } from "./types.js";

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function formatResolutionRow(record: SpikeRunRecord): string {
  const resolution =
    record.status === "PASS"
      ? `PASS (primary \`${record.flagName} = ${String(record.primaryRecommended)}\`)`
      : `${record.status} -> ${record.fallbackAction} (\`${record.flagName} = ${String(record.primaryRecommended)}\`)`;
  const markers = record.markerLocations.join(", ");
  return `| \`${record.spikeId}\` | ${escapePipe(markers)} | ${escapePipe(resolution)} | \`${record.targetDoc}\` (${record.executionMode}) |`;
}

export function formatSpikeMarkdown(record: SpikeRunRecord): string {
  const lines: string[] = [];
  lines.push(`# ${record.spikeId} — ${record.title}`);
  lines.push("");

  if (record.executionMode !== "LIVE_BROWSER") {
    lines.push(
      "> **WARNING — MOCKED_CONTRACT_TEST:** This output was produced in an offline mocked/contract test environment and MUST NOT be committed as a live browser/device Phase 0 spike record (`07` §1.1)."
    );
    lines.push("");
  }

  lines.push(`- **Execution Mode:** \`${record.executionMode}\``);
  lines.push(`- **Outcome:** **${record.status}**`);
  lines.push(`- **Feature Flag:** \`${record.flagName} = ${String(record.primaryRecommended)}\``);
  lines.push(`- **Target Record:** \`${record.targetDoc}\``);
  lines.push(`- **Summary:** ${record.summary}`);
  lines.push(`- **Pass Criterion:** ${record.passCriterion}`);
  lines.push(`- **Fallback Action:** ${record.fallbackAction}`);
  lines.push(`- **Duration (ms):** ${Math.max(0, Math.round(record.finishedAtMs - record.startedAtMs))}`);
  lines.push("");

  lines.push("## Environment");
  lines.push("");
  lines.push(`- **Platform / UA:** ${record.environment.platform} | \`${record.environment.userAgent}\``);
  lines.push(
    `- **Chrome / Readiness:** chromeMajor=${record.environment.chromeMajor ?? "n/a"}, readiness=\`${record.environment.readiness}\``
  );
  lines.push(
    `- **SDKs / Libraries:** \`firebase\` ${record.environment.firebaseSdkVersion}, \`pdfjs-dist\` ${record.environment.pdfJsVersion}, \`dompurify\` ${record.environment.domPurifyVersion}`
  );
  lines.push(`- **Recorded At:** ${record.environment.collectedAtIso}`);
  lines.push("");

  if (record.missingPrerequisites.length > 0) {
    lines.push("## Missing Prerequisites");
    lines.push("");
    for (const item of record.missingPrerequisites) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push("## Measurements");
  lines.push("");
  const metricEntries = Object.entries(record.metrics);
  if (metricEntries.length === 0) {
    lines.push("- (none)");
  } else {
    lines.push("| Metric | Value |");
    lines.push("|---|---|");
    for (const [k, v] of metricEntries) {
      lines.push(`| \`${k}\` | \`${String(v)}\` |`);
    }
  }
  lines.push("");

  if (record.manualChecklist.length > 0) {
    lines.push("## Manual Verification Checklist");
    lines.push("");
    for (const item of record.manualChecklist) {
      lines.push(`- [${item.completed ? "x" : " "}] **${item.id}:** ${item.description}${item.notes ? ` (${item.notes})` : ""}`);
    }
    lines.push("");
  }

  lines.push("## Marker Resolution Preview");
  lines.push("");
  lines.push("| Spike ID | Marker Locations | Outcome | Source |");
  lines.push("|---|---|---|---|");
  lines.push(formatResolutionRow(record));
  lines.push("");

  if (record.rawSamples.length > 0) {
    lines.push("## Raw Samples (JSON)");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(record.rawSamples, null, 2));
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

export function formatSpikeSuiteMarkdown(records: readonly SpikeRunRecord[]): string {
  const lines: string[] = [];
  lines.push("# Toulmin Phase 0 Spike Harness Export");
  lines.push("");
  lines.push("## RESOLUTION.md Candidate Rows");
  lines.push("");
  lines.push("| Spike ID | Marker Locations | Outcome | Source |");
  lines.push("|---|---|---|---|");
  for (const r of records) {
    lines.push(formatResolutionRow(r));
  }
  lines.push("");
  for (const r of records) {
    lines.push("---");
    lines.push("");
    lines.push(formatSpikeMarkdown(r));
  }
  return lines.join("\n");
}

export function formatSpikeJsonExport(records: readonly SpikeRunRecord[]): string {
  const allLive = records.length > 0 && records.every((r) => r.executionMode === "LIVE_BROWSER");
  return JSON.stringify(
    {
      schemaVersion: "toulmin-spike-export-v1",
      warning: allLive
        ? undefined
        : "Contains non-live MOCKED_CONTRACT_TEST records; do not commit to docs/spikes/ as hardware proof.",
      exportedAtIso: new Date().toISOString(),
      count: records.length,
      records,
    },
    null,
    2
  );
}
