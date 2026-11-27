package app.toulmin.core

enum class PComparator(val wireName: String) {
    LT("<"),
    LE("<="),
    EQ("="),
    GT(">"),
    GE(">="),
    ;

    companion object {
        fun fromWireName(wire: String): PComparator =
            entries.firstOrNull { it.wireName == wire }
                ?: error("Unknown PComparator: $wire")
    }
}

enum class TupleSource(val wireName: String) {
    MANUSCRIPT("manuscript"),
    LAB_NOTE("lab_note"),
    PRINT_PAGE("print_page"),
    ;

    companion object {
        fun fromWireName(wire: String): TupleSource =
            entries.firstOrNull { it.wireName == wire }
                ?: error("Unknown TupleSource: $wire")
    }
}

data class QuantTuple(
    val tupleId: String,
    val valueRaw: String,
    val unitRaw: String,
    val metricClass: MetricClass,
    val pComparator: PComparator?,
    val valueNorm: Double?,
    val valueLo: Double?,
    val valueHi: Double?,
    val sigDigits: Int,
    val unitCanon: String,
    val keyLemmas: List<String>,
    val section: String,
    val source: TupleSource,
    val span: TextRange,
)

val COUNT_NOUNS: Set<String> = hashSetOf(
    "patients",
    "participants",
    "subjects",
    "people",
    "persons",
    "individuals",
    "cases",
    "controls",
    "studies",
    "trials",
    "samples",
    "cohorts",
    "groups",
    "sites",
    "centres",
    "centers",
    "countries",
    "hospitals",
    "schools",
    "children",
    "adults",
    "women",
    "men",
    "mice",
    "rats",
    "animals",
    "cells",
    "years",
    "months",
    "weeks",
    "days",
    "hours",
    "times",
    "doses",
    "events",
    "deaths",
    "items",
    "questions",
    "respondents",
    "experiments",
    "models",
    "datasets",
)

data class ExtractQuantitiesOptions(
    val docId: String? = null,
    val sentenceHash: String? = null,
    val occurrenceIndex: Int? = null,
    val section: String? = null,
    val source: TupleSource? = null,
    val lang: String? = null,
    val format: SourceFormat? = null,
    val tableHeader: String? = null,
    val rowLabel: String? = null,
    val citationSpans: List<TextRange>? = null,
    val applyLatex: Boolean? = null,
)

data class QuantExtractionMeta(
    val tuples: List<QuantTuple>,
    val metricFromUnitByTupleIndex: List<Boolean>,
)

private val INTERVAL_CUES: Set<String> = hashSetOf(
    "mean",
    "median",
    "average",
    "estimate",
    "or",
    "hr",
    "rr",
    "irr",
    "ratio",
    "difference",
    "effect",
    "ci",
    "iqr",
)

private val MEAN_SD_CUES: Set<String> = hashSetOf("mean", "sd")

private val SLASH_UNIT_NUMERATORS: Set<String> = hashSetOf(
    "g",
    "mg",
    "ug",
    "\u03BCg",
    "ng",
    "mol",
    "mmol",
    "umol",
    "\u03BCmol",
    "nmol",
)

private const val CITATION_PLACEHOLDER = "\u27E6c\u27E7"

fun computeTupleId(
    docId: String,
    sentenceHash: String,
    occurrenceIndex: Int,
    tupleOrdinal: Int,
    metricClass: MetricClass,
    valueRaw: String,
): String =
    sha256hex("$docId|$sentenceHash|$occurrenceIndex|$tupleOrdinal|${metricClass.wireName}|$valueRaw")
        .substring(0, 32)

private data class Rule4Match(
    val comparator: PComparator,
    val num: ParsedNumber,
    val exprStartNorm: Int,
    val exprEndNorm: Int,
)

private fun isWordCharAtBasic(text: String, idx: Int): Boolean {
    if (idx < 0 || idx >= text.length) return false
    val u = codePointAtSafe(text, idx)
    return isBaseLetter(u.cp) || isDigit(u.cp)
}

private fun parseRule4PValueAt(
    normText: String,
    normLowerText: String,
    rawSubText: String,
    normMap: IntArray,
    pos: Int,
    isEnglish: Boolean,
): Rule4Match? {
    val n = normText.length
    if (pos >= n) return null
    if (normLowerText[pos].code != 112 || isWordCharBefore(normText, pos)) return null

    var k = pos + 1
    if (normLowerText.startsWith("-value", k) && !isWordCharAtBasic(normText, k + 6)) {
        k += 6
    } else {
        val afterSp = skipSpaces(normText, k)
        if (normLowerText.startsWith("value", afterSp) && !isWordCharAtBasic(normText, afterSp + 5)) {
            k = afterSp + 5
            val afterValSp = skipSpaces(normText, k)
            if (normLowerText.startsWith("of", afterValSp) && !isWordCharAtBasic(normText, afterValSp + 2)) {
                k = afterValSp + 2
            }
        } else if (isWordCharAtBasic(normText, k)) {
            return null
        }
    }

    k = skipSpaces(normText, k)
    if (k >= n) return null

    val c0 = normText[k].code
    val c1 = if (k + 1 < n) normText[k + 1].code else 0
    val comparator: PComparator
    if (c0 == 60 /* '<' */) {
        if (c1 == 61) {
            comparator = PComparator.LE
            k += 2
        } else {
            comparator = PComparator.LT
            k += 1
        }
    } else if (c0 == 0x2264 /* '≤' */) {
        comparator = PComparator.LE
        k += 1
    } else if (c0 == 62 /* '>' */) {
        if (c1 == 61) {
            comparator = PComparator.GE
            k += 2
        } else {
            comparator = PComparator.GT
            k += 1
        }
    } else if (c0 == 0x2265 /* '≥' */) {
        comparator = PComparator.GE
        k += 1
    } else if (c0 == 61 /* '=' */) {
        comparator = PComparator.EQ
        k += 1
    } else {
        return null
    }

    k = skipSpaces(normText, k)
    val num = parseFiniteNumberAt(normText, rawSubText, normMap, k, isEnglish, true) ?: return null
    return Rule4Match(comparator, num, pos, num.endNorm)
}

private fun isPureAsciiDigitToken(word: String): Boolean {
    if (word.isEmpty()) return false
    for (i in 0 until word.length) {
        if (!isAsciiDigitCode(word[i].code)) return false
    }
    return true
}

private fun isSlashLiterDenominator(
    textLower: String,
    spans: List<WordSpan>,
    idx: Int,
): Boolean {
    if (idx <= 0) return false
    val cur = spans[idx]
    if (cur.text != "l" || cur.start < 2 || textLower[cur.start - 1].code != 47) return false
    val prev = spans[idx - 1]
    if (prev.end != cur.start - 1) return false
    var pStart = 0
    while (pStart < prev.text.length && isAsciiDigitCode(prev.text[pStart].code)) {
        pStart++
    }
    val numUnit = if (pStart == 0) prev.text else prev.text.substring(pStart)
    return SLASH_UNIT_NUMERATORS.contains(numUnit)
}

private fun buildWordMask(textLower: String, spans: List<WordSpan>): Pair<ByteArray, Boolean> {
    val hasLetterMask = ByteArray(spans.size)
    var anyLetter = false
    for (i in spans.indices) {
        if (isPureAsciiDigitToken(spans[i].text)) continue
        if (isSlashLiterDenominator(textLower, spans, i)) {
            hasLetterMask[i] = 2
            continue
        }
        hasLetterMask[i] = 1
        anyLetter = true
    }
    return hasLetterMask to anyLetter
}

private data class ProseWordSpansResult(
    val cleanedLower: String,
    val spans: List<WordSpan>,
    val hasLetterMask: ByteArray,
    val anyLetterInDoc: Boolean,
)

