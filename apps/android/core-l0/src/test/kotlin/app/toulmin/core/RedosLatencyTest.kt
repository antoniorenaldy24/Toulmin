package app.toulmin.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.ceil

/**
 * Adversarial ReDoS & worst-case O(n) latency fuzz suite (`AC-L0-15`, `02` §1.4, `07` §6.9 Procedure 1)
 * for all §2–§6 entry points in `apps/android/core-l0`.
 */
class RedosLatencyTest {
    companion object {
        private const val SEED_FUZZ = 0x544C4D46
        private const val SEED_FUZZ_ALT = 0x544C4D4E
        private const val TEN_KB = 10_240
        private const val MAX_MEDIAN_MS = 5.0
    }

    private fun createPrng(seed: Int): () -> Double {
        var state = seed.toUInt()
        return {
            state += 0x6D2B79F5u
            var t = (state xor (state shr 15)) * (1u or state)
            t = (t + ((t xor (t shr 7)) * (61u or t))) xor t
            ((t xor (t shr 14)).toDouble()) / 4294967296.0
        }
    }

    private fun exactLength(pattern: String, len: Int = TEN_KB): String {
        val reps = ceil(len.toDouble() / pattern.length).toInt().coerceAtLeast(1)
        val sb = StringBuilder(reps * pattern.length)
        repeat(reps) { sb.append(pattern) }
        return sb.substring(0, len)
    }

    private inline fun medianMs(runs: Int = 5, fn: () -> Unit): Double {
        fn()
        val timings = DoubleArray(runs)
        for (i in 0 until runs) {
            val start = System.nanoTime()
            fn()
            timings[i] = (System.nanoTime() - start) / 1_000_000.0
        }
        timings.sort()
        return timings[runs ushr 1]
    }

    private data class EntryPoint(
        val name: String,
        val run: (String) -> Unit,
    )

    private val entryPoints: List<EntryPoint> = listOf(
        EntryPoint("norm") { norm(it) },
        EntryPoint("normLower") { normLower(it) },
        EntryPoint("foldLatin") { foldLatin(it) },
        EntryPoint("sha256hex") { sha256hex(it) },
        EntryPoint("mathText") { mathText(it) },
        EntryPoint("preMask(latex)") { preMask(it, SourceFormat.LATEX) },
        EntryPoint("preMask(md)") { preMask(it, SourceFormat.MD) },
        EntryPoint("applyLatexSubstitutions") { applyLatexSubstitutions(it) },
        EntryPoint("normSentence") { normSentence(it, NormSentenceOptions(format = SourceFormat.MD)) },
        EntryPoint("segmentDocument(latex)") { segmentDocument(it, SourceFormat.LATEX) },
        EntryPoint("segmentDocument(md)") { segmentDocument(it, SourceFormat.MD) },
        EntryPoint("scanCitations") { scanCitations(it) },
        EntryPoint("partitionClauses") { partitionClauses(it, emptyList()) },
    )

    private fun build64OpenerCorpus(seed: Int): List<String> {
        val rng = createPrng(seed)
        val openers = listOf(
            "(", "[", "{", "\\cite{", "$", "$$", "\\(", "\\[",
            "<", "<!--", "\\textbf{", "\\frac{", "\\SI{", "\\section{", "<p ", "<sec>",
        )
        return List(64) { i ->
            if (i < openers.size) {
                exactLength(openers[i])
            } else {
                val a = openers[(rng() * openers.size).toInt()]
                val b = openers[(rng() * openers.size).toInt()]
                val pad = if (i % 2 == 0) "x " else ""
                exactLength("$a$b$pad")
            }
        }
    }

