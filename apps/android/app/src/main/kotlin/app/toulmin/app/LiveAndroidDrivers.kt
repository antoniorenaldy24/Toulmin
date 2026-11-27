package app.toulmin.app

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.net.TrafficStats
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.provider.Settings
import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import app.toulmin.l1.AndroidL1Bridge
import app.toulmin.l1.PromptLoader
import app.toulmin.spikes.AndroidEnvironmentMetadata
import app.toulmin.spikes.ClockProvider
import app.toulmin.spikes.DeviceEnvProvider
import app.toulmin.spikes.ExecutionMode
import app.toulmin.spikes.FtsEvidenceSeed
import app.toulmin.spikes.FtsProbeOutcome
import app.toulmin.spikes.FtsQueryCase
import app.toulmin.spikes.FtsSpikeDriver
import app.toulmin.spikes.NetworkByteCounter
import app.toulmin.spikes.O2PhotoCategory
import app.toulmin.spikes.O2TestPhotoCase
import app.toulmin.spikes.OcrBox
import app.toulmin.spikes.OcrElement
import app.toulmin.spikes.OcrLine
import app.toulmin.spikes.OcrPoint
import app.toulmin.spikes.OcrRecognitionOutcome
import app.toulmin.spikes.OcrSpikeDriver
import app.toulmin.spikes.PdfRendererProbeOutcome
import app.toulmin.spikes.SystemClockProvider
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class AndroidDeviceEnvProvider(
    private val context: Context,
    private val l1Bridge: AndroidL1Bridge,
    private val promptLoader: PromptLoader,
    private val clock: ClockProvider = SystemClockProvider,
) : DeviceEnvProvider {

    override fun inspectEnvironment(): AndroidEnvironmentMetadata {
        val pkgInfo = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(
                    "com.google.android.aicore",
                    PackageManager.PackageInfoFlags.of(0L),
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo("com.google.android.aicore", 0)
            }
        }.getOrNull()

        val aicoreVersionCode = pkgInfo?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode
            else @Suppress("DEPRECATION") it.versionCode.toLong()
        }

        val airplaneOn = Settings.Global.getInt(
            context.contentResolver,
            Settings.Global.AIRPLANE_MODE_ON,
            0,
        ) != 0

        val socModel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Build.SOC_MODEL
        } else {
            Build.HARDWARE
        }

        return AndroidEnvironmentMetadata(
            executionMode = ExecutionMode.LIVE_ANDROID_DEVICE,
            deviceManufacturer = Build.MANUFACTURER,
            deviceModel = Build.MODEL,
            socModel = socModel,
            androidSdkInt = Build.VERSION.SDK_INT,
            androidRelease = Build.VERSION.RELEASE,
            aicorePackageInstalled = pkgInfo != null,
            aicoreVersionName = pkgInfo?.versionName,
            aicoreVersionCode = aicoreVersionCode,
            baseModelName = null,
            airplaneModeOn = airplaneOn,
            hasGoogleServicesJson = BuildConfig.HAS_GOOGLE_SERVICES_JSON,
            firebaseAppInitialized = l1Bridge.isFirebaseInitialized(),
            pinnedVersions = linkedMapOf(
                "firebaseBom" to BuildConfig.PINNED_FIREBASE_BOM,
                "firebaseAi" to BuildConfig.PINNED_FIREBASE_AI,
                "firebaseAiOndevice" to BuildConfig.PINNED_FIREBASE_AI_ONDEVICE,
                "firebaseAiKsp" to BuildConfig.PINNED_FIREBASE_AI_KSP,
                "mlkitTextRecognition" to BuildConfig.PINNED_MLKIT_OCR,
                "room" to BuildConfig.PINNED_ROOM,
            ),
            collectedAtIso = clock.formatUtcIso(clock.nowEpochMs()),
        )
    }

    override fun readUidNetworkBytes(): NetworkByteCounter? {
        val uid = Process.myUid()
        val tx = TrafficStats.getUidTxBytes(uid)
        val rx = TrafficStats.getUidRxBytes(uid)
        if (tx == TrafficStats.UNSUPPORTED.toLong() || rx == TrafficStats.UNSUPPORTED.toLong()) {
            return null
        }
        return NetworkByteCounter(uidTxBytes = tx, uidRxBytes = rx)
    }

    override fun loadPromptTemplate(fileName: String): String =
        promptLoader.loadVerified(fileName)

    override fun verifyPromptManifest(): Map<String, String> =
        promptLoader.verifyAllPrompts()
}