private fun buildProseWordSpans(
    normText: String,
    normLowerText: String,
    excludedSpans: List<TextRange>,
): ProseWordSpansResult {
    var cleaned = normLowerText
    val hasPlaceholder = normLowerText.contains(CITATION_PLACEHOLDER)
    if (excludedSpans.isNotEmpty() || hasPlaceholder) {
        val sb = StringBuilder(normLowerText.length)
        var last = 0
        for (sIdx in excludedSpans.indices) {
            val span = excludedSpans[sIdx]
            val sStart = maxOf(last, span.start)
            val sEnd = maxOf(sStart, minOf(normText.length, span.end))
            if (sStart > last) {
                sb.append(normLowerText, last, sStart)
            }
            repeat(sEnd - sStart) { sb.append(' ') }
            last = sEnd
        }
        if (last < normLowerText.length) {
            sb.append(normLowerText, last, normLowerText.length)
        }
        cleaned = sb.toString()
        if (hasPlaceholder) {
            val out = StringBuilder(cleaned.length)
            var p = 0
            while (p < cleaned.length) {
                val idx = cleaned.indexOf(CITATION_PLACEHOLDER, p)
                if (idx == -1) {
                    if (p == 0) {
                        out.append(cleaned)
                    } else {
                        out.append(cleaned, p, cleaned.length)
                    }
                    break
                }
                if (idx > p) {
                    out.append(cleaned, p, idx)
                }
                out.append("   ")
                p = idx + CITATION_PLACEHOLDER.length
            }
            cleaned = out.toString()
        }
    }
    val spans = extractWordSpans(cleaned)
    val (mask, anyLetter) = buildWordMask(cleaned, spans)
    return ProseWordSpansResult(cleaned, spans, mask, anyLetter)
}

private data class WordWindowBounds(
    val nextHintIdx: Int,
    val beforeStart: Int,
    val beforeEnd: Int,
    val afterIdx: Int,
    val afterEnd: Int,
    val hasContentLetter: Boolean,
)

private fun locateWordWindow(
    wordSpans: List<WordSpan>,
    hasLetterMask: ByteArray,
    startNorm: Int,
    endNorm: Int,
    leftHintIdx: Int,
    countPerSide: Int,
): WordWindowBounds {
    val wsLen = wordSpans.size
    var idx = leftHintIdx
    while (idx < wsLen && wordSpans[idx].end <= startNorm) {
        idx++
    }
    val beforeEnd = idx
    val beforeStart = maxOf(0, beforeEnd - countPerSide)
    var afterIdx = idx
    while (afterIdx < wsLen && wordSpans[afterIdx].start < endNorm) {
        afterIdx++
    }
    val afterEnd = minOf(wsLen, afterIdx + countPerSide)

    var hasContentLetter = false
    for (k in beforeStart until beforeEnd) {
        if (hasLetterMask[k].toInt() == 1) {
            hasContentLetter = true
            break
        }
    }
    if (!hasContentLetter) {
        for (k in afterIdx until afterEnd) {
            if (hasLetterMask[k].toInt() == 1) {
                hasContentLetter = true
                break
            }
        }
    }

    return WordWindowBounds(beforeEnd, beforeStart, beforeEnd, afterIdx, afterEnd, hasContentLetter)
}

private fun collectWindowWords(
    wordSpans: List<WordSpan>,
    hasLetterMask: ByteArray,
    win: WordWindowBounds,
): List<String> {
    val words = ArrayList<String>((win.beforeEnd - win.beforeStart) + (win.afterEnd - win.afterIdx))
    for (k in win.beforeStart until win.beforeEnd) {
        if (hasLetterMask[k].toInt() != 2) {
            words.add(wordSpans[k].text)
        }
    }
    for (k in win.afterIdx until win.afterEnd) {
        if (hasLetterMask[k].toInt() != 2) {
            words.add(wordSpans[k].text)
        }
    }
    return words
}

private fun containsMeanSdCue(
    words: List<String>,
    windowTextLower: String,
    tableHeaderLower: String,
    tableWindowWords: List<String>?,
): Boolean {
    for (i in words.indices) {
        if (MEAN_SD_CUES.contains(words[i])) return true
    }
    if (tableWindowWords != null) {
        for (i in tableWindowWords.indices) {
            if (MEAN_SD_CUES.contains(tableWindowWords[i])) return true
        }
    }
    val combined = if (tableHeaderLower.isNotEmpty()) "$windowTextLower $tableHeaderLower" else windowTextLower
    return combined.contains("s.d.") ||
        combined.contains("standard deviation") ||
        combined.contains("m (sd)") ||
        combined.contains("mean (sd)")
}

private fun hasIntervalCueInWindow(
    wordSpans: List<WordSpan>,
    beforeStart: Int,
    beforeEnd: Int,
): Boolean {
    for (i in beforeStart until beforeEnd) {
        if (INTERVAL_CUES.contains(wordSpans[i].text)) return true
    }
    return false
}

private fun isDigitPrefixedUnitToken(word: String): Boolean {
    val len = word.length
    if (len < 2 || !isAsciiDigitCode(word[0].code)) return false
    var dEnd = 1
    while (dEnd < len && isAsciiDigitCode(word[dEnd].code)) {
        dEnd++
    }
    if (dEnd >= len) return false
    val tail = word.substring(dEnd)
    if (dEnd == 4 && tail == "s") return false
    return UNIT_WORDS.contains(tail) || isKnownSuffixWordUnit(tail) || SLASH_UNIT_NUMERATORS.contains(tail)
}

private fun stemKeyWord(w: String): String? {
    if (w.isEmpty() ||
        BM25_STOPWORDS.contains(w) ||
        UNIT_WORDS.contains(w) ||
        isKnownSuffixWordUnit(w) ||
        isDigitPrefixedUnitToken(w)
    ) {
        return null
    }
    val stem = porterStem(w)
    return if (stem.isNotEmpty()) stem else null
}

private const val UNSET_SENTINEL = "\uFFFF__UNSET__"

private fun getCachedWordStem(
    wordSpans: List<WordSpan>,
    wordStemCache: Array<String?>,
    idx: Int,
): String? {
    val cached = wordStemCache[idx]
    if (cached !== UNSET_SENTINEL) return cached
    val computed = stemKeyWord(wordSpans[idx].text)
    wordStemCache[idx] = computed
    return computed
}

private fun appendUniqueStem(out: MutableList<String>, seen: HashSet<String>?, stem: String): HashSet<String>? {
    if (out.isEmpty()) {
        out.add(stem)
        return seen
    }
    if (out.size == 1) {
        if (out[0] != stem) {
            out.add(stem)
        }
        return seen
    }
    val activeSet = seen ?: HashSet(out)
    if (activeSet.add(stem)) {
        out.add(stem)
    }
    return activeSet
}

private fun computeKeyLemmas(
    wordSpans: List<WordSpan>,
    hasLetterMask: ByteArray,
    wordStemCache: Array<String?>,
    r1Start: Int,
    r1End: Int,
    r2Start: Int,
    r2End: Int,
    extraExcludedWord: String?,
): List<String> {
    val out = ArrayList<String>()
    var seen: HashSet<String>? = null

    fun processRange(startIdx: Int, endIdx: Int) {
        for (k in startIdx until endIdx) {
            if (hasLetterMask[k].toInt() != 1) continue
            if (extraExcludedWord != null && wordSpans[k].text == extraExcludedWord) continue
            val stem = getCachedWordStem(wordSpans, wordStemCache, k)
            if (stem != null) {
                seen = appendUniqueStem(out, seen, stem)
            }
        }
    }

    processRange(r1Start, r1End)
    processRange(r2Start, r2End)

    if (out.size > 1) {
        out.sort()
    }
    return out
}

private data class CiOrIqrLabelMatch(val label: String, val afterLabelNorm: Int)

private fun tryReadCiOrIqrLabel(
    normText: String,
    normLowerText: String,
    startPos: Int,
    requireConfOrLabel: Boolean,
): CiOrIqrLabelMatch? {
    var k = startPos
    val n = normText.length

    if (k < n && isAsciiDigitCode(normText[k].code)) {
        var dEnd = k
        while (dEnd < n && isAsciiDigitCode(normText[dEnd].code)) {
            dEnd++
        }
        var afterPct = dEnd
        if (afterPct < n && normText[afterPct].code == 32) {
            afterPct++
        }
        if (afterPct < n && normText[afterPct].code == 37 /* '%' */) {
            afterPct++
            k = skipSpaces(normText, afterPct)
            val ciEnd = matchWordLowerAt(normLowerText, k, "ci")
            if (ciEnd != -1) {
                var after = skipSpaces(normText, ciEnd)
                if (after < n && (normText[after].code == 58 || normText[after].code == 61)) {
                    after = skipSpaces(normText, after + 1)
                }
                return CiOrIqrLabelMatch("ci", after)
            }
        }
        return null
    }

    fun readLabelTail(afterWord: Int, label: String): CiOrIqrLabelMatch {
        var after = skipSpaces(normText, afterWord)
        if (after < n && (normText[after].code == 58 || normText[after].code == 61)) {
            after = skipSpaces(normText, after + 1)
        }
        return CiOrIqrLabelMatch(label, after)
    }

    val ciEnd = matchWordLowerAt(normLowerText, k, "ci")
    if (ciEnd != -1) return readLabelTail(ciEnd, "ci")

    if (requireConfOrLabel) {
        val iqrEnd = matchWordLowerAt(normLowerText, k, "iqr")
        if (iqrEnd != -1) return readLabelTail(iqrEnd, "iqr")
        val rangeEnd = matchWordLowerAt(normLowerText, k, "range")
        if (rangeEnd != -1) return readLabelTail(rangeEnd, "range")
    }
    return null
}

