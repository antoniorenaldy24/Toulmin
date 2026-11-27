package app.toulmin.core

import kotlin.math.floor
import kotlin.math.ln

enum class EvidenceSourceKind(val wireName: String) {
    ABSTRACT("ABSTRACT"),
    FULLTEXT("FULLTEXT"),
    USER_PDF("USER_PDF"),
    PHYSICAL_TABLE("PHYSICAL_TABLE"),
    PHYSICAL_TEXT("PHYSICAL_TEXT"),
    LAB_NOTE("LAB_NOTE"),
    MANUSCRIPT("MANUSCRIPT"),
    ;

    companion object {
        fun fromWireName(wire: String): EvidenceSourceKind =
            entries.firstOrNull { it.wireName == wire }
                ?: error("Unknown EvidenceSourceKind: $wire")
    }
}

const val BM25_K1 = 1.2
const val BM25_B = 0.75
const val BM25_CLAUSE_WEIGHT = 1.0
const val BM25_CONTEXT_WEIGHT = 0.5
const val BM25_QUANTITY_BONUS = 1.0
const val GRID_KEY_SCALE = 1_000_000_000.0

private const val CITATION_PLACEHOLDER_BM25 = "\u27E6c\u27E7"

private fun sourceKindRankValue(kind: EvidenceSourceKind): Int = when (kind) {
    EvidenceSourceKind.ABSTRACT -> 0
    EvidenceSourceKind.FULLTEXT -> 1
    EvidenceSourceKind.USER_PDF -> 2
    EvidenceSourceKind.PHYSICAL_TABLE -> 3
    EvidenceSourceKind.PHYSICAL_TEXT -> 4
    EvidenceSourceKind.LAB_NOTE -> 5
    EvidenceSourceKind.MANUSCRIPT -> 6
}

data class TokBM25Options(
    val lang: String? = null,
    val format: SourceFormat? = null,
    val markerRanges: List<TextRange>? = null,
    val deleteCitations: Boolean = true,
    val applyLatex: Boolean = true,
)

data class Bm25UnitInput(
    val chunkId: String,
    val refId: String,
    val sourceKind: EvidenceSourceKind,
    val ordinal: Int,
    val text: String,
    val section: String? = null,
    val tokens: List<String>? = null,
    val quantities: List<QuantTuple>? = null,
    val lang: String? = null,
)

class Bm25IndexedUnit(
    val chunkId: String,
    val refId: String,
    val sourceKind: EvidenceSourceKind,
    val ordinal: Int,
    val section: String,
    val text: String,
    val tokens: List<String>,
    val termFreqs: Map<String, Int>,
    val tokenSet: Set<String>,
    val length: Int,
    val lang: String?,
    private val initialQuantities: List<QuantTuple>?,
) {
    private var cachedQuantities: List<QuantTuple>? = initialQuantities

    fun getQuantities(): List<QuantTuple> {
        var cur = cachedQuantities
        if (cur == null) {
            cur = extractQuantities(text, ExtractQuantitiesOptions(lang = lang))
            cachedQuantities = cur
        }
        return cur
    }
}

class Bm25Corpus(
    val units: List<Bm25IndexedUnit>,
    val docCount: Int,
    val avgdl: Double,
    val docFreq: Map<String, Int>,
    val idfOverrides: Map<String, Double>? = null,
)

data class BuildBm25CorpusOptions(
    val lang: String? = null,
    val idfOverrides: Map<String, Double>? = null,
)

data class BuildBm25QueryOptions(
    val lang: String? = null,
    val format: SourceFormat? = null,
    val markerRanges: List<TextRange>? = null,
    val deleteCitations: Boolean = true,
    val applyLatex: Boolean = true,
    val claimTokens: List<String>? = null,
    val contextTokens: List<String>? = null,
    val claimQuantities: List<QuantTuple>? = null,
)

class Bm25Query(
    val terms: List<String>,
    val weights: Map<String, Double>,
    val claimTokens: List<String>,
    val claimWordTerms: List<String>,
    val claimQuantities: List<QuantTuple>,
)

data class Bm25ScoreBreakdown(
    val bm25: Double,
    val bonus: Double,
    val score: Double,
    val gridScore: Long,
)

