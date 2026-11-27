package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.asStringList
import app.toulmin.core.ConformanceTestHelper.bool
import app.toulmin.core.ConformanceTestHelper.doubleVal
import app.toulmin.core.ConformanceTestHelper.intVal
import app.toulmin.core.ConformanceTestHelper.longVal
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import kotlin.math.abs

class ConformanceBm25Test {
    private fun parseUnits(arr: JsonArray): List<Bm25UnitInput> = arr.map { el ->
        val u = el.jsonObject
        Bm25UnitInput(
            chunkId = u.str("chunkId"),
            refId = u.str("refId"),
            sourceKind = EvidenceSourceKind.fromWireName(u.str("sourceKind")),
            ordinal = u.intVal("ordinal"),
            text = u.str("text"),
            tokens = u["tokens"]?.asStringList(),
        )
    }

    private fun parseDoubleMap(obj: JsonObject): Map<String, Double> =
        obj.entries.associate { (k, v) -> k to v.jsonPrimitive.content.toDouble() }

    @TestFactory
    fun `conformance l0 bm25 json`(): List<DynamicTest> {
        val cases = ConformanceTestHelper.loadGoldenArray("bm25.json")
        return cases.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            val op = tc.str("op")
            DynamicTest.dynamicTest("$id ($op)") {
                when (op) {
                    "tokBM25" -> {
                        assertEquals(tc["expected"]!!.asStringList(), tokBM25(tc.str("input")))
                    }
                    "coverage" -> {
                        val idfMap = parseDoubleMap(tc["idf"]!!.jsonObject)
                        val claimWords = tc["claimWordTerms"]?.asStringList()
                            ?: buildBm25Query(tc.strOrNull("claimText") ?: "").claimWordTerms
                        val bm25MinCov = tc.doubleVal("bm25MinCov")
                        for (uEl in tc["units"]!!.jsonArray) {
                            val u = uEl.jsonObject
                            val res = computeClaimCoverage(
                                claimWords,
                                u["tokens"]!!.asStringList(),
                                idfMap,
                                bm25MinCov,
                            )
                            assertTrue(abs(res.cov - u.doubleVal("expectedCov")) <= 1e-9)
                            assertEquals(u.longVal("expectedCovGrid"), res.covGrid)
                            assertEquals(u.intVal("expectedStems"), res.stems)
                            assertEquals(u.bool("expectedKept"), res.kept)
                        }
                    }
                    "score" -> {
                        val corpus = buildBm25Corpus(parseUnits(tc["units"]!!.jsonArray))
                        val query = buildBm25Query(tc.str("claimText"), tc.strOrNull("sentenceText"))
                        val ranked = rankBm25Units(corpus, query)
                        assertEquals(tc["expectedRanking"]!!.asStringList(), ranked.map { it.unit.chunkId })
                        val expectedScores = tc["expectedScores"]!!.jsonObject
                        for (r in ranked) {
                            val exp = expectedScores[r.unit.chunkId]!!.jsonObject
                            assertTrue(abs(r.bm25 - exp.doubleVal("bm25")) <= 1e-9)
                            assertEquals(exp.doubleVal("bonus"), r.bonus)
                            assertTrue(abs(r.score - exp.doubleVal("score")) <= 1e-9)
                            assertEquals(exp.longVal("gridScore"), r.gridScore)
                        }
                    }
                    "rankTie" -> {
                        val idfOverrides = parseDoubleMap(tc["idfOverrides"]!!.jsonObject)
                        val corpus = buildBm25Corpus(
                            parseUnits(tc["units"]!!.jsonArray),
                            BuildBm25CorpusOptions(idfOverrides = idfOverrides),
                        )
                        val query = buildBm25Query(tc.str("claimText"))
                        val ranked = rankBm25Units(corpus, query)
                        assertEquals(tc["expectedRanking"]!!.asStringList(), ranked.map { it.unit.chunkId })
                        val expGrid = tc.longVal("expectedGridScore")
                        for (r in ranked) {
                            assertEquals(expGrid, r.gridScore)
                        }
                    }
                    "quantityBonus" -> {
                        val corpus = buildBm25Corpus(parseUnits(tc["units"]!!.jsonArray))
                        val query = buildBm25Query(tc.str("claimText"))
                        val ranked = rankBm25Units(corpus, query)
                        val bonusByChunk = parseDoubleMap(tc["expectedBonusByChunk"]!!.jsonObject)
                        val expectedScoresByChunk = tc["expectedScoresByChunk"]?.jsonObject
                        for (r in ranked) {
                            assertEquals(bonusByChunk[r.unit.chunkId]!!, r.bonus)
                            if (expectedScoresByChunk != null) {
                                val exp = expectedScoresByChunk[r.unit.chunkId]!!.jsonObject
                                assertTrue(abs(r.bm25 - exp.doubleVal("bm25")) <= 1e-9)
                                assertTrue(abs(r.score - exp.doubleVal("score")) <= 1e-9)
                                assertEquals(exp.longVal("gridScore"), r.gridScore)
                            }
                        }
                        tc["expectedRanking"]?.let {
                            assertEquals(it.asStringList(), ranked.map { r -> r.unit.chunkId })
                        }
                    }
                    "corpusScale" -> {
                        val targetUnit = tc["targetUnit"]!!.jsonObject
                        val targetRefId = tc.str("targetRefId")
                        val bgCount = tc.intVal("backgroundRefCount")
                        val bgText = tc.str("backgroundUnitText")
                        val inputs = ArrayList<Bm25UnitInput>(1 + bgCount)
                        inputs.add(
                            Bm25UnitInput(
                                chunkId = targetUnit.str("chunkId"),
                                refId = targetRefId,
                                sourceKind = EvidenceSourceKind.ABSTRACT,
                                ordinal = 0,
                                text = targetUnit.str("text"),
                            ),
                        )
                        for (i in 1..bgCount) {
                            inputs.add(
                                Bm25UnitInput(
                                    chunkId = "bg-$i",
                                    refId = "r-bg-$i",
                                    sourceKind = EvidenceSourceKind.ABSTRACT,
                                    ordinal = 0,
                                    text = bgText,
                                ),
                            )
                        }
                        val corpus = buildBm25Corpus(inputs)
                        assertEquals(tc.intVal("expectedDocCount"), corpus.docCount)
                        val query = buildBm25Query(tc.str("claimText"))
                        val ranked = rankBm25Units(corpus, query)
                        val targetChunkId = targetUnit.str("chunkId")
                        val targetRow = ranked.first { it.unit.chunkId == targetChunkId }
                        assertTrue(abs(targetRow.score - tc.doubleVal("expectedTargetScore")) <= 1e-9)
                        assertEquals(tc.longVal("expectedTargetGridScore"), targetRow.gridScore)

                        val targetCov = computeClaimCoverage(query.claimWordTerms, targetRow.unit.tokenSet, corpus)
                        assertTrue(abs(targetCov.cov - tc.doubleVal("expectedTargetCov")) <= 1e-9)
                        assertEquals(tc.longVal("expectedTargetCovGrid"), targetCov.covGrid)
                        assertEquals(tc.bool("expectedTargetKept"), targetCov.kept)

                        val bgRow = ranked.first { it.unit.chunkId == "bg-1" }
                        val bgCov = computeClaimCoverage(query.claimWordTerms, bgRow.unit.tokenSet, corpus)
                        assertTrue(abs(bgCov.cov - tc.doubleVal("expectedBgCov")) <= 1e-9)
                        assertEquals(tc.longVal("expectedBgCovGrid"), bgCov.covGrid)
                        assertEquals(tc.bool("expectedBgKept"), bgCov.kept)

                        val sel = selectEvidenceCandidates(corpus, targetRefId, query)
                        assertEquals(
                            tc["expectedSelectedChunkIds"]!!.asStringList(),
                            sel.selected.map { it.unit.chunkId },
                        )
                    }
                    "select" -> {
                        val corpus = buildBm25Corpus(parseUnits(tc["units"]!!.jsonArray))
                        val query = buildBm25Query(tc.str("claimText"))
                        val sel = selectEvidenceCandidates(corpus, tc.str("refId"), query)
                        assertEquals(
                            tc["expectedSelectedChunkIds"]!!.asStringList(),
                            sel.selected.map { it.unit.chunkId },
                        )
                        assertEquals(tc.intVal("expectedCandidates"), sel.candidates)
                        assertEquals(tc.bool("expectedSuspicious"), sel.suspicious)
                    }
                    else -> error("Unsupported op in bm25.json: $op")
                }
            }
        }
    }
}
