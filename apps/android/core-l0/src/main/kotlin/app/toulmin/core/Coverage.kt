package app.toulmin.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class Bm25MinCovConfig(
    val bm25_min_cov: Double,
    val status: String,
    val note: String,
)

private fun loadBm25MinCovConfig(): Bm25MinCovConfig {
    val jsonText = NormTableData.loadResourceBytes("bm25_min_cov.json").decodeToString()
    val root = Json.parseToJsonElement(jsonText).jsonObject
    return Bm25MinCovConfig(
        bm25_min_cov = root["bm25_min_cov"]!!.jsonPrimitive.double,
        status = root["status"]!!.jsonPrimitive.content,
        note = root["note"]!!.jsonPrimitive.content,
    )
}

val BM25_MIN_COV_CONFIG: Bm25MinCovConfig by lazy { loadBm25MinCovConfig() }
val DEFAULT_BM25_MIN_COV: Double get() = BM25_MIN_COV_CONFIG.bm25_min_cov
val BM25_MIN_COV: Double get() = BM25_MIN_COV_CONFIG.bm25_min_cov

const val MAX_EVIDENCE_CANDIDATES = 5
const val MAX_ABSTRACT_CANDIDATES = 3
const val MAX_FULLTEXT_CANDIDATES = 2

data class Bm25MinCovResolution(
    val value: Double,
    val mismatch: Boolean,
    val code: String?,
)

data class ClaimCoverageResult(
    val cov: Double,
    val covGrid: Long,
    val stems: Int,
    val sharedStems: List<String>,
    val claimTermCount: Int,
    val kept: Boolean,
    val minCovUsed: Double,
    val minCovGrid: Long,
)

data class EvaluatedCandidate(
    val unit: Bm25IndexedUnit,
    val bm25: Double,
    val bonus: Double,
    val score: Double,
    val gridScore: Long,
    val coverage: ClaimCoverageResult,
)

data class SelectEvidenceOptions(
    val minCov: Double? = null,
    val isUnitBlocked: ((Bm25IndexedUnit) -> Boolean)? = null,
)

data class EvidenceSelectionResult(
    val selected: List<EvaluatedCandidate>,
    val allScored: List<EvaluatedCandidate>,
    val candidates: Int,
    val suspicious: Boolean,
    val minCovUsed: Double,
)

fun resolveBm25MinCov(remoteConfigValue: Double? = null): Bm25MinCovResolution {
    val bundled = BM25_MIN_COV
    val mismatch = remoteConfigValue != null &&
        (!remoteConfigValue.isFinite() || gridKey(remoteConfigValue) != gridKey(bundled))
    return Bm25MinCovResolution(
        value = bundled,
        mismatch = mismatch,
        code = if (mismatch) "BM25_MIN_COV_MISMATCH" else null,
    )
}

fun passesCoverageFilter(
    cov: Double,
    stems: Int,
    minCov: Double = BM25_MIN_COV,
): Boolean = stems >= 2 || gridKey(cov) >= gridKey(minCov)

sealed interface IdfLookup {
    fun getIdf(term: String): Double
}

class CorpusIdfLookup(val corpus: Bm25Corpus) : IdfLookup {
    override fun getIdf(term: String): Double = getCorpusIdf(corpus, term)
}

class MapIdfLookup(val map: Map<String, Double>) : IdfLookup {
    override fun getIdf(term: String): Double = map[term] ?: 0.0
}

class FunctionIdfLookup(val fn: (String) -> Double) : IdfLookup {
    override fun getIdf(term: String): Double = fn(term)
}

fun computeClaimCoverage(
    claimWordTerms: List<String>,
    unitTokens: Collection<String>,
    idfSource: IdfLookup,
    minCov: Double = BM25_MIN_COV,
): ClaimCoverageResult {
    val distinctClaimWords = HashSet<String>()
    for (i in claimWordTerms.indices) {
        val tok = claimWordTerms[i]
        if (isWordBm25Token(tok)) {
            distinctClaimWords.add(tok)
        }
    }

    val sortedClaimWords = distinctClaimWords.sortedWith { a, b -> compareCodeUnits(a, b) }
    val minCovGrid = gridKey(minCov)

    if (sortedClaimWords.isEmpty()) {
        val cov = 1.0
        val covGrid = gridKey(cov)
        return ClaimCoverageResult(
            cov = cov,
            covGrid = covGrid,
            stems = 0,
            sharedStems = emptyList(),
            claimTermCount = 0,
            kept = true,
            minCovUsed = minCov,
            minCovGrid = minCovGrid,
        )
    }

    val unitSet: Set<String> = if (unitTokens is Set<String>) unitTokens else HashSet(unitTokens)

    var totalIdf = 0.0
    var matchedIdf = 0.0
    val sharedStems = ArrayList<String>()

    for (i in sortedClaimWords.indices) {
        val term = sortedClaimWords[i]
        val idf = idfSource.getIdf(term)
        totalIdf += idf
        if (unitSet.contains(term)) {
            matchedIdf += idf
            sharedStems.add(term)
        }
    }

    val cov = if (totalIdf > 0.0) matchedIdf / totalIdf else 0.0
    val covGrid = gridKey(cov)
    val stems = sharedStems.size

    return ClaimCoverageResult(
        cov = cov,
        covGrid = covGrid,
        stems = stems,
        sharedStems = sharedStems,
        claimTermCount = sortedClaimWords.size,
        kept = passesCoverageFilter(cov, stems, minCov),
        minCovUsed = minCov,
        minCovGrid = minCovGrid,
    )
}

