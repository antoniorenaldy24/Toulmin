package app.toulmin.app

import app.toulmin.core.sha256hexBytes
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.zip.ZipFile

class AndroidModuleBoundaryTest {
    private val repoRoot: Path by lazy {
        val prop = System.getProperty("toulmin.repoRoot")
        if (!prop.isNullOrBlank()) {
            Paths.get(prop).normalize()
        } else {
            Paths.get("").toAbsolutePath().normalize().parent.parent
        }
    }

    private fun readUtf8(path: Path): String =
        Files.readAllBytes(path).toString(Charsets.UTF_8)

    @Test
    fun `only l1 module imports com-google-firebase-ai`() {
        val restrictedRoots = listOf(
            repoRoot.resolve("apps/android/core-l0/src/main"),
            repoRoot.resolve("apps/android/spike-core/src/main"),
            repoRoot.resolve("apps/android/app/src/main"),
        )
        for (root in restrictedRoots) {
            Files.walk(root).use { stream ->
                stream.filter { it.toString().endsWith(".kt") }.forEach { ktFile ->
                    val content = readUtf8(ktFile)
                    assertFalse(
                        content.contains("com.google.firebase"),
                        "Forbidden Firebase import/reference in ${ktFile.fileName} (00 §7.2, 06 §5.3)",
                    )
                }
            }
        }
    }

    @Test
    fun `main sources contain zero debug tokens, secrets, or hardcoded calendar dates`() {
        val mainRoots = listOf(
            repoRoot.resolve("apps/android/l1/src/main"),
            repoRoot.resolve("apps/android/spike-core/src/main"),
            repoRoot.resolve("apps/android/app/src/main"),
        )
        val forbiddenTokens = listOf(
            "debug" + "Token",
            "DebugAppCheck" + "ProviderFactory",
            "FIREBASE_APPCHECK_" + "DEBUG_TOKEN",
            "AIzaSy",
        )
        val isoDatePattern = Regex("""\b20\d{2}-\d{2}-\d{2}\b""")

        for (root in mainRoots) {
            Files.walk(root).use { stream ->
                stream.filter { it.toString().endsWith(".kt") || it.toString().endsWith(".xml") }
                    .forEach { file ->
                        val content = readUtf8(file)
                        for (tok in forbiddenTokens) {
                            assertFalse(
                                content.contains(tok),
                                "Forbidden token '$tok' found in $file (AC-SEC-15)",
                            )
                        }
                        if (file.toString().endsWith(".kt")) {
                            assertFalse(
                                isoDatePattern.containsMatchIn(content),
                                "Hardcoded ISO date literal found in $file (00 §7.4)",
                            )
                        }
                    }
            }
        }
    }

    @Test
    fun `AndroidManifest enforces D-10 backup exclusion`() {
        val manifest = readUtf8(
            repoRoot.resolve("apps/android/app/src/main/AndroidManifest.xml"),
        )
        assertTrue(manifest.contains("""android:allowBackup="false""""))
        assertTrue(manifest.contains("""android:dataExtractionRules="@xml/data_extraction_rules""""))
        assertTrue(manifest.contains("""android:fullBackupContent="@xml/backup_rules""""))
    }

    @Test
    fun `built bundledSample APKs preserve core-l0 Tier A resources, p2_1 prompts, and zero debug providers in DEX and Manifest`() {
        val coreAssets = listOf("unicode_15_1.bin", "norm_table.json", "porter_v1.json", "bm25_min_cov.json", "wordlist_en.txt")
        for (name in coreAssets) {
            val expected = sha256hexBytes(Files.readAllBytes(repoRoot.resolve("packages/core-l0/$name")))
            val actual = sha256hexBytes(javaClass.classLoader!!.getResourceAsStream(name)!!.use { it.readBytes() })
            assertEquals(expected, actual, "Classpath resource mismatch for $name")
        }

        val apkCandidates = listOf(
            "debug" to repoRoot.resolve("apps/android/app/build/outputs/apk/bundledSample/debug/app-bundledSample-debug.apk"),
            "release" to repoRoot.resolve("apps/android/app/build/outputs/apk/bundledSample/release/app-bundledSample-release-unsigned.apk"),
        )
        val existingApks = apkCandidates.filter { Files.isRegularFile(it.second) }
        val requireApk = System.getProperty("toulmin.requireApk") == "true"
        if (requireApk) {
            assertTrue(existingApks.isNotEmpty(), "Expected built APK under apps/android/app/build/outputs/apk/bundledSample/")
        }

        val forbiddenApkStrings = listOf(
            "debug" + "Token",
            "DebugAppCheck" + "ProviderFactory",
            "FIREBASE_APPCHECK_" + "DEBUG_TOKEN",
            "AIzaSy",
        )
        val forbiddenReleaseOnlyStrings = listOf(
            "FirebaseFirestore",
            "FirebaseFunctions",
            "FirebaseAppCheckDebugRegistrar",
        )

        for ((variant, apkPath) in existingApks) {
            ZipFile(apkPath.toFile()).use { zip ->
                for (name in coreAssets) {
                    val entry = zip.getEntry(name)
                    assertTrue(entry != null, "Missing Tier A resource '$name' in $variant APK")
                    val expected = sha256hexBytes(Files.readAllBytes(repoRoot.resolve("packages/core-l0/$name")))
                    val actual = sha256hexBytes(zip.getInputStream(entry).use { it.readBytes() })
                    assertEquals(expected, actual, "$variant APK resource SHA-256 mismatch for $name")
                }

                val prompts = listOf("stage1.txt", "stage2.txt", "b5.txt", "o2.txt", "alt_sources.txt")
                for (name in prompts) {
                    val entry = zip.getEntry("assets/prompts/p2.1/$name")
                    assertTrue(entry != null, "Missing prompt asset 'assets/prompts/p2.1/$name' in $variant APK")
                    val expected = sha256hexBytes(Files.readAllBytes(repoRoot.resolve("packages/prompts/p2.1/$name")))
                    val actual = sha256hexBytes(zip.getInputStream(entry).use { it.readBytes() })
                    assertEquals(expected, actual, "$variant APK prompt SHA-256 mismatch for $name")
                }
                assertTrue(zip.getEntry("assets/prompts/p2.1/manifest.json") != null, "Missing prompt manifest.json in $variant APK")

                val entries = zip.entries().toList()
                val dexOrManifest = entries.filter { it.name.endsWith(".dex") || it.name == "AndroidManifest.xml" }
                assertTrue(dexOrManifest.any { it.name.endsWith(".dex") }, "Expected classes*.dex in $variant APK")
                for (entry in dexOrManifest) {
                    val text = zip.getInputStream(entry).use { it.readBytes() }.toString(Charsets.US_ASCII)
                    for (tok in forbiddenApkStrings) {
                        assertFalse(text.contains(tok), "Forbidden token '$tok' in $variant APK ${entry.name}")
                    }
                    if (variant == "release") {
                        for (tok in forbiddenReleaseOnlyStrings) {
                            assertFalse(text.contains(tok), "Forbidden release DEX literal '$tok' in ${entry.name}")
                        }
                    }
                }
            }
        }
    }
}