data class Bm25ScoredUnit(
    val unit: Bm25IndexedUnit,
    val bm25: Double,
    val bonus: Double,
    val score: Double,
    val gridScore: Long,
)

private data class PositionedToken(
    val pos: Int,
    val seq: Int,
    val token: String,
)

private data class NumericMaskInterval(
    val start: Int,
    val end: Int,
)

fun compareCodeUnits(a: String, b: String): Int {
    val minLen = if (a.length < b.length) a.length else b.length
    for (i in 0 until minLen) {
        val ca = a[i].code
        val cb = b[i].code
        if (ca != cb) return ca - cb
    }
    return a.length - b.length
}

fun gridKey(x: Double): Long {
    if (!x.isFinite() || x <= 0.0) return 0L
    return floor(x * GRID_KEY_SCALE + 0.5).toLong()
}

fun isNumericBm25Token(token: String): Boolean = token.length > 1 && token[0].code == 35 /* '#' */

fun isWordBm25Token(token: String): Boolean = token.isNotEmpty() && token[0].code != 35 /* '#' */

fun sourceKindRank(kind: EvidenceSourceKind): Int = sourceKindRankValue(kind)

private fun detectPreMaskFormat(text: String, explicitFormat: SourceFormat?): SourceFormat {
    if (explicitFormat != null) return explicitFormat
    if (text.contains("\\(") ||
        text.contains("\\[") ||
        text.contains("\\begin{") ||
        text.contains("\\section") ||
        text.contains("\\documentclass") ||
        text.contains("\\footnote")
    ) {
        return SourceFormat.LATEX
    }
    return SourceFormat.MD
}

private fun needsPreMaskScan(text: String, format: SourceFormat): Boolean {
    if (text.contains("$") || text.contains("`")) return true
    if (format == SourceFormat.LATEX) {
        return text.contains("\\(") ||
            text.contains("\\[") ||
            text.contains("\\begin{") ||
            text.contains("\\footnote") ||
            text.contains("%")
    }
    return text.contains("<!--") || text.contains("---")
}

private fun stripPlaceholdersAndMasks(text: String): String {
    if (!text.contains(CITATION_PLACEHOLDER_BM25) && !text.contains(MASK_CHAR)) {
        return text
    }
    val sb = StringBuilder(text.length)
    var i = 0
    var segStart = 0
    val n = text.length
    while (i < n) {
        val ch = text[i].code
        if (ch == 0x27E6 && text.startsWith(CITATION_PLACEHOLDER_BM25, i)) {
            if (i > segStart) sb.append(text, segStart, i)
            sb.append(' ')
            i += CITATION_PLACEHOLDER_BM25.length
            segStart = i
            continue
        }
        if (ch == 0xE000) {
            if (i > segStart) sb.append(text, segStart, i)
            sb.append(' ')
            i++
            while (i < n && text[i].code == 0xE000) {
                i++
            }
            segStart = i
            continue
        }
        i++
    }
    if (segStart < n) {
        sb.append(text, segStart, n)
    }
    return sb.toString()
}

private data class Bm25PreprocessSegment(
    val start: Int,
    val end: Int,
    val replacement: String,
    val priority: Int,
)