fun computeClaimCoverage(
    claimWordTerms: List<String>,
    unitTokens: Collection<String>,
    idfCorpus: Bm25Corpus,
    minCov: Double = BM25_MIN_COV,
): ClaimCoverageResult = computeClaimCoverage(claimWordTerms, unitTokens, CorpusIdfLookup(idfCorpus), minCov)

fun computeClaimCoverage(
    claimWordTerms: List<String>,
    unitTokens: Collection<String>,
    idfMap: Map<String, Double>,
    minCov: Double = BM25_MIN_COV,
): ClaimCoverageResult = computeClaimCoverage(claimWordTerms, unitTokens, MapIdfLookup(idfMap), minCov)

fun selectEvidenceCandidates(
    corpus: Bm25Corpus,
    refId: String,
    query: Bm25Query,
    options: SelectEvidenceOptions? = null,
): EvidenceSelectionResult {
    val minCov = options?.minCov ?: BM25_MIN_COV
    val evaluated = ArrayList<EvaluatedCandidate>()
    val corpusLookup = CorpusIdfLookup(corpus)

    for (i in corpus.units.indices) {
        val unit = corpus.units[i]
        if (unit.refId != refId) continue
        val breakdown = scoreBm25Unit(corpus, query, unit)
        val coverage = computeClaimCoverage(query.claimWordTerms, unit.tokenSet, corpusLookup, minCov)
        evaluated.add(
            EvaluatedCandidate(
                unit = unit,
                bm25 = breakdown.bm25,
                bonus = breakdown.bonus,
                score = breakdown.score,
                gridScore = breakdown.gridScore,
                coverage = coverage,
            ),
        )
    }

    val candComparator = Comparator<EvaluatedCandidate> { a, b ->
        compareBm25Candidates(
            Bm25ScoredUnit(a.unit, a.bm25, a.bonus, a.score, a.gridScore),
            Bm25ScoredUnit(b.unit, b.bm25, b.bonus, b.score, b.gridScore),
        )
    }
    evaluated.sortWith(candComparator)

    val keptAbstract = ArrayList<EvaluatedCandidate>()
    val keptFulltext = ArrayList<EvaluatedCandidate>()
    val keptRemaining = ArrayList<EvaluatedCandidate>()

    for (i in evaluated.indices) {
        val item = evaluated[i]
        if (!item.coverage.kept) continue
        val kind = item.unit.sourceKind
        if (kind == EvidenceSourceKind.ABSTRACT) {
            if (keptAbstract.size < MAX_ABSTRACT_CANDIDATES) {
                keptAbstract.add(item)
            } else {
                keptRemaining.add(item)
            }
        } else if (kind == EvidenceSourceKind.FULLTEXT || kind == EvidenceSourceKind.USER_PDF) {
            if (keptFulltext.size < MAX_FULLTEXT_CANDIDATES) {
                keptFulltext.add(item)
            } else {
                keptRemaining.add(item)
            }
        } else {
            keptRemaining.add(item)
        }
    }

    val picked = ArrayList<EvaluatedCandidate>(MAX_EVIDENCE_CANDIDATES)
    picked.addAll(keptAbstract)
    picked.addAll(keptFulltext)
    var remIdx = 0
    while (remIdx < keptRemaining.size && picked.size < MAX_EVIDENCE_CANDIDATES) {
        picked.add(keptRemaining[remIdx])
        remIdx++
    }

    picked.sortWith(candComparator)

    var suspicious = false
    val finalSelected = ArrayList<EvaluatedCandidate>(picked.size)
    val blocker = options?.isUnitBlocked
    if (blocker != null) {
        for (i in picked.indices) {
            val cand = picked[i]
            if (blocker(cand.unit)) {
                suspicious = true
            } else {
                finalSelected.add(cand)
            }
        }
    } else {
        finalSelected.addAll(picked)
    }

    return EvidenceSelectionResult(
        selected = finalSelected,
        allScored = evaluated,
        candidates = finalSelected.size,
        suspicious = suspicious,
        minCovUsed = minCov,
    )
}