private fun matchRangeSeparatorAt(normText: String, normLowerText: String, pos: Int): Int {
    val n = normText.length
    val k = skipSpaces(normText, pos)
    if (k >= n) return -1
    val ch = normText[k].code
    if (ch == 45 || ch == 0x2013 || ch == 44) {
        return skipSpaces(normText, k + 1)
    }
    val toEnd = matchWordLowerAt(normLowerText, k, "to")
    if (toEnd != -1 && toEnd > pos && k > pos) {
        return skipSpaces(normText, toEnd)
    }
    return -1
}

private fun matchStrictRangeHyphenOrTo(normText: String, normLowerText: String, pos: Int): Int {
    val n = normText.length
    val k = skipSpaces(normText, pos)
    if (k >= n) return -1
    val ch = normText[k].code
    if (ch == 45 || ch == 0x2013) {
        return skipSpaces(normText, k + 1)
    }
    if (k > pos) {
        val toEnd = matchWordLowerAt(normLowerText, k, "to")
        if (toEnd != -1) {
            val after = skipSpaces(normText, toEnd)
            if (after > toEnd) return after
        }
    }
    return -1
}

private data class CombinedUnitInfo(
    val unitCanon: String,
    val unitRaw: String,
    val unitFamily: UnitFamily,
    val factor: Double,
    val isSampleSizePrefix: Boolean,
    val unitStartNorm: Int,
    val unitEndNorm: Int,
    val extraExcludedUnitWord: String?,
)

private val EMPTY_COMBINED_UNIT = CombinedUnitInfo(
    unitCanon = "",
    unitRaw = "",
    unitFamily = UnitFamily.NONE,
    factor = 1.0,
    isSampleSizePrefix = false,
    unitStartNorm = -1,
    unitEndNorm = -1,
    extraExcludedUnitWord = null,
)

private fun resolveCombinedUnit(
    prep: PreparedInput,
    suffixUnit: UnitMatch?,
    prefixUnit: UnitMatch?,
): CombinedUnitInfo {
    if (suffixUnit != null) {
        val sStart = if (suffixUnit.startNorm in prep.normMap.indices) prep.normMap[suffixUnit.startNorm] else 0
        val sEnd = if (suffixUnit.endNorm in prep.normMap.indices) prep.normMap[suffixUnit.endNorm] else prep.subText.length
        val rawSlice = prep.subText.substring(sStart, sEnd)
        val keepSampleSize =
            suffixUnit.family == UnitFamily.COUNT && prefixUnit != null && prefixUnit.isSampleSizePrefix
        val isUnknown = suffixUnit.family == UnitFamily.UNKNOWN
        return CombinedUnitInfo(
            unitCanon = suffixUnit.unitCanon,
            unitRaw = rawSlice,
            unitFamily = suffixUnit.family,
            factor = suffixUnit.factor,
            isSampleSizePrefix = keepSampleSize,
            unitStartNorm = if (keepSampleSize) prefixUnit!!.startNorm else suffixUnit.startNorm,
            unitEndNorm = suffixUnit.endNorm,
            extraExcludedUnitWord = if (isUnknown) null else asciiLower(rawSlice),
        )
    }
    if (prefixUnit != null) {
        val pStart = if (prefixUnit.startNorm in prep.normMap.indices) prep.normMap[prefixUnit.startNorm] else 0
        val pEnd = if (prefixUnit.endNorm in prep.normMap.indices) prep.normMap[prefixUnit.endNorm] else prep.subText.length
        val rawSlice = prep.subText.substring(pStart, pEnd)
        return CombinedUnitInfo(
            unitCanon = prefixUnit.unitCanon,
            unitRaw = rawSlice,
            unitFamily = prefixUnit.family,
            factor = prefixUnit.factor,
            isSampleSizePrefix = prefixUnit.isSampleSizePrefix,
            unitStartNorm = prefixUnit.startNorm,
            unitEndNorm = prefixUnit.endNorm,
            extraExcludedUnitWord = null,
        )
    }
    return EMPTY_COMBINED_UNIT
}