class LiveMlKitOcrDriver(private val context: Context) : OcrSpikeDriver {
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    override suspend fun recognizeTableCase(scenario: O2TestPhotoCase): OcrRecognitionOutcome =
        withContext(Dispatchers.Default) {
            val bitmap = renderScenarioBitmap(scenario)
            try {
                val image = InputImage.fromBitmap(bitmap, 0)
                val mlText = awaitTask(recognizer.process(image))
                val lines = ArrayList<OcrLine>()
                var anglePopulated = false
                var cornersPopulated = false

                for (block in mlText.textBlocks) {
                    for (line in block.lines) {
                        val box = line.boundingBox ?: continue
                        val lineAngle = runCatching { line.angle }.getOrNull()
                        if (lineAngle != null) anglePopulated = true
                        val corners = line.cornerPoints?.map { OcrPoint(it.x.toFloat(), it.y.toFloat()) } ?: emptyList()
                        if (corners.size >= 2) cornersPopulated = true
                        val elements = line.elements.mapNotNull { el ->
                            val eb = el.boundingBox ?: return@mapNotNull null
                            OcrElement(
                                text = el.text,
                                box = OcrBox(eb.left.toFloat(), eb.top.toFloat(), eb.right.toFloat(), eb.bottom.toFloat()),
                            )
                        }
                        lines.add(
                            OcrLine(
                                text = line.text,
                                angle = lineAngle,
                                cornerPoints = corners,
                                box = OcrBox(box.left.toFloat(), box.top.toFloat(), box.right.toFloat(), box.bottom.toFloat()),
                                elements = elements,
                            ),
                        )
                    }
                }

                OcrRecognitionOutcome(
                    success = true,
                    lines = lines,
                    imageWidth = bitmap.width,
                    imageHeight = bitmap.height,
                    angleFieldPopulated = anglePopulated,
                    cornerPointsPopulated = cornersPopulated,
                    errorMessage = null,
                )
            } catch (t: Throwable) {
                OcrRecognitionOutcome(
                    success = false,
                    lines = emptyList(),
                    imageWidth = bitmap.width,
                    imageHeight = bitmap.height,
                    angleFieldPopulated = false,
                    cornerPointsPopulated = false,
                    errorMessage = "${t.javaClass.simpleName}: ${t.message}",
                )
            } finally {
                bitmap.recycle()
            }
        }

