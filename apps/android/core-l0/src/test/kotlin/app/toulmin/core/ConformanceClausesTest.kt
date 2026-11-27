package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.asStringList
import app.toulmin.core.ConformanceTestHelper.bool
import app.toulmin.core.ConformanceTestHelper.str
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceClausesTest {
    @TestFactory
    fun `conformance l0 clauses json`(): List<DynamicTest> {
        val entries = ConformanceTestHelper.loadGoldenArray("clauses.json")
        return entries.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            DynamicTest.dynamicTest(id) {
                val input = tc.str("input")
                val markers = scanCitations(input)
                val clauses = partitionClauses(input, markers)
                val expected = tc["expected"]!!.jsonArray
                assertEquals(expected.size, clauses.size)

                for (i in expected.indices) {
                    val c = clauses[i]
                    val exp = expected[i].jsonObject
                    assertEquals(i, c.clauseIndex)
                    assertEquals(exp.str("claimText"), c.claimText)
                    assertEquals(exp["markerRawTexts"]!!.asStringList(), c.markers.map { it.rawText })
                    assertEquals(exp.bool("uncited"), c.uncited)
                    assertTrue(c.span.start >= 0)
                    assertTrue(c.span.end <= input.length)
                    assertTrue(c.span.start <= c.span.end)
                    if (i > 0) {
                        assertTrue(clauses[i - 1].range.end <= c.range.start)
                    }
                }
            }
        }
    }
}