    private fun buildNearMatchCorpus(): List<String> {
        val nearPatterns = listOf(
            "ignore override disregard forget ",
            "previous prior above earlier all any ",
            "system developer assistant user evidence ",
            "you are now a language model ",
            "respond reply answer output return print ",
            "new revised real actual hidden task ",
            "< <system </ <evidence <instruction ",
            "[inst </inst <<sys <<evidence ",
            "## ### instruction system task prompt ",
            "the correct right true verdict answer ",
            "do not follow obey your previous ",
            "begin end of system instructions prompt ",
            "http:// https:// example.org/p?a=1 ",
            "\"verdict\" s01_ s02_ nei_silent ",
            "et al. e.g. i.e. Fig. 2 vs. approx. i.v. ",
            "A. ",
            "95% CI IQR median range from between ",
            "95% CI [12, 45] median 5 [3, 7] days ",
        )
        return nearPatterns.map { exactLength(it) }
    }

    private fun buildCite64Keys10k(): String {
        val keys = (0 until 64).joinToString(",") { "ref_key_$it" }
        val prefix = "\\cite{$keys,"
        return prefix + exactLength("key_char:0123_abc-def.", TEN_KB - prefix.length)
    }

    private fun buildPandoc10k(): String {
        val prefix = "[@" + (0 until 64).joinToString("; @") { "k$it" } + "; "
        return prefix + exactLength("smith2020_", TEN_KB - prefix.length)
    }

    private fun buildNumericRuns(): List<String> = listOf(
        exactLength("1234567890"),
        exactLength("1.2.3.4.5.6.7.8.9."),
        exactLength("1\u00B72\u00B73\u00B74\u00B7"),
        exactLength("1,234,567,890 "),
        exactLength("0.001 -1.23 95% 1.2-3.4 "),
    )

    private val unicodeMixPool: List<String> = listOf(
        "a", "Z", "M\u00FC", "u\u0308", "\u0130", "\u03B1", "\u03BF", "\u0430", "\u0440",
        "\uD835\uDC22", "\u24D8", "\uF0B1", "\uE123", "\u092A", "\u200D", "\u200B", "\u202E",
        "\uDB40\uDC69", "0", "5", " ", "\t", "\n", ".", "?", "!", "(", ")", "[", "]", "{", "}",
        "<", ">", "$", "\\", "_", ":", "-", "+", "%", "\u00B7", "#", "&", "\"", "'",
    )

    private val commonLatinFillers: List<String> = listOf(
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "l", "m", "n", "o", "p", "r", "s", "t", "u",
        " ", " ", " ", " ", " ",
    )

    private val unicodeRealisticMixPool: List<String> = buildList {
        repeat(5) { addAll(commonLatinFillers) }
        addAll(unicodeMixPool.filter { it != "\\" && it != "$" })
    }

    private fun buildRandomUnicodeStrings(
        seed: Int,
        count: Int,
        minLen: Int,
        maxLen: Int,
        pool: List<String> = unicodeMixPool,
    ): List<String> {
        val rng = createPrng(seed)
        return List(count) {
            val targetLen = minLen + (rng() * (maxLen - minLen + 1)).toInt()
            val sb = StringBuilder(targetLen)
            repeat(targetLen) {
                sb.append(pool[(rng() * pool.size).toInt()])
            }
            sb.toString()
        }
    }

    private fun warmUpEntryPoint(
        name: String,
        run: (String) -> Unit,
        samples: List<String>,
        warmedUp: MutableSet<String>,
    ) {
        if (!warmedUp.add(name)) return
        repeat(8) {
            for (s in samples) run(s)
        }
    }