    override suspend fun probePdfRendererTextApi(): PdfRendererProbeOutcome =
        withContext(Dispatchers.IO) {
            val pdfFile = File(context.cacheDir, "spike_pdf_probe.pdf")
            try {
                val doc = PdfDocument()
                val pageInfo = PdfDocument.PageInfo.Builder(612, 792, 1).create()
                val page = doc.startPage(pageInfo)
                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.BLACK
                    textSize = 18f
                }
                page.canvas.drawText("Toulmin PDF probe: 48 patients", 72f, 120f, paint)
                doc.finishPage(page)
                FileOutputStream(pdfFile).use { doc.writeTo(it) }
                doc.close()

                val pfd = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY)
                pfd.use {
                    PdfRenderer(it).use { renderer ->
                        val pageCount = renderer.pageCount
                        val rPage = renderer.openPage(0)
                        rPage.use { opened ->
                            val method = opened.javaClass.methods.firstOrNull { m ->
                                m.name == "getTextContents" && m.parameterCount == 0
                            }
                            if (method == null) {
                                return@withContext PdfRendererProbeOutcome(
                                    sdkInt = Build.VERSION.SDK_INT,
                                    pdfOpened = true,
                                    pageCount = pageCount,
                                    textApiMethodFound = false,
                                    extractedTextNonEmpty = false,
                                    extractedSnippet = null,
                                    notes = "getTextContents() unavailable on SDK ${Build.VERSION.SDK_INT}; Bitmap + ML Kit OCR fallback applies.",
                                )
                            }
                            val textList = runCatching { method.invoke(opened) as? List<*> }.getOrNull()
                            val joined = textList?.joinToString(" ") { item -> item?.toString().orEmpty() }?.trim().orEmpty()
                            PdfRendererProbeOutcome(
                                sdkInt = Build.VERSION.SDK_INT,
                                pdfOpened = true,
                                pageCount = pageCount,
                                textApiMethodFound = true,
                                extractedTextNonEmpty = joined.isNotEmpty(),
                                extractedSnippet = joined.take(120),
                                notes = "getTextContents() returned ${textList?.size ?: 0} items on SDK ${Build.VERSION.SDK_INT}.",
                            )
                        }
                    }
                }
            } catch (t: Throwable) {
                PdfRendererProbeOutcome(
                    sdkInt = Build.VERSION.SDK_INT,
                    pdfOpened = false,
                    pageCount = 0,
                    textApiMethodFound = false,
                    extractedTextNonEmpty = false,
                    extractedSnippet = null,
                    notes = "${t.javaClass.simpleName}: ${t.message}",
                )
            } finally {
                pdfFile.delete()
            }
        }

    private fun renderScenarioBitmap(scenario: O2TestPhotoCase): Bitmap {
        val width = 1400
        val height = 900
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 34f
            typeface = Typeface.MONOSPACE
        }

        val rowsToDraw = ArrayList<Pair<List<String>, FloatArray>>()
        if (scenario.hasTwoRowHeader) {
            // Draw "Baseline" wide across columns 0..1 (120..520) and "Followup" over column 2 (920)
            rowsToDraw.add(scenario.headerRow1 to floatArrayOf(180f, 920f))
            rowsToDraw.add(scenario.headerRow2 to floatArrayOf(120f, 520f, 920f))
        } else {
            rowsToDraw.add(scenario.headerRow1 to floatArrayOf(120f, 520f, 920f))
        }
        for (row in scenario.dataRows) {
            rowsToDraw.add(row to floatArrayOf(120f, 520f, 920f))
        }
        if (scenario.category == O2PhotoCategory.CAPTURE_GATE_TILTED) {
            rowsToDraw.clear()
            rowsToDraw.add(listOf("Arm alpha beta 10 20%") to floatArrayOf(120f))
            rowsToDraw.add(listOf("Group gamma delta 44 11%") to floatArrayOf(120f))
            rowsToDraw.add(listOf("Cohort epsilon zeta 51 19%") to floatArrayOf(120f))
            rowsToDraw.add(listOf("Placebo theta iota 30 5%") to floatArrayOf(120f))
            rowsToDraw.add(listOf("Control kappa lambda 28 8%") to floatArrayOf(120f))
        } else if (scenario.category == O2PhotoCategory.SHORT_TABLE) {
            rowsToDraw.clear()
            rowsToDraw.add(listOf("Arm alpha N delta") to floatArrayOf(120f))
            rowsToDraw.add(listOf("Cohort beta 20 18%") to floatArrayOf(120f))
            rowsToDraw.add(listOf("Footnote summary line") to floatArrayOf(120f))
        }

        var y = 160f
        for ((idx, pair) in rowsToDraw.withIndex()) {
            val (cells, xPositions) = pair
            val angle = scenario.simulatedTiltAnglesDeg.getOrNull(idx)?.toFloat() ?: 0f
            canvas.save()
            if (angle != 0f) {
                canvas.rotate(angle, 120f, y)
            }
            for ((colIdx, cellText) in cells.withIndex()) {
                val x = xPositions.getOrElse(colIdx) { 120f + colIdx * 380f }
                if (scenario.hasTwoRowHeader && idx == 0 && colIdx == 0) {
                    val widePaint = Paint(paint).apply { textScaleX = 2.4f }
                    canvas.drawText(cellText, x, y, widePaint)
                } else {
                    canvas.drawText(cellText, x, y, paint)
                }
            }
            canvas.restore()
            y += 120f
        }
        return bmp
    }

    private suspend fun awaitTask(task: com.google.android.gms.tasks.Task<Text>): Text =
        suspendCancellableCoroutine { cont ->
            task.addOnSuccessListener { result ->
                if (cont.isActive) cont.resume(result)
            }.addOnFailureListener { err ->
                if (cont.isActive) cont.resumeWithException(err)
            }
        }
}

class LiveRoomFtsDriver(private val context: Context) : FtsSpikeDriver {
    override suspend fun runRoomFts4Probe(
        documents: List<FtsEvidenceSeed>,
        queries: List<FtsQueryCase>,
    ): FtsProbeOutcome = withContext(Dispatchers.IO) {
        val db = Room.inMemoryDatabaseBuilder<SpikeFtsDatabase>(context)
            .setDriver(BundledSQLiteDriver())
            .build()
        try {
            val dao = db.evidenceDao()
            dao.insertAll(
                documents.map { seed ->
                    SpikeEvidenceEntity(
                        chunkId = seed.chunkId,
                        refId = seed.refId,
                        section = seed.section,
                        text = seed.text,
                    )
                },
            )
            var matched = 0
            for (q in queries) {
                val hits = dao.search(q.query)
                if (hits.any { it.chunkId == q.expectedChunkId }) {
                    matched++
                }
            }
            FtsProbeOutcome(
                success = matched == queries.size,
                indexedCount = documents.size,
                queriesRun = queries.size,
                queriesMatched = matched,
                driverName = "BundledSQLiteDriver",
                errorMessage = null,
            )
        } catch (t: Throwable) {
            FtsProbeOutcome(
                success = false,
                indexedCount = documents.size,
                queriesRun = queries.size,
                queriesMatched = 0,
                driverName = "BundledSQLiteDriver",
                errorMessage = "${t.javaClass.simpleName}: ${t.message}",
            )
        } finally {
            db.close()
        }
    }
}