private fun preprocessForBm25(x: String, options: TokBM25Options?): String {
    val hasExplicitMarkers = !options?.markerRanges.isNullOrEmpty()
    val shouldDeleteCitations = options?.deleteCitations != false
    val shouldApplyLatex = options?.applyLatex != false

    if (!hasExplicitMarkers &&
        !x.contains("\\") &&
        !x.contains("$") &&
        !x.contains("`") &&
        !x.contains("<!--") &&
        !x.contains("---") &&
        !x.contains(CITATION_PLACEHOLDER_BM25) &&
        !x.contains(MASK_CHAR) &&
        (!shouldDeleteCitations || (!x.contains("[") && !x.contains("(")))
    ) {
        return x
    }

    val format = detectPreMaskFormat(x, options?.format)
    val runMask = needsPreMaskScan(x, format)
    val maskRes = if (runMask) {
        preMask(x, format, if (format == SourceFormat.MD) PreMaskOptions(frontMatterMath = true) else null)
    } else {
        null
    }

    val citeSpans: List<TextRangeLike> = when {
        options?.markerRanges != null -> options.markerRanges
        shouldDeleteCitations -> {
            val scanTarget = maskRes?.maskedText ?: x
            if (scanTarget.contains("[") || scanTarget.contains("(") || scanTarget.contains("\\")) {
                scanCitations(scanTarget)
            } else {
                emptyList()
            }
        }
        else -> emptyList()
    }

    val segments = ArrayList<Bm25PreprocessSegment>()
    for (r in citeSpans) {
        if (r.start >= 0 && r.end > r.start && r.end <= x.length) {
            segments.add(Bm25PreprocessSegment(r.start, r.end, " ", 0))
        }
    }
    if (maskRes != null) {
        for (m in maskRes.mathRegions) {
            if (m.start >= 0 && m.end > m.start && m.end <= x.length) {
                segments.add(Bm25PreprocessSegment(m.start, m.end, m.text, 1))
            }
        }
        for (r in maskRes.regions) {
            if (r.kind != MaskedRegionKind.INLINE_MATH &&
                r.kind != MaskedRegionKind.DISPLAY_MATH &&
                r.start >= 0 &&
                r.end > r.start &&
                r.end <= x.length
            ) {
                segments.add(Bm25PreprocessSegment(r.start, r.end, " ", 2))
            }
        }
    }

    val latexOpts = if (maskRes != null && (maskRes.userMacros.isNotEmpty() || maskRes.customCiteMacros.isNotEmpty())) {
        LatexSubstitutionsOptions(
            userMacros = maskRes.userMacros.takeIf { it.isNotEmpty() },
            customCiteMacros = maskRes.customCiteMacros.takeIf { it.isNotEmpty() },
        )
    } else {
        null
    }

    if (segments.isEmpty()) {
        val clean = stripPlaceholdersAndMasks(x)
        if (shouldApplyLatex && clean.contains("\\")) {
            return applyLatexSubstitutions(clean, latexOpts).text
        }
        return clean
    }

    segments.sortWith { a, b ->
        if (a.start != b.start) a.start - b.start
        else if (a.priority != b.priority) a.priority - b.priority
        else b.end - a.end
    }

    val sb = StringBuilder(x.length)
    var cursor = 0

    fun pushProseSlice(slice: String) {
        val clean = stripPlaceholdersAndMasks(slice)
        if (clean.isEmpty()) return
        if (shouldApplyLatex && clean.contains("\\")) {
            sb.append(applyLatexSubstitutions(clean, latexOpts).text)
        } else {
            sb.append(clean)
        }
    }

    for (seg in segments) {
        if (seg.start < cursor) continue
        if (seg.start > cursor) {
            pushProseSlice(x.substring(cursor, seg.start))
        }
        if (seg.replacement.isNotEmpty()) {
            sb.append(seg.replacement)
        }
        cursor = seg.end
    }
    if (cursor < x.length) {
        pushProseSlice(x.substring(cursor))
    }

    return sb.toString()
}

private fun isRangeValueRaw(valueRaw: String): Boolean {
    val lower = normLower(valueRaw)
    if (lower.contains(" to ") || lower.contains(" and ") || lower.contains(", ")) return true
    var braceDepth = 0
    for (i in 0 until lower.length) {
        val ch = lower[i].code
        if (ch == 123 && i > 0 && lower[i - 1].code == 94) {
            braceDepth++
            continue
        }
        if (braceDepth > 0) {
            if (ch == 123) braceDepth++ else if (ch == 125) braceDepth--
            continue
        }
        if (ch == 45 && i > 0) {
            val prev = lower[i - 1].code
            if (prev != 101 && prev != 94) return true
        }
    }
    return false
}

private fun formatNumericToken(value: Double, isPercent: Boolean): String {
    val canon = formatCanonicalDecimal(value)
    return if (isPercent) "#$canon%" else "#$canon"
}

