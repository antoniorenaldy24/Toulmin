package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.asStringList
import app.toulmin.core.ConformanceTestHelper.doubleVal
import app.toulmin.core.ConformanceTestHelper.intVal
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceQuantityTest {
    @TestFactory
    fun `conformance l0 quantity json`(): List<DynamicTest> {
        val cases = ConformanceTestHelper.loadGoldenArray("quantity.json")
        return cases.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            DynamicTest.dynamicTest(id) {
                val input = tc.str("input")
                val actual = extractQuantities(
                    input,
                    ExtractQuantitiesOptions(
                        lang = tc.strOrNull("lang"),
                        tableHeader = tc.strOrNull("tableHeader"),
                        rowLabel = tc.strOrNull("rowLabel"),
                    ),
                )
                val expected = tc["expected"]!!.jsonArray
                assertEquals(expected.size, actual.size, "[$id] tuple count mismatch")

                for (i in expected.indices) {
                    val a = actual[i]
                    val e = expected[i].jsonObject
                    e.strOrNull("valueRaw")?.let { assertEquals(it, a.valueRaw, "[$id][$i] valueRaw") }
                    e.strOrNull("unitRaw")?.let { assertEquals(it, a.unitRaw, "[$id][$i] unitRaw") }
                    e.strOrNull("unitCanon")?.let { assertEquals(it, a.unitCanon, "[$id][$i] unitCanon") }
                    if (e.containsKey("valueNorm")) {
                        assertEquals(e.doubleVal("valueNorm"), a.valueNorm!!, 1e-12, "[$id][$i] valueNorm")
                    }
                    if (e.containsKey("valueLo")) {
                        assertEquals(e.doubleVal("valueLo"), a.valueLo!!, 1e-12, "[$id][$i] valueLo")
                    }
                    if (e.containsKey("valueHi")) {
                        assertEquals(e.doubleVal("valueHi"), a.valueHi!!, 1e-12, "[$id][$i] valueHi")
                    }
                    if (e.containsKey("sigDigits")) {
                        assertEquals(e.intVal("sigDigits"), a.sigDigits, "[$id][$i] sigDigits")
                    }
                    e.strOrNull("metricClass")?.let {
                        assertEquals(MetricClass.fromWireName(it), a.metricClass, "[$id][$i] metricClass")
                    }
                    if (e.containsKey("pComparator")) {
                        val expCmp = e.strOrNull("pComparator")?.let { PComparator.fromWireName(it) }
                        assertEquals(expCmp, a.pComparator, "[$id][$i] pComparator")
                    }
                    e["keyLemmas"]?.let {
                        assertEquals(it.asStringList(), a.keyLemmas, "[$id][$i] keyLemmas")
                    }
                    assertTrue(a.span.start >= 0)
                    assertTrue(a.span.end <= input.length)
                    assertTrue(a.span.start <= a.span.end)
                }

                tc["assertNotSameFamily"]?.jsonArray?.forEach { pairEl ->
                    val pair = pairEl.jsonArray
                    val ua = pair[0].jsonPrimitive.content
                    val ub = pair[1].jsonPrimitive.content
                    assertFalse(sameFamily(ua, ub), "[$id] sameFamily($ua, $ub) must be false")
                }
            }
        }
    }
}
