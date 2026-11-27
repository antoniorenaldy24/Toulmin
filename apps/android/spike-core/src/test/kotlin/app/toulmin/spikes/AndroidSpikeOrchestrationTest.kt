package app.toulmin.spikes

import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AndroidSpikeOrchestrationTest {
    private class FakeClock : ClockProvider {
        private var elapsed = 1_000L
        override fun nowEpochMs(): Long = 1_700_000_000_000L
        override fun nowElapsedMs(): Long {
            elapsed += 25L
            return elapsed
        }
    }

    private class FakeEnvProvider(
        private val aicoreInstalled: Boolean = true,
        private val airplaneOn: Boolean = true,
        private val firebaseReady: Boolean = true,
    ) : DeviceEnvProvider {
        override fun inspectEnvironment(): AndroidEnvironmentMetadata = AndroidEnvironmentMetadata(
            executionMode = ExecutionMode.MOCKED_CONTRACT_TEST,
            deviceManufacturer = "Xiaomi",
            deviceModel = "2506BPN68G",
            socModel = "Dimensity 9400+",
            androidSdkInt = 35,
            androidRelease = "15",
            aicorePackageInstalled = aicoreInstalled,
            aicoreVersionName = if (aicoreInstalled) "1.0.0" else null,
            aicoreVersionCode = if (aicoreInstalled) 123456L else null,
            baseModelName = null,
            airplaneModeOn = airplaneOn,
            hasGoogleServicesJson = firebaseReady,
            firebaseAppInitialized = firebaseReady,
            pinnedVersions = mapOf("firebaseBom" to "35.2.0"),
            collectedAtIso = "1970-01-01T00:00:00Z",
        )

        override fun readUidNetworkBytes(): NetworkByteCounter = NetworkByteCounter(0L, 0L)

        override fun loadPromptTemplate(fileName: String): String = when (fileName) {
            "stage1.txt" -> "Analyze {has_citation} {previous_sentence} {sentence} {words_numbered}\n[0] {title_0} ({year_0})"
            "stage2.txt" -> "Check {word_cap} {context_sentence} {clause_text}\n<<EVIDENCE id=0>>\n{evidence_0}\n<</EVIDENCE>>"
            "b5.txt" -> "{section_a} {value_a} {unit_a} {window_a} vs {section_b} {value_b} {unit_b} {window_b}"
            "o2.txt" -> "{claim_text} | {header_text} | {row_text}"
            else -> "{approved_claim_text}"
        }

        override fun verifyPromptManifest(): Map<String, String> =
            PromptAndSchemaSot.PROMPT_FILES.associateWith { "0".repeat(64) }
    }

    private class FakeL1Driver(
        private val firebaseReady: Boolean = true,
        private val resolvedTier: L1Tier = L1Tier.STABLE,
        private val rawJsonExposed: Boolean = true,
        private val stage2LatencyMs: Long = 120L,
        private val baseModelName: String? = "gemini-nano-v4",
    ) : L1SpikeDriver {
        override fun isFirebaseInitialized(): Boolean = firebaseReady

        override suspend fun checkStatus(tier: L1Tier): OnDeviceAvailability =
            if (resolvedTier == L1Tier.NONE) OnDeviceAvailability.UNAVAILABLE else OnDeviceAvailability.AVAILABLE

        override suspend fun resolveTierCascade(): TierCascadeProbeResult =
            TierCascadeProbeResult(
                resolvedTier = resolvedTier,
                attempts = listOf(
                    TierAttemptRecord(L1Tier.PREVIEW, false, "NONE", "AICoreException", "606", 15L),
                    TierAttemptRecord(L1Tier.STABLE, resolvedTier == L1Tier.STABLE, "ON_DEVICE", null, null, 20L),
                ),
                onDeviceConfigClass = "com.google.firebase.ai.OnDeviceConfig",
                onDeviceModelOptionNames = listOf("PREVIEW", "PREVIEW_FAST", "STABLE"),
            )

        override suspend fun runSchemaCall(
            schemaId: String,
            prompt: String,
            tier: L1Tier,
            useFlatFallback: Boolean,
        ): L1SpikeCallOutcome {
            val keys = PromptAndSchemaSot.SCHEMA_KEYS[schemaId].orEmpty()
            val json = if (rawJsonExposed) {
                keys.joinToString(",", prefix = "{", postfix = "}") { "\"$it\":\"ok\"" }
            } else {
                null
            }
            return L1SpikeCallOutcome(
                success = resolvedTier != L1Tier.NONE,
                schemaId = schemaId,
                tier = tier,
                inferenceSource = if (resolvedTier != L1Tier.NONE) "ON_DEVICE" else "NONE",
                rawText = json,
                decodedSummary = json ?: "ok",
                outputChars = 80,
                latencyMs = if (schemaId.startsWith("Verdict")) stage2LatencyMs else 80L,
                errorClass = null,
                errorCode = null,
                errorMessage = null,
            )
        }

        override suspend fun measureStreamingFirstToken(
            schemaId: String,
            prompt: String,
            tier: L1Tier,
        ): L1StreamTimingOutcome = L1StreamTimingOutcome(true, 35L, 95L, 80, "ON_DEVICE", null)

        override suspend fun getBaseModelName(): BaseModelProbeResult =
            BaseModelProbeResult(
                available = !baseModelName.isNullOrBlank(),
                baseModelName = baseModelName,
                errorClass = null,
                errorMessage = null,
            )

        override fun inspectLinkedFirebaseClasses(): LinkedClassAudit = LinkedClassAudit(
            forbiddenNetworkClassesFound = emptyList(),
            debugClassesFound = emptyList(),
            aiLogicPresent = true,
            appCheckCorePresent = false,
        )
    }

    private class FakeOcrDriver : OcrSpikeDriver {
        override suspend fun recognizeTableCase(scenario: O2TestPhotoCase): OcrRecognitionOutcome {
            if (scenario.category == O2PhotoCategory.CAPTURE_GATE_TILTED) {
                val lines = listOf(0.5f, 7.5f, 1.0f, 9.0f, 0.8f).mapIndexed { idx, ang ->
                    makeLine(listOf("R$idx", "10", "20%"), y = 100f + idx * 60f, angle = ang)
                }
                return OcrRecognitionOutcome(true, lines, 1200, 800, angleFieldPopulated = true, cornerPointsPopulated = true, null)
            }
            if (scenario.category == O2PhotoCategory.SHORT_TABLE) {
                val lines = listOf(
                    makeLine(scenario.headerRow1, y = 100f, angle = 4f),
                    makeLine(scenario.dataRows[0], y = 160f, angle = 11f),
                    makeLine(listOf("Note", "row", "3"), y = 220f, angle = 5f),
                )
                return OcrRecognitionOutcome(true, lines, 1200, 800, angleFieldPopulated = true, cornerPointsPopulated = true, null)
            }
            val lines = ArrayList<OcrLine>()
            var y = 100f
            if (scenario.hasTwoRowHeader) {
                lines.add(makeLine(scenario.headerRow1, y = y, angle = 0f, xStep = 360f))
                y += 60f
                lines.add(makeLine(scenario.headerRow2, y = y, angle = 0f, xStep = 180f))
                y += 60f
            } else {
                lines.add(makeLine(scenario.headerRow1, y = y, angle = 0f, xStep = 180f))
                y += 60f
            }
            for (r in scenario.dataRows) {
                lines.add(makeLine(r, y = y, angle = 0f, xStep = 180f))
                y += 60f
            }
            return OcrRecognitionOutcome(true, lines, 1200, 800, angleFieldPopulated = true, cornerPointsPopulated = true, null)
        }

        private fun makeLine(cells: List<String>, y: Float, angle: Float, xStep: Float = 180f): OcrLine {
            val elements = cells.mapIndexed { idx, txt ->
                val left = 80f + idx * xStep
                OcrElement(txt, OcrBox(left, y, left + 80f, y + 30f))
            }
            return OcrLine(
                text = cells.joinToString(" "),
                angle = angle,
                cornerPoints = listOf(OcrPoint(80f, y), OcrPoint(600f, y), OcrPoint(600f, y + 30f), OcrPoint(80f, y + 30f)),
                box = OcrBox(80f, y, 80f + cells.size * xStep, y + 30f),
                elements = elements,
            )
        }

        override suspend fun probePdfRendererTextApi(): PdfRendererProbeOutcome =
            PdfRendererProbeOutcome(35, true, 1, true, true, "Toulmin PDF probe", "ok")
    }

    private class FakeFtsDriver : FtsSpikeDriver {
        override suspend fun runRoomFts4Probe(
            documents: List<FtsEvidenceSeed>,
            queries: List<FtsQueryCase>,
        ): FtsProbeOutcome = FtsProbeOutcome(true, documents.size, queries.size, queries.size, "BundledSQLiteDriver", null)
    }

    @Test
    fun `all Android spikes pass with mocked healthy AICore and Firebase drivers`() = runTest {
        val runner = AndroidSpikeRunner(
            envProvider = FakeEnvProvider(),
            l1Driver = FakeL1Driver(),
            ocrDriver = FakeOcrDriver(),
            ftsDriver = FakeFtsDriver(),
            clock = FakeClock(),
        )
        val records = runner.runAll(
            SpikeRunOptions(
                executionMode = ExecutionMode.MOCKED_CONTRACT_TEST,
                includeQuotaBurst = true,
            ),
        )
        assertEquals(7, records.size)
        for (r in records) {
            assertEquals(SpikeStatus.PASS, r.status, "Expected PASS for ${r.spikeId}, got ${r.status}: ${r.summary}")
            assertTrue(r.primaryRecommended, "Expected primaryRecommended=true for ${r.spikeId}")
            assertEquals(ExecutionMode.MOCKED_CONTRACT_TEST, r.executionMode)
        }
    }

    @Test
    fun `S-A1 requires Airplane Mode and S-A3 requires quota burst for PASS`() = runTest {
        val runner = AndroidSpikeRunner(
            envProvider = FakeEnvProvider(airplaneOn = false),
            l1Driver = FakeL1Driver(),
            ocrDriver = FakeOcrDriver(),
            ftsDriver = FakeFtsDriver(),
            clock = FakeClock(),
        )
        val sa1 = runner.runSA1(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST))
        val sa3 = runner.runSA3(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST, includeQuotaBurst = false))
        assertEquals(SpikeStatus.MANUAL_REQUIRED, sa1.status)
        assertFalse(sa1.primaryRecommended)
        assertEquals(SpikeStatus.MANUAL_REQUIRED, sa3.status)
        assertFalse(sa3.primaryRecommended)
    }

    @Test
    fun `missing google-services reports UNAVAILABLE for S-A1 to S-A3 and S-A5 while S-A4 and S-RP stay runnable`() = runTest {
        val runner = AndroidSpikeRunner(
            envProvider = FakeEnvProvider(firebaseReady = false),
            l1Driver = FakeL1Driver(firebaseReady = false),
            ocrDriver = FakeOcrDriver(),
            ftsDriver = FakeFtsDriver(),
            clock = FakeClock(),
        )
        val sa1 = runner.runSA1(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST))
        val sa2 = runner.runSA2(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST))
        val sa3 = runner.runSA3(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST))
        val sa4 = runner.runSA4(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST))
        val sa5 = runner.runSA5(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST))
        val srp = runner.runSRPAndroidBoundary(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST))

        assertEquals(SpikeStatus.UNAVAILABLE, sa1.status)
        assertEquals(SpikeStatus.UNAVAILABLE, sa2.status)
        assertEquals(SpikeStatus.UNAVAILABLE, sa3.status)
        assertEquals(SpikeStatus.UNAVAILABLE, sa5.status)
        assertEquals(SpikeStatus.PASS, sa4.status)
        assertEquals(SpikeStatus.PASS, srp.status)
        assertFalse(sa1.primaryRecommended)
    }

    @Test
    fun `S-A3 recommends reasoning_word_cap=30 when Stage 2 p95 exceeds 10s`() = runTest {
        val runner = AndroidSpikeRunner(
            envProvider = FakeEnvProvider(),
            l1Driver = FakeL1Driver(stage2LatencyMs = 11_200L),
            ocrDriver = FakeOcrDriver(),
            ftsDriver = FakeFtsDriver(),
            clock = FakeClock(),
        )
        val sa3 = runner.runSA3(SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST))
        assertEquals(SpikeStatus.FAIL, sa3.status)
        assertFalse(sa3.primaryRecommended)
        assertEquals("30", sa3.metrics["recommended_reasoning_word_cap"]?.content)
        assertEquals("30000", sa3.metrics["VerdictV1_recommended_l1_deadline_ms"]?.content)
    }

    @Test
    fun `smokeMode does not falsely emit PASS on S-A1 or S-A2`() = runTest {
        val runner = AndroidSpikeRunner(
            envProvider = FakeEnvProvider(),
            l1Driver = FakeL1Driver(),
            ocrDriver = FakeOcrDriver(),
            ftsDriver = FakeFtsDriver(),
            clock = FakeClock(),
        )
        val opts = SpikeRunOptions(executionMode = ExecutionMode.MOCKED_CONTRACT_TEST, smokeMode = true)
        assertEquals(SpikeStatus.MANUAL_REQUIRED, runner.runSA1(opts).status)
        assertEquals(SpikeStatus.MANUAL_REQUIRED, runner.runSA2(opts).status)
        assertEquals(SpikeStatus.MANUAL_REQUIRED, runner.runSA3(opts).status)
    }
}
