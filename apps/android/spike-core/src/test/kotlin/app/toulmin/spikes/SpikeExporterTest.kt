package app.toulmin.spikes

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SpikeExporterTest {
    private fun sampleRecord(mode: ExecutionMode): SpikeRunRecord = SpikeRunRecord(
        spikeId = "S-A1",
        title = "Android PREVIEW -> STABLE Tier Cascade",
        category = "android-l1",
        targetDoc = "/docs/spikes/S-A1.md",
        flagName = "spike_s_a1_primary",
        primaryRecommended = true,
        executionMode = mode,
        status = SpikeStatus.PASS,
        summary = "Resolved STABLE; 10/10 ON_DEVICE.",
        passCriterion = "10/10 ON_DEVICE offline.",
        fallbackAction = "Disable Stage 2 on Android.",
        markerLocations = listOf("04 §5.2.1", "07 §1.4"),
        missingPrerequisites = emptyList(),
        environment = AndroidEnvironmentMetadata(
            executionMode = mode,
            deviceManufacturer = "Xiaomi",
            deviceModel = "15T Pro",
            socModel = "Dimensity 9400+",
            androidSdkInt = 35,
            androidRelease = "15",
            aicorePackageInstalled = true,
            aicoreVersionName = "1.0",
            aicoreVersionCode = 100L,
            baseModelName = "gemini-nano-v4",
            airplaneModeOn = true,
            hasGoogleServicesJson = true,
            firebaseAppInitialized = true,
            pinnedVersions = mapOf("firebaseBom" to "35.2.0"),
            collectedAtIso = "1970-01-01T00:00:00Z",
        ),
        metrics = mapOf("onDeviceSuccesses" to JsonPrimitive(10)),
        rawSamples = emptyList(),
        manualChecklist = emptyList(),
        startedAtMs = 100L,
        finishedAtMs = 350L,
    )

    @Test
    fun `mocked export stamps explicit warning in both Markdown and JSON`() {
        val mocked = sampleRecord(ExecutionMode.MOCKED_CONTRACT_TEST)
        val md = SpikeExporter.formatSpikeMarkdown(mocked)
        assertTrue(md.contains("WARNING — MOCKED_CONTRACT_TEST"))
        assertTrue(md.contains("| `S-A1` | 04 §5.2.1, 07 §1.4 | PASS (primary `spike_s_a1_primary = true`) | `/docs/spikes/S-A1.md` (MOCKED_CONTRACT_TEST) |"))

        val jsonText = SpikeExporter.formatSpikeJsonExport(listOf(mocked), "1970-01-01T00:00:00Z")
        val root = Json.parseToJsonElement(jsonText).jsonObject
        assertEquals("toulmin-spike-export-v1", root["schemaVersion"]?.jsonPrimitive?.content)
        assertTrue(root["warning"]?.jsonPrimitive?.content?.contains("MOCKED_CONTRACT_TEST") == true)
    }

    @Test
    fun `live device export omits mocked warning`() {
        val live = sampleRecord(ExecutionMode.LIVE_ANDROID_DEVICE)
        val md = SpikeExporter.formatSpikeMarkdown(live)
        assertFalse(md.contains("WARNING — MOCKED_CONTRACT_TEST"))

        val jsonText = SpikeExporter.formatSpikeJsonExport(listOf(live), "1970-01-01T00:00:00Z")
        val root = Json.parseToJsonElement(jsonText).jsonObject
        assertNull(root["warning"])
    }
}
