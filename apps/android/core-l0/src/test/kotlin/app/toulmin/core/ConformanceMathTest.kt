package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.asIntList
import app.toulmin.core.ConformanceTestHelper.asStringList
import app.toulmin.core.ConformanceTestHelper.bool
import app.toulmin.core.ConformanceTestHelper.boolOrNull
import app.toulmin.core.ConformanceTestHelper.intOrNull
import app.toulmin.core.ConformanceTestHelper.intVal
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceMathTest {
    private fun assertOffsetMapInvariants(inputLen: Int, outputText: String, map: IntArray) {
        assertEquals(outputText.length + 1, map.size)
        assertEquals(inputLen, map[outputText.length])
        for (i in map.indices) {
            val v = map[i]
            assertTrue(v >= 0)
            assertTrue(v <= inputLen)
            if (i > 0) {
                assertTrue(v >= map[i - 1])
            }
        }
    }

    @TestFactory
    fun `conformance l0 math json`(): List<DynamicTest> {
        val entries = ConformanceTestHelper.loadGoldenArray("math.json")
        return entries.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            val op = tc.str("op")
            DynamicTest.dynamicTest("$id ($op)") {
                when (op) {
                    "normSentenceCompare" -> {
                        val format = SourceFormat.fromWireName(tc.str("format"))
                        val inputA = tc.str("inputA")
                        val inputB = tc.str("inputB")
                        val exp = tc["expected"]!!.jsonObject
                        val normA = normSentence(inputA, NormSentenceOptions(format = format))
                        val normB = normSentence(inputB, NormSentenceOptions(format = format))
                        assertEquals(exp.str("normA"), normA)
                        assertEquals(exp.str("normB"), normB)
                        assertEquals(exp.bool("equal"), normA == normB)
                        assertEquals(
                            exp.bool("equal"),
                            sentenceHash(inputA, NormSentenceOptions(format = format)) ==
                                sentenceHash(inputB, NormSentenceOptions(format = format)),
                        )
                    }
                    "normSentence" -> {
                        val format = SourceFormat.fromWireName(tc.str("format"))
                        val markerRanges = tc["markerRanges"]?.jsonArray?.map {
                            val obj = it.jsonObject
                            TextRange(obj.intVal("start"), obj.intVal("end"))
                        }
                        val opts = NormSentenceOptions(format = format, markerRanges = markerRanges)
                        assertEquals(tc.str("expected"), normSentence(tc.str("input"), opts))
                    }
                    "mathText" -> {
                        assertEquals(tc.str("expected"), mathText(tc.str("input")))
                    }
                    "preMask" -> {
                        val format = SourceFormat.fromWireName(tc.str("format"))
                        val input = tc.str("input")
                        val res = preMask(input, format)
                        assertEquals(input.length, res.maskedText.length)
                        val exp = tc["expected"]!!.jsonObject

                        exp.intOrNull("mathCount")?.let { assertEquals(it, res.mathRegions.size) }
                        exp.intOrNull("displayCount")?.let { assertEquals(it, res.report.mathRegions.display) }
                        exp.intOrNull("inlineCount")?.let { assertEquals(it, res.report.mathRegions.inline) }
                        exp["mathTexts"]?.let {
                            assertEquals(it.asStringList(), res.mathRegions.map { m -> m.text })
                        }
                        exp.boolOrNull("firstMathIsBlockBoundary")?.let { expectedFlag ->
                            val firstMath = res.regions.firstOrNull { r ->
                                r.kind == MaskedRegionKind.DISPLAY_MATH || r.kind == MaskedRegionKind.INLINE_MATH
                            }
                            assertEquals(expectedFlag, firstMath?.isBlockBoundary)
                        }
                        if (exp.boolOrNull("unmaskedEqualsInput") == true) {
                            assertEquals(input, res.maskedText)
                        }
                        exp["userMacros"]?.jsonObject?.let { expMacros ->
                            val expectedMap = expMacros.entries.associate { (k, v) -> k to v.jsonPrimitive.content }
                            assertEquals(expectedMap, res.userMacros)
                        }
                        exp["macrosNotExpanded"]?.let {
                            assertEquals(it.asStringList(), res.report.macrosNotExpanded)
                        }
                        if (exp.boolOrNull("fullyMasked") == true) {
                            assertEquals(MASK_CHAR.toString().repeat(input.length), res.maskedText)
                        }
                        val maskedLength = exp.intOrNull("maskedLength")
                        val unmaskedTail = exp.strOrNull("unmaskedTail")
                        if (maskedLength != null && unmaskedTail != null) {
                            assertEquals(MASK_CHAR.toString().repeat(maskedLength) + unmaskedTail, res.maskedText)
                        }
                        exp["captions"]?.jsonArray?.let { expCaptions ->
                            val actualCaptions = res.proseStreams.filter { it.kind == "caption" }
                            assertEquals(expCaptions.size, actualCaptions.size)
                            for (i in expCaptions.indices) {
                                val cExp = expCaptions[i].jsonObject
                                val cAct = actualCaptions[i]
                                assertEquals(cExp.str("rawText"), cAct.rawText)
                                val secObj = cExp["section"]!!.jsonObject
                                assertEquals(
                                    SectionState(
                                        CanonicalSectionLabel.fromWireName(secObj.str("label")),
                                        secObj.strOrNull("subsection"),
                                    ),
                                    cAct.section,
                                )
                            }
                        }
                        exp["footnotes"]?.jsonArray?.let { expFootnotes ->
                            val actualFootnotes = res.proseStreams.filter { it.kind == "footnote" }
                            assertEquals(expFootnotes.size, actualFootnotes.size)
                            for (i in expFootnotes.indices) {
                                val fExp = expFootnotes[i].jsonObject
                                val fAct = actualFootnotes[i]
                                fExp["kind"]?.let { assertEquals(fExp.str("kind"), fAct.kind) }
                                assertEquals(fExp.str("rawText"), fAct.rawText)
                                val secObj = fExp["section"]!!.jsonObject
                                assertEquals(
                                    SectionState(
                                        CanonicalSectionLabel.fromWireName(secObj.str("label")),
                                        secObj.strOrNull("subsection"),
                                    ),
                                    fAct.section,
                                )
                            }
                        }
                    }
                    "applyLatexSubstitutions" -> {
                        val input = tc.str("input")
                        val exp = tc["expected"]!!.jsonObject
                        val res = applyLatexSubstitutions(input)
                        assertEquals(exp.str("text"), res.text)
                        assertEquals(exp["unregisteredCommands"]!!.asStringList(), res.unregisteredCommands)
                        assertOffsetMapInvariants(input.length, res.text, res.map)
                        exp["map"]?.let {
                            assertEquals(it.asIntList(), res.map.toList())
                        }
                    }
                    else -> error("Unsupported op in math.json: $op")
                }
            }
        }
    }
}
