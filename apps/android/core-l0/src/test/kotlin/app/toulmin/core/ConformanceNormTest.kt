package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.asBoolList
import app.toulmin.core.ConformanceTestHelper.asIntList
import app.toulmin.core.ConformanceTestHelper.bool
import app.toulmin.core.ConformanceTestHelper.str
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceNormTest {
    private fun resolveInput(entry: JsonObject): String {
        val codeUnitsEl = entry["codeUnits"]
        if (codeUnitsEl != null) {
            val units = codeUnitsEl.asIntList()
            return String(CharArray(units.size) { units[it].toChar() })
        }
        return entry["input"]?.jsonPrimitive?.content ?: ""
    }

    private fun assertMapInvariants(input: String, result: NormResult) {
        assertEquals(result.text.length + 1, result.map.size)
        assertEquals(input.length, result.map[result.text.length])
        for (i in result.map.indices) {
            val cur = result.map[i]
            assertTrue(cur >= 0, "map[$i] >= 0")
            assertTrue(cur <= input.length, "map[$i] <= input.length")
            if (i > 0) {
                assertTrue(cur >= result.map[i - 1], "map[$i] monotonic")
            }
        }
    }

    @TestFactory
    fun `conformance l0 norm json`(): List<DynamicTest> {
        val entries = ConformanceTestHelper.loadGoldenArray("norm.json")
        return entries.map { el ->
            val entry = el.jsonObject
            val id = entry.str("id")
            val op = entry.str("op")
            DynamicTest.dynamicTest("$id ($op)") {
                val input = resolveInput(entry)
                when (op) {
                    "norm" -> {
                        val exp = entry["expected"]!!.jsonObject
                        val actual = norm(input)
                        assertEquals(exp.str("text"), actual.text)
                        assertEquals(exp["map"]!!.asIntList(), actual.map.toList())
                        assertMapInvariants(input, actual)
                    }
                    "normLower" -> {
                        val exp = entry["expected"]!!.jsonObject
                        val actual = normLowerWithMap(input)
                        assertEquals(exp.str("text"), actual.text)
                        assertEquals(exp["map"]!!.asIntList(), actual.map.toList())
                        assertEquals(exp.str("text"), normLower(input))
                        assertMapInvariants(input, actual)
                    }
                    "foldLatin" -> {
                        assertEquals(entry.str("expected"), foldLatin(input))
                    }
                    "letterWord" -> {
                        val flags = input.indices.map { i -> isLetterAt(input, i) }
                        assertEquals(entry["expected"]!!.asBoolList(), flags)
                    }
                    "charClass" -> {
                        val exp = entry["expected"]!!.jsonObject
                        val unit = codePointAtSafe(input, 0)
                        assertEquals(exp.str("generalCategory"), generalCategory(unit.cp).code)
                        assertEquals(exp.bool("isLetter"), isLetter(unit.cp, false))
                        assertEquals(exp.bool("isUpper"), isUpper(unit.cp))
                        assertEquals(exp.bool("isLower"), isLower(unit.cp))
                        assertEquals(exp.bool("isDigit"), isDigit(unit.cp))
                        assertEquals(exp.bool("isSpace"), isSpace(unit.cp))
                        assertEquals(exp.str("normLower"), normLower(input))
                    }
                    "sha256hex" -> {
                        assertEquals(entry.str("expected"), sha256hex(input))
                    }
                    else -> error("Unsupported op in norm.json: $op")
                }
            }
        }
    }
}