private fun emitNumericTokensForTuple(prepText: String, qt: QuantTuple): List<String> {
    val vNorm = qt.valueNorm ?: return emptyList()
    if (!vNorm.isFinite()) return emptyList()
    val isPct = qt.unitCanon == "%"
    val lo = qt.valueLo
    val hi = qt.valueHi
    if (lo != null && hi != null && lo.isFinite() && hi.isFinite()) {
        if (isRangeValueRaw(qt.valueRaw)) {
            return listOf(formatNumericToken(lo, isPct), formatNumericToken(hi, isPct))
        }
        if (lo != hi) {
            val spanSlice = prepText.substring(qt.span.start, qt.span.end)
            if (spanSlice.contains("\u00B1") || spanSlice.contains("+/-")) {
                return listOf(formatNumericToken(vNorm, isPct))
            }
            return listOf(
                formatNumericToken(vNorm, isPct),
                formatNumericToken(lo, isPct),
                formatNumericToken(hi, isPct),
            )
        }
    }
    return listOf(formatNumericToken(vNorm, isPct))
}

private fun asciiMatchIgnoreCaseAt(text: String, pos: Int, wordLower: String): Boolean {
    if (pos + wordLower.length > text.length) return false
    for (i in 0 until wordLower.length) {
        var cu = text[pos + i].code
        if (cu in 65..90) cu += 32
        if (cu != wordLower[i].code) return false
    }
    return true
}

private fun isBasicWordCharAt(text: String, idx: Int): Boolean {
    if (idx < 0 || idx >= text.length) return false
    val u = codePointAtSafe(text, idx)
    return !u.isUnpairedSurrogate && (isLetter(u.cp, false) || isDigit(u.cp))
}

private fun resolveNumericMaskIntervals(
    prepText: String,
    qt: QuantTuple,
    outIntervals: MutableList<NumericMaskInterval>,
): Int {
    var valueStart = qt.span.start
    var valueEnd = qt.span.end
    if (qt.valueRaw.isNotEmpty()) {
        val found = prepText.indexOf(qt.valueRaw, qt.span.start)
        if (found != -1 && found + qt.valueRaw.length <= qt.span.end) {
            valueStart = found
            valueEnd = found + qt.valueRaw.length
        }
    }
    outIntervals.add(NumericMaskInterval(valueStart, valueEnd))

    if (qt.unitCanon == "%") {
        val pctWords = arrayOf("per cent", "percent", "pct")
        var cursor = qt.span.start
        while (cursor < qt.span.end) {
            var matched = false
            for (w in pctWords.indices) {
                val word = pctWords[w]
                val wordEnd = cursor + word.length
                if (wordEnd <= qt.span.end &&
                    asciiMatchIgnoreCaseAt(prepText, cursor, word) &&
                    !isBasicWordCharAt(prepText, cursor - 1) &&
                    !isBasicWordCharAt(prepText, wordEnd)
                ) {
                    outIntervals.add(NumericMaskInterval(cursor, wordEnd))
                    cursor = wordEnd
                    matched = true
                    break
                }
            }
            if (!matched) cursor++
        }
    }

    return valueStart
}

private fun maskIntervalsWithSpaces(text: String, intervals: List<NumericMaskInterval>): String {
    if (intervals.isEmpty()) return text
    val sb = StringBuilder(text.length)
    var cursor = 0
    for (i in intervals.indices) {
        val iv = intervals[i]
        if (iv.end <= cursor) continue
        val start = maxOf(cursor, iv.start)
        if (start > cursor) {
            sb.append(text, cursor, start)
        }
        val maskLen = iv.end - start
        if (maskLen > 0) {
            repeat(maskLen) { sb.append(' ') }
        }
        cursor = iv.end
    }
    if (cursor < text.length) {
        sb.append(text, cursor, text.length)
    }
    return sb.toString()
}

