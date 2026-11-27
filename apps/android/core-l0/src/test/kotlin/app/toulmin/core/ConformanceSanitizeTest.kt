package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.asIntList
import app.toulmin.core.ConformanceTestHelper.asStringList
import app.toulmin.core.ConformanceTestHelper.bool
import app.toulmin.core.ConformanceTestHelper.boolOrNull
import app.toulmin.core.ConformanceTestHelper.intOrNull
import app.toulmin.core.ConformanceTestHelper.intVal
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceSanitizeTest {
    @TestFactory
    fun `conformance l0 sanitize json`(): List<DynamicTest> {
        val cases = ConformanceTestHelper.loadGoldenArray("sanitize.json")
        return cases.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            val op = tc.str("op")
            DynamicTest.dynamicTest("$id ($op)") {
                when (op) {
                    "sanitize" -> {
                        val opts = tc["options"]?.jsonObject?.let { optObj ->
                            SanitizeOptions(hiddenPdfText = optObj.boolOrNull("hiddenPdfText") == true)
                        }
                        val res = sanitizeText(tc.str("input"), opts)
                        val exp = tc["expected"]!!.jsonObject
                        exp.strOrNull("text")?.let { assertEquals(it, res.text, "[$id] text") }
                        exp["map"]?.let { assertEquals(it.asIntList(), res.map.toList(), "[$id] map") }
                        exp.strOrNull("detectText")?.let { assertEquals(it, res.detectText, "[$id] detectText") }
                        assertEquals(SanitizeTier.fromWireName(exp.str("tier")), res.tier, "[$id] tier")
                        assertEquals(exp.bool("blocked"), res.blocked, "[$id] blocked")
                        assertEquals(exp["reasons"]!!.asStringList(), res.reasons, "[$id] reasons")
                        exp.intOrNull("invisibleCharCount")?.let {
                            assertEquals(it, res.invisibleCharCount, "[$id] invisibleCharCount")
                        }
                        exp.intOrNull("mixedScriptWordCount")?.let {
                            assertEquals(it, res.mixedScriptWordCount, "[$id] mixedScriptWordCount")
                        }
                        assertEquals(res.text.length + 1, res.map.size)
                    }
                    "wrap" -> {
                        val sanitized = sanitizeText(tc.str("input"))
                        assertEquals(tc.str("expectedEscaped"), escapeEvidenceDelimiters(sanitized.text))
                        assertEquals(tc.str("expectedWrapped"), wrapEvidenceBlock(tc.intVal("idArg"), sanitized.text))
                    }
                    "metadata" -> {
                        val field = MetadataFieldName.fromWireName(tc.str("field"))
                        val meta = sanitizeMetadataField(field, tc.str("input"))
                        val exp = tc["expected"]!!.jsonObject
                        assertEquals(exp.str("value"), meta.value)
                        assertEquals(exp.bool("withheld"), meta.withheld)
                    }
                    else -> error("Unsupported op in sanitize.json: $op")
                }
            }
        }
    }
}
