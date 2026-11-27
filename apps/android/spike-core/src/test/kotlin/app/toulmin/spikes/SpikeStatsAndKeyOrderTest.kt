package app.toulmin.spikes

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SpikeStatsAndKeyOrderTest {
    @Test
    fun `token estimate, output cap, and deadline match spec formulas`() {
        assertEquals(0, SpikeStats.estimateAndroidTokens(0))
        // ceil(100 / 3.2) = 32; ceil(32 * 1.25) = 40
        assertEquals(40, SpikeStats.estimateAndroidTokens(100))
        // cap <= 256
        assertEquals(135, SpikeStats.computeAndroidOutputCap(100.0))
        assertEquals(256, SpikeStats.computeAndroidOutputCap(220.0))
        // deadline = max(30_000, 2 * p99)
        assertEquals(30_000L, SpikeStats.computeAndroidDeadlineMs(8_000.0))
        assertEquals(34_000L, SpikeStats.computeAndroidDeadlineMs(17_000.0))
    }

    @Test
    fun `streaming top-level key extractor handles nested objects and escaped quotes`() {
        val validJson = """
            {
              "s01_evidence_span": "quote with \"escaped\" {braces}",
              "s02_evidence_idx": 0,
              "s03_micro_reasoning": "same direction and value",
              "s04_verdict": "SUPPORTED"
            }
        """.trimIndent()
        assertTrue(
            SpikeStats.hasExpectedKeyOrder(
                validJson,
                listOf("s01_evidence_span", "s02_evidence_idx", "s03_micro_reasoning", "s04_verdict"),
            ),
        )

        val reorderedJson = """
            {
              "s04_verdict": "SUPPORTED",
              "s01_evidence_span": "quote",
              "s02_evidence_idx": 0,
              "s03_micro_reasoning": "reason"
            }
        """.trimIndent()
        assertFalse(
            SpikeStats.hasExpectedKeyOrder(
                reorderedJson,
                listOf("s01_evidence_span", "s02_evidence_idx", "s03_micro_reasoning", "s04_verdict"),
            ),
        )

        val nestedJson = """{"s1_kind":"TABLE_ROW","s2_facts":[{"f1_quote":"48","f2_column":"N","f3_value":"48"}],"s3_doi":""}"""
        assertEquals(
            listOf("s1_kind", "s2_facts", "s3_doi"),
            SpikeStats.extractTopLevelJsonKeys(nestedJson),
        )
    }
}
