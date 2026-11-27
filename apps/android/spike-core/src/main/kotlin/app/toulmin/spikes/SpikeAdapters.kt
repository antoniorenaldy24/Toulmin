package app.toulmin.spikes

import java.time.Instant

interface ClockProvider {
    fun nowEpochMs(): Long
    fun nowElapsedMs(): Long
    fun formatUtcIso(epochMs: Long): String = Instant.ofEpochMilli(epochMs).toString()
}

object SystemClockProvider : ClockProvider {
    override fun nowEpochMs(): Long = System.currentTimeMillis()
    override fun nowElapsedMs(): Long = System.nanoTime() / 1_000_000L
}

data class TierAttemptRecord(
    val tier: L1Tier,
    val success: Boolean,
    val inferenceSource: String,
    val errorClass: String?,
    val errorMessage: String?,
    val latencyMs: Long,
)

data class TierCascadeProbeResult(
    val resolvedTier: L1Tier,
    val attempts: List<TierAttemptRecord>,
    val onDeviceConfigClass: String,
    val onDeviceModelOptionNames: List<String>,
)

data class L1SpikeCallOutcome(
    val success: Boolean,
    val schemaId: String,
    val tier: L1Tier,
    val inferenceSource: String,
    val rawText: String?,
    val decodedSummary: String?,
    val outputChars: Int,
    val latencyMs: Long,
    val errorClass: String?,
    val errorCode: String?,
    val errorMessage: String?,
)

data class L1StreamTimingOutcome(
    val success: Boolean,
    val timeToFirstTokenMs: Long,
    val totalMs: Long,
    val outputChars: Int,
    val inferenceSource: String,
    val errorMessage: String?,
)

data class BaseModelProbeResult(
    val available: Boolean,
    val baseModelName: String?,
    val errorClass: String?,
    val errorMessage: String?,
)

data class LinkedClassAudit(
    val forbiddenNetworkClassesFound: List<String>,
    val debugClassesFound: List<String>,
    val aiLogicPresent: Boolean,
    val appCheckCorePresent: Boolean,
)

interface L1SpikeDriver {
    fun isFirebaseInitialized(): Boolean
    suspend fun checkStatus(tier: L1Tier = L1Tier.STABLE): OnDeviceAvailability
    suspend fun resolveTierCascade(): TierCascadeProbeResult
    suspend fun runSchemaCall(
        schemaId: String,
        prompt: String,
        tier: L1Tier = L1Tier.STABLE,
        useFlatFallback: Boolean = false,
    ): L1SpikeCallOutcome

    suspend fun measureStreamingFirstToken(
        schemaId: String,
        prompt: String,
        tier: L1Tier = L1Tier.STABLE,
    ): L1StreamTimingOutcome?

    suspend fun getBaseModelName(): BaseModelProbeResult
    fun inspectLinkedFirebaseClasses(): LinkedClassAudit
}

data class O2TestPhotoCase(
    val id: String,
    val category: O2PhotoCategory,
    val hasTwoRowHeader: Boolean,
    val headerRow1: List<String>,
    val headerRow2: List<String>,
    val dataRows: List<List<String>>,
    val targetRowIndex: Int,
    val expectedEvidenceString: String,
    val simulatedTiltAnglesDeg: List<Double> = emptyList(),
)

enum class O2PhotoCategory {
    CLEAN_TABLE,
    CAPTURE_GATE_TILTED,
    SHORT_TABLE,
}

data class OcrRecognitionOutcome(
    val success: Boolean,
    val lines: List<OcrLine>,
    val imageWidth: Int,
    val imageHeight: Int,
    val angleFieldPopulated: Boolean,
    val cornerPointsPopulated: Boolean,
    val errorMessage: String?,
)

data class PdfRendererProbeOutcome(
    val sdkInt: Int,
    val pdfOpened: Boolean,
    val pageCount: Int,
    val textApiMethodFound: Boolean,
    val extractedTextNonEmpty: Boolean,
    val extractedSnippet: String?,
    val notes: String,
)

interface OcrSpikeDriver {
    suspend fun recognizeTableCase(scenario: O2TestPhotoCase): OcrRecognitionOutcome
    suspend fun probePdfRendererTextApi(): PdfRendererProbeOutcome
}

data class FtsEvidenceSeed(
    val chunkId: String,
    val refId: String,
    val section: String,
    val text: String,
)

data class FtsQueryCase(
    val query: String,
    val expectedChunkId: String,
)

data class FtsProbeOutcome(
    val success: Boolean,
    val indexedCount: Int,
    val queriesRun: Int,
    val queriesMatched: Int,
    val driverName: String,
    val errorMessage: String?,
)

interface FtsSpikeDriver {
    suspend fun runRoomFts4Probe(
        documents: List<FtsEvidenceSeed>,
        queries: List<FtsQueryCase>,
    ): FtsProbeOutcome
}

data class NetworkByteCounter(
    val uidTxBytes: Long,
    val uidRxBytes: Long,
)

interface DeviceEnvProvider {
    fun inspectEnvironment(): AndroidEnvironmentMetadata
    fun readUidNetworkBytes(): NetworkByteCounter?
    fun loadPromptTemplate(fileName: String): String
    fun verifyPromptManifest(): Map<String, String>
}
