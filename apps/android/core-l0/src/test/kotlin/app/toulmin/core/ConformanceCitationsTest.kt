package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.asIntList
import app.toulmin.core.ConformanceTestHelper.asStringList
import app.toulmin.core.ConformanceTestHelper.bool
import app.toulmin.core.ConformanceTestHelper.intOrNull
import app.toulmin.core.ConformanceTestHelper.intVal
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceCitationsTest {
    @TestFactory
    fun `conformance l0 citations json`(): List<DynamicTest> {
        val entries = ConformanceTestHelper.loadGoldenArray("citations.json")
        return entries.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            val op = tc.str("op")
            DynamicTest.dynamicTest("$id ($op)") {
                when (op) {
                    "scan" -> {
                        val customCiteMacros = tc.strOrNull("latexSource")?.let {
                            preMask(it, SourceFormat.LATEX).customCiteMacros
                        }
                        val bibKeys = tc["bibKeys"]?.asStringList()?.toSet()
                        val markers = scanCitations(
                            tc.str("input"),
                            ScanCitationsOptions(
                                customCiteMacros = customCiteMacros,
                                bibKeys = bibKeys,
                            ),
                        )
                        val expected = tc["expected"]!!.jsonArray
                        assertEquals(expected.size, markers.size)
                        for (i in expected.indices) {
                            val actual = markers[i]
                            val exp = expected[i].jsonObject
                            assertEquals(exp.str("rule"), actual.rule.wireName)
                            assertEquals(exp.str("kind"), actual.kind.wireName)
                            assertEquals(exp.bool("narrative"), actual.narrative)
                            exp["keys"]?.let { assertEquals(it.asStringList(), actual.keys) }
                            exp["numericIds"]?.let { assertEquals(it.asIntList(), actual.numericIds) }
                            exp.strOrNull("rawText")?.let { assertEquals(it, actual.rawText) }
                            exp["surnames"]?.let {
                                assertEquals(it.asStringList(), actual.authorYears.map { ay -> ay.surname })
                            }
                            exp["years"]?.let {
                                assertEquals(it.asStringList(), actual.authorYears.map { ay -> ay.year })
                            }
                        }
                    }
                    "scanBatch" -> {
                        for (subEl in tc["cases"]!!.jsonArray) {
                            val sub = subEl.jsonObject
                            val subInput = sub.str("input")
                            val markers = scanCitations(subInput)
                            val expNumeric = sub["expectedNumeric"]!!.jsonArray.map { it.asIntList() }
                            assertEquals(expNumeric, markers.map { it.numericIds }, subInput)
                        }
                    }
                    "resolve" -> {
                        val markers = scanCitations(tc.str("input"))
                        val exp = tc["expected"]!!.jsonObject
                        assertEquals(exp.intVal("markerCount"), markers.size)
                        val bibEntries = tc["entries"]!!.jsonArray.map { eEl ->
                            val o = eEl.jsonObject
                            BibliographyEntry(
                                refId = o.str("refId"),
                                key = o.str("key"),
                                orderIndex = o.intOrNull("orderIndex"),
                                firstAuthorFamily = o.strOrNull("firstAuthorFamily"),
                                corporateAuthor = o.strOrNull("corporateAuthor"),
                                shortauthor = o.strOrNull("shortauthor"),
                                shorthand = o.strOrNull("shorthand"),
                                year = o.strOrNull("year"),
                            )
                        }
                        val res = resolveCitationMarkers(markers, ResolveCitationsOptions(entries = bibEntries))
                        assertEquals(
                            exp["statuses"]!!.asStringList(),
                            res.resolvedMarkers.map { it.status.wireName },
                        )
                        exp["resolvedRefIds"]?.let { assertEquals(it.asStringList(), res.resolvedRefIds) }
                        exp["possibleCitationTexts"]?.let {
                            assertEquals(it.asStringList(), res.possibleCitations.map { p -> p.text })
                        }
                        assertEquals(exp["unresolvedKeys"]!!.asStringList(), res.unresolvedKeys)
                    }
                    "resolveMarkdown" -> {
                        val input = tc.str("input")
                        val masked = preMask(input, SourceFormat.MD)
                        val mdRefs = extractMarkdownNumberedReferences(input, masked)
                        assertTrue(mdRefs.isNotEmpty())
                        val markers = scanCitations(
                            masked.maskedText,
                            ScanCitationsOptions(hasKnownNumberingOrder = true),
                        )
                        val res = resolveCitationMarkers(
                            markers,
                            ResolveCitationsOptions(markdownNumberedRefs = mdRefs),
                        )
                        val exp = tc["expected"]!!.jsonObject
                        assertEquals(exp["resolvedRefIds"]!!.asStringList(), res.resolvedRefIds)
                        assertEquals(
                            exp["statuses"]!!.asStringList(),
                            res.resolvedMarkers.map { it.status.wireName },
                        )
                        assertEquals(exp["unresolvedKeys"]!!.asStringList(), res.unresolvedKeys)
                    }
                    else -> error("Unsupported op in citations.json: $op")
                }
            }
        }
    }
}
