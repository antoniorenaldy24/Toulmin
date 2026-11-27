package app.toulmin.spikes

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

@Serializable
enum class AndroidSpikeId(val wireId: String) {
    S_N4("S-N4"),
    S_A1("S-A1"),
    S_A2("S-A2"),
    S_A3("S-A3"),
    S_A4("S-A4"),
    S_A5("S-A5"),
    S_RP("S-RP"),
}

@Serializable
enum class ExecutionMode {
    LIVE_ANDROID_DEVICE,
    MOCKED_CONTRACT_TEST,
}

@Serializable
enum class SpikeStatus {
    PASS,
    FAIL,
    UNAVAILABLE,
    SKIPPED,
    MANUAL_REQUIRED,
}

@Serializable
enum class L1Tier {
    PREVIEW,
    STABLE,
    NONE,
}

@Serializable
enum class OnDeviceAvailability {
    AVAILABLE,
    DOWNLOADABLE,
    DOWNLOADING,
    UNAVAILABLE,
    UNKNOWN,
}

@Serializable
data class AndroidEnvironmentMetadata(
    val executionMode: ExecutionMode,
    val deviceManufacturer: String,
    val deviceModel: String,
    val socModel: String,
    val androidSdkInt: Int,
    val androidRelease: String,
    val aicorePackageInstalled: Boolean,
    val aicoreVersionName: String?,
    val aicoreVersionCode: Long?,
    val baseModelName: String?,
    val airplaneModeOn: Boolean,
    val hasGoogleServicesJson: Boolean,
    val firebaseAppInitialized: Boolean,
    val pinnedVersions: Map<String, String>,
    val collectedAtIso: String,
)

@Serializable
data class SpikeManualStepItem(
    val id: String,
    val description: String,
    val completed: Boolean,
    val notes: String? = null,
)

@Serializable
data class SpikeRunRecord(
    val spikeId: String,
    val title: String,
    val category: String,
    val targetDoc: String,
    val flagName: String,
    val primaryRecommended: Boolean,
    val executionMode: ExecutionMode,
    val status: SpikeStatus,
    val summary: String,
    val passCriterion: String,
    val fallbackAction: String,
    val markerLocations: List<String>,
    val missingPrerequisites: List<String>,
    val environment: AndroidEnvironmentMetadata,
    val metrics: Map<String, JsonPrimitive>,
    val rawSamples: List<JsonObject>,
    val manualChecklist: List<SpikeManualStepItem>,
    val startedAtMs: Long,
    val finishedAtMs: Long,
)

@Serializable
data class SpikeRunOptions(
    val executionMode: ExecutionMode = ExecutionMode.LIVE_ANDROID_DEVICE,
    val smokeMode: Boolean = false,
    val includeQuotaBurst: Boolean = false,
    val sa1Calls: Int = 10,
    val sa2CallsPerSchema: Int = 20,
    val sa3CallsPerSchema: Int = 30,
    val sa3BurstCalls: Int = 200,
)

@Serializable
data class SpikeExportBundle(
    val schemaVersion: String = "toulmin-spike-export-v1",
    val warning: String? = null,
    val exportedAtIso: String,
    val count: Int,
    val records: List<SpikeRunRecord>,
)
