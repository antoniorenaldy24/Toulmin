package app.toulmin.spikes

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.math.max

/**
 * Formats Android Phase 0 spike results into spec-compliant Markdown, RESOLUTION.md rows,
 * and JSON exports aligned with `apps/web/src/spikes/export.ts` (`07` §1.1 rule 2, §1.4, §1.7).
 */
object SpikeExporter {
    private val json = Json {
        prettyPrint = true
        encodeDefaults = true
        explicitNulls = false
    }

    private fun escapePipe(value: String): String =
        value.replace("|", "\\|").replace("\r\n", " ").replace("\n", " ")

    fun formatResolutionRow(record: SpikeRunRecord): String {
        val resolution = if (record.status == SpikeStatus.PASS) {
            "PASS (primary `${record.flagName} = ${record.primaryRecommended}`)"
        } else {
            "${record.status.name} -> ${record.fallbackAction} (`${record.flagName} = ${record.primaryRecommended}`)"
        }
        val markers = record.markerLocations.joinToString(", ")
        return "| `${record.spikeId}` | ${escapePipe(markers)} | ${escapePipe(resolution)} | `${record.targetDoc}` (${record.executionMode.name}) |"
    }

    fun formatSpikeMarkdown(record: SpikeRunRecord): String {
        val lines = ArrayList<String>()
        lines.add("# ${record.spikeId} — ${record.title}")
        lines.add("")

        if (record.executionMode != ExecutionMode.LIVE_ANDROID_DEVICE) {
            lines.add(
                "> **WARNING — MOCKED_CONTRACT_TEST:** This output was produced in an offline mocked/contract test environment and MUST NOT be committed as a live Android device Phase 0 spike record (`07` §1.1).",
            )
            lines.add("")
        }

        lines.add("- **Execution Mode:** `${record.executionMode.name}`")
        lines.add("- **Outcome:** **${record.status.name}**")
        lines.add("- **Feature Flag:** `${record.flagName} = ${record.primaryRecommended}`")
        lines.add("- **Target Record:** `${record.targetDoc}`")
        lines.add("- **Summary:** ${record.summary}")
        lines.add("- **Pass Criterion:** ${record.passCriterion}")
        lines.add("- **Fallback Action:** ${record.fallbackAction}")
        lines.add("- **Duration (ms):** ${max(0L, record.finishedAtMs - record.startedAtMs)}")
        lines.add("")

        lines.add("## Environment")
        lines.add("")
        val e = record.environment
        lines.add("- **Device / SoC:** ${e.deviceManufacturer} ${e.deviceModel} (SoC: `${e.socModel}`)")
        lines.add("- **Android OS:** Android ${e.androidRelease} (SDK ${e.androidSdkInt}), Airplane Mode=${e.airplaneModeOn}")
        lines.add(
            "- **AICore / Model:** installed=${e.aicorePackageInstalled}, versionName=${e.aicoreVersionName ?: "n/a"}, versionCode=${e.aicoreVersionCode ?: "n/a"}, baseModelName=`${e.baseModelName ?: "n/a"}`",
        )
        lines.add(
            "- **Firebase Config:** hasGoogleServicesJson=${e.hasGoogleServicesJson}, firebaseAppInitialized=${e.firebaseAppInitialized}",
        )
        lines.add("- **Pinned SDKs:** ${e.pinnedVersions.entries.joinToString(", ") { "${it.key}=${it.value}" }}")
        lines.add("- **Recorded At:** ${e.collectedAtIso}")
        lines.add("")

        if (record.missingPrerequisites.isNotEmpty()) {
            lines.add("## Missing Prerequisites")
            lines.add("")
            for (item in record.missingPrerequisites) {
                lines.add("- $item")
            }
            lines.add("")
        }

        lines.add("## Measurements")
        lines.add("")
        if (record.metrics.isEmpty()) {
            lines.add("- (none)")
        } else {
            lines.add("| Metric | Value |")
            lines.add("|---|---|")
            for ((k, v) in record.metrics) {
                lines.add("| `$k` | `${v.content}` |")
            }
        }
        lines.add("")

        if (record.manualChecklist.isNotEmpty()) {
            lines.add("## Manual Verification Checklist")
            lines.add("")
            for (item in record.manualChecklist) {
                val mark = if (item.completed) "x" else " "
                val note = if (!item.notes.isNullOrBlank()) " (${item.notes})" else ""
                lines.add("- [$mark] **${item.id}:** ${item.description}$note")
            }
            lines.add("")
        }

        lines.add("## Marker Resolution Preview")
        lines.add("")
        lines.add("| Spike ID | Marker Locations | Outcome | Source |")
        lines.add("|---|---|---|---|")
        lines.add(formatResolutionRow(record))
        lines.add("")

        if (record.rawSamples.isNotEmpty()) {
            lines.add("## Raw Samples (JSON)")
            lines.add("")
            lines.add("```json")
            lines.add(json.encodeToString(record.rawSamples))
            lines.add("```")
            lines.add("")
        }

        return lines.joinToString("\n")
    }

    fun formatSpikeSuiteMarkdown(records: List<SpikeRunRecord>): String {
        val lines = ArrayList<String>()
        lines.add("# Toulmin Phase 0 Android Spike Harness Export")
        lines.add("")
        lines.add("## RESOLUTION.md Candidate Rows")
        lines.add("")
        lines.add("| Spike ID | Marker Locations | Outcome | Source |")
        lines.add("|---|---|---|---|")
        for (r in records) {
            lines.add(formatResolutionRow(r))
        }
        lines.add("")
        for (r in records) {
            lines.add("---")
            lines.add("")
            lines.add(formatSpikeMarkdown(r))
        }
        return lines.joinToString("\n")
    }

    fun formatSpikeJsonExport(records: List<SpikeRunRecord>, exportedAtIso: String): String {
        val allLive = records.isNotEmpty() && records.all { it.executionMode == ExecutionMode.LIVE_ANDROID_DEVICE }
        val bundle = SpikeExportBundle(
            schemaVersion = "toulmin-spike-export-v1",
            warning = if (allLive) {
                null
            } else {
                "Contains non-live MOCKED_CONTRACT_TEST records; do not commit to docs/spikes/ as hardware proof."
            },
            exportedAtIso = exportedAtIso,
            count = records.size,
            records = records,
        )
        return json.encodeToString(bundle)
    }
}
