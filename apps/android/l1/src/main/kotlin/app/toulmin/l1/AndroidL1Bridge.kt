package app.toulmin.l1

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.ai.type.JsonSchema
import com.google.firebase.ai.type.PublicPreviewAPI
import app.toulmin.l1.schema.AltSourcesV1
import app.toulmin.l1.schema.B5CheckV1
import app.toulmin.l1.schema.O2PhysicalExtractFlatV1
import app.toulmin.l1.schema.O2PhysicalExtractV1
import app.toulmin.l1.schema.TriageFlatV1
import app.toulmin.l1.schema.TriageV1
import app.toulmin.l1.schema.VerdictFlatV1
import app.toulmin.l1.schema.VerdictV1
import app.toulmin.l1.schema.VerdictV1_cap20
import app.toulmin.l1.schema.VerdictV1_cap30
import app.toulmin.l1.schema.firebaseAISchema
import app.toulmin.spikes.BaseModelProbeResult
import app.toulmin.spikes.L1SpikeCallOutcome
import app.toulmin.spikes.L1SpikeDriver
import app.toulmin.spikes.L1StreamTimingOutcome
import app.toulmin.spikes.L1Tier
import app.toulmin.spikes.LinkedClassAudit
import app.toulmin.spikes.OnDeviceAvailability
import app.toulmin.spikes.PromptAndSchemaSot
import app.toulmin.spikes.TierCascadeProbeResult
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@OptIn(PublicPreviewAPI::class)
class AndroidL1Bridge(private val context: Context) : L1SpikeDriver {
    private val json = Json { encodeDefaults = true }

    private fun hasFirebaseApp(): Boolean =
        runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    override fun isFirebaseInitialized(): Boolean = hasFirebaseApp()

    override suspend fun checkStatus(tier: L1Tier): OnDeviceAvailability {
        if (!hasFirebaseApp()) return OnDeviceAvailability.UNAVAILABLE
        return OnDeviceModels.checkStatus(tier)
    }

    override suspend fun resolveTierCascade(): TierCascadeProbeResult {
        if (!hasFirebaseApp()) {
            return TierCascadeProbeResult(
                resolvedTier = L1Tier.NONE,
                attempts = emptyList(),
                onDeviceConfigClass = "com.google.firebase.ai.OnDeviceConfig",
                onDeviceModelOptionNames = listOf("PREVIEW", "PREVIEW_FAST", "STABLE"),
            )
        }
        return OnDeviceModels.resolveTier()
    }

    override suspend fun runSchemaCall(
        schemaId: String,
        prompt: String,
        tier: L1Tier,
        useFlatFallback: Boolean,
    ): L1SpikeCallOutcome {
        val targetSchemaId = if (useFlatFallback) {
            PromptAndSchemaSot.FLAT_FALLBACK_SCHEMAS[schemaId] ?: schemaId
        } else {
            schemaId
        }
        if (!hasFirebaseApp()) {
            return L1SpikeCallOutcome(
                success = false,
                schemaId = targetSchemaId,
                tier = tier,
                inferenceSource = "NONE",
                rawText = null,
                decodedSummary = null,
                outputChars = 0,
                latencyMs = 0L,
                errorClass = "IllegalStateException",
                errorCode = null,
                errorMessage = "FirebaseApp is not initialized",
            )
        }

        val callOutcome = CallL1.execute<String>(deadlineMs = 30_000L) {
            val model = OnDeviceModels.model(targetSchemaId, tier)
            when (targetSchemaId) {
                "TriageV1" -> runTyped(model, TriageV1.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "TriageFlatV1" -> runTyped(model, TriageFlatV1.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "VerdictV1" -> runTyped(model, VerdictV1.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "VerdictV1_cap30" -> runTyped(model, VerdictV1_cap30.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "VerdictV1_cap20" -> runTyped(model, VerdictV1_cap20.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "VerdictFlatV1" -> runTyped(model, VerdictFlatV1.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "B5CheckV1" -> runTyped(model, B5CheckV1.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "O2PhysicalExtractV1" -> runTyped(model, O2PhysicalExtractV1.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "O2PhysicalExtractFlatV1" -> runTyped(model, O2PhysicalExtractFlatV1.firebaseAISchema(), prompt) { json.encodeToString(it) }
                "AltSourcesV1" -> runTyped(model, AltSourcesV1.firebaseAISchema(), prompt) { json.encodeToString(it) }
                else -> error("Unknown schemaId: $targetSchemaId")
            }
        }

        val rawOrSerialized = callOutcome.rawText ?: callOutcome.data
        return L1SpikeCallOutcome(
            success = callOutcome.data != null && callOutcome.error == null,
            schemaId = targetSchemaId,
            tier = tier,
            inferenceSource = callOutcome.inferenceSource,
            rawText = callOutcome.rawText,
            decodedSummary = callOutcome.data,
            outputChars = rawOrSerialized?.length ?: 0,
            latencyMs = callOutcome.ms,
            errorClass = callOutcome.errorClass,
            errorCode = callOutcome.errorCode,
            errorMessage = callOutcome.errorMessage ?: callOutcome.error,
        )
    }

    private suspend fun <T : Any> runTyped(
        model: com.google.firebase.ai.GenerativeModel,
        schema: JsonSchema<T>,
        prompt: String,
        encode: (T) -> String,
    ): Triple<String, String, String?> {
        val resp = model.generateObject(schema, prompt)
        val obj = resp.getObject() ?: error("generateObject returned null object")
        val src = mapInferenceSource(resp.response.inferenceSource)
        val raw = resp.response.text
        return Triple(encode(obj), src, raw)
    }

    override suspend fun measureStreamingFirstToken(
        schemaId: String,
        prompt: String,
        tier: L1Tier,
    ): L1StreamTimingOutcome? {
        if (!hasFirebaseApp()) return null
        val t0 = System.nanoTime() / 1_000_000L
        var firstTokenMs = -1L
        val sb = StringBuilder()
        var lastSource = "NONE"
        return try {
            InferenceMutex.withLock {
                val model = OnDeviceModels.model(schemaId, tier)
                model.generateContentStream(prompt).collect { chunk ->
                    if (firstTokenMs < 0L) {
                        firstTokenMs = (System.nanoTime() / 1_000_000L) - t0
                    }
                    chunk.text?.let { sb.append(it) }
                    lastSource = mapInferenceSource(chunk.inferenceSource)
                }
            }
            val totalMs = (System.nanoTime() / 1_000_000L) - t0
            L1StreamTimingOutcome(
                success = sb.isNotEmpty(),
                timeToFirstTokenMs = if (firstTokenMs >= 0L) firstTokenMs else totalMs,
                totalMs = totalMs,
                outputChars = sb.length,
                inferenceSource = lastSource,
                errorMessage = null,
            )
        } catch (t: Throwable) {
            L1StreamTimingOutcome(
                success = false,
                timeToFirstTokenMs = -1L,
                totalMs = (System.nanoTime() / 1_000_000L) - t0,
                outputChars = sb.length,
                inferenceSource = "NONE",
                errorMessage = "${t.javaClass.simpleName}: ${t.message}",
            )
        }
    }

    override suspend fun getBaseModelName(): BaseModelProbeResult =
        AiCoreTelemetry.readBaseModelName()

    override fun inspectLinkedFirebaseClasses(): LinkedClassAudit =
        LinkedFirebaseAudit.inspect(AndroidL1Bridge::class.java.classLoader)
}
