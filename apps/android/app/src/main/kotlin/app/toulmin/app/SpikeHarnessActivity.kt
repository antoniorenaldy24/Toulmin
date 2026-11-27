package app.toulmin.app

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import app.toulmin.l1.AndroidL1Bridge
import app.toulmin.l1.PromptLoader
import app.toulmin.spikes.AndroidSpikeId
import app.toulmin.spikes.AndroidSpikeRunner
import app.toulmin.spikes.ExecutionMode
import app.toulmin.spikes.SpikeExporter
import app.toulmin.spikes.SpikeRunOptions
import app.toulmin.spikes.SpikeRunRecord
import app.toulmin.spikes.SystemClockProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class SpikeHarnessActivity : AppCompatActivity() {
    private lateinit var txtEnvSummary: TextView
    private lateinit var txtOutputLog: TextView
    private lateinit var chkSmokeMode: CheckBox
    private lateinit var chkQuotaBurst: CheckBox

    private lateinit var envProvider: AndroidDeviceEnvProvider
    private lateinit var runner: AndroidSpikeRunner
    private val latestRecords = LinkedHashMap<String, SpikeRunRecord>()
    private var isRunning = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_spike_harness)

        txtEnvSummary = findViewById(R.id.txtEnvSummary)
        txtOutputLog = findViewById(R.id.txtOutputLog)
        chkSmokeMode = findViewById(R.id.chkSmokeMode)
        chkQuotaBurst = findViewById(R.id.chkQuotaBurst)

        val l1Bridge = AndroidL1Bridge(applicationContext)
        val promptLoader = PromptLoader(assets)
        envProvider = AndroidDeviceEnvProvider(applicationContext, l1Bridge, promptLoader)
        runner = AndroidSpikeRunner(
            envProvider = envProvider,
            l1Driver = l1Bridge,
            ocrDriver = LiveMlKitOcrDriver(applicationContext),
            ftsDriver = LiveRoomFtsDriver(applicationContext),
        )

        renderEnvSummary()
        wireButtons()
        handleIntentTrigger(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntentTrigger(intent)
    }

    override fun onStop() {
        super.onStop()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun renderEnvSummary() {
        val env = envProvider.inspectEnvironment()
        val promptOk = runCatching { envProvider.verifyPromptManifest().size }.getOrElse { -1 }
        txtEnvSummary.text = buildString {
            appendLine("Device: ${env.deviceManufacturer} ${env.deviceModel} (SoC: ${env.socModel})")
            appendLine("Android: ${env.androidRelease} (SDK ${env.androidSdkInt}) | Airplane: ${env.airplaneModeOn}")
            appendLine("AICore: installed=${env.aicorePackageInstalled}, ver=${env.aicoreVersionCode ?: "n/a"}")
            appendLine("Firebase: googleServicesJson=${env.hasGoogleServicesJson}, appInit=${env.firebaseAppInitialized}")
            appendLine("SSOT p2.1 prompts verified: $promptOk/5")
        }.trimEnd()
    }

    private fun wireButtons() {
        findViewById<Button>(R.id.btnRunAll).setOnClickListener { triggerAll(autoExport = false) }
        findViewById<Button>(R.id.btnSN4).setOnClickListener { triggerSingle(AndroidSpikeId.S_N4) }
        findViewById<Button>(R.id.btnSA1).setOnClickListener { triggerSingle(AndroidSpikeId.S_A1) }
        findViewById<Button>(R.id.btnSA2).setOnClickListener { triggerSingle(AndroidSpikeId.S_A2) }
        findViewById<Button>(R.id.btnSA3).setOnClickListener { triggerSingle(AndroidSpikeId.S_A3) }
        findViewById<Button>(R.id.btnSA4).setOnClickListener { triggerSingle(AndroidSpikeId.S_A4) }
        findViewById<Button>(R.id.btnSA5).setOnClickListener { triggerSingle(AndroidSpikeId.S_A5) }
        findViewById<Button>(R.id.btnSRP).setOnClickListener { triggerSingle(AndroidSpikeId.S_RP) }
        findViewById<Button>(R.id.btnExport).setOnClickListener { exportCurrentRecords() }
    }

    private fun handleIntentTrigger(intent: Intent?) {
        val target = intent?.getStringExtra("spike") ?: return
        val autoExport = intent.getBooleanExtra("export", false)
        chkSmokeMode.isChecked = intent.getBooleanExtra("smoke", false)
        chkQuotaBurst.isChecked = intent.getBooleanExtra("burst", false)

        if (target.equals("all", ignoreCase = true)) {
            triggerAll(autoExport = autoExport)
        } else {
            val match = AndroidSpikeId.entries.firstOrNull {
                it.wireId.equals(target, ignoreCase = true) || it.name.equals(target, ignoreCase = true)
            }
            if (match != null) {
                triggerSingle(match, autoExport = autoExport)
            } else {
                appendLog("Unknown intent spike extra: $target")
            }
        }
    }

    private fun currentOptions(): SpikeRunOptions = SpikeRunOptions(
        executionMode = ExecutionMode.LIVE_ANDROID_DEVICE,
        smokeMode = chkSmokeMode.isChecked,
        includeQuotaBurst = chkQuotaBurst.isChecked,
    )

    private fun triggerAll(autoExport: Boolean) {
        if (isRunning) return
        isRunning = true
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        appendLog("Running all Android Phase 0 spikes (smoke=${chkSmokeMode.isChecked}, burst=${chkQuotaBurst.isChecked})...")
        lifecycleScope.launch {
            try {
                val results = withContext(Dispatchers.Default) {
                    runner.runAll(currentOptions())
                }
                for (r in results) {
                    latestRecords[r.spikeId] = r
                    appendLog("${r.spikeId}: ${r.status.name} (flag=${r.flagName}=${r.primaryRecommended}) — ${r.summary}")
                }
                if (autoExport) {
                    exportCurrentRecords()
                }
            } finally {
                isRunning = false
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    private fun triggerSingle(id: AndroidSpikeId, autoExport: Boolean = false) {
        if (isRunning) return
        isRunning = true
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        appendLog("Running ${id.wireId}...")
        lifecycleScope.launch {
            try {
                val r = withContext(Dispatchers.Default) {
                    runner.runById(id, currentOptions())
                }
                latestRecords[r.spikeId] = r
                appendLog(SpikeExporter.formatSpikeMarkdown(r))
                if (autoExport) {
                    exportCurrentRecords()
                }
            } finally {
                isRunning = false
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    private fun exportCurrentRecords() {
        val records = latestRecords.values.toList()
        if (records.isEmpty()) {
            appendLog("No spike records to export yet. Run one or all spikes first.")
            return
        }
        val exportDir = (getExternalFilesDir("spikes") ?: File(filesDir, "spikes")).apply { mkdirs() }
        val nowIso = SystemClockProvider.formatUtcIso(SystemClockProvider.nowEpochMs())
        val jsonText = SpikeExporter.formatSpikeJsonExport(records, nowIso)
        val mdText = SpikeExporter.formatSpikeSuiteMarkdown(records)

        File(exportDir, "android-spikes-latest.json").writeText(jsonText, Charsets.UTF_8)
        File(exportDir, "android-spikes-latest.md").writeText(mdText, Charsets.UTF_8)
        for (r in records) {
            File(exportDir, "${r.spikeId}.md").writeText(SpikeExporter.formatSpikeMarkdown(r), Charsets.UTF_8)
        }
        appendLog("Exported ${records.size} spike records to: ${exportDir.absolutePath}")
    }

    private fun appendLog(line: String) {
        val existing = txtOutputLog.text?.toString().orEmpty()
        txtOutputLog.text = if (existing.isEmpty()) line else "$existing\n\n$line"
    }
}