fun tokBM25(x: String, options: TokBM25Options? = null): List<String> {
    if (x.isEmpty()) return emptyList()
    val prepText = preprocessForBm25(x, options)
    if (prepText.isEmpty()) return emptyList()

    val quantities = extractQuantities(
        prepText,
        ExtractQuantitiesOptions(
            lang = options?.lang,
            applyLatex = false,
            citationSpans = emptyList(),
        ),
    )

    val emitted = ArrayList<PositionedToken>()
    val maskIntervals = ArrayList<NumericMaskInterval>()
    var seq = 0

    for (i in quantities.indices) {
        val qt = quantities[i]
        val numTokens = emitNumericTokensForTuple(prepText, qt)
        if (numTokens.isEmpty()) continue
        val emitPos = resolveNumericMaskIntervals(prepText, qt, maskIntervals)
        for (k in numTokens.indices) {
            emitted.add(PositionedToken(emitPos, seq++, numTokens[k]))
        }
    }

    maskIntervals.sortWith { a, b -> if (a.start != b.start) a.start - b.start else a.end - b.end }

    val remainingText = maskIntervalsWithSpaces(prepText, maskIntervals)
    val normRes = normLowerWithMap(remainingText)
    val lower = normRes.text
    val normMap = normRes.map
    val n = lower.length

    var i = 0
    while (i < n) {
        val cu = lower[i].code
        if (cu < 0x80) {
            val isAsciiLet = cu in 97..122
            val isAsciiDig = cu in 48..57
            if (!isAsciiLet && !isAsciiDig) {
                i++
                continue
            }
            val runStart = i
            var hasLetter = isAsciiLet
            var prevIsLetter = isAsciiLet
            i++
            while (i < n) {
                val c = lower[i].code
                if (c < 0x80) {
                    if (c in 97..122) {
                        hasLetter = true
                        prevIsLetter = true
                        i++
                    } else if (c in 48..57) {
                        prevIsLetter = false
                        i++
                    } else {
                        break
                    }
                } else {
                    val u = codePointAtSafe(lower, i)
                    if (u.isUnpairedSurrogate) break
                    val nextLet = isLetter(u.cp, prevIsLetter)
                    if (nextLet || isDigit(u.cp)) {
                        if (nextLet) hasLetter = true
                        prevIsLetter = nextLet
                        i += u.len
                    } else {
                        break
                    }
                }
            }
            if (hasLetter) {
                val word = lower.substring(runStart, i)
                if (!BM25_STOPWORDS.contains(word)) {
                    val stem = porterStem(word)
                    if (stem.isNotEmpty()) {
                        val pos = if (runStart in normMap.indices) normMap[runStart] else runStart
                        emitted.add(PositionedToken(pos, seq++, stem))
                    }
                }
            }
            continue
        }

        val u0 = codePointAtSafe(lower, i)
        if (u0.isUnpairedSurrogate) {
            i += u0.len
            continue
        }
        val startIsLetter = isLetter(u0.cp, false)
        val startIsDigit = isDigit(u0.cp)
        if (!startIsLetter && !startIsDigit) {
            i += u0.len
            continue
        }

        val runStart = i
        var hasLetter = startIsLetter
        var prevIsLetter = startIsLetter
        i += u0.len

        while (i < n) {
            val u = codePointAtSafe(lower, i)
            if (u.isUnpairedSurrogate) break
            val nextLet = isLetter(u.cp, prevIsLetter)
            if (nextLet || isDigit(u.cp)) {
                if (nextLet) hasLetter = true
                prevIsLetter = nextLet
                i += u.len
            } else {
                break
            }
        }

        if (hasLetter) {
            val word = lower.substring(runStart, i)
            if (!BM25_STOPWORDS.contains(word)) {
                val stem = porterStem(word)
                if (stem.isNotEmpty()) {
                    val pos = if (runStart in normMap.indices) normMap[runStart] else runStart
                    emitted.add(PositionedToken(pos, seq++, stem))
                }
            }
        }
    }

    if (maskIntervals.isNotEmpty() && emitted.size > 1) {
        emitted.sortWith { a, b -> if (a.pos != b.pos) a.pos - b.pos else a.seq - b.seq }
    }

    return emitted.map { it.token }
}

fun computeIdf(docCount: Int, docFreq: Int): Double {
    if (docCount <= 0) return 0.0
    val df = maxOf(0, minOf(docCount, docFreq))
    return ln(1.0 + (docCount - df + 0.5) / (df + 0.5))
}