    @Test
    fun `all 64 10 KB repeated-opener, near-match, 64-key, numeric, and mixed Unicode inputs run in median le 5 ms`() {
        val openers10k = build64OpenerCorpus(SEED_FUZZ)
        val openersAlt10k = build64OpenerCorpus(SEED_FUZZ_ALT)
        val nearMatches10k = buildNearMatchCorpus()
        val cite64Keys10k = buildCite64Keys10k()
        val pandoc10k = buildPandoc10k()
        val numericRuns = buildNumericRuns()

        val mixedRealistic = buildRandomUnicodeStrings(
            SEED_FUZZ + 7, 1, TEN_KB, TEN_KB, unicodeRealisticMixPool,
        )[0].substring(0, TEN_KB)

        val warmupCorpus10k = listOf(
            openers10k[0],
            openers10k[17],
            nearMatches10k[14],
            nearMatches10k[15],
            nearMatches10k[17],
            cite64Keys10k,
            numericRuns[4],
            mixedRealistic,
        )
        val warmedUp = HashSet<String>()

        for (ep in entryPoints) {
            warmUpEntryPoint(ep.name, ep.run, warmupCorpus10k, warmedUp)
            var worstMs = 0.0
            var worstIdx = -1
            for (i in openers10k.indices) {
                val input = openers10k[i]
                val ms = medianMs { ep.run(input) }
                if (ms > worstMs) {
                    worstMs = ms
                    worstIdx = i
                }
            }
            assertTrue(
                worstMs <= MAX_MEDIAN_MS,
                "${ep.name} failed on opener[$worstIdx] (${"%.3f".format(worstMs)} ms)",
            )

            for (i in 16 until 24) {
                val ms = medianMs { ep.run(openersAlt10k[i]) }
                assertTrue(
                    ms <= MAX_MEDIAN_MS,
                    "${ep.name} alt-seed[$i] exceeded 5 ms (${"%.3f".format(ms)} ms)",
                )
            }

            for (i in nearMatches10k.indices) {
                val ms = medianMs { ep.run(nearMatches10k[i]) }
                assertTrue(
                    ms <= MAX_MEDIAN_MS,
                    "${ep.name} nearMatch[$i] exceeded 5 ms (${"%.3f".format(ms)} ms)",
                )
            }

            val citeMs = medianMs { ep.run(cite64Keys10k) }
            assertTrue(citeMs <= MAX_MEDIAN_MS, "${ep.name} cite64Keys10k (${"%.3f".format(citeMs)} ms)")

            val pandocMs = medianMs { ep.run(pandoc10k) }
            assertTrue(pandocMs <= MAX_MEDIAN_MS, "${ep.name} pandoc10k (${"%.3f".format(pandocMs)} ms)")

            for (r in numericRuns.indices) {
                val ms = medianMs { ep.run(numericRuns[r]) }
                assertTrue(
                    ms <= MAX_MEDIAN_MS,
                    "${ep.name} numericRun[$r] (${"%.3f".format(ms)} ms)",
                )
            }
        }

        // Clause partitioner with dense parsed citation markers on 10 KB input
        val denseCite10k = exactLength("Drug [1] ")
        val denseCiteMarkers = scanCitations(denseCite10k)
        repeat(8) { partitionClauses(denseCite10k, denseCiteMarkers) }
        val denseMs = medianMs { partitionClauses(denseCite10k, denseCiteMarkers) }
        assertTrue(denseMs <= MAX_MEDIAN_MS, "partitionClauses denseCite10k (${"%.3f".format(denseMs)} ms)")

        // 1,000 random Unicode class-mixed strings
        val unicode1000 = buildRandomUnicodeStrings(SEED_FUZZ + 1, 1_000, 32, 160)
        for (sample in unicode1000) {
            val nRes = norm(sample)
            assertEquals(nRes.text.length + 1, nRes.map.size)
            assertEquals(sample.length, nRes.map[nRes.text.length])
            preMask(sample, SourceFormat.LATEX)
            applyLatexSubstitutions(sample)
            normSentence(sample, NormSentenceOptions(format = SourceFormat.LATEX))
            segmentDocument(sample, SourceFormat.MD)
            scanCitations(sample)
            partitionClauses(sample, emptyList())
        }

        // 8 exact 10 KB realistic mixed Unicode inputs across every entry point
        val mixed10kSamples = buildRandomUnicodeStrings(
            SEED_FUZZ + 99, 8, TEN_KB, TEN_KB, unicodeRealisticMixPool,
        ).map { it.substring(0, TEN_KB) }
        for (ep in entryPoints) {
            warmUpEntryPoint(ep.name, ep.run, warmupCorpus10k, warmedUp)
            for (i in mixed10kSamples.indices) {
                val ms = medianMs { ep.run(mixed10kSamples[i]) }
                assertTrue(
                    ms <= MAX_MEDIAN_MS,
                    "${ep.name} mixed10k[$i] (${"%.3f".format(ms)} ms)",
                )
            }
        }
    }
}