private fun lowerBoundMap(map: IntArray, target: Int, maxOut: Int): Int {
    var lo = 0
    var hi = maxOut
    while (lo < hi) {
        val mid = (lo + hi) ushr 1
        val v = if (mid in map.indices) map[mid] else 0
        if (v < target) {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    return lo
}

private fun mapExcludedSpansToNorm(prep: PreparedInput, rawSpans: List<TextRange>): List<TextRange> {
    if (rawSpans.isEmpty()) return emptyList()
    val normLen = prep.normText.length
    val subLen = prep.subText.length
    val result = ArrayList<TextRange>(rawSpans.size)
    for (s in rawSpans.indices) {
        val rs = rawSpans[s]
        var subStart = rs.start
        var subEnd = rs.end
        val lMap = prep.latexMap
        if (lMap != null) {
            subStart = lowerBoundMap(lMap, rs.start, subLen)
            subEnd = lowerBoundMap(lMap, rs.end, subLen)
        }
        val nStart = lowerBoundMap(prep.normMap, subStart, normLen)
        val nEnd = lowerBoundMap(prep.normMap, subEnd, normLen)
        if (nEnd > nStart) {
            result.add(TextRange(nStart, nEnd))
        }
    }
    result.sortWith { a, b -> if (a.start != b.start) a.start - b.start else a.end - b.end }
    return result
}

private fun isPlusMinusUnitCompatible(a: UnitMatch?, b: UnitMatch?): Boolean {
    if (a == null || b == null) return true
    return a.unitCanon == b.unitCanon && a.family != UnitFamily.UNKNOWN
}

private fun isRangeUnitCompatible(a: UnitMatch?, b: UnitMatch?): Boolean {
    if (a == null) return true
    if (b == null) return false
    return a.unitCanon == b.unitCanon && a.family != UnitFamily.UNKNOWN
}

private fun isPointIntervalUnitCompatible(
    aSuf: UnitMatch?,
    aPrefix: UnitMatch?,
    bSuf: UnitMatch?,
    cSuf: UnitMatch?,
    postSuf: UnitMatch?,
): Boolean {
    if (!isRangeUnitCompatible(bSuf, cSuf)) return false
    val boundSuf = postSuf ?: cSuf ?: bSuf ?: return true
    if (boundSuf.family == UnitFamily.UNKNOWN) return false
    if (aSuf != null && (aSuf.family == UnitFamily.UNKNOWN || aSuf.unitCanon != boundSuf.unitCanon)) {
        return false
    }
    if (aPrefix != null && (aPrefix.family == UnitFamily.UNKNOWN || aPrefix.unitCanon != boundSuf.unitCanon)) {
        return false
    }
    return true
}

private fun overlapsExcludedSpan(spans: List<TextRange>, startNorm: Int, endNorm: Int): Boolean {
    val len = spans.size
    if (len == 0 || endNorm <= startNorm) return false
    var lo = 0
    var hi = len
    while (lo < hi) {
        val mid = (lo + hi) ushr 1
        if (spans[mid].end <= startNorm) {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    return lo < len && spans[lo].start < endNorm
}

private class ScanRuntimeCtx(
    val prep: PreparedInput,
    val normText: String,
    val normLowerText: String,
    val cleanedLower: String,
    val n: Int,
    val tupleIdHasher: Sha256PrefixHasher,
    val section: String,
    val source: TupleSource,
    val anyLetterInDoc: Boolean,
    val wordSpans: List<WordSpan>,
    val hasLetterMask: ByteArray,
    val excludedNormSpans: List<TextRange>,
    val tableWordSpans: List<WordSpan>?,
    val tableLetterMask: ByteArray?,
    val tableStemCache: Array<String?>?,
    val tableWindowWords: List<String>?,
    val tableHeaderLower: String,
    val tableCombinedLower: String,
    val sentenceHasPct: Boolean,
    val sentenceHasTo: Boolean,
    val sentenceHasAnd: Boolean,
    val sentenceHasCiWord: Boolean,
    val sentenceHasRangeSep: Boolean,
    val cues: DocMetricCues,
    val wordStemCache: Array<String?>,
) {
    val tuples = ArrayList<QuantTuple>()
    val metricFromUnitList = ArrayList<Boolean>()
    var wordHintIdx = 0
    var seenPctBeforeCursor = false
    var lastConsumedEndNorm = 0
}

private fun commitTuple(
    ctx: ScanRuntimeCtx,
    valueRaw: String,
    unitMatch: CombinedUnitInfo,
    pComparator: PComparator?,
    metricClass: MetricClass,
    metricFromUnit: Boolean,
    valueNorm: Double,
    valueLo: Double,
    valueHi: Double,
    sigDigits: Int,
    spanStartNorm: Int,
    spanEndNorm: Int,
    keyLemmas: List<String>,
) {
    if (!valueNorm.isFinite() || !valueLo.isFinite() || !valueHi.isFinite()) return
    val ordinal = ctx.tuples.size
    ctx.tuples.add(
        QuantTuple(
            tupleId = ctx.tupleIdHasher.digestHex32("$ordinal|${metricClass.wireName}|$valueRaw"),
            valueRaw = valueRaw,
            unitRaw = unitMatch.unitRaw,
            metricClass = metricClass,
            pComparator = pComparator,
            valueNorm = normalizeZero(valueNorm),
            valueLo = normalizeZero(valueLo),
            valueHi = normalizeZero(valueHi),
            sigDigits = sigDigits,
            unitCanon = unitMatch.unitCanon,
            keyLemmas = keyLemmas,
            section = ctx.section,
            source = ctx.source,
            span = toRawSpan(ctx.prep, spanStartNorm, spanEndNorm),
        ),
    )
    ctx.metricFromUnitList.add(metricFromUnit)
    if (spanEndNorm > ctx.lastConsumedEndNorm) {
        ctx.lastConsumedEndNorm = spanEndNorm
    }
}

private fun pushTupleFromSpan(
    ctx: ScanRuntimeCtx,
    valueRaw: String,
    unitMatch: CombinedUnitInfo,
    isRule4PValue: Boolean,
    pComparator: PComparator?,
    valueNorm: Double,
    valueLo: Double,
    valueHi: Double,
    sigDigits: Int,
    spanStartNorm: Int,
    spanEndNorm: Int,
) {
    val tblWords = ctx.tableWindowWords
    val tblSpans = ctx.tableWordSpans
    val tblMask = ctx.tableLetterMask
    val tblStems = ctx.tableStemCache
    if (tblWords != null && tblSpans != null && tblMask != null && tblStems != null) {
        val metric = classifyMetricClass(
            MetricClassInput(
                unitFamily = unitMatch.unitFamily,
                isRule4PValue = isRule4PValue,
                isSampleSizePrefix = unitMatch.isSampleSizePrefix,
                windowWordsLower = tblWords,
                windowTextLower = ctx.tableCombinedLower,
                preNormalized = true,
            ),
        )
        val keyLemmas = computeKeyLemmas(
            tblSpans,
            tblMask,
            tblStems,
            0,
            tblSpans.size,
            0,
            0,
            unitMatch.extraExcludedUnitWord,
        )
        commitTuple(
            ctx, valueRaw, unitMatch, pComparator, metric.metricClass, metric.metricFromUnit,
            valueNorm, valueLo, valueHi, sigDigits, spanStartNorm, spanEndNorm, keyLemmas,
        )
        return
    }

    if (!ctx.anyLetterInDoc) {
        val metric = classifyUnitOnly(unitMatch.unitFamily, isRule4PValue, unitMatch.isSampleSizePrefix)
        commitTuple(
            ctx, valueRaw, unitMatch, pComparator, metric.metricClass, metric.metricFromUnit,
            valueNorm, valueLo, valueHi, sigDigits, spanStartNorm, spanEndNorm, emptyList(),
        )
        return
    }

    val win = locateWordWindow(
        ctx.wordSpans,
        ctx.hasLetterMask,
        spanStartNorm,
        spanEndNorm,
        ctx.wordHintIdx,
        6,
    )
    ctx.wordHintIdx = win.nextHintIdx

    var metric = classifyUnitOnly(unitMatch.unitFamily, isRule4PValue, unitMatch.isSampleSizePrefix)
    if ((ctx.cues.hasEffectCue || ctx.cues.hasSampleCue || ctx.cues.hasDoseCue) && win.hasContentLetter) {
        val wordsList = collectWindowWords(ctx.wordSpans, ctx.hasLetterMask, win)
        var windowTextForMetric = ""
        if (ctx.cues.hasEffectCue) {
            val wStartNorm = if (win.beforeStart < win.beforeEnd) ctx.wordSpans[win.beforeStart].start else spanStartNorm
            val wEndNorm = if (win.afterEnd > win.afterIdx) ctx.wordSpans[win.afterEnd - 1].end else spanEndNorm
            windowTextForMetric = ctx.cleanedLower.substring(wStartNorm, wEndNorm)
        }
        metric = classifyMetricClass(
            MetricClassInput(
                unitFamily = unitMatch.unitFamily,
                isRule4PValue = isRule4PValue,
                isSampleSizePrefix = unitMatch.isSampleSizePrefix,
                windowWordsLower = wordsList,
                windowTextLower = windowTextForMetric,
                preNormalized = true,
            ),
        )
    }

    val keyLemmas = computeKeyLemmas(
        ctx.wordSpans,
        ctx.hasLetterMask,
        ctx.wordStemCache,
        win.beforeStart,
        win.beforeEnd,
        win.afterIdx,
        win.afterEnd,
        unitMatch.extraExcludedUnitWord,
    )
    commitTuple(
        ctx, valueRaw, unitMatch, pComparator, metric.metricClass, metric.metricFromUnit,
        valueNorm, valueLo, valueHi, sigDigits, spanStartNorm, spanEndNorm, keyLemmas,
    )
}

private data class IntervalBoundsMatch(
    val bNum: ParsedNumber,
    val bSuf: UnitMatch?,
    val cNum: ParsedNumber,
    val cSuf: UnitMatch?,
    val boundsEndNorm: Int,
)

private fun parseIntervalBounds(
    ctx: ScanRuntimeCtx,
    bStartNorm: Int,
    hasPct: Boolean,
): IntervalBoundsMatch? {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    val bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStartNorm, prep.isEnglish, true)
        ?: return null
    val bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false)
    val sepAfterB = matchRangeSeparatorAt(normText, normLowerText, bSuf?.endNorm ?: bNum.endNorm)
    if (sepAfterB == -1) return null
    val cNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, sepAfterB, prep.isEnglish, true)
        ?: return null
    val cSuf = scanSuffixUnitFast(normText, normLowerText, cNum.endNorm, hasPct, false)
    return IntervalBoundsMatch(bNum, bSuf, cNum, cSuf, cSuf?.endNorm ?: cNum.endNorm)
}

private fun tryRule6FromTo(ctx: ScanRuntimeCtx, i: Int): Int {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    val fromEnd = matchWordLowerAt(normLowerText, i, "from")
    if (fromEnd == -1) return -1
    val aStart = skipSpaces(normText, fromEnd)
    if (aStart <= fromEnd) return -1
    val aNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, aStart, prep.isEnglish, true)
        ?: return -1
    val hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct
    val aSuf = scanSuffixUnitFast(normText, normLowerText, aNum.endNorm, hasPct, aNum.isYearIntCandidate)
    val aAfterUnit = aSuf?.endNorm ?: aNum.endNorm
    val spBeforeTo = skipSpaces(normText, aAfterUnit)
    val toEnd = if (spBeforeTo > aAfterUnit) matchWordLowerAt(normLowerText, spBeforeTo, "to") else -1
    if (toEnd == -1) return -1
    val bStart = skipSpaces(normText, toEnd)
    if (bStart <= toEnd) return -1
    val bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStart, prep.isEnglish, true)
        ?: return -1
    val bSuf = scanSuffixUnitFast(
        normText,
        normLowerText,
        bNum.endNorm,
        hasPct || aSuf?.family == UnitFamily.PERCENT,
        bNum.isYearIntCandidate,
    )
    val bAfterUnit = bSuf?.endNorm ?: bNum.endNorm
    if (overlapsExcludedSpan(ctx.excludedNormSpans, i, bAfterUnit)) return -1

    val effUnitA = resolveCombinedUnit(prep, aSuf ?: bSuf, null)
    val effUnitB = resolveCombinedUnit(prep, bSuf, null)

    if (!(aNum.isYearIntCandidate && effUnitA.unitFamily == UnitFamily.NONE)) {
        val valNormA = scaleParsedNumber(aNum, effUnitA.factor)
        pushTupleFromSpan(
            ctx,
            prep.subText.substring(aNum.rawStartSub, aNum.rawEndSub),
            effUnitA,
            false,
            null,
            valNormA,
            valNormA,
            valNormA,
            aNum.sigDigits,
            aStart,
            aAfterUnit,
        )
    }

    if (!(bNum.isYearIntCandidate && effUnitB.unitFamily == UnitFamily.NONE)) {
        val valNormB = scaleParsedNumber(bNum, effUnitB.factor)
        pushTupleFromSpan(
            ctx,
            prep.subText.substring(bNum.rawStartSub, bNum.rawEndSub),
            effUnitB,
            false,
            null,
            valNormB,
            valNormB,
            valNormB,
            bNum.sigDigits,
            bStart,
            bAfterUnit,
        )
    }

    return bAfterUnit
}

