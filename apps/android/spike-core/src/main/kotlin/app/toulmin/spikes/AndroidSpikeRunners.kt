package app.toulmin.spikes

import app.toulmin.core.SanitizeTier
import app.toulmin.core.norm
import app.toulmin.core.sanitizeText
import app.toulmin.core.tokBM25
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.abs

class AndroidSpikeRunner(
    private val envProvider: DeviceEnvProvider,
    private val l1Driver: L1SpikeDriver,
    private val ocrDriver: OcrSpikeDriver,
    private val ftsDriver: FtsSpikeDriver,
    private val clock: ClockProvider = SystemClockProvider,
) {
    suspend fun runAll(options: SpikeRunOptions = SpikeRunOptions()): List<SpikeRunRecord> = listOf(
        runSN4(options),
        runSA1(options),
        runSA2(options),
        runSA3(options),
        runSA4(options),
        runSA5(options),
        runSRPAndroidBoundary(options),
    )

    suspend fun runById(id: AndroidSpikeId, options: SpikeRunOptions = SpikeRunOptions()): SpikeRunRecord =
        when (id) {
            AndroidSpikeId.S_N4 -> runSN4(options)
            AndroidSpikeId.S_A1 -> runSA1(options)
            AndroidSpikeId.S_A2 -> runSA2(options)
            AndroidSpikeId.S_A3 -> runSA3(options)
            AndroidSpikeId.S_A4 -> runSA4(options)
            AndroidSpikeId.S_A5 -> runSA5(options)
            AndroidSpikeId.S_RP -> runSRPAndroidBoundary(options)
        }

    suspend fun runSN4(options: SpikeRunOptions = SpikeRunOptions()): SpikeRunRecord {
        val started = clock.nowElapsedMs()
        val env = envProvider.inspectEnvironment()
        val missing = ArrayList<String>()
        if (!env.aicorePackageInstalled && options.executionMode == ExecutionMode.LIVE_ANDROID_DEVICE) {
            missing.add("com.google.android.aicore package is not installed on device")
        }

        val probe = l1Driver.getBaseModelName()
        val status = when {
            !env.aicorePackageInstalled && options.executionMode == ExecutionMode.LIVE_ANDROID_DEVICE ->
                SpikeStatus.UNAVAILABLE
            probe.available && !probe.baseModelName.isNullOrBlank() -> SpikeStatus.PASS
            env.aicoreVersionCode != null -> SpikeStatus.PASS
            else -> SpikeStatus.UNAVAILABLE
        }
        val primary = status == SpikeStatus.PASS && probe.available && !probe.baseModelName.isNullOrBlank()
        val metrics = linkedMapOf(
            "aicoreInstalled" to JsonPrimitive(env.aicorePackageInstalled),
            "aicoreVersionCode" to JsonPrimitive(env.aicoreVersionCode ?: -1L),
            "aicoreVersionName" to JsonPrimitive(env.aicoreVersionName ?: "none"),
            "baseModelName" to JsonPrimitive(probe.baseModelName ?: "unavailable"),
            "baseModelReadable" to JsonPrimitive(primary),
            "socModel" to JsonPrimitive(env.socModel),
            "deviceModel" to JsonPrimitive("${env.deviceManufacturer} ${env.deviceModel}"),
        )
        val rawSamples = listOf(
            buildJsonObject {
                put("baseModelName", probe.baseModelName ?: "null")
                put("aicoreVersionCode", env.aicoreVersionCode ?: -1L)
                put("errorClass", probe.errorClass ?: "none")
                put("errorMessage", probe.errorMessage ?: "none")
            },
        )
        val summary = if (primary) {
            "getBaseModelName() returned '${probe.baseModelName}' with AICore versionCode=${env.aicoreVersionCode}."
        } else if (status == SpikeStatus.PASS) {
            "getBaseModelName() unavailable (${probe.errorClass ?: "empty"}); fallback AICore versionCode=${env.aicoreVersionCode} recorded."
        } else {
            "AICore / base model telemetry unavailable on this device (${probe.errorMessage ?: "missing AICore"})."
        }

        return SpikeRunRecord(
            spikeId = "S-N4",
            title = "Android AICore Model Generation & getBaseModelName()",
            category = "android-l1",
            targetDoc = "/docs/spikes/S-N4.md",
            flagName = "spike_s_n4_primary",
            primaryRecommended = primary,
            executionMode = options.executionMode,
            status = status,
            summary = summary,
            passCriterion = "baseModelName and AICore versionCode recorded on target device (07 §1.3).",
            fallbackAction = "Record AICore version from system settings and state 'model generation per Google's device table'.",
            markerLocations = listOf("00 §6.1", "04 §5.2.1", "06 §3.4", "07 §1.3"),
            missingPrerequisites = missing,
            environment = env.copy(baseModelName = probe.baseModelName ?: env.baseModelName),
            metrics = metrics,
            rawSamples = rawSamples,
            manualChecklist = listOf(
                SpikeManualStepItem(
                    id = "sn4-screenshot",
                    description = "Capture Proof/Settings screenshot showing baseModelName and AICore versionCode on Xiaomi 15T Pro.",
                    completed = false,
                ),
            ),
            startedAtMs = started,
            finishedAtMs = clock.nowElapsedMs(),
        )
    }

    suspend fun runSA1(options: SpikeRunOptions = SpikeRunOptions()): SpikeRunRecord {
        val started = clock.nowElapsedMs()
        val env = envProvider.inspectEnvironment()
        val missing = ArrayList<String>()
        if (!env.firebaseAppInitialized) {
            missing.add("FirebaseApp not initialized (add local apps/android/app/google-services.json for live Firebase AI calls)")
        }
        if (!env.aicorePackageInstalled && options.executionMode == ExecutionMode.LIVE_ANDROID_DEVICE) {
            missing.add("com.google.android.aicore package not installed")
        }

        if (missing.isNotEmpty()) {
            return SpikeRunRecord(
                spikeId = "S-A1",
                title = "Android PREVIEW -> STABLE Tier Cascade & Airplane Mode",
                category = "android-l1",
                targetDoc = "/docs/spikes/S-A1.md",
                flagName = "spike_s_a1_primary",
                primaryRecommended = false,
                executionMode = options.executionMode,
                status = SpikeStatus.UNAVAILABLE,
                summary = "Missing runtime prerequisites: ${missing.joinToString("; ")}.",
                passCriterion = "Resolved tier recorded; Airplane Mode STABLE 10/10 with inferenceSource = ON_DEVICE (07 §1.4).",
                fallbackAction = "Disable O1/Stage 2 on Android; keep OCR, deterministic Select-row matching, and L0 only.",
                markerLocations = listOf("04 §5.2.1", "07 §1.4"),
                missingPrerequisites = missing,
                environment = env,
                metrics = mapOf("firebaseAppInitialized" to JsonPrimitive(env.firebaseAppInitialized)),
                rawSamples = emptyList(),
                manualChecklist = emptyList(),
                startedAtMs = started,
                finishedAtMs = clock.nowElapsedMs(),
            )
        }

        val cascade = l1Driver.resolveTierCascade()
        val template = envProvider.loadPromptTemplate("stage1.txt")
        val targetCalls = if (options.smokeMode) 3 else options.sa1Calls
        val samples = ArrayList<JsonObject>(targetCalls + cascade.attempts.size)
        for (att in cascade.attempts) {
            samples.add(
                buildJsonObject {
                    put("phase", "tier_cascade")
                    put("tier", att.tier.name)
                    put("success", att.success)
                    put("inferenceSource", att.inferenceSource)
                    put("errorClass", att.errorClass ?: "none")
                    put("errorMessage", att.errorMessage ?: "none")
                    put("latencyMs", att.latencyMs)
                },
            )
        }

        var onDeviceSuccesses = 0
        if (cascade.resolvedTier != L1Tier.NONE) {
            for (i in 0 until targetCalls) {
                val prompt = SpikeFixtures.stage1PromptSample(i, template)
                val out = l1Driver.runSchemaCall("TriageV1", prompt, cascade.resolvedTier, useFlatFallback = false)
                if (out.success && out.inferenceSource == "ON_DEVICE") {
                    onDeviceSuccesses++
                }
                samples.add(
                    buildJsonObject {
                        put("phase", "offline_triage")
                        put("callIndex", i)
                        put("success", out.success)
                        put("inferenceSource", out.inferenceSource)
                        put("latencyMs", out.latencyMs)
                        put("errorClass", out.errorClass ?: "none")
                        put("errorMessage", out.errorMessage ?: "none")
                    },
                )
            }
        }

        val fullCountMet = !options.smokeMode && targetCalls >= 10
        val callsPassed = cascade.resolvedTier != L1Tier.NONE && onDeviceSuccesses == targetCalls
        val status = when {
            cascade.resolvedTier == L1Tier.NONE -> SpikeStatus.FAIL
            callsPassed && !options.smokeMode && env.airplaneModeOn -> SpikeStatus.PASS
            callsPassed -> SpikeStatus.MANUAL_REQUIRED
            else -> SpikeStatus.FAIL
        }
        val primary = status == SpikeStatus.PASS

        return SpikeRunRecord(
            spikeId = "S-A1",
            title = "Android PREVIEW -> STABLE Tier Cascade & Airplane Mode",
            category = "android-l1",
            targetDoc = "/docs/spikes/S-A1.md",
            flagName = "spike_s_a1_primary",
            primaryRecommended = primary,
            executionMode = options.executionMode,
            status = status,
            summary = "Resolved tier=${cascade.resolvedTier.name}; $onDeviceSuccesses/$targetCalls calls returned ON_DEVICE (airplaneModeOn=${env.airplaneModeOn}, smokeMode=${options.smokeMode}).",
            passCriterion = "Resolved tier recorded; Airplane Mode STABLE 10/10 with inferenceSource = ON_DEVICE (07 §1.4).",
            fallbackAction = "Disable O1/Stage 2 on Android; keep OCR, deterministic Select-row matching, and L0 only.",
            markerLocations = listOf("04 §5.2.1", "07 §1.4"),
            missingPrerequisites = emptyList(),
            environment = env,
            metrics = linkedMapOf(
                "resolvedTier" to JsonPrimitive(cascade.resolvedTier.name),
                "onDeviceSuccesses" to JsonPrimitive(onDeviceSuccesses),
                "totalCalls" to JsonPrimitive(targetCalls),
                "fullCountMet" to JsonPrimitive(fullCountMet),
                "airplaneModeOn" to JsonPrimitive(env.airplaneModeOn),
                "onDeviceConfigClass" to JsonPrimitive(cascade.onDeviceConfigClass),
                "onDeviceModelOptions" to JsonPrimitive(cascade.onDeviceModelOptionNames.joinToString(",")),
            ),
            rawSamples = samples,
            manualChecklist = listOf(
                SpikeManualStepItem(
                    id = "sa1-airplane",
                    description = "Confirm S-A1 was executed in Airplane Mode on Xiaomi 15T Pro with 10/10 ON_DEVICE responses.",
                    completed = env.airplaneModeOn && callsPassed && fullCountMet,
                    notes = if (!env.airplaneModeOn) "Device Airplane Mode was OFF during this run." else null,
                ),
            ),
            startedAtMs = started,
            finishedAtMs = clock.nowElapsedMs(),
        )
    }

    suspend fun runSA2(options: SpikeRunOptions = SpikeRunOptions()): SpikeRunRecord {
        val started = clock.nowElapsedMs()
        val env = envProvider.inspectEnvironment()
        val missing = ArrayList<String>()
        if (!env.firebaseAppInitialized) {
            missing.add("FirebaseApp not initialized (missing local google-services.json)")
        }
        if (missing.isNotEmpty()) {
            return SpikeRunRecord(
                spikeId = "S-A2",
                title = "Android @Generable + KSP + generateObject (Pre-decode)",
                category = "android-l1",
                targetDoc = "/docs/spikes/S-A2.md",
                flagName = "spike_s_a2_primary",
                primaryRecommended = false,
                executionMode = options.executionMode,
                status = SpikeStatus.UNAVAILABLE,
                summary = "Missing runtime prerequisites: ${missing.joinToString("; ")}.",
                passCriterion = "20/20 decode per schema (TriageV1, VerdictV1, VerdictV1_cap30, B5CheckV1, O2PhysicalExtractV1), nested lists/enums accepted, inferenceSource readable.",
                fallbackAction = "Use flat schemas (TriageFlatV1, VerdictFlatV1, O2PhysicalExtractFlatV1) with L0 string validation and generateContent fallback.",
                markerLocations = listOf("00 §6.2", "04 §2.1", "04 §2.2", "04 §5.2.1", "07 §1.4"),
                missingPrerequisites = missing,
                environment = env,
                metrics = emptyMap(),
                rawSamples = emptyList(),
                manualChecklist = emptyList(),
                startedAtMs = started,
                finishedAtMs = clock.nowElapsedMs(),
            )
        }

        val callsPerSchema = if (options.smokeMode) 3 else options.sa2CallsPerSchema
        val stage1Tpl = envProvider.loadPromptTemplate("stage1.txt")
        val stage2Tpl = envProvider.loadPromptTemplate("stage2.txt")
        val b5Tpl = envProvider.loadPromptTemplate("b5.txt")
        val o2Tpl = envProvider.loadPromptTemplate("o2.txt")

        val samples = ArrayList<JsonObject>()
        val metrics = linkedMapOf<String, JsonPrimitive>(
            "callsPerSchema" to JsonPrimitive(callsPerSchema),
            "smokeMode" to JsonPrimitive(options.smokeMode),
        )
        var allSchemasPassed = true
        var rawJsonExposedCount = 0
        var keyOrderOkCount = 0
        var totalPrimaryCalls = 0
        var flatFallbackTested = 0
        var flatFallbackPassed = 0

        for (schemaId in PromptAndSchemaSot.PRIMARY_ON_DEVICE_SCHEMAS) {
            var decodedOk = 0
            var onDeviceOk = 0
            for (i in 0 until callsPerSchema) {
                val prompt = buildPromptForSchema(schemaId, i, stage1Tpl, stage2Tpl, b5Tpl, o2Tpl)
                val out = l1Driver.runSchemaCall(schemaId, prompt, L1Tier.STABLE, useFlatFallback = false)
                totalPrimaryCalls++
                if (out.success) decodedOk++
                if (out.inferenceSource == "ON_DEVICE") onDeviceOk++
                val expectedKeys = PromptAndSchemaSot.SCHEMA_KEYS[schemaId].orEmpty()
                val rawText = out.rawText
                val keyOrderOk = if (rawText != null) {
                    rawJsonExposedCount++
                    SpikeStats.hasExpectedKeyOrder(rawText, expectedKeys)
                } else {
                    false
                }
                if (keyOrderOk) keyOrderOkCount++

                samples.add(
                    buildJsonObject {
                        put("schemaId", schemaId)
                        put("callIndex", i)
                        put("success", out.success)
                        put("inferenceSource", out.inferenceSource)
                        put("rawJsonExposed", rawText != null)
                        put("keyOrderOk", keyOrderOk)
                        put("latencyMs", out.latencyMs)
                        put("errorClass", out.errorClass ?: "none")
                    },
                )
            }
            metrics["${schemaId}_decoded"] = JsonPrimitive(decodedOk)
            metrics["${schemaId}_onDevice"] = JsonPrimitive(onDeviceOk)
            if (decodedOk < callsPerSchema || onDeviceOk < callsPerSchema) {
                allSchemasPassed = false
                val flatId = PromptAndSchemaSot.FLAT_FALLBACK_SCHEMAS[schemaId]
                if (flatId != null) {
                    flatFallbackTested++
                    val prompt = buildPromptForSchema(schemaId, 0, stage1Tpl, stage2Tpl, b5Tpl, o2Tpl)
                    val flatOut = l1Driver.runSchemaCall(schemaId, prompt, L1Tier.STABLE, useFlatFallback = true)
                    if (flatOut.success) flatFallbackPassed++
                    metrics["${flatId}_fallback_ok"] = JsonPrimitive(flatOut.success)
                }
            }
        }

        metrics["rawJsonExposedCalls"] = JsonPrimitive(rawJsonExposedCount)
        metrics["keyOrderOkCalls"] = JsonPrimitive(keyOrderOkCount)
        metrics["totalPrimaryCalls"] = JsonPrimitive(totalPrimaryCalls)
        metrics["flatFallbackTested"] = JsonPrimitive(flatFallbackTested)
        metrics["flatFallbackPassed"] = JsonPrimitive(flatFallbackPassed)
        for ((k, v) in env.pinnedVersions) {
            metrics["pinned_$k"] = JsonPrimitive(v)
        }

        val status = when {
            !allSchemasPassed -> SpikeStatus.FAIL
            options.smokeMode -> SpikeStatus.MANUAL_REQUIRED
            else -> SpikeStatus.PASS
        }
        val primary = status == SpikeStatus.PASS

        return SpikeRunRecord(
            spikeId = "S-A2",
            title = "Android @Generable + KSP + generateObject (Pre-decode)",
            category = "android-l1",
            targetDoc = "/docs/spikes/S-A2.md",
            flagName = "spike_s_a2_primary",
            primaryRecommended = primary,
            executionMode = options.executionMode,
            status = status,
            summary = "Tested ${PromptAndSchemaSot.PRIMARY_ON_DEVICE_SCHEMAS.size} @Generable schemas x $callsPerSchema calls; allSchemasPassed=$allSchemasPassed, rawJsonExposed=$rawJsonExposedCount/$totalPrimaryCalls.",
            passCriterion = "20/20 decode per schema, nested lists & enums accepted, inferenceSource readable, versions pinned in libs.versions.toml.",
            fallbackAction = "Use flat schemas (TriageFlatV1, VerdictFlatV1, O2PhysicalExtractFlatV1) with L0 string validation and generateContent fallback.",
            markerLocations = listOf("00 §6.2", "04 §2.1", "04 §2.2", "04 §5.2.1", "07 §1.4"),
            missingPrerequisites = emptyList(),
            environment = env,
            metrics = metrics,
            rawSamples = samples,
            manualChecklist = listOf(
                SpikeManualStepItem(
                    id = "sa2-full20",
                    description = "Run full 20 calls per schema (non-smoke) on Xiaomi 15T Pro before l0-freeze-a.",
                    completed = !options.smokeMode && allSchemasPassed,
                ),
            ),
            startedAtMs = started,
            finishedAtMs = clock.nowElapsedMs(),
        )
    }

    suspend fun runSA3(options: SpikeRunOptions = SpikeRunOptions()): SpikeRunRecord {
        val started = clock.nowElapsedMs()
        val env = envProvider.inspectEnvironment()
        val missing = ArrayList<String>()
        if (!env.firebaseAppInitialized) {
            missing.add("FirebaseApp not initialized (missing local google-services.json)")
        }
        if (missing.isNotEmpty()) {
            return SpikeRunRecord(
                spikeId = "S-A3",
                title = "Android Latency Split, Token Budgets & Quota Codes",
                category = "android-l1",
                targetDoc = "/docs/spikes/S-A3.md",
                flagName = "spike_s_a3_primary",
                primaryRecommended = false,
                executionMode = options.executionMode,
                status = SpikeStatus.UNAVAILABLE,
                summary = "Missing runtime prerequisites: ${missing.joinToString("; ")}.",
                passCriterion = "Stage 2 p95 <= 10 s; output caps computed; l1_deadline_ms = max(30000, 2*p99) per schema; quota codes recorded.",
                fallbackAction = "If Stage 2 p95 > 10 s, set reasoning_word_cap = 30 before R1-E or run Stage 2 on demand only; treat unknown non-BUSY quota errors as long-term.",
                markerLocations = listOf("04 §1.3", "04 §1.4", "04 §1.5", "07 §1.4"),
                missingPrerequisites = missing,
                environment = env,
                metrics = emptyMap(),
                rawSamples = emptyList(),
                manualChecklist = emptyList(),
                startedAtMs = started,
                finishedAtMs = clock.nowElapsedMs(),
            )
        }

        val callsPerSchema = if (options.smokeMode) 3 else options.sa3CallsPerSchema
        val stage1Tpl = envProvider.loadPromptTemplate("stage1.txt")
        val stage2Tpl = envProvider.loadPromptTemplate("stage2.txt")
        val b5Tpl = envProvider.loadPromptTemplate("b5.txt")
        val o2Tpl = envProvider.loadPromptTemplate("o2.txt")

        val metrics = linkedMapOf<String, JsonPrimitive>(
            "callsPerSchema" to JsonPrimitive(callsPerSchema),
            "smokeMode" to JsonPrimitive(options.smokeMode),
        )
        val samples = ArrayList<JsonObject>()
        var stage2Cap40P95Ms = 0.0
        var stage2Cap30P95Ms = 0.0
        var allCallsSucceeded = true

        for (schemaId in PromptAndSchemaSot.PRIMARY_ON_DEVICE_SCHEMAS) {
            val latencies = ArrayList<Double>(callsPerSchema)
            val inputTokens = ArrayList<Double>(callsPerSchema)
            val outputTokens = ArrayList<Double>(callsPerSchema)
            for (i in 0 until callsPerSchema) {
                val prompt = buildPromptForSchema(schemaId, i, stage1Tpl, stage2Tpl, b5Tpl, o2Tpl)
                val out = l1Driver.runSchemaCall(schemaId, prompt, L1Tier.STABLE)
                if (!out.success) allCallsSucceeded = false
                latencies.add(out.latencyMs.toDouble())
                inputTokens.add(SpikeStats.estimateAndroidTokens(prompt.length).toDouble())
                outputTokens.add(SpikeStats.estimateAndroidTokens(out.outputChars).toDouble())
                samples.add(
                    buildJsonObject {
                        put("phase", "sequential")
                        put("schemaId", schemaId)
                        put("callIndex", i)
                        put("success", out.success)
                        put("latencyMs", out.latencyMs)
                        put("inputEstTokens", SpikeStats.estimateAndroidTokens(prompt.length))
                        put("outputChars", out.outputChars)
                        put("outputEstTokens", SpikeStats.estimateAndroidTokens(out.outputChars))
                        put("errorClass", out.errorClass ?: "none")
                        put("errorCode", out.errorCode ?: "none")
                        put("errorMessage", out.errorMessage?.take(120) ?: "none")
                    },
                )
            }
            val p50 = SpikeStats.percentile(latencies, 0.50)
            val p95 = SpikeStats.percentile(latencies, 0.95)
            val p99 = SpikeStats.percentile(latencies, 0.99)
            val tailMedian = if (latencies.size > 1) SpikeStats.median(latencies.drop(1)) else latencies.firstOrNull() ?: 0.0
            val tSessionEst = maxOf(0.0, (latencies.firstOrNull() ?: 0.0) - tailMedian)
            val p95OutTok = SpikeStats.percentile(outputTokens, 0.95)
            val maxInTok = inputTokens.maxOrNull() ?: 0.0
            val recommendedOutCap = SpikeStats.computeAndroidOutputCap(p95OutTok)
            val recommendedDeadlineMs = SpikeStats.computeAndroidDeadlineMs(p99)

            metrics["${schemaId}_p50_ms"] = JsonPrimitive(SpikeStats.round2(p50))
            metrics["${schemaId}_p95_ms"] = JsonPrimitive(SpikeStats.round2(p95))
            metrics["${schemaId}_p99_ms"] = JsonPrimitive(SpikeStats.round2(p99))
            metrics["${schemaId}_t_session_est_ms"] = JsonPrimitive(SpikeStats.round2(tSessionEst))
            metrics["${schemaId}_max_in_est_tokens"] = JsonPrimitive(maxInTok.toInt())
            metrics["${schemaId}_recommended_max_output_tokens"] = JsonPrimitive(recommendedOutCap)
            metrics["${schemaId}_recommended_l1_deadline_ms"] = JsonPrimitive(recommendedDeadlineMs)

            if (schemaId == "VerdictV1") stage2Cap40P95Ms = p95
            if (schemaId == "VerdictV1_cap30") stage2Cap30P95Ms = p95
        }

        // Optional streaming prefill probe for t_prefill / t_decode split
        val streamSample = l1Driver.measureStreamingFirstToken(
            "VerdictV1",
            buildPromptForSchema("VerdictV1", 0, stage1Tpl, stage2Tpl, b5Tpl, o2Tpl),
            L1Tier.STABLE,
        )
        if (streamSample != null) {
            metrics["stream_t_prefill_ms"] = JsonPrimitive(streamSample.timeToFirstTokenMs)
            metrics["stream_total_ms"] = JsonPrimitive(streamSample.totalMs)
            metrics["stream_decode_ms"] = JsonPrimitive(maxOf(0L, streamSample.totalMs - streamSample.timeToFirstTokenMs))
        }

        // Optional 200-call quota burst
        val observedQuotaCodes = LinkedHashSet<String>()
        if (options.includeQuotaBurst) {
            val burstPrompt = SpikeFixtures.stage1PromptSample(10, stage1Tpl)
            for (b in 0 until options.sa3BurstCalls) {
                val out = l1Driver.runSchemaCall("TriageV1", burstPrompt, L1Tier.STABLE)
                if (!out.success) {
                    observedQuotaCodes.add("${out.errorClass ?: "Err"}:${out.errorCode ?: out.errorMessage ?: "unknown"}")
                }
            }
            metrics["quotaBurstCalls"] = JsonPrimitive(options.sa3BurstCalls)
            metrics["observedQuotaCodes"] = JsonPrimitive(observedQuotaCodes.joinToString("; ").ifEmpty { "none_triggered" })
        }

        val reasoningCapRecommended = if (stage2Cap40P95Ms > 10_000.0) 30 else 40
        metrics["recommended_reasoning_word_cap"] = JsonPrimitive(reasoningCapRecommended)

        val status = when {
            !allCallsSucceeded -> SpikeStatus.FAIL
            stage2Cap40P95Ms > 10_000.0 -> SpikeStatus.FAIL
            options.smokeMode || !options.includeQuotaBurst -> SpikeStatus.MANUAL_REQUIRED
            else -> SpikeStatus.PASS
        }
        val primary = status == SpikeStatus.PASS && reasoningCapRecommended == 40

        return SpikeRunRecord(
            spikeId = "S-A3",
            title = "Android Latency Split, Token Budgets & Quota Codes",
            category = "android-l1",
            targetDoc = "/docs/spikes/S-A3.md",
            flagName = "spike_s_a3_primary",
            primaryRecommended = primary,
            executionMode = options.executionMode,
            status = status,
            summary = "VerdictV1 p95=${SpikeStats.round2(stage2Cap40P95Ms)} ms (cap30 p95=${SpikeStats.round2(stage2Cap30P95Ms)} ms); recommended reasoning_word_cap=$reasoningCapRecommended.",
            passCriterion = "Stage 2 p95 <= 10 s; output caps computed; l1_deadline_ms = max(30000, 2*p99); quota codes recorded.",
            fallbackAction = "If p95 > 10 s, switch to reasoning_word_cap = 30 before R1-E or on-demand Stage 2; treat non-BUSY quota errors as long-term.",
            markerLocations = listOf("04 §1.3", "04 §1.4", "04 §1.5", "07 §1.4"),
            missingPrerequisites = emptyList(),
            environment = env,
            metrics = metrics,
            rawSamples = samples,
            manualChecklist = listOf(
                SpikeManualStepItem(
                    id = "sa3-quota-burst",
                    description = "Run 200 back-to-back calls on Xiaomi 15T Pro to capture BUSY and daily/battery quota error codes.",
                    completed = options.includeQuotaBurst,
                ),
            ),
            startedAtMs = started,
            finishedAtMs = clock.nowElapsedMs(),
        )
    }

    suspend fun runSA4(options: SpikeRunOptions = SpikeRunOptions()): SpikeRunRecord {
        val started = clock.nowElapsedMs()
        val env = envProvider.inspectEnvironment()
        val cases = SpikeFixtures.o2TestCases()
        val samples = ArrayList<JsonObject>(cases.size + 1)

        var anglePopulatedCount = 0
        var cornerPointsPopulatedCount = 0
        var cleanAccepted = 0
        var cleanRejected = 0
        var cleanCorrect = 0
        var tiltedRejected = 0
        var shortAccepted = 0
        var shortIqrSkipped = 0
        var ocrFailures = 0

        for (tc in cases) {
            val ocr = ocrDriver.recognizeTableCase(tc)
            if (!ocr.success) {
                ocrFailures++
                samples.add(
                    buildJsonObject {
                        put("caseId", tc.id)
                        put("category", tc.category.name)
                        put("success", false)
                        put("error", ocr.errorMessage ?: "ocr_failed")
                    },
                )
                continue
            }
            if (ocr.angleFieldPopulated) anglePopulatedCount++
            if (ocr.cornerPointsPopulated) cornerPointsPopulatedCount++

            val res = O2Geometry.runSelectRowPipeline(ocr, tc.hasTwoRowHeader, tc.targetRowIndex)
            when (tc.category) {
                O2PhotoCategory.CLEAN_TABLE -> {
                    if (res.gate.accepted) {
                        cleanAccepted++
                        if (res.evidenceString == tc.expectedEvidenceString) {
                            cleanCorrect++
                        }
                    } else {
                        cleanRejected++
                    }
                }
                O2PhotoCategory.CAPTURE_GATE_TILTED -> {
                    if (!res.gate.accepted) tiltedRejected++
                }
                O2PhotoCategory.SHORT_TABLE -> {
                    if (res.gate.accepted) shortAccepted++
                    if (res.gate.iqrSkipped) shortIqrSkipped++
                }
            }
            samples.add(
                buildJsonObject {
                    put("caseId", tc.id)
                    put("category", tc.category.name)
                    put("accepted", res.gate.accepted)
                    put("iqrSkipped", res.gate.iqrSkipped)
                    put("qualifyingLines", res.gate.qualifyingLineCount)
                    put("iqrDeg", res.gate.iqrDeg ?: -1.0)
                    put("medianAngleDeg", res.gate.medianAngleDeg)
                    put("evidenceString", res.evidenceString)
                    put("expected", tc.expectedEvidenceString)
                },
            )
        }

        val pdfProbe = ocrDriver.probePdfRendererTextApi()
        samples.add(
            buildJsonObject {
                put("caseId", "pdf-renderer-probe")
                put("sdkInt", pdfProbe.sdkInt)
                put("pdfOpened", pdfProbe.pdfOpened)
                put("textApiMethodFound", pdfProbe.textApiMethodFound)
                put("extractedTextNonEmpty", pdfProbe.extractedTextNonEmpty)
                put("notes", pdfProbe.notes)
            },
        )

        val selectRowAccuracy = cleanCorrect.toDouble() / 10.0
        val passed = ocrFailures == 0 &&
            selectRowAccuracy >= 0.90 &&
            tiltedRejected >= 5 &&
            cleanRejected <= 1 &&
            shortAccepted == 4 &&
            shortIqrSkipped == 4 &&
            (anglePopulatedCount > 0 || cornerPointsPopulatedCount > 0)

        val primary = passed && anglePopulatedCount == cases.size && pdfProbe.textApiMethodFound

        return SpikeRunRecord(
            spikeId = "S-A4",
            title = "Android Bundled ML Kit OCR, Capture Gate, Select-Row & PdfRenderer (Pre-decode)",
            category = "android-ocr",
            targetDoc = "/docs/spikes/S-A4.md",
            flagName = "spike_s_a4_primary",
            primaryRecommended = primary,
            executionMode = options.executionMode,
            status = if (passed) SpikeStatus.PASS else SpikeStatus.FAIL,
            summary = "Select-row accuracy=${SpikeStats.round2(selectRowAccuracy)} ($cleanCorrect/10), tiltedRejected=$tiltedRejected/6, cleanRejected=$cleanRejected/10, shortAccepted=$shortAccepted/4, anglePopulated=$anglePopulatedCount/${cases.size}, pdfTextApi=${pdfProbe.textApiMethodFound}.",
            passCriterion = "OCR offline; Select-row accuracy >= 0.90 on 10 tables (>= 3 two-row headers); 3-deg IQR rejects >= 5/6 tilted & <= 1/10 clean; 4/4 short tables skip IQR and pass; angle or cornerPoints populated; PdfRenderer text recorded.",
            fallbackAction = "Raise IQR threshold in 0.5-deg steps up to 4.5 deg if clean rejected > 1; deskew from cornerPoints if angle missing; render PDF pages to Bitmap + ML Kit OCR if PdfRenderer text API absent.",
            markerLocations = listOf("06 §3.1", "06 §3.8", "07 §1.4"),
            missingPrerequisites = emptyList(),
            environment = env,
            metrics = linkedMapOf(
                "selectRowAccuracy" to JsonPrimitive(SpikeStats.round2(selectRowAccuracy)),
                "cleanCorrect" to JsonPrimitive(cleanCorrect),
                "cleanAccepted" to JsonPrimitive(cleanAccepted),
                "cleanRejected" to JsonPrimitive(cleanRejected),
                "tiltedRejected" to JsonPrimitive(tiltedRejected),
                "shortAccepted" to JsonPrimitive(shortAccepted),
                "shortIqrSkipped" to JsonPrimitive(shortIqrSkipped),
                "anglePopulatedCount" to JsonPrimitive(anglePopulatedCount),
                "cornerPointsPopulatedCount" to JsonPrimitive(cornerPointsPopulatedCount),
                "pdfTextApiFound" to JsonPrimitive(pdfProbe.textApiMethodFound),
                "pdfExtractedNonEmpty" to JsonPrimitive(pdfProbe.extractedTextNonEmpty),
            ),
            rawSamples = samples,
            manualChecklist = listOf(
                SpikeManualStepItem(
                    id = "sa4-real-photos",
                    description = "Run MS-O2 30 printed photos + 6 capture-gate + 4 short-table photos on physical Xiaomi 15T Pro camera before Phase 1 O2 evaluation.",
                    completed = false,
                ),
            ),
            startedAtMs = started,
            finishedAtMs = clock.nowElapsedMs(),
        )
    }

    suspend fun runSA5(options: SpikeRunOptions = SpikeRunOptions()): SpikeRunRecord {
        val started = clock.nowElapsedMs()
        val env = envProvider.inspectEnvironment()
        val classAudit = l1Driver.inspectLinkedFirebaseClasses()
        val coreL0Smoke = verifyCoreL0SsotAndPrompts()

        val (seeds, queries) = SpikeFixtures.ftsSeedsAndQueries()
        val ftsOutcome = ftsDriver.runRoomFts4Probe(seeds, queries)

        val netBefore = envProvider.readUidNetworkBytes()
        val aiReady = env.firebaseAppInitialized
        var l1CallOutcome: L1SpikeCallOutcome? = null
        if (aiReady) {
            val stage1Tpl = envProvider.loadPromptTemplate("stage1.txt")
            val prompt = SpikeFixtures.stage1PromptSample(10, stage1Tpl)
            l1CallOutcome = l1Driver.runSchemaCall("TriageFlatV1", prompt, L1Tier.STABLE)
        }
        val netAfter = envProvider.readUidNetworkBytes()
        val txDelta = if (netBefore != null && netAfter != null) netAfter.uidTxBytes - netBefore.uidTxBytes else -1L
        val rxDelta = if (netBefore != null && netAfter != null) netAfter.uidRxBytes - netBefore.uidRxBytes else -1L
        val zeroTrafficDuringRun = (txDelta == 0L && rxDelta == 0L) || (netBefore == null && options.executionMode == ExecutionMode.MOCKED_CONTRACT_TEST)

        val noForbiddenClasses = classAudit.forbiddenNetworkClassesFound.isEmpty() && classAudit.debugClassesFound.isEmpty()
        val ftsOk = ftsOutcome.success && ftsOutcome.queriesMatched == queries.size
        val l1Ok = l1CallOutcome?.let { it.success && it.inferenceSource == "ON_DEVICE" } == true

        val status = when {
            !noForbiddenClasses || !ftsOk || !coreL0Smoke.ok -> SpikeStatus.FAIL
            !aiReady -> SpikeStatus.UNAVAILABLE
            l1Ok && zeroTrafficDuringRun -> SpikeStatus.PASS
            else -> SpikeStatus.FAIL
        }

        val missing = ArrayList<String>()
        if (!aiReady) missing.add("FirebaseApp not initialized (missing local google-services.json for ONLY_ON_DEVICE call)")

        return SpikeRunRecord(
            spikeId = "S-A5",
            title = "Android bundledSample Zero-Network Contract & Room @Fts4",
            category = "android-platform",
            targetDoc = "/docs/spikes/S-A5.md",
            flagName = "spike_s_a5_primary",
            primaryRecommended = status == SpikeStatus.PASS,
            executionMode = options.executionMode,
            status = status,
            summary = "coreL0=${coreL0Smoke.ok}, forbiddenClasses=${classAudit.forbiddenNetworkClassesFound.size}, debugClasses=${classAudit.debugClassesFound.size}, fts4=${ftsOutcome.queriesMatched}/${queries.size}, l1OnDevice=$l1Ok, netDeltaTx=$txDelta, netDeltaRx=$rxDelta.",
            passCriterion = "ONLY_ON_DEVICE call succeeds offline without App Check/Auth; zero outbound network bytes/classes; Room @Fts4 returns 20/20 query matches.",
            fallbackAction = "Any outbound connection is a blocking defect; FTS4 failure falls back to BM25 over plain Room table in memory.",
            markerLocations = listOf("00 §5 D-18", "04 §5.2.3", "06 §3.1", "06 §3.2", "07 §1.4"),
            missingPrerequisites = missing,
            environment = env,
            metrics = linkedMapOf(
                "coreL0SsotOk" to JsonPrimitive(coreL0Smoke.ok),
                "promptCountVerified" to JsonPrimitive(coreL0Smoke.promptCount),
                "forbiddenNetworkClassCount" to JsonPrimitive(classAudit.forbiddenNetworkClassesFound.size),
                "debugClassCount" to JsonPrimitive(classAudit.debugClassesFound.size),
                "fts4Driver" to JsonPrimitive(ftsOutcome.driverName),
                "fts4Matched" to JsonPrimitive(ftsOutcome.queriesMatched),
                "fts4Total" to JsonPrimitive(queries.size),
                "l1OnDeviceSuccess" to JsonPrimitive(l1Ok),
                "uidTxDeltaBytes" to JsonPrimitive(txDelta),
                "uidRxDeltaBytes" to JsonPrimitive(rxDelta),
            ),
            rawSamples = listOf(
                buildJsonObject {
                    put("forbiddenNetworkClasses", classAudit.forbiddenNetworkClassesFound.joinToString(","))
                    put("debugClasses", classAudit.debugClassesFound.joinToString(","))
                    put("ftsError", ftsOutcome.errorMessage ?: "none")
                    put("l1Error", l1CallOutcome?.errorMessage ?: "none")
                    put("coreL0Detail", coreL0Smoke.detail)
                },
            ),
            manualChecklist = listOf(
                SpikeManualStepItem(
                    id = "sa5-pcapdroid-airplane",
                    description = "Capture full session with PCAPdroid + adb shell dumpsys netstats in Airplane Mode and with Wi-Fi ON (zero DNS/TCP/QUIC).",
                    completed = false,
                ),
            ),
            startedAtMs = started,
            finishedAtMs = clock.nowElapsedMs(),
        )
    }

    suspend fun runSRPAndroidBoundary(options: SpikeRunOptions = SpikeRunOptions()): SpikeRunRecord {
        val started = clock.nowElapsedMs()
        val env = envProvider.inspectEnvironment()
        val classAudit = l1Driver.inspectLinkedFirebaseClasses()
        val bomOk = compareSemverAtLeast(env.pinnedVersions["firebaseBom"] ?: "0.0.0", "34.14.0")
        val noAppCheckInBundledSample = !classAudit.appCheckCorePresent && classAudit.debugClassesFound.isEmpty()

        val status = if (bomOk && noAppCheckInBundledSample) {
            SpikeStatus.PASS
        } else {
            SpikeStatus.FAIL
        }

        return SpikeRunRecord(
            spikeId = "S-RP",
            title = "Android bundledSample Replay-Protection Boundary Verification",
            category = "android-platform",
            targetDoc = "/docs/spikes/S-RP.md",
            flagName = "spike_s_rp_primary",
            primaryRecommended = status == SpikeStatus.PASS,
            executionMode = options.executionMode,
            status = status,
            summary = "Firebase BoM=${env.pinnedVersions["firebaseBom"]} (>= 34.14.0: $bomOk); bundledSample omits App Check & Play Integrity ($noAppCheckInBundledSample) per 04 §5.2.3 & 05 §4.3.1.",
            passCriterion = "Firebase BoM >= 34.14.0 pinned; bundledSample excludes App Check / debug providers and makes zero cloud AI Logic calls.",
            fallbackAction = "Cloud App Check replay protection on Android applies only if a networked flavor is ever introduced.",
            markerLocations = listOf("00 §6.2", "04 §5.2.3", "05 §4.3.1", "07 §1.3", "07 §1.7"),
            missingPrerequisites = emptyList(),
            environment = env,
            metrics = linkedMapOf(
                "firebaseBomPinned" to JsonPrimitive(env.pinnedVersions["firebaseBom"] ?: "unknown"),
                "bomMeetsMinimum34_14_0" to JsonPrimitive(bomOk),
                "appCheckCorePresent" to JsonPrimitive(classAudit.appCheckCorePresent),
                "debugClassesCount" to JsonPrimitive(classAudit.debugClassesFound.size),
            ),
            rawSamples = emptyList(),
            manualChecklist = listOf(
                SpikeManualStepItem(
                    id = "srp-web-ios",
                    description = "Cloud limited-use App Check token tests for S-RP execute on Web and iOS clients; Android bundledSample is offline-only.",
                    completed = true,
                ),
            ),
            startedAtMs = started,
            finishedAtMs = clock.nowElapsedMs(),
        )
    }

    private fun verifyCoreL0SsotAndPrompts(): CoreL0SmokeOutcome {
        return try {
            val normalized = norm("TNF\u03B1 reduced by 12% in trial [1].").text
            val sanitized = sanitizeText("Mean mortality was 23% across cohorts.")
            val tokens = tokBM25("Mean mortality was 23% across cohorts.")
            val manifest = envProvider.verifyPromptManifest()
            val ok = normalized.contains("TNF") &&
                sanitized.tier == SanitizeTier.CLEAN &&
                tokens.isNotEmpty() &&
                manifest.size == PromptAndSchemaSot.PROMPT_FILES.size
            CoreL0SmokeOutcome(
                ok = ok,
                promptCount = manifest.size,
                detail = "normLen=${normalized.length}, tokens=${tokens.size}, prompts=${manifest.size}",
            )
        } catch (e: Throwable) {
            CoreL0SmokeOutcome(ok = false, promptCount = 0, detail = "${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun buildPromptForSchema(
        schemaId: String,
        index: Int,
        stage1Tpl: String,
        stage2Tpl: String,
        b5Tpl: String,
        o2Tpl: String,
    ): String = when (schemaId) {
        "TriageV1", "TriageFlatV1" -> SpikeFixtures.stage1PromptSample(index, stage1Tpl)
        "VerdictV1", "VerdictFlatV1" -> SpikeFixtures.stage2PromptSample(index, stage2Tpl, wordCap = 40)
        "VerdictV1_cap30" -> SpikeFixtures.stage2PromptSample(index, stage2Tpl, wordCap = 30)
        "VerdictV1_cap20" -> SpikeFixtures.stage2PromptSample(index, stage2Tpl, wordCap = 20)
        "B5CheckV1" -> SpikeFixtures.b5PromptSample(index, b5Tpl)
        "O2PhysicalExtractV1", "O2PhysicalExtractFlatV1" -> SpikeFixtures.o2PromptSample(index, o2Tpl)
        else -> SpikeFixtures.stage1PromptSample(index, stage1Tpl)
    }

    private fun compareSemverAtLeast(actual: String, minimum: String): Boolean {
        val a = actual.split('.').map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
        val m = minimum.split('.').map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, m.size)) {
            val av = a.getOrElse(i) { 0 }
            val mv = m.getOrElse(i) { 0 }
            if (av > mv) return true
            if (av < mv) return false
        }
        return true
    }

    private data class CoreL0SmokeOutcome(
        val ok: Boolean,
        val promptCount: Int,
        val detail: String,
    )
}
