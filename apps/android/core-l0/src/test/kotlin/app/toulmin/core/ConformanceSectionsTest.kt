package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.bool
import app.toulmin.core.ConformanceTestHelper.intVal
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceSectionsTest {
    private fun JsonObject.toSectionState(): SectionState =
        SectionState(
            label = CanonicalSectionLabel.fromWireName(str("label")),
            subsection = strOrNull("subsection"),
        )

    private fun JsonArray.toSectionStates(): List<SectionState> =
        map { it.jsonObject.toSectionState() }

    @TestFactory
    fun `conformance l0 sections json`(): List<DynamicTest> {
        val entries = ConformanceTestHelper.loadGoldenArray("sections.json")
        return entries.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            val op = tc.str("op")
            DynamicTest.dynamicTest("$id ($op)") {
                when (op) {
                    "tracker" -> {
                        tc["expectedInitial"]?.jsonObject?.let { expInit ->
                            val tracker = SectionTracker()
                            assertEquals(expInit.toSectionState(), tracker.current)
                        }
                        val steps = tc["steps"]!!.jsonArray.map { s ->
                            val o = s.jsonObject
                            HeadingInput(o.intVal("level"), o.str("heading"))
                        }
                        assertEquals(tc["expected"]!!.jsonArray.toSectionStates(), resolveHeadingSequence(steps))
                    }
                    "match" -> {
                        for (itemEl in tc["cases"]!!.jsonArray) {
                            val item = itemEl.jsonObject
                            val expected = item.strOrNull("expected")?.let { CanonicalSectionLabel.fromWireName(it) }
                            assertEquals(
                                expected,
                                matchCanonicalSectionLabel(item.str("heading"), item.bool("isFirstHeading")),
                            )
                        }
                    }
                    "preMaskSections" -> {
                        val res = preMask(tc.str("input"), SourceFormat.fromWireName(tc.str("format")))
                        assertEquals(
                            tc["expected"]!!.jsonArray.toSectionStates(),
                            res.sectionTransitions.map { it.state },
                        )
                    }
                    else -> error("Unsupported op in sections.json: $op")
                }
            }
        }
    }
}