private fun tryRule7Between(ctx: ScanRuntimeCtx, i: Int): Int {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    val betEnd = matchWordLowerAt(normLowerText, i, "between")
    if (betEnd == -1) return -1
    val aStart = skipSpaces(normText, betEnd)
    if (aStart <= betEnd) return -1
    val aPrefix = scanLeadingPrefixCurrency(normText, normLowerText, aStart)
    var aNumStart = aStart
    if (aPrefix != null) {
        aNumStart = skipSpaces(normText, aPrefix.endNorm)
        if (aNumStart - aPrefix.endNorm > 1) return -1
    }
    val aNum = parseFiniteNumberAt(
        normText, prep.subText, prep.normMap, aNumStart, prep.isEnglish, true, aPrefix != null,
    ) ?: return -1
    val hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct
    val aSuf = scanSuffixUnitFast(normText, normLowerText, aNum.endNorm, hasPct, aNum.isYearIntCandidate)
    if (aPrefix != null && aSuf != null && (aSuf.family == UnitFamily.UNKNOWN || aPrefix.unitCanon != aSuf.unitCanon)) {
        return -1
    }
    val aAfterUnit = aSuf?.endNorm ?: aNum.endNorm
    val spBeforeAnd = skipSpaces(normText, aAfterUnit)
    val andEnd = if (spBeforeAnd > aAfterUnit) matchWordLowerAt(normLowerText, spBeforeAnd, "and") else -1
    if (andEnd == -1) return -1
    val bStart = skipSpaces(normText, andEnd)
    if (bStart <= andEnd) return -1
    val bPrefix = scanLeadingPrefixCurrency(normText, normLowerText, bStart)
    var bNumStart = bStart
    if (bPrefix != null) {
        bNumStart = skipSpaces(normText, bPrefix.endNorm)
        if (bNumStart - bPrefix.endNorm > 1) return -1
    }
    val bNum = parseFiniteNumberAt(
        normText, prep.subText, prep.normMap, bNumStart, prep.isEnglish, true, bPrefix != null,
    ) ?: return -1
    val bSuf = scanSuffixUnitFast(
        normText,
        normLowerText,
        bNum.endNorm,
        hasPct || aSuf?.family == UnitFamily.PERCENT,
        bNum.isYearIntCandidate,
    )
    if (bPrefix != null && bSuf != null && (bSuf.family == UnitFamily.UNKNOWN || bPrefix.unitCanon != bSuf.unitCanon)) {
        return -1
    }
    val effB = bSuf ?: bPrefix
    if (aSuf != null) {
        if (effB == null || effB.family == UnitFamily.UNKNOWN || aSuf.unitCanon != effB.unitCanon) {
            return -1
        }
    } else if (aPrefix != null && effB != null) {
        if (effB.family == UnitFamily.UNKNOWN || aPrefix.unitCanon != effB.unitCanon) {
            return -1
        }
    }
    val bAfterUnit = bSuf?.endNorm ?: bNum.endNorm
    if (overlapsExcludedSpan(ctx.excludedNormSpans, i, bAfterUnit)) return -1
    val sharedSuf = bSuf ?: aSuf
    val sharedPrefix = aPrefix ?: bPrefix
    val unitA = resolveCombinedUnit(prep, aSuf ?: sharedSuf, if (sharedSuf == null) sharedPrefix else null)
    val unitB = resolveCombinedUnit(prep, bSuf ?: sharedSuf, if (sharedSuf == null) sharedPrefix else null)
    val valLo = scaleParsedNumber(aNum, unitA.factor)
    val valHi = scaleParsedNumber(bNum, unitB.factor)
    pushTupleFromSpan(
        ctx,
        prep.subText.substring(aNum.rawStartSub, bNum.rawEndSub),
        unitB,
        false,
        null,
        (valLo + valHi) / 2.0,
        valLo,
        valHi,
        maxOf(aNum.sigDigits, bNum.sigDigits),
        i,
        bAfterUnit,
    )
    return bAfterUnit
}

private fun tryStandaloneCi(ctx: ScanRuntimeCtx, i: Int): Int {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    val n = ctx.n
    val ciHead = tryReadCiOrIqrLabel(normText, normLowerText, i, false)
    if (ciHead == null || ciHead.label != "ci") return -1
    var bScan = skipSpaces(normText, ciHead.afterLabelNorm)
    if (bScan >= n) return -1
    var closeBracket = 0
    val bStartCh = normText[bScan].code
    if (bStartCh == 91 /* '[' */) {
        closeBracket = 93
        bScan = skipSpaces(normText, bScan + 1)
    } else if (bStartCh == 40 /* '(' */) {
        closeBracket = 41
        bScan = skipSpaces(normText, bScan + 1)
    } else if (!isAsciiDigitCode(bStartCh) && bStartCh != 45 && bStartCh != 43 && bStartCh != 46) {
        return -1
    }
    val hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct
    val bounds = parseIntervalBounds(ctx, bScan, hasPct) ?: return -1
    if (!isRangeUnitCompatible(bounds.bSuf, bounds.cSuf)) return -1
    var exprEnd = bounds.boundsEndNorm
    var postUnit: UnitMatch? = null
    if (closeBracket != 0) {
        val closeIdx = skipSpaces(normText, exprEnd)
        if (closeIdx >= n || normText[closeIdx].code != closeBracket) return -1
        exprEnd = closeIdx + 1
        postUnit = scanSuffixUnitFast(normText, normLowerText, exprEnd, hasPct, false)
        if (postUnit != null) {
            exprEnd = postUnit.endNorm
        }
    }
    if (overlapsExcludedSpan(ctx.excludedNormSpans, i, exprEnd)) return -1
    var prefixUnit = scanPrefixUnit(normText, normLowerText, i, ctx.lastConsumedEndNorm)
    if (prefixUnit != null && overlapsExcludedSpan(ctx.excludedNormSpans, prefixUnit.startNorm, i)) {
        prefixUnit = null
    }
    val effSuf = postUnit ?: bounds.cSuf ?: bounds.bSuf
    val unitMatch = resolveCombinedUnit(prep, effSuf, prefixUnit)
    val factorB = bounds.bSuf?.factor ?: unitMatch.factor
    val factorC = bounds.cSuf?.factor ?: unitMatch.factor
    val valLo = scaleParsedNumber(bounds.bNum, factorB)
    val valHi = scaleParsedNumber(bounds.cNum, factorC)
    val spanStart = prefixUnit?.startNorm ?: i
    pushTupleFromSpan(
        ctx,
        prep.subText.substring(bounds.bNum.rawStartSub, bounds.cNum.rawEndSub),
        unitMatch,
        false,
        null,
        (valLo + valHi) / 2.0,
        valLo,
        valHi,
        maxOf(bounds.bNum.sigDigits, bounds.cNum.sigDigits),
        spanStart,
        exprEnd,
    )
    return exprEnd
}

