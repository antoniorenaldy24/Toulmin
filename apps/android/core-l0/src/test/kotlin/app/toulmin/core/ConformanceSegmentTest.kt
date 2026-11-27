package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.boolOrNull
import app.toulmin.core.ConformanceTestHelper.intOrNull
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceSegmentTest {
    @TestFactory
    fun `conformance l0 segment json`(): List<DynamicTest> {
        val entries = ConformanceTestHelper.loadGoldenArray("segment.json")
        return entries.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            DynamicTest.dynamicTest(id) {
                val input = tc.str("input")
                val format = SourceFormat.fromWireName(tc.str("format"))
                val res = segmentDocument(input, format)
                val expected = tc["expected"]!!.jsonArray
                assertEquals(expected.size, res.sentences.size)

                for (i in expected.indices) {
                    val sent = res.sentences[i]
                    val exp = expected[i].jsonObject
                    val expText = exp.str("text")
                    assertEquals(expText, sent.rawText)
                    assertEquals(expText, input.substring(sent.start, sent.end))
                    exp.intOrNull("markerCount")?.let { assertEquals(it, sent.markers.size) }
                    exp.strOrNull("section")?.let {
                        assertEquals(CanonicalSectionLabel.fromWireName(it), sent.section)
                    }
                    exp.boolOrNull("eligible")?.let { assertEquals(it, sent.eligible) }
                    exp.intOrNull("wordCount")?.let { assertEquals(it, sent.wordCount) }
                }
            }
        }
    }
}