fun getCorpusIdf(corpus: Bm25Corpus, term: String): Double {
    corpus.idfOverrides?.get(term)?.let { return it }
    return computeIdf(corpus.docCount, corpus.docFreq[term] ?: 0)
}

fun buildBm25Corpus(
    units: List<Bm25UnitInput>,
    options: BuildBm25CorpusOptions? = null,
): Bm25Corpus {
    val indexed = ArrayList<Bm25IndexedUnit>(units.size)
    val docFreq = HashMap<String, Int>()
    var totalLength = 0L

    for (i in units.indices) {
        val raw = units[i]
        val unitLang = raw.lang ?: options?.lang
        val tokens = raw.tokens?.toList()
            ?: tokBM25(raw.text, if (unitLang != null) TokBM25Options(lang = unitLang) else null)

        val termFreqs = HashMap<String, Int>(tokens.size * 2)
        val tokenSet = HashSet<String>(tokens.size * 2)
        for (k in tokens.indices) {
            val tok = tokens[k]
            termFreqs[tok] = (termFreqs[tok] ?: 0) + 1
            if (tokenSet.add(tok)) {
                docFreq[tok] = (docFreq[tok] ?: 0) + 1
            }
        }

        totalLength += tokens.size.toLong()

        indexed.add(
            Bm25IndexedUnit(
                chunkId = raw.chunkId,
                refId = raw.refId,
                sourceKind = raw.sourceKind,
                ordinal = raw.ordinal,
                section = raw.section ?: "abstract",
                text = raw.text,
                tokens = tokens,
                termFreqs = termFreqs,
                tokenSet = tokenSet,
                length = tokens.size,
                lang = unitLang,
                initialQuantities = raw.quantities?.toList(),
            ),
        )
    }

    val docCount = indexed.size
    val avgdl = if (docCount > 0) totalLength.toDouble() / docCount.toDouble() else 0.0

    return Bm25Corpus(
        units = indexed,
        docCount = docCount,
        avgdl = avgdl,
        docFreq = docFreq,
        idfOverrides = options?.idfOverrides,
    )
}

fun buildBm25Query(
    claimText: String,
    sentenceText: String? = null,
    options: BuildBm25QueryOptions? = null,
): Bm25Query {
    val tokOpts = if (options != null) {
        TokBM25Options(
            lang = options.lang,
            format = options.format,
            markerRanges = options.markerRanges,
            deleteCitations = options.deleteCitations,
            applyLatex = options.applyLatex,
        )
    } else {
        null
    }
    val claimTokens = options?.claimTokens?.toList() ?: tokBM25(claimText, tokOpts)

    val weights = HashMap<String, Double>(claimTokens.size * 2)
    val claimWordSet = HashSet<String>(claimTokens.size * 2)

    for (i in claimTokens.indices) {
        val tok = claimTokens[i]
        weights[tok] = BM25_CLAUSE_WEIGHT
        if (isWordBm25Token(tok)) {
            claimWordSet.add(tok)
        }
    }

    if (options?.contextTokens != null || sentenceText != null) {
        val sentTokens = options?.contextTokens ?: tokBM25(sentenceText!!, tokOpts)
        for (i in sentTokens.indices) {
            val tok = sentTokens[i]
            if (!weights.containsKey(tok)) {
                weights[tok] = BM25_CONTEXT_WEIGHT
            }
        }
    }

    val terms = weights.keys.sortedWith { a, b -> compareCodeUnits(a, b) }
    val claimWordTerms = claimWordSet.sortedWith { a, b -> compareCodeUnits(a, b) }
    val claimQuantities = options?.claimQuantities?.toList() ?: extractQuantities(
        claimText,
        ExtractQuantitiesOptions(
            lang = options?.lang,
            format = options?.format,
            applyLatex = options?.applyLatex,
            citationSpans = options?.markerRanges,
        ),
    )

    return Bm25Query(
        terms = terms,
        weights = weights,
        claimTokens = claimTokens,
        claimWordTerms = claimWordTerms,
        claimQuantities = claimQuantities,
    )
}

