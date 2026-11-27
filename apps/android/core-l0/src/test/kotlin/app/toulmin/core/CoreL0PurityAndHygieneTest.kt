package app.toulmin.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files

class CoreL0PurityAndHygieneTest {
    @Test
    fun `bundled Tier A binary and JSON resources match packages-core-l0 byte-for-byte`() {
        val tsDir = ConformanceTestHelper.repoRoot.resolve("packages").resolve("core-l0")
        val binFromTs = Files.readAllBytes(tsDir.resolve("unicode_15_1.bin"))
        val normFromTs = Files.readAllBytes(tsDir.resolve("norm_table.json"))

        val binFromClasspath = NormTableData::class.java.classLoader
            .getResourceAsStream("unicode_15_1.bin")!!
            .use { it.readBytes() }
        val normFromClasspath = NormTableData::class.java.classLoader
            .getResourceAsStream("norm_table.json")!!
            .use { it.readBytes() }

        assertEquals(sha256hexBytes(binFromTs), sha256hexBytes(binFromClasspath))
        assertEquals(sha256hexBytes(normFromTs), sha256hexBytes(normFromClasspath))

        val resDir = ConformanceTestHelper.repoRoot
            .resolve("apps")
            .resolve("android")
            .resolve("core-l0")
            .resolve("src")
            .resolve("main")
            .resolve("resources")
        assertTrue(Files.isRegularFile(resDir.resolve("unicode_15_1.bin")))
        assertTrue(Files.isRegularFile(resDir.resolve("norm_table.json")))
        assertEquals(sha256hexBytes(binFromTs), sha256hexBytes(Files.readAllBytes(resDir.resolve("unicode_15_1.bin"))))
        assertEquals(sha256hexBytes(normFromTs), sha256hexBytes(Files.readAllBytes(resDir.resolve("norm_table.json"))))
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