private fun tryRule2Interval(
    ctx: ScanRuntimeCtx,
    aNum: ParsedNumber,
    aPrefix: UnitMatch?,
    aSuf: UnitMatch?,
    exprStartBase: Int,
    nextAfterA: Int,
    nextChAfterA: Int,
): Int {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    val n = ctx.n
    if (overlapsExcludedSpan(ctx.excludedNormSpans, nextAfterA, nextAfterA + 1)) return -1
    val hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct
    val isParenOrBracket = nextChAfterA == 40 || nextChAfterA == 91
    val boundsSearchPos: Int
    val hasExplicitLabel: Boolean
    var closeCh = 0

    if (isParenOrBracket) {
        closeCh = if (nextChAfterA == 40) 41 else 93
        val innerStart = skipSpaces(normText, nextAfterA + 1)
        val labelMatch = if (nextChAfterA == 40) tryReadCiOrIqrLabel(normText, normLowerText, innerStart, true) else null
        hasExplicitLabel = labelMatch != null
        boundsSearchPos = labelMatch?.afterLabelNorm ?: innerStart
    } else {
        val afterComma = skipSpaces(normText, nextAfterA + 1)
        val labelMatch = tryReadCiOrIqrLabel(normText, normLowerText, afterComma, false)
        if (labelMatch == null || labelMatch.label != "ci") return -1
        hasExplicitLabel = true
        boundsSearchPos = labelMatch.afterLabelNorm
    }

    val bounds = parseIntervalBounds(ctx, boundsSearchPos, hasPct) ?: return -1
    var finalEnd = bounds.boundsEndNorm
    var postSuf: UnitMatch? = null
    if (isParenOrBracket) {
        val afterC = skipSpaces(normText, bounds.boundsEndNorm)
        if (afterC >= n || normText[afterC].code != closeCh) return -1
        val postCloseEnd = afterC + 1
        if (closeCh == 93 && postCloseEnd < n && normText[postCloseEnd].code == 40) return -1
        postSuf = if (aSuf == null) scanSuffixUnitFast(normText, normLowerText, postCloseEnd, hasPct, false) else null
        finalEnd = postSuf?.endNorm ?: postCloseEnd
    }

    if (!isPointIntervalUnitCompatible(aSuf, aPrefix, bounds.bSuf, bounds.cSuf, postSuf)) return -1
    if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) return -1

    val unitMatch = resolveCombinedUnit(prep, aSuf ?: postSuf ?: bounds.cSuf ?: bounds.bSuf, aPrefix)
    val factorA = aSuf?.factor ?: unitMatch.factor
    val factorB = bounds.bSuf?.factor ?: unitMatch.factor
    val factorC = bounds.cSuf?.factor ?: unitMatch.factor
    val valA = scaleParsedNumber(aNum, factorA)
    val valB = scaleParsedNumber(bounds.bNum, factorB)
    val valC = scaleParsedNumber(bounds.cNum, factorC)

    if (!hasExplicitLabel) {
        val winCheck = locateWordWindow(
            ctx.wordSpans, ctx.hasLetterMask, aNum.startNorm, aNum.endNorm, ctx.wordHintIdx, 4,
        )
        val bareAllowed = hasIntervalCueInWindow(ctx.wordSpans, winCheck.beforeStart, winCheck.beforeEnd) ||
            (valB <= valA && valA <= valC)
        if (!bareAllowed) return -1
    }

    pushTupleFromSpan(
        ctx,
        prep.subText.substring(aNum.rawStartSub, aNum.rawEndSub),
        unitMatch,
        false,
        null,
        valA,
        valB,
        valC,
        aNum.sigDigits,
        exprStartBase,
        finalEnd,
    )
    return finalEnd
}

private fun tryRule2bMeanSd(
    ctx: ScanRuntimeCtx,
    aNum: ParsedNumber,
    aPrefix: UnitMatch?,
    aSuf: UnitMatch?,
    exprStartBase: Int,
    nextAfterA: Int,
): Int {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    val n = ctx.n
    if (overlapsExcludedSpan(ctx.excludedNormSpans, nextAfterA, nextAfterA + 1)) return -1
    val bStart = skipSpaces(normText, nextAfterA + 1)
    val bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStart, prep.isEnglish, false)
        ?: return -1
    if (bNum.value < 0.0) return -1
    val hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct
    val bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false)
    val afterB = skipSpaces(normText, bSuf?.endNorm ?: bNum.endNorm)
    if (afterB >= n || normText[afterB].code != 41 /* ')' */) return -1
    if (bSuf != null && (aSuf == null || bSuf.family == UnitFamily.UNKNOWN || bSuf.unitCanon != aSuf.unitCanon)) {
        return -1
    }
    val cmpA = if (aSuf != null && bSuf != null) scaleParsedNumber(aNum, aSuf.factor) else aNum.value
    val cmpB = if (aSuf != null && bSuf != null) scaleParsedNumber(bNum, bSuf.factor) else bNum.value
    if (cmpB >= cmpA) return -1
    val postCloseEnd = afterB + 1
    val postSuf = if (aSuf == null) scanSuffixUnitFast(normText, normLowerText, postCloseEnd, hasPct, false) else null
    val finalEnd = postSuf?.endNorm ?: postCloseEnd
    if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) return -1

    val win = locateWordWindow(
        ctx.wordSpans, ctx.hasLetterMask, exprStartBase, finalEnd, ctx.wordHintIdx, 6,
    )
    val winWords = if (win.hasContentLetter) collectWindowWords(ctx.wordSpans, ctx.hasLetterMask, win) else emptyList()
    var localWindowLower = ""
    if (winWords.isNotEmpty()) {
        val wStartNorm = if (win.beforeStart < win.beforeEnd) ctx.wordSpans[win.beforeStart].start else exprStartBase
        val wEndNorm = if (win.afterEnd > win.afterIdx) ctx.wordSpans[win.afterEnd - 1].end else finalEnd
        localWindowLower = ctx.cleanedLower.substring(wStartNorm, wEndNorm)
    }
    if (!containsMeanSdCue(winWords, localWindowLower, ctx.tableHeaderLower, ctx.tableWindowWords)) {
        return -1
    }
    val unitMatch = resolveCombinedUnit(prep, aSuf ?: postSuf, aPrefix)
    val valNorm = scaleParsedNumber(aNum, unitMatch.factor)
    pushTupleFromSpan(
        ctx,
        prep.subText.substring(aNum.rawStartSub, aNum.rawEndSub),
        unitMatch,
        false,
        null,
        valNorm,
        valNorm,
        valNorm,
        aNum.sigDigits,
        exprStartBase,
        finalEnd,
    )
    return finalEnd
}

private fun tryRule3PlusMinus(
    ctx: ScanRuntimeCtx,
    aNum: ParsedNumber,
    aPrefix: UnitMatch?,
    aSuf: UnitMatch?,
    exprStartBase: Int,
    nextAfterA: Int,
): Int {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    if (overlapsExcludedSpan(ctx.excludedNormSpans, nextAfterA, nextAfterA + 1)) return -1
    val opEnd = when {
        normText[nextAfterA].code == 0x00B1 -> nextAfterA + 1
        normText.startsWith("+/-", nextAfterA) -> nextAfterA + 3
        else -> -1
    }
    if (opEnd == -1) return -1
    val bStart = skipSpaces(normText, opEnd)
    val bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStart, prep.isEnglish, false)
        ?: return -1
    val hasPct = ctx.seenPctBeforeCursor || ctx.sentenceHasPct
    val bSuf = scanSuffixUnitFast(normText, normLowerText, bNum.endNorm, hasPct, false)
    if (!isPlusMinusUnitCompatible(aSuf, bSuf)) return -1
    val unitMatch = resolveCombinedUnit(prep, aSuf ?: bSuf, aPrefix)
    val factorB = bSuf?.factor ?: unitMatch.factor
    val finalEnd = bSuf?.endNorm ?: bNum.endNorm
    if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) return -1
    val aScaled = scaleParsedNumber(aNum, unitMatch.factor)
    val bScaled = scaleParsedNumber(bNum, factorB)
    pushTupleFromSpan(
        ctx,
        prep.subText.substring(aNum.rawStartSub, aNum.rawEndSub),
        unitMatch,
        false,
        null,
        aScaled,
        aScaled - bScaled,
        aScaled + bScaled,
        aNum.sigDigits,
        exprStartBase,
        finalEnd,
    )
    return finalEnd
}

