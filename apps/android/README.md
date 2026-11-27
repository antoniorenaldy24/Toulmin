# Toulmin Android Phase 0 Spike Harness (`apps/android`)

Minimal `bundledSample` Android spike harness for Phase 0 compatibility spikes (`S-N4`, `S-A1..S-A5`, and `S-RP` Android boundary check) wired to `:core-l0` (`app.toulmin.core`).

## Modules

- `:core-l0` — Pure Kotlin Tier A L0 engine and golden conformance assets (`unicode_15_1.bin`, `norm_table.json`, `porter_v1.json`, `bm25_min_cov.json`, `wordlist_en.txt`).
- `:spike-core` — Pure Kotlin/JVM spike orchestration, O2 Select-row geometry & capture quality gate, statistics/deadline formulas, prompt SSOT assembly, and `RESOLUTION.md` JSON/Markdown exporter.
- `:l1` — Single module importing `com.google.firebase.ai.*` (`ONLY_ON_DEVICE`), `@Generable` schemas + KSP processor, prompt SHA-256 verifier (synced from `packages/prompts/p2.1/`), `OnDeviceModels` tier cascade (`PREVIEW -> STABLE`), `CallL1` deadline/settle wrapper, and `AiCoreTelemetry.readBaseModelName()`.
- `:app` — `bundledSample` debug APK hosting `SpikeHarnessActivity`, ML Kit bundled Latin OCR, Room `@Fts4` (`BundledSQLiteDriver`), and `PdfRenderer` probes.

## Offline Build & JVM Tests (No `google-services.json` Required)

```powershell
cd apps/android
.\gradlew.bat :core-l0:test :spike-core:test :l1:testDebugUnitTest :app:testBundledSampleDebugUnitTest :app:assembleBundledSampleDebug
```

When `apps/android/app/google-services.json` is absent, Gradle compiles cleanly without applying `com.google.gms.google-services`, and Firebase AI calls report `UNAVAILABLE` gracefully.

## Running on a Physical Android Device (Xiaomi 15T Pro / AICore)

1. Copy `apps/android/app/google-services.json.example` to `apps/android/app/google-services.json` and fill in your local non-committed Firebase project values (never commit `google-services.json`).
2. Build and install the debug APK:
   ```powershell
   .\gradlew.bat :app:installBundledSampleDebug
   ```
3. Run via UI or trigger via ADB:
   ```powershell
   adb shell am start -n app.toulmin/app.toulmin.app.SpikeHarnessActivity --es spike all --ez export true
   ```
4. Pull exported JSON & Markdown for `/docs/spikes/RESOLUTION.md`:
   ```powershell
   adb pull /sdcard/Android/data/app.toulmin/files/spikes/ ./android-spike-export/
   ```
