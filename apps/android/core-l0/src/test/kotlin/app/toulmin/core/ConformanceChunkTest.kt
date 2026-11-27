package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.asIntList
import app.toulmin.core.ConformanceTestHelper.asStringList
import app.toulmin.core.ConformanceTestHelper.doubleVal
import app.toulmin.core.ConformanceTestHelper.intOrNull
import app.toulmin.core.ConformanceTestHelper.intVal
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceChunkTest {
    private fun parseExpectedUnit(obj: JsonObject): EvidenceUnit = EvidenceUnit(
        chunkId = obj.str("chunkId"),
        sourceKind = EvidenceSourceKind.fromWireName(obj.str("sourceKind")),
        section = obj.str("section"),
        text = obj.str("text"),
        ordinal = obj.intVal("ordinal"),
    )

    private fun parseExpectedUnits(arr: JsonArray): List<EvidenceUnit> =
        arr.map { parseExpectedUnit(it.jsonObject) }

    private fun parsePdfPages(arr: JsonArray): List<PdfPageInput> = arr.map { pageEl ->
        val p = pageEl.jsonObject
        val items = p["items"]!!.jsonArray.map { itemEl ->
            val itObj = itemEl.jsonObject
            PdfTextItem(
                str = itObj.str("str"),
                x = itObj.doubleVal("x"),
                y = itObj.doubleVal("y"),
                width = itObj.doubleVal("width"),
                height = itObj.doubleVal("height"),
                renderMode = itObj.intOrNull("renderMode"),
                fillColor = itObj.strOrNull("fillColor"),
            )
        }
        PdfPageInput(
            pageNumber = p.intOrNull("pageNumber"),
            width = p.doubleVal("width"),
            height = p.doubleVal("height"),
            viewBox = p["viewBox"]?.jsonArray?.map { it.jsonPrimitive.double },
            backgroundColor = p.strOrNull("backgroundColor"),
            items = items,
        )
    }

    @TestFactory
    fun `conformance l0 chunk json`(): List<DynamicTest> {
        val cases = ConformanceTestHelper.loadGoldenArray("chunk.json")
        return cases.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            val op = tc.str("op")
            DynamicTest.dynamicTest("$id ($op)") {
                when (op) {
                    "chunkId" -> {
                        val refId = tc.str("refId")
                        val kind = EvidenceSourceKind.fromWireName(tc.str("sourceKind"))
                        val section = tc.str("section")
                        val ordinal = tc.intVal("ordinal")
                        val idA = computeChunkId(refId, kind, section, ordinal, tc.str("textA"))
                        val idB = computeChunkId(refId, kind, section, ordinal, tc.str("textB"))
                        assertEquals(tc.str("expectedChunkIdA"), idA)
                        assertEquals(tc.str("expectedChunkIdB"), idB)
                        assertNotEquals(idA, idB)
                        val expEv = tc.str("expectedEvidenceVersion")
                        assertEquals(expEv, computeEvidenceVersion(listOf(idB, idA)))
                        assertEquals(expEv, computeEvidenceVersion(listOf(idA, idB)))
                    }
                    "abstract" -> {
                        val units = chunkAbstract(tc.str("refId"), tc.str("rawAbstract"))
                        assertEquals(parseExpectedUnits(tc["expectedUnits"]!!.jsonArray), units)
                    }
                    "jats" -> {
                        val res = chunkJatsXml(tc.str("refId"), tc.str("xml"))
                        assertEquals(tc.strOrNull("expectedDoi"), res.doi)
                        assertEquals(parseExpectedUnits(tc["expectedUnits"]!!.jsonArray), res.units)
                    }
                    "pdf" -> {
                        val res = chunkPdfPages(tc.str("refId"), parsePdfPages(tc["pages"]!!.jsonArray))
                        assertEquals(tc["expectedHiddenTextPages"]!!.asIntList(), res.hiddenTextPages)
                        assertEquals(parseExpectedUnits(tc["expectedUnits"]!!.jsonArray), res.units)
                    }
                    "windowShape" -> {
                        val words = tc["words"]!!.asStringList()
                        val fullText = words.joinToString(" ")
                        val shaped = shapeEvidenceWindow(fullText, tc.str("query"))
                        val expStart = tc.intVal("expectedStartWordIndex")
                        val expCount = tc.intVal("expectedWordCount")
                        assertEquals(expStart, shaped.startWordIndex)
                        assertEquals(expCount, shaped.wordCount)
                        assertEquals(tc.intVal("expectedMatchCount"), shaped.matchCount)
                        assertEquals(words.subList(expStart, expStart + expCount).joinToString(" "), shaped.text)
                    }
                    "physicalRow" -> {
                        val pairs = tc["pairs"]!!.jsonArray.map { pEl ->
                            val po = pEl.jsonObject
                            SelectRowCellInput(
                                header = po.str("header"),
                                upperHeader = po.strOrNull("upperHeader"),
                                cell = po.str("cell"),
                            )
                        }
                        val unit = chunkPhysicalTableRow(
                            tc.str("refId"),
                            tc.str("photoSha256"),
                            pairs,
                            tc.intVal("ordinal"),
                        )
                        assertEquals(parseExpectedUnit(tc["expectedUnit"]!!.jsonObject), unit)
                    }
                    else -> error("Unsupported op in chunk.json: $op")
                }
            }
        }
    }
}