private fun tryRule7Range(
    ctx: ScanRuntimeCtx,
    aNum: ParsedNumber,
    aPrefix: UnitMatch?,
    aSuf: UnitMatch?,
    exprStartBase: Int,
    afterANumAndUnit: Int,
): Int {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    val n = ctx.n
    if (overlapsExcludedSpan(ctx.excludedNormSpans, afterANumAndUnit, afterANumAndUnit + 1)) return -1
    val bStart = matchStrictRangeHyphenOrTo(normText, normLowerText, afterANumAndUnit)
    if (bStart == -1) return -1
    val bNum = parseFiniteNumberAt(normText, prep.subText, prep.normMap, bStart, prep.isEnglish, true)
        ?: return -1
    val bSuf = scanSuffixUnitFast(
        normText,
        normLowerText,
        bNum.endNorm,
        ctx.seenPctBeforeCursor || ctx.sentenceHasPct || aSuf?.family == UnitFamily.PERCENT,
        bNum.isYearIntCandidate,
    )
    val finalEnd = bSuf?.endNorm ?: bNum.endNorm
    if (finalEnd < n &&
        normText[finalEnd].code == 45 &&
        finalEnd + 1 < n &&
        isAsciiDigitCode(normText[finalEnd + 1].code)
    ) {
        return -1
    }
    if (!isRangeUnitCompatible(aSuf, bSuf)) return -1
    if (overlapsExcludedSpan(ctx.excludedNormSpans, exprStartBase, finalEnd)) return -1
    val unitMatch = resolveCombinedUnit(prep, bSuf ?: aSuf, aPrefix)
    val factorA = aSuf?.factor ?: unitMatch.factor
    val factorB = bSuf?.factor ?: unitMatch.factor
    val valLo = scaleParsedNumber(aNum, factorA)
    val valHi = scaleParsedNumber(bNum, factorB)
    pushTupleFromSpan(
        ctx,
        prep.subText.substring(aNum.rawStartSub, bNum.rawEndSub),
        unitMatch,
        false,
        null,
        (valLo + valHi) / 2.0,
        valLo,
        valHi,
        maxOf(aNum.sigDigits, bNum.sigDigits),
        exprStartBase,
        finalEnd,
    )
    return finalEnd
}

private fun tryRule9WordNumber(ctx: ScanRuntimeCtx, i: Int): Int {
    val normText = ctx.normText
    val normLowerText = ctx.normLowerText
    val prep = ctx.prep
    val n = ctx.n
    val wn = parseWordNumberAt(normText, normLowerText, i) ?: return -1
    if (wn.value < 0L) return wn.endNorm
    val suf = scanSuffixUnitFast(
        normText,
        normLowerText,
        wn.endNorm,
        ctx.seenPctBeforeCursor || ctx.sentenceHasPct,
        false,
    )
    if (suf != null && suf.family != UnitFamily.UNKNOWN) {
        if (overlapsExcludedSpan(ctx.excludedNormSpans, i, suf.endNorm)) return -1
        val unitMatch = resolveCombinedUnit(prep, suf, null)
        val valNorm = scaleWordNumber(wn.value, unitMatch.factor)
        val rStart = if (i in prep.normMap.indices) prep.normMap[i] else 0
        val rEnd = if (wn.endNorm in prep.normMap.indices) prep.normMap[wn.endNorm] else prep.subText.length
        pushTupleFromSpan(
            ctx,
            prep.subText.substring(rStart, rEnd),
            unitMatch,
            false,
            null,
            valNorm,
            valNorm,
            valNorm,
            computeSigDigits(wn.value.toString()),
            i,
            suf.endNorm,
        )
        return suf.endNorm
    }

    val nextWordPos = skipSpaces(normText, wn.endNorm)
    var nextWordEnd = nextWordPos
    while (nextWordEnd < n && isBaseLetter(normLowerText[nextWordEnd].code)) {
        nextWordEnd++
    }
    if (nextWordEnd > nextWordPos && (nextWordEnd >= n || !isDigit(normLowerText[nextWordEnd].code))) {
        val nextWord = normLowerText.substring(nextWordPos, nextWordEnd)
        if (COUNT_NOUNS.contains(nextWord)) {
            if (overlapsExcludedSpan(ctx.excludedNormSpans, i, nextWordEnd)) return -1
            val rStart = if (i in prep.normMap.indices) prep.normMap[i] else 0
            val rEnd = if (wn.endNorm in prep.normMap.indices) prep.normMap[wn.endNorm] else prep.subText.length
            val wnDouble = wn.value.toDouble()
            pushTupleFromSpan(
                ctx,
                prep.subText.substring(rStart, rEnd),
                EMPTY_COMBINED_UNIT,
                false,
                null,
                wnDouble,
                wnDouble,
                wnDouble,
                computeSigDigits(wn.value.toString()),
                i,
                wn.endNorm,
            )
            return wn.endNorm
        }
    }
    return wn.endNorm
}

