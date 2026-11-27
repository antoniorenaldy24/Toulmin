package app.toulmin.l1

import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceModelOption
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import app.toulmin.l1.schema.TriageFlatV1
import app.toulmin.l1.schema.firebaseAISchema
import app.toulmin.spikes.L1Tier
import app.toulmin.spikes.OnDeviceAvailability
import app.toulmin.spikes.TierAttemptRecord
import app.toulmin.spikes.TierCascadeProbeResult
import java.util.concurrent.ConcurrentHashMap

object AndroidOutputCaps {
    private val initialCaps = mapOf(
        "TriageV1" to 200,
        "TriageFlatV1" to 120,
        "VerdictV1" to 220,
        "VerdictV1_cap30" to 200,
        "VerdictV1_cap20" to 180,
        "VerdictFlatV1" to 220,
        "B5CheckV1" to 120,
        "O2PhysicalExtractV1" to 200,
        "O2PhysicalExtractFlatV1" to 140,
        "AltSourcesV1" to 120,
    )

    fun forSchema(schemaId: String): Int = initialCaps[schemaId] ?: 200
}

@OptIn(PublicPreviewAPI::class)
object OnDeviceModels {
    @Volatile
    var activeTier: L1Tier = L1Tier.PREVIEW
        private set

    @Volatile
    private var generation: Int = 0
    private val cache = ConcurrentHashMap<String, GenerativeModel>()

    private val ai by lazy {
        // bundledSample makes zero network calls and omits firebase-appcheck* (D-18)
        Firebase.ai(backend = GenerativeBackend.googleAI())
    }

    fun model(schemaId: String, tier: L1Tier = activeTier): GenerativeModel =
        cache.computeIfAbsent("$generation:${tier.name}:$schemaId") {
            val modelOption = when (tier) {
                L1Tier.PREVIEW -> OnDeviceModelOption.PREVIEW
                L1Tier.STABLE -> OnDeviceModelOption.STABLE
                L1Tier.NONE -> null
            }
            ai.generativeModel(
                modelName = "gemini-3.8-flash",
                onDeviceConfig = OnDeviceConfig(
                    mode = InferenceMode.ONLY_ON_DEVICE,
                    maxOutputTokens = AndroidOutputCaps.forSchema(schemaId),
                    modelOption = modelOption,
                ),
            )
        }

    suspend fun checkStatus(tier: L1Tier = L1Tier.STABLE): OnDeviceAvailability {
        return runCatching {
            val status = model("TriageFlatV1", tier).onDeviceExtension?.checkStatus()
            when (status) {
                OnDeviceModelStatus.AVAILABLE -> OnDeviceAvailability.AVAILABLE
                OnDeviceModelStatus.DOWNLOADABLE -> OnDeviceAvailability.DOWNLOADABLE
                OnDeviceModelStatus.DOWNLOADING -> OnDeviceAvailability.DOWNLOADING
                OnDeviceModelStatus.UNAVAILABLE -> OnDeviceAvailability.UNAVAILABLE
                else -> OnDeviceAvailability.UNKNOWN
            }
        }.getOrElse {
            OnDeviceAvailability.UNKNOWN
        }
    }

    /**
     * Cascade PREVIEW -> STABLE -> NONE; runs under InferenceMutex (`04` §5.2.1).
     */
    suspend fun resolveTier(): TierCascadeProbeResult = InferenceMutex.withLock {
        val attempts = ArrayList<TierAttemptRecord>(2)
        for (tier in listOf(L1Tier.PREVIEW, L1Tier.STABLE)) {
            activeTier = tier
            generation += 1
            val t0 = System.nanoTime() / 1_000_000L
            val res = runCatching {
                model("TriageFlatV1", tier).generateObject(TriageFlatV1.firebaseAISchema(), PING_PROMPT)
            }
            val elapsed = (System.nanoTime() / 1_000_000L) - t0
            if (res.isSuccess) {
                val resp = res.getOrThrow()
                val src = mapInferenceSource(resp.response.inferenceSource)
                attempts.add(
                    TierAttemptRecord(
                        tier = tier,
                        success = true,
                        inferenceSource = src,
                        errorClass = null,
                        errorMessage = null,
                        latencyMs = elapsed,
                    ),
                )
                return@withLock TierCascadeProbeResult(
                    resolvedTier = tier,
                    attempts = attempts,
                    onDeviceConfigClass = OnDeviceConfig::class.java.name,
                    onDeviceModelOptionNames = listOf("PREVIEW", "PREVIEW_FAST", "STABLE"),
                )
            } else {
                val err = res.exceptionOrNull()
                Log.i("Toulmin", "tier $tier failed: ${err?.javaClass?.simpleName}")
                attempts.add(
                    TierAttemptRecord(
                        tier = tier,
                        success = false,
                        inferenceSource = "NONE",
                        errorClass = err?.javaClass?.name,
                        errorMessage = err?.message,
                        latencyMs = elapsed,
                    ),
                )
            }
        }
        activeTier = L1Tier.NONE
        generation += 1
        TierCascadeProbeResult(
            resolvedTier = L1Tier.NONE,
            attempts = attempts,
            onDeviceConfigClass = OnDeviceConfig::class.java.name,
            onDeviceModelOptionNames = listOf("PREVIEW", "PREVIEW_FAST", "STABLE"),
        )
    }

    private const val PING_PROMPT =
        "Return ONLY a JSON object for the sentence: \"The trial enrolled 48 patients.\" " +
            "WORDS: 0:The 1:trial 2:enrolled 3:48 4:patients"
}
