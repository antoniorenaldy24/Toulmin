package app.toulmin.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files

class CoreL0PurityAndHygieneTest {
    @Test
    fun `bundled Tier A binary, JSON, and wordlist resources match packages-core-l0 byte-for-byte`() {
        val tsDir = ConformanceTestHelper.repoRoot.resolve("packages").resolve("core-l0")
        val resDir = ConformanceTestHelper.repoRoot
            .resolve("apps")
            .resolve("android")
            .resolve("core-l0")
            .resolve("src")
            .resolve("main")
            .resolve("resources")

        val assetNames = listOf(
            "unicode_15_1.bin",
            "norm_table.json",
            "porter_v1.json",
            "bm25_min_cov.json",
            "wordlist_en.txt",
        )
        for (name in assetNames) {
            val fromTs = Files.readAllBytes(tsDir.resolve(name))
            val fromClasspath = NormTableData::class.java.classLoader
                .getResourceAsStream(name)!!
                .use { it.readBytes() }
            assertEquals(sha256hexBytes(fromTs), sha256hexBytes(fromClasspath), "Classpath hash mismatch for $name")

            val resPath = resDir.resolve(name)
            assertTrue(Files.isRegularFile(resPath), "Missing copied resource $name under src/main/resources/")
            assertEquals(
                sha256hexBytes(fromTs),
                sha256hexBytes(Files.readAllBytes(resPath)),
                "On-disk resource hash mismatch for $name",
            )
        }
    }

    @Test
    fun `src main kotlin obeys pure L0 boundaries with zero platform normalization, regex, or IO`() {
        val mainDir = ConformanceTestHelper.repoRoot
            .resolve("apps")
            .resolve("android")
            .resolve("core-l0")
            .resolve("src")
            .resolve("main")
            .resolve("kotlin")

        val forbiddenPatterns = listOf(
            "java.text.Normalizer",
            "java.text.BreakIterator",
            "java.util.regex",
            "Regex(",
            ".toRegex(",
            ".lowercase(",
            ".uppercase(",
            ".lowercaseChar(",
            ".uppercaseChar(",
            ".trim(",
            "Character.is",
            ".isLetter(",
            ".isDigit(",
            ".isWhitespace(",
            ".isUpperCase(",
            ".isLowerCase(",
            "android.",
            "com.google.firebase",
            "java.net.",
            "java.io.File",
            "System.currentTimeMillis",
            "System.nanoTime",
            "java.util.Random",
            "kotlin.random",
            "toByteArray(Charsets.UTF_8)",
            "Locale",
            "String.format",
        )

        val ktFiles = Files.walk(mainDir).use { stream ->
            stream.filter { it.toString().endsWith(".kt") }.toList()
        }
        assertTrue(ktFiles.isNotEmpty(), "Expected Kotlin main files under $mainDir")

        for (file in ktFiles) {
            val content = Files.readString(file, Charsets.UTF_8)
            for (pat in forbiddenPatterns) {
                assertTrue(
                    !content.contains(pat),
                    "Forbidden pattern '$pat' found in ${file.fileName}",
                )
            }
        }
    }
}