fun extractQuantitiesWithMeta(
    text: String,
    options: ExtractQuantitiesOptions? = null,
): QuantExtractionMeta {
    val prep = prepareInput(
        text,
        PrepareInputOptions(
            lang = options?.lang,
            format = options?.format,
            applyLatex = options?.applyLatex,
        ),
    )
    val normText = prep.normText
    val normLowerText = prep.normLowerText
    val n = normText.length

    val docId = options?.docId ?: ""
    val section = options?.section ?: "unlabeled"
    val source = options?.source ?: TupleSource.MANUSCRIPT
    val occurrenceIndex = options?.occurrenceIndex ?: 0
    val sentenceHash = options?.sentenceHash ?: sha256hex(normLowerText)

    val rawCitationSpans: List<TextRange> = if (options?.citationSpans != null) {
        options.citationSpans
    } else if (text.contains("[") || text.contains("(") || text.contains("\\")) {
        scanCitations(text).map { TextRange(it.start, it.end) }
    } else {
        emptyList()
    }
    val excludedNormSpans = mapExcludedSpansToNorm(prep, rawCitationSpans)
    val proseWords = buildProseWordSpans(normText, normLowerText, excludedNormSpans)
    val cleanedLower = proseWords.cleanedLower
    val wordSpans = proseWords.spans
    val hasLetterMask = proseWords.hasLetterMask
    val anyLetterInDoc = proseWords.anyLetterInDoc

    var tableWordSpans: List<WordSpan>? = null
    var tableLetterMask: ByteArray? = null
    var tableStemCache: Array<String?>? = null
    var tableWindowWords: List<String>? = null
    var tableHeaderLower = ""
    var tableCombinedLower = ""
    if (options?.tableHeader != null || options?.rowLabel != null) {
        val hdrLower = normLower(options.tableHeader ?: "")
        val rowLower = normLower(options.rowLabel ?: "")
        tableHeaderLower = hdrLower
        tableCombinedLower = if (hdrLower.isNotEmpty() && rowLower.isNotEmpty()) "$hdrLower $rowLower" else hdrLower + rowLower
        val tblSpans = extractWordSpans(tableCombinedLower)
        val (tblMask, _) = buildWordMask(tableCombinedLower, tblSpans)
        val filteredTbl = ArrayList<String>(tblSpans.size)
        for (t in tblSpans.indices) {
            if (tblMask[t].toInt() != 2) {
                filteredTbl.add(tblSpans[t].text)
            }
        }
        tableWordSpans = tblSpans
        tableLetterMask = tblMask
        tableStemCache = arrayOfNulls<String?>(tblSpans.size).apply { fill(UNSET_SENTINEL) }
        tableWindowWords = filteredTbl
    }

    val cues = detectDocMetricCues(
        cleanedLower, wordSpans, hasLetterMask, tableWindowWords, tableCombinedLower,
    )
    val sentenceHasPct = hasPercentageContext(cleanedLower, tableCombinedLower)

    var sentenceHasTo = false
    var sentenceHasAnd = false
    var sentenceHasCiWord = false
    for (w in wordSpans.indices) {
        if (hasLetterMask[w].toInt() != 1) continue
        val word = wordSpans[w].text
        if (word == "to") {
            sentenceHasTo = true
        } else if (word == "and") {
            sentenceHasAnd = true
        } else if (word == "ci") {
            sentenceHasCiWord = true
        }
        if (sentenceHasTo && sentenceHasAnd && sentenceHasCiWord) break
    }
    val sentenceHasRangeSep = sentenceHasTo ||
        normText.contains("-") ||
        normText.contains("\u2013") ||
        normText.contains(",")

    val ctx = ScanRuntimeCtx(
        prep = prep,
        normText = normText,
        normLowerText = normLowerText,
        cleanedLower = cleanedLower,
        n = n,
        tupleIdHasher = createSha256PrefixHasher("$docId|$sentenceHash|$occurrenceIndex|"),
        section = section,
        source = source,
        anyLetterInDoc = anyLetterInDoc,
        wordSpans = wordSpans,
        hasLetterMask = hasLetterMask,
        excludedNormSpans = excludedNormSpans,
        tableWordSpans = tableWordSpans,
        tableLetterMask = tableLetterMask,
        tableStemCache = tableStemCache,
        tableWindowWords = tableWindowWords,
        tableHeaderLower = tableHeaderLower,
        tableCombinedLower = tableCombinedLower,
        sentenceHasPct = sentenceHasPct,
        sentenceHasTo = sentenceHasTo,
        sentenceHasAnd = sentenceHasAnd,
        sentenceHasCiWord = sentenceHasCiWord,
        sentenceHasRangeSep = sentenceHasRangeSep,
        cues = cues,
        wordStemCache = arrayOfNulls<String?>(wordSpans.size).apply { fill(UNSET_SENTINEL) },
    )

    fun tryConsumeNumericExpr(numPos: Int, prePrefix: UnitMatch?): Int {
        val aNum = parseNumberOrScientificAt(
            normText, prep.subText, prep.normMap, numPos, prep.isEnglish,
            prePrefix == null, prePrefix != null,
        ) ?: return -1
        if (!aNum.value.isFinite()) {
            ctx.lastConsumedEndNorm = aNum.endNorm
            return aNum.endNorm
        }
        var aPrefix = prePrefix ?: scanPrefixUnit(normText, normLowerText, numPos, ctx.lastConsumedEndNorm)
        if (aPrefix != null && overlapsExcludedSpan(excludedNormSpans, aPrefix.startNorm, numPos)) {
            aPrefix = null
        }
        val aSuf = scanSuffixUnitFast(
            normText,
            normLowerText,
            aNum.endNorm,
            ctx.seenPctBeforeCursor || sentenceHasPct,
            aNum.isYearIntCandidate,
        )
        if (aSuf?.family == UnitFamily.PERCENT) {
            ctx.seenPctBeforeCursor = true
        }
        val afterANumAndUnit = aSuf?.endNorm ?: aNum.endNorm
        val exprStartBase = aPrefix?.startNorm ?: numPos
        val nextAfterA = skipSpaces(normText, afterANumAndUnit)
        val nextChAfterA = if (nextAfterA < n) normText[nextAfterA].code else 0

        if (nextChAfterA == 40 || nextChAfterA == 91 || nextChAfterA == 44) {
            val nextR2 = tryRule2Interval(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA, nextChAfterA)
            if (nextR2 != -1) return nextR2
        }
        if (nextChAfterA == 40) {
            val nextR2b = tryRule2bMeanSd(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA)
            if (nextR2b != -1) return nextR2b
        }
        if (nextChAfterA == 0x00B1 || nextChAfterA == 43) {
            val nextR3 = tryRule3PlusMinus(ctx, aNum, aPrefix, aSuf, exprStartBase, nextAfterA)
            if (nextR3 != -1) return nextR3
        }
        if (nextChAfterA == 45 || nextChAfterA == 0x2013 ||
            (nextAfterA > afterANumAndUnit && (nextChAfterA == 116 || nextChAfterA == 84))
        ) {
            val nextR7 = tryRule7Range(ctx, aNum, aPrefix, aSuf, exprStartBase, afterANumAndUnit)
            if (nextR7 != -1) return nextR7
        }

        val unitMatch = resolveCombinedUnit(prep, aSuf, aPrefix)
        if (!(aNum.isYearIntCandidate && unitMatch.unitFamily == UnitFamily.NONE) &&
            !overlapsExcludedSpan(excludedNormSpans, exprStartBase, afterANumAndUnit)
        ) {
            val valNorm = scaleParsedNumber(aNum, unitMatch.factor)
            pushTupleFromSpan(
                ctx,
                prep.subText.substring(aNum.rawStartSub, aNum.rawEndSub),
                unitMatch,
                false,
                null,
                valNorm,
                valNorm,
                valNorm,
                aNum.sigDigits,
                exprStartBase,
                afterANumAndUnit,
            )
        }
        return afterANumAndUnit
    }

    var exclIdx = 0
    var i = 0
    while (i < n) {
        while (exclIdx < excludedNormSpans.size && excludedNormSpans[exclIdx].end <= i) {
            exclIdx++
        }
        if (exclIdx < excludedNormSpans.size &&
            i >= excludedNormSpans[exclIdx].start &&
            i < excludedNormSpans[exclIdx].end
        ) {
            i = excludedNormSpans[exclIdx].end
            continue
        }

        val cu = normText[i].code
        if (cu == 32 || cu == 10 || cu == 44 || cu == 59 || cu == 58 ||
            cu == 40 || cu == 41 || cu == 91 || cu == 93
        ) {
            i++
            continue
        }
        if (cu == 0x27E6 && normText.startsWith(CITATION_PLACEHOLDER, i)) {
            i += CITATION_PLACEHOLDER.length
            continue
        }
        if (cu == 37 /* '%' */) {
            ctx.seenPctBeforeCursor = true
            i++
            continue
        }
        if (cu == 46 && (i + 1 >= n || !isAsciiDigitCode(normText[i + 1].code))) {
            while (i < n && normText[i].code == 46 && (i + 1 >= n || !isAsciiDigitCode(normText[i + 1].code))) {
                i++
            }
            continue
        }

        val lowerCu = normLowerText[i].code
        if (lowerCu == 112 /* 'p' */) {
            val pMatch = parseRule4PValueAt(normText, normLowerText, prep.subText, prep.normMap, i, prep.isEnglish)
            if (pMatch != null && !overlapsExcludedSpan(excludedNormSpans, pMatch.exprStartNorm, pMatch.exprEndNorm)) {
                val pVal = normalizeZero(pMatch.num.value)
                pushTupleFromSpan(
                    ctx,
                    prep.subText.substring(pMatch.num.rawStartSub, pMatch.num.rawEndSub),
                    EMPTY_COMBINED_UNIT,
                    true,
                    pMatch.comparator,
                    pVal,
                    pVal,
                    pVal,
                    pMatch.num.sigDigits,
                    pMatch.exprStartNorm,
                    pMatch.exprEndNorm,
                )
                i = pMatch.exprEndNorm
                continue
            }
        }

        if (sentenceHasTo && lowerCu == 102 /* 'f' */ && !isWordCharBefore(normText, i)) {
            val nextFrom = tryRule6FromTo(ctx, i)
            if (nextFrom != -1) {
                i = nextFrom
                continue
            }
        }

        if (sentenceHasAnd && lowerCu == 98 /* 'b' */ && !isWordCharBefore(normText, i)) {
            val nextBet = tryRule7Between(ctx, i)
            if (nextBet != -1) {
                i = nextBet
                continue
            }
        }

        if (sentenceHasPct &&
            sentenceHasCiWord &&
            sentenceHasRangeSep &&
            isAsciiDigitCode(cu) &&
            !isWordCharBefore(normText, i)
        ) {
            val nextCi = tryStandaloneCi(ctx, i)
            if (nextCi != -1) {
                i = nextCi
                continue
            }
        }

        if (isAsciiDigitCode(cu)) {
            val dateEnd = matchDateEndAt(normText, i)
            if (dateEnd != -1) {
                i = dateEnd
                continue
            }
        }

        if (isAsciiDigitCode(cu) || cu == 45 || cu == 43 || cu == 46) {
            val nextNum = tryConsumeNumericExpr(i, null)
            if (nextNum != -1) {
                i = nextNum
                continue
            }
        }

        val firstCp = if (cu < 0x80) cu else codePointAtSafe(normText, i).cp
        if (isBaseLetter(firstCp)) {
            val nextR9 = tryRule9WordNumber(ctx, i)
            if (nextR9 != -1) {
                i = nextR9
                continue
            }
            val leadCur = scanLeadingPrefixCurrency(normText, normLowerText, i)
            if (leadCur != null && leadCur.endNorm < n && isAsciiDigitCode(normText[leadCur.endNorm].code)) {
                val nextCurNum = tryConsumeNumericExpr(leadCur.endNorm, leadCur)
                if (nextCurNum != -1) {
                    i = nextCurNum
                    continue
                }
            }
            while (i < n) {
                val u = codePointAtSafe(normText, i)
                if (isBaseLetter(u.cp) || isDigit(u.cp)) {
                    i += u.len
                } else {
                    break
                }
            }
            continue
        }

        if (isAsciiDigitCode(cu)) {
            while (i < n) {
                val chRun = normText[i].code
                if (isAsciiDigitCode(chRun) || chRun == 46) {
                    i++
                } else {
                    break
                }
            }
            continue
        }

        val stepLen = if (cu < 0x80) 1 else codePointAtSafe(normText, i).len
        i += stepLen
    }

    return QuantExtractionMeta(ctx.tuples, ctx.metricFromUnitList)
}

fun extractQuantities(
    text: String,
    options: ExtractQuantitiesOptions? = null,
): List<QuantTuple> = extractQuantitiesWithMeta(text, options).tuples