fun buildB4Query(sentenceText: String, options: TokBM25Options? = null): Bm25Query =
    buildBm25Query(
        sentenceText,
        null,
        if (options != null) {
            BuildBm25QueryOptions(
                lang = options.lang,
                format = options.format,
                markerRanges = options.markerRanges,
                deleteCitations = options.deleteCitations,
                applyLatex = options.applyLatex,
            )
        } else {
            null
        },
    )

fun computeQuantityBonus(
    claimQuantities: List<QuantTuple>,
    unitQuantities: List<QuantTuple>,
): Double {
    if (claimQuantities.isEmpty() || unitQuantities.isEmpty()) return 0.0

    for (i in claimQuantities.indices) {
        val cq = claimQuantities[i]
        if (cq.metricClass == MetricClass.OTHER || cq.keyLemmas.isEmpty()) continue
        for (j in unitQuantities.indices) {
            val uq = unitQuantities[j]
            if (uq.metricClass != cq.metricClass ||
                uq.keyLemmas.isEmpty() ||
                !sameFamily(cq.unitCanon, uq.unitCanon)
            ) {
                continue
            }
            for (a in cq.keyLemmas.indices) {
                val lemma = cq.keyLemmas[a]
                if (UNIT_WORDS.contains(lemma)) continue
                if (uq.keyLemmas.contains(lemma)) return BM25_QUANTITY_BONUS
            }
        }
    }
    return 0.0
}

fun scoreBm25Unit(
    corpus: Bm25Corpus,
    query: Bm25Query,
    unit: Bm25IndexedUnit,
): Bm25ScoreBreakdown {
    var bm25 = 0.0
    val avgdl = corpus.avgdl

    if (avgdl > 0.0 && unit.length > 0 && query.terms.isNotEmpty()) {
        val lengthNorm = BM25_K1 * (1.0 - BM25_B + BM25_B * (unit.length.toDouble() / avgdl))
        for (i in query.terms.indices) {
            val term = query.terms[i]
            val tf = unit.termFreqs[term] ?: 0
            if (tf == 0) continue
            val w = query.weights[term] ?: 0.0
            if (w == 0.0) continue
            val idf = getCorpusIdf(corpus, term)
            val tfDouble = tf.toDouble()
            val tfNorm = (tfDouble * (BM25_K1 + 1.0)) / (tfDouble + lengthNorm)
            bm25 += w * idf * tfNorm
        }
    }

    var bonus = 0.0
    if (query.claimQuantities.any { it.metricClass != MetricClass.OTHER && it.keyLemmas.isNotEmpty() }) {
        bonus = computeQuantityBonus(query.claimQuantities, unit.getQuantities())
    }

    val score = bm25 + bonus
    return Bm25ScoreBreakdown(
        bm25 = bm25,
        bonus = bonus,
        score = score,
        gridScore = gridKey(score),
    )
}

fun compareBm25Candidates(a: Bm25ScoredUnit, b: Bm25ScoredUnit): Int {
    if (a.gridScore != b.gridScore) {
        return if (b.gridScore > a.gridScore) 1 else -1
    }
    val rankDiff = sourceKindRank(a.unit.sourceKind) - sourceKindRank(b.unit.sourceKind)
    if (rankDiff != 0) return rankDiff
    if (a.unit.ordinal != b.unit.ordinal) return a.unit.ordinal - b.unit.ordinal
    val refCmp = compareCodeUnits(a.unit.refId, b.unit.refId)
    if (refCmp != 0) return refCmp
    return compareCodeUnits(a.unit.chunkId, b.unit.chunkId)
}

fun rankBm25Units(
    corpus: Bm25Corpus,
    query: Bm25Query,
    filterRefId: String? = null,
): List<Bm25ScoredUnit> {
    val scored = ArrayList<Bm25ScoredUnit>(corpus.units.size)
    for (i in corpus.units.indices) {
        val unit = corpus.units[i]
        if (filterRefId != null && unit.refId != filterRefId) continue
        val breakdown = scoreBm25Unit(corpus, query, unit)
        scored.add(Bm25ScoredUnit(unit, breakdown.bm25, breakdown.bonus, breakdown.score, breakdown.gridScore))
    }
    scored.sortWith { a, b -> compareBm25Candidates(a, b) }
    return scored
}
