package app.toulmin.core

enum class MarkerKind(val wireName: String) {
    EXPLICIT("EXPLICIT"),
    HEURISTIC("HEURISTIC"),
}

enum class BibStatus(val wireName: String) {
    PENDING("PENDING"),
    RESOLVED("RESOLVED"),
    DOI_NOT_FOUND("DOI_NOT_FOUND"),
    NOT_INDEXED("NOT_INDEXED"),
    AMBIGUOUS("AMBIGUOUS"),
    METADATA_MISMATCH("METADATA_MISMATCH"),
    UNRESOLVED_KEY("UNRESOLVED_KEY"),
    UPSTREAM_UNAVAILABLE("UPSTREAM_UNAVAILABLE"),
    RATE_LIMITED("RATE_LIMITED"),
}

enum class CitationRuleKind(val wireName: String) {
    LATEX_CITE("latex_cite"),
    PANDOC_BRACKET("pandoc_bracket"),
    NUMERIC_BRACKET("numeric_bracket"),
    PANDOC_NARRATIVE("pandoc_narrative"),
    AUTHOR_YEAR_PAREN("author_year_paren"),
    AUTHOR_YEAR_NARRATIVE("author_year_narrative"),
    DOCX_FIELD("docx_field"),
    DOCX_SUPERSCRIPT("docx_superscript"),
}

val MULTICITE_COMMANDS: Set<String> = setOf(
    "cites", "parencites", "textcites", "autocites", "footcites",
)

val INTERVAL_CONTEXT_WORDS: Set<String> = setOf(
    "ci", "iqr", "sd", "se", "sem", "range", "interval", "ranges", "intervals", "cri", "hdi",
)

val NON_NAME_WORDS: Set<String> = setOf(
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    "spring", "summer", "autumn", "fall", "winter",
    "table", "tables", "figure", "figures", "fig",
    "section", "chapter", "appendix", "supplement", "eq", "equation",
    "version", "release", "update", "phase", "wave",
    "cohort", "trial", "study", "survey", "census", "report",
    "year", "fy", "q1", "q2", "q3", "q4",
)

val SURNAME_PARTICLES: List<String> = listOf(
    "van der ", "de la ", "van ", "von ", "de ", "del ", "di ", "da ", "le ", "la ", "du ",
)

val AUTHOR_YEAR_PREFIXES: List<String> = listOf(
    "see also ", "see ", "e.g., ", "e.g. ", "cf. ",
)

val FIRST_CITATION_ORDER_STYLES: List<String> = listOf(
    "unsrt", "ieee", "vancouver", "nature", "ama",
)

private const val MAX_KEYS_PER_MARKER = 64
private const val MAX_MULTICITE_GROUPS = 16
private const val MAX_PANDOC_AFFIX_LEN = 100
private const val MAX_BRACKET_LEN = 2_000
private const val MAX_CITE_OPT_LEN = 200
private const val MAX_CITE_KEY_GROUP_LEN = 2_000
private const val MAX_NUMERIC_RANGE_SPAN = 30
private const val MAX_PAREN_LEN = 300
private const val MAX_SURNAME_LEN = 40
private const val MAX_NARRATIVE_LOOKBACK = 60

data class WordSpan(
    override val start: Int,
    override val end: Int,
    val text: String,
) : TextRangeLike

data class AuthorYearQuery(
    val surname: String,
    val surnameFolded: String,
    val year: String,
    val extraYears: List<String>,
    val isOrgAcronym: Boolean,
    val locator: String?,
)

data class CitationMarker(
    override val start: Int,
    override val end: Int,
    val rawText: String,
    val rule: CitationRuleKind,
    val kind: MarkerKind,
    val narrative: Boolean,
    val keys: List<String>,
    val numericIds: List<Int>,
    val authorYears: List<AuthorYearQuery>,
    val authoritativeRefIds: List<String>? = null,
) : TextRangeLike

data class AuthoritativeDocxMarker(
    override val start: Int,
    override val end: Int,
    val kind: CitationRuleKind, // DOCX_FIELD or DOCX_SUPERSCRIPT
    val keys: List<String>? = null,
    val numericIds: List<Int>? = null,
    val refIds: List<String>? = null,
) : TextRangeLike

data class ScanCitationsOptions(
    val customCiteMacros: Set<String>? = null,
    val hasKnownNumberingOrder: Boolean? = null,
    val numberedBibSize: Int? = null,
    val bibKeys: Set<String>? = null,
    val docxMarkers: List<AuthoritativeDocxMarker>? = null,
)

data class BibliographyEntry(
    val refId: String,
    val key: String,
    val orderIndex: Int? = null,
    val firstAuthorFamily: String? = null,
    val corporateAuthor: String? = null,
    val shortauthor: String? = null,
    val shorthand: String? = null,
    val year: String? = null,
)

data class MarkdownNumberedRef(
    val index: Int,
    val text: String,
    val lineStart: Int,
)

enum class MarkerResolutionStatus(val wireName: String) {
    RESOLVED("RESOLVED"),
    UNRESOLVED_KEY("UNRESOLVED_KEY"),
    AMBIGUOUS("AMBIGUOUS"),
    POSSIBLE_CITATION("POSSIBLE_CITATION"),
}

data class ResolvedCitationMarker(
    val marker: CitationMarker,
    val status: MarkerResolutionStatus,
    val refIds: List<String>,
    val unresolvedKeys: List<String>,
    val ambiguousCandidates: List<String>,
)

data class BibItemRef(
    val key: String,
    val label: String?,
)

data class ResolveCitationsOptions(
    val entries: List<BibliographyEntry>? = null,
    val bibItems: List<BibItemRef>? = null,
    val docxNumberedRefs: List<String>? = null,
    val markdownNumberedRefs: List<MarkdownNumberedRef>? = null,
    val bibStyle: String? = null,
    val report: ImportQualityReport? = null,
)

data class PossibleCitationRecord(
    val range: TextRange,
    val text: String,
)

data class CitationResolutionResult(
    val resolvedMarkers: List<ResolvedCitationMarker>,
    val resolvedRefIds: List<String>,
    val unresolvedKeys: List<String>,
    val possibleCitations: List<PossibleCitationRecord>,
    val ambiguousMarkers: List<ResolvedCitationMarker>,
    val report: ImportQualityReport,
)

private fun splitByChar(s: String, delim: Char): List<String> {
    val out = mutableListOf<String>()
    var start = 0
    while (true) {
        val idx = s.indexOf(delim, start)
        if (idx == -1) {
            out.add(s.substring(start))
            break
        }
        out.add(s.substring(start, idx))
        start = idx + 1
    }
    return out
}

private fun isMaskChar(cp: Int): Boolean = cp == 0xE000

private fun isSentenceStopChar(cp: Int): Boolean =
    cp == 0x2E || cp == 0x3F || cp == 0x21 || cp == 0x3B || cp == 0x0A || cp == 0x0D

private fun containsAsciiSubstrCaseInsensitive(haystack: String, needleLower: String): Boolean {
    val n = haystack.length
    val m = needleLower.length
    if (m == 0) return true
    if (n < m) return false
    for (i in 0..(n - m)) {
        var ok = true
        for (j in 0 until m) {
            var c = haystack[i + j].code
            if (c in 65..90) c += 32
            if (c != needleLower[j].code) {
                ok = false
                break
            }
        }
        if (ok) return true
    }
    return false
}

private fun trimSpaceLocal(input: String): String {
    var left = 0
    val n = input.length
    while (left < n && isSpace(input[left].code)) left++
    var right = n
    while (right > left && isSpace(input[right - 1].code)) right--
    return input.substring(left, right)
}

private fun advanceExclusionIndex(
    excluded: List<TextRangeLike>?,
    exIdx: Int,
    pos: Int,
): Int {
    if (excluded == null) return 0
    var idx = exIdx
    while (idx < excluded.size && pos >= excluded[idx].end) {
        idx++
    }
    return idx
}

private fun isInsideExclusion(
    excluded: List<TextRangeLike>?,
    exIdx: Int,
    pos: Int,
): TextRangeLike? {
    if (excluded == null || exIdx >= excluded.size) return null
    val r = excluded[exIdx]
    return if (pos >= r.start && pos < r.end) r else null
}

private inline fun forEachWordSpan(
    text: String,
    start: Int,
    end: Int,
    excludedSpans: List<TextRangeLike>?,
    onWord: (wordStart: Int, wordEnd: Int, letterCount: Int) -> Unit,
) {
    val limit = minOf(end, text.length)
    var i = maxOf(0, start)
    var exIdx = advanceExclusionIndex(excludedSpans, 0, i)

    while (i < limit) {
        exIdx = advanceExclusionIndex(excludedSpans, exIdx, i)
        val activeEx = isInsideExclusion(excludedSpans, exIdx, i)
        if (activeEx != null) {
            i = minOf(limit, activeEx.end)
            continue
        }

        val cu = text[i].code
        if (isMaskChar(cu)) {
            i++
            continue
        }

        val wordStart: Int
        var cur: Int
        var prevIsLetter: Boolean
        var letterCount: Int

        if (cu < 0x80) {
            val firstIsAsciiLetter = (cu in 65..90) || (cu in 97..122)
            val firstIsAsciiDigit = cu in 48..57
            if (!firstIsAsciiLetter && !firstIsAsciiDigit) {
                i++
                continue
            }
            wordStart = i
            cur = i + 1
            prevIsLetter = firstIsAsciiLetter
            letterCount = if (firstIsAsciiLetter) 1 else 0
        } else {
            val unit = codePointAtSafe(text, i)
            val firstIsLetter = !unit.isUnpairedSurrogate && isLetter(unit.cp, false)
            if (unit.isUnpairedSurrogate || !(firstIsLetter || isDigit(unit.cp))) {
                i += unit.len
                continue
            }
            wordStart = i
            cur = i + unit.len
            prevIsLetter = firstIsLetter
            letterCount = if (firstIsLetter) 1 else 0
        }

        while (cur < limit) {
            exIdx = advanceExclusionIndex(excludedSpans, exIdx, cur)
            if (isInsideExclusion(excludedSpans, exIdx, cur) != null) break
            val nextCu = text[cur].code
            if (isMaskChar(nextCu)) break
            if (nextCu < 0x80) {
                val nextIsAsciiLetter = (nextCu in 65..90) || (nextCu in 97..122)
                val nextIsAsciiDigit = nextCu in 48..57
                if (nextIsAsciiLetter || nextIsAsciiDigit) {
                    if (nextIsAsciiLetter) letterCount++
                    prevIsLetter = nextIsAsciiLetter
                    cur++
                    continue
                }
                if ((nextCu == 0x27 || nextCu == 0x2D) && cur + 1 < limit) {
                    val peekExIdx = advanceExclusionIndex(excludedSpans, exIdx, cur + 1)
                    if (isInsideExclusion(excludedSpans, peekExIdx, cur + 1) == null) {
                        val afterCu = text[cur + 1].code
                        if (!isMaskChar(afterCu)) {
                            if (afterCu < 0x80) {
                                val afterIsAsciiLetter = (afterCu in 65..90) || (afterCu in 97..122)
                                val afterIsAsciiDigit = afterCu in 48..57
                                if (afterIsAsciiLetter || afterIsAsciiDigit) {
                                    if (afterIsAsciiLetter) letterCount++
                                    prevIsLetter = afterIsAsciiLetter
                                    cur += 2
                                    continue
                                }
                            } else {
                                val after = codePointAtSafe(text, cur + 1)
                                if (!after.isUnpairedSurrogate) {
                                    val afterIsLetter = isLetter(after.cp, false)
                                    if (afterIsLetter || isDigit(after.cp)) {
                                        if (afterIsLetter) letterCount++
                                        prevIsLetter = afterIsLetter
                                        cur += 1 + after.len
                                        continue
                                    }
                                }
                            }
                        }
                    }
                }
                break
            }

            val nextUnit = codePointAtSafe(text, cur)
            if (nextUnit.isUnpairedSurrogate) break
            val nextIsLetter = isLetter(nextUnit.cp, prevIsLetter)
            if (nextIsLetter || isDigit(nextUnit.cp)) {
                if (nextIsLetter) letterCount++
                prevIsLetter = nextIsLetter
                cur += nextUnit.len
                continue
            }
            break
        }

        onWord(wordStart, cur, letterCount)
        i = cur
    }
}

fun extractWordSpans(
    text: String,
    start: Int = 0,
    end: Int = text.length,
    excludedSpans: List<TextRangeLike>? = null,
): List<WordSpan> {
    val words = mutableListOf<WordSpan>()
    forEachWordSpan(text, start, end, excludedSpans) { wordStart, wordEnd, _ ->
        words.add(WordSpan(wordStart, wordEnd, text.substring(wordStart, wordEnd)))
    }
    return words
}

data class WordSpanStats(
    val wordCount: Int,
    val hasLongWord: Boolean,
)

fun getWordSpanStats(
    text: String,
    start: Int = 0,
    end: Int = text.length,
    excludedSpans: List<TextRangeLike>? = null,
): WordSpanStats {
    var wordCount = 0
    var hasLongWord = false
    forEachWordSpan(text, start, end, excludedSpans) { _, _, letterCount ->
        wordCount++
        if (letterCount >= 3) hasLongWord = true
    }
    return WordSpanStats(wordCount, hasLongWord)
}

fun countWords(
    text: String,
    start: Int = 0,
    end: Int = text.length,
    excludedSpans: List<TextRangeLike>? = null,
): Int {
    var wordCount = 0
    forEachWordSpan(text, start, end, excludedSpans) { _, _, _ ->
        wordCount++
    }
    return wordCount
}

private class BackwardDelims(
    val nextCloseBracket: IntArray,
    val nextOpenBracket: IntArray,
    val nextCloseParen: IntArray,
    val nextOpenParen: IntArray,
    val nextCloseBrace: IntArray,
    val nextOpenBrace: IntArray,
    val nextMask: IntArray,
)

private fun buildBackwardDelims(text: String): BackwardDelims {
    val n = text.length
    val nextCloseBracket = IntArray(n + 1)
    val nextOpenBracket = IntArray(n + 1)
    val nextCloseParen = IntArray(n + 1)
    val nextOpenParen = IntArray(n + 1)
    val nextCloseBrace = IntArray(n + 1)
    val nextOpenBrace = IntArray(n + 1)
    val nextMask = IntArray(n + 1)

    var cBracket = n
    var oBracket = n
    var cParen = n
    var oParen = n
    var cBrace = n
    var oBrace = n
    var mPos = n

    nextCloseBracket[n] = n
    nextOpenBracket[n] = n
    nextCloseParen[n] = n
    nextOpenParen[n] = n
    nextCloseBrace[n] = n
    nextOpenBrace[n] = n
    nextMask[n] = n

    for (i in n - 1 downTo 0) {
        when (text[i].code) {
            93 -> cBracket = i
            91 -> oBracket = i
            41 -> cParen = i
            40 -> oParen = i
            125 -> cBrace = i
            123 -> oBrace = i
            0xE000 -> mPos = i
        }
        nextCloseBracket[i] = cBracket
        nextOpenBracket[i] = oBracket
        nextCloseParen[i] = cParen
        nextOpenParen[i] = oParen
        nextCloseBrace[i] = cBrace
        nextOpenBrace[i] = oBrace
        nextMask[i] = mPos
    }

    return BackwardDelims(
        nextCloseBracket,
        nextOpenBracket,
        nextCloseParen,
        nextOpenParen,
        nextCloseBrace,
        nextOpenBrace,
        nextMask,
    )
}

private fun isAllKeyChars(key: String): Boolean {
    if (key.isEmpty()) return false
    var i = 0
    while (i < key.length) {
        val unit = codePointAtSafe(key, i)
        if (unit.isUnpairedSurrogate || !isKeyChar(unit.cp)) return false
        i += unit.len
    }
    return true
}

private fun isWordBoundaryBefore(text: String, pos: Int): Boolean {
    if (pos <= 0) return true
    val cu = text[pos - 1].code
    if (isMaskChar(cu) || isDigit(cu)) return false
    var prevStart = pos - 1
    if (cu in 0xDC00..0xDFFF && prevStart > 0) {
        val high = text[prevStart - 1].code
        if (high in 0xD800..0xDBFF) prevStart--
    }
    return !isLetterAt(text, prevStart)
}

private fun stripParticlesLower(loweredSurname: String): String {
    for (particle in SURNAME_PARTICLES) {
        if (loweredSurname.startsWith(particle)) {
            return loweredSurname.substring(particle.length)
        }
    }
    return loweredSurname
}

private fun parseLatexCiteCandidate(
    text: String,
    p: Int,
    delims: BackwardDelims,
    stopLimit: Int,
    customCiteMacros: Set<String>?,
): CitationMarker? {
    val n = stopLimit
    if (p + 1 >= n || !isAsciiLetter(text[p + 1].code)) return null
    var cmdEnd = p + 2
    while (cmdEnd < n && isAsciiLetter(text[cmdEnd].code)) cmdEnd++
    val cmd = text.substring(p + 1, cmdEnd)
    val isCustomCite = customCiteMacros != null &&
        containsAsciiSubstrCaseInsensitive(cmd, "cite") &&
        cmd in customCiteMacros
    if (cmd !in CITE_COMMANDS && !isCustomCite) return null

    var cur = cmdEnd
    if (cur < n && text[cur].code == 42) cur++

    val isMulti = cmd in MULTICITE_COMMANDS
    val maxGroups = if (isMulti) MAX_MULTICITE_GROUPS else 1
    val keys = mutableListOf<String>()
    var acceptedEnd = -1

    fun buildLatexMarker(): CitationMarker? {
        if (acceptedEnd == -1 || keys.isEmpty()) return null
        return CitationMarker(
            start = p,
            end = acceptedEnd,
            rawText = text.substring(p, acceptedEnd),
            rule = CitationRuleKind.LATEX_CITE,
            kind = MarkerKind.EXPLICIT,
            narrative = cmd in NARRATIVE_CITE_COMMANDS,
            keys = keys,
            numericIds = emptyList(),
            authorYears = emptyList(),
        )
    }

    for (g in 0 until maxGroups) {
        var scanPos = cur
        for (opt in 0 until 2) {
            val adjOpt = skipAdjacentWhitespace(text, scanPos, n)
            if (adjOpt.crossedBlankLine || adjOpt.pos >= n || text[adjOpt.pos].code != 91) break
            val openBrk = adjOpt.pos
            val closeBrk = delims.nextCloseBracket[openBrk + 1]
            val nextOpenBrk = delims.nextOpenBracket[openBrk + 1]
            val nextMaskPos = delims.nextMask[openBrk + 1]
            if (closeBrk >= n ||
                closeBrk >= nextMaskPos ||
                nextOpenBrk < closeBrk ||
                closeBrk - openBrk > MAX_CITE_OPT_LEN
            ) {
                return if (g == 0) null else buildLatexMarker()
            }
            scanPos = closeBrk + 1
        }

        val adjBrace = skipAdjacentWhitespace(text, scanPos, n)
        if (adjBrace.crossedBlankLine || adjBrace.pos >= n || text[adjBrace.pos].code != 123) {
            if (g == 0) return null
            break
        }
        val openBrace = adjBrace.pos
        val closeBrace = delims.nextCloseBrace[openBrace + 1]
        val nextOpenBrace = delims.nextOpenBrace[openBrace + 1]
        val nextMaskPos = delims.nextMask[openBrace + 1]
        if (closeBrace >= n ||
            closeBrace >= nextMaskPos ||
            nextOpenBrace < closeBrace ||
            closeBrace - openBrace > MAX_CITE_KEY_GROUP_LEN
        ) {
            if (g == 0) return null
            break
        }

        val inner = text.substring(openBrace + 1, closeBrace)
        val rawParts = splitByChar(inner, ',')
        for (part in rawParts) {
            val k = trimSpaceLocal(part)
            if (!isAllKeyChars(k) || keys.size >= MAX_KEYS_PER_MARKER) return null
            keys.add(k)
        }

        acceptedEnd = closeBrace + 1
        cur = acceptedEnd
    }

    return buildLatexMarker()
}

private fun tryParsePandocBracket(
    text: String,
    p: Int,
    q: Int,
): CitationMarker? {
    val inner = text.substring(p + 1, q)
    if (inner.indexOf('@') == -1) return null
    val items = splitByChar(inner, ';')
    if (items.isEmpty() || items.size > MAX_KEYS_PER_MARKER) return null

    val keys = mutableListOf<String>()
    for (item in items) {
        var atIdx = -1
        for (k in item.indices) {
            if (item[k].code == 64) {
                if (atIdx != -1) return null
                atIdx = k
            }
        }
        if (atIdx == -1) return null

        var prefixEnd = atIdx
        if (atIdx > 0 && item[atIdx - 1].code == 45) {
            if (atIdx - 1 == 0 || isSpace(item[atIdx - 2].code) || item[atIdx - 2].code == 44) {
                prefixEnd = atIdx - 1
            }
        }
        if (prefixEnd > 0) {
            val chBefore = item[prefixEnd - 1].code
            if (chBefore == 46 || isDigit(chBefore) || isLetterAt(item, prefixEnd - 1)) {
                return null
            }
        }

        var keyEnd = atIdx + 1
        while (keyEnd < item.length) {
            val unit = codePointAtSafe(item, keyEnd)
            if (unit.isUnpairedSurrogate || !isKeyChar(unit.cp)) break
            keyEnd += unit.len
        }
        if (keyEnd == atIdx + 1) return null

        val key = item.substring(atIdx + 1, keyEnd)
        val affixLen = prefixEnd + (item.length - keyEnd)
        if (affixLen > MAX_PANDOC_AFFIX_LEN) return null
        keys.add(key)
    }

    return CitationMarker(
        start = p,
        end = q + 1,
        rawText = text.substring(p, q + 1),
        rule = CitationRuleKind.PANDOC_BRACKET,
        kind = MarkerKind.EXPLICIT,
        narrative = false,
        keys = keys,
        numericIds = emptyList(),
        authorYears = emptyList(),
    )
}

private fun isBareNumberToken(token: String): Boolean {
    if (token.isEmpty()) return false
    var start = 0
    if (token[start].code == 40) start++
    if (start >= token.length) return false
    var hasSign = false
    val signCh = token[start].code
    if (signCh == 45 || signCh == 43 || signCh == 0x2212) {
        hasSign = true
        start++
    }
    if (start >= token.length) return false
    var sawSep = false
    val bodyLen = token.length - start
    for (i in start until token.length) {
        val ch = token[i].code
        if (isDigit(ch)) continue
        if ((ch == 46 || ch == 44) && !sawSep && i > start && i + 1 < token.length) {
            sawSep = true
            continue
        }
        return false
    }
    if (!sawSep && !hasSign && bodyLen == 4) {
        val yr = token.substring(start).toInt()
        if (yr in 1900..2099) return false
    }
    return true
}

private fun parseAsciiInt1to4(s: String): Int? {
    if (s.length !in 1..4) return null
    for (i in s.indices) {
        if (!isDigit(s[i].code)) return null
    }
    return s.toInt()
}

private class NumericLookbackState(
    var cursor: Int = 0,
    var w1: String? = null,
    var w2: String? = null,
    var tokStart: Int = 0,
    var tokEnd: Int = 0,
    var inTok: Boolean = false,
)

private fun advanceNumericLookback(
    text: String,
    state: NumericLookbackState,
    lastMarkerEnd: Int,
    p: Int,
) {
    if (lastMarkerEnd > state.cursor) {
        state.cursor = lastMarkerEnd
        state.w1 = null
        state.w2 = null
        state.tokStart = lastMarkerEnd
        state.tokEnd = lastMarkerEnd
        state.inTok = false
    }

    var segStart = state.cursor
    for (k in p - 1 downTo state.cursor) {
        val cp = text[k].code
        val isDecimalDot = cp == 46 && k + 1 < p && isDigit(text[k + 1].code)
        if (isMaskChar(cp) || (isSentenceStopChar(cp) && !isDecimalDot)) {
            segStart = k + 1
            state.w1 = null
            state.w2 = null
            state.tokStart = segStart
            state.tokEnd = segStart
            state.inTok = false
            break
        }
    }

    fun isPureDigitsSpan(s: Int, e: Int): Boolean {
        if (s < 0 || e <= s) return false
        for (idx in s until e) {
            if (!isDigit(text[idx].code)) return false
        }
        return true
    }

    var aStart = -1
    var aEnd = -1
    var bStart = -1
    var bEnd = -1
    var bMergedDecimal = false
    forEachWordSpan(text, segStart, p, null) { ws, we, _ ->
        if (bStart != -1 &&
            !bMergedDecimal &&
            ws == bEnd + 1 &&
            text[bEnd].code == 46 &&
            isPureDigitsSpan(bStart, bEnd) &&
            isPureDigitsSpan(ws, we)
        ) {
            bEnd = we
            bMergedDecimal = true
        } else {
            aStart = bStart
            aEnd = bEnd
            bStart = ws
            bEnd = we
            bMergedDecimal = false
        }
    }
    if (aStart != -1) {
        state.w2 = text.substring(aStart, aEnd)
        state.w1 = text.substring(bStart, bEnd)
    } else if (bStart != -1) {
        state.w2 = state.w1
        state.w1 = text.substring(bStart, bEnd)
    }

    for (i in segStart until p) {
        if (isSpace(text[i].code)) {
            state.inTok = false
        } else {
            if (!state.inTok) {
                state.tokStart = i
                state.inTok = true
            }
            state.tokEnd = i + 1
        }
    }

    state.cursor = p
}

private fun tryParseNumericBracket(
    text: String,
    p: Int,
    q: Int,
    lastMarkerEnd: Int,
    numericLookback: NumericLookbackState,
    options: ScanCitationsOptions?,
): CitationMarker? {
    val inner = text.substring(p + 1, q)
    if (inner.indexOf('.') != -1) return null

    val segments = splitByChar(inner, ',')
    if (segments.isEmpty()) return null

    val expanded = mutableListOf<Int>()
    var singleRangeLo = -1
    var singleRangeHi = -1
    var singlePairCount = 0

    for (rawSeg in segments) {
        val seg = trimSpaceLocal(rawSeg)
        if (seg.isEmpty()) return null

        var dashIdx = -1
        for (k in seg.indices) {
            val ch = seg[k].code
            if (ch == 45 || ch == 0x2013) {
                if (dashIdx != -1) return null
                dashIdx = k
            }
        }

        if (dashIdx == -1) {
            val value = parseAsciiInt1to4(seg) ?: return null
            if (value < 1) return null
            expanded.add(value)
            singlePairCount++
        } else {
            val leftStr = trimSpaceLocal(seg.substring(0, dashIdx))
            val rightStr = trimSpaceLocal(seg.substring(dashIdx + 1))
            val a = parseAsciiInt1to4(leftStr) ?: return null
            val b = parseAsciiInt1to4(rightStr) ?: return null
            if (a < 1 || b < a || b - a > MAX_NUMERIC_RANGE_SPAN) return null
            if (segments.size == 1) {
                singleRangeLo = a
                singleRangeHi = b
            }
            for (v in a..b) expanded.add(v)
        }
    }

    if (expanded.isEmpty()) return null

    val bibSize = options?.numberedBibSize
    if (bibSize != null) {
        for (v in expanded) {
            if (v > bibSize) return null
        }
    }

    advanceNumericLookback(text, numericLookback, lastMarkerEnd, p)
    if (numericLookback.tokEnd > numericLookback.tokStart &&
        text[numericLookback.tokEnd - 1].code == 0x00B1
    ) {
        return null
    }

    val w1 = numericLookback.w1
    if (w1 != null && normLower(w1) in INTERVAL_CONTEXT_WORDS) return null
    val w2 = numericLookback.w2
    if (w2 != null && normLower(w2) in INTERVAL_CONTEXT_WORDS) return null

    val isExactTwoNumberInterval =
        (segments.size == 2 && singlePairCount == 2 && expanded.size == 2 && expanded[0] < expanded[1]) ||
            (segments.size == 1 && singleRangeLo != -1 && singleRangeLo < singleRangeHi)

    val lastTok = if (isExactTwoNumberInterval) {
        text.substring(numericLookback.tokStart, numericLookback.tokEnd)
    } else {
        ""
    }
    if (isExactTwoNumberInterval && isBareNumberToken(lastTok)) {
        var after = q + 1
        while (after < text.length && isSpace(text[after].code)) after++
        if (after < text.length) {
            val nextCh = text[after].code
            if (!isMaskChar(nextCh) &&
                (isLetterAt(text, after) ||
                    nextCh == 37 ||
                    nextCh == 0x00B0 ||
                    nextCh == 0x03BC ||
                    nextCh == 0x00B5)
            ) {
                return null
            }
        }
    }

    val kind = if (options?.hasKnownNumberingOrder == true) MarkerKind.EXPLICIT else MarkerKind.HEURISTIC
    return CitationMarker(
        start = p,
        end = q + 1,
        rawText = text.substring(p, q + 1),
        rule = CitationRuleKind.NUMERIC_BRACKET,
        kind = kind,
        narrative = false,
        keys = emptyList(),
        numericIds = expanded,
        authorYears = emptyList(),
    )
}

private data class ParsedSurname(
    val surname: String,
    val endPos: Int,
    val isOrgAcronym: Boolean,
)

private fun parseSurnameAt(text: String, start: Int, limit: Int): ParsedSurname? {
    var cur = start
    val lowerSlice = normLower(text.substring(start, minOf(limit, start + 12)))
    for (particle in SURNAME_PARTICLES) {
        if (lowerSlice.startsWith(particle)) {
            cur += particle.length
            break
        }
    }

    if (cur >= limit) return null
    val firstUnit = codePointAtSafe(text, cur)
    if (firstUnit.isUnpairedSurrogate || !isUpper(firstUnit.cp)) return null

    var endPos = cur + firstUnit.len
    var coreCpCount = 1
    var allCoreUpper = true
    var prevIsLetter = true

    while (endPos < limit && endPos - start < MAX_SURNAME_LEN) {
        val unit = codePointAtSafe(text, endPos)
        if (unit.isUnpairedSurrogate) break
        if (isLetter(unit.cp, prevIsLetter)) {
            prevIsLetter = true
            if (!isCombiningMark(unit.cp)) {
                coreCpCount++
                if (!isUpper(unit.cp)) allCoreUpper = false
            }
            endPos += unit.len
            continue
        }
        if (unit.cp == 0x27 || unit.cp == 0x2D) {
            if (endPos + 1 < limit) {
                val after = codePointAtSafe(text, endPos + 1)
                if (!after.isUnpairedSurrogate && isLetter(after.cp, false)) {
                    allCoreUpper = false
                    prevIsLetter = true
                    coreCpCount += 2
                    endPos += 1 + after.len
                    continue
                }
            }
        }
        break
    }

    if (endPos - start > MAX_SURNAME_LEN || coreCpCount < 2) return null
    val isOrgAcronym = cur == start && allCoreUpper
    if (allCoreUpper && (cur != start || coreCpCount > 6)) return null

    val fullSurname = text.substring(start, endPos)
    val fullLower = normLower(fullSurname)
    val coreLower = normLower(text.substring(cur, endPos))
    if (fullLower in NON_NAME_WORDS || coreLower in NON_NAME_WORDS) return null

    return ParsedSurname(fullSurname, endPos, isOrgAcronym)
}

private data class ParsedYearAndLocator(
    val year: String,
    val extraYears: List<String>,
    val locator: String?,
    val endPos: Int,
)

private val LOCATOR_PREFIXES: List<String> = listOf(", pp. ", ", p. ", ", ch. ", ", fig. ")

private fun parseYearAndLocatorAt(text: String, start: Int, limit: Int): ParsedYearAndLocator? {
    if (start + 4 > limit) return null
    val prefix = text.substring(start, start + 2)
    if (prefix != "19" && prefix != "20") return null
    if (!isDigit(text[start + 2].code) || !isDigit(text[start + 3].code)) return null

    var cur = start + 4
    var baseYear = text.substring(start, cur)
    val extraYears = mutableListOf<String>()

    if (cur < limit) {
        val u = codePointAtSafe(text, cur)
        if (!u.isUnpairedSurrogate && u.cp in 97..122) {
            val nextAfterLetter = if (cur + 1 < limit) text[cur + 1].code else -1
            val isAlphaContinuation = cur + 1 < limit && isLetterAt(text, cur + 1)
            if (isAlphaContinuation) return null
            baseYear += text[cur]
            cur++
            if (nextAfterLetter == 44) {
                var listCur = cur
                while (listCur + 1 < limit &&
                    text[listCur].code == 44 &&
                    text[listCur + 1].code in 97..122 &&
                    (listCur + 2 >= limit ||
                        text[listCur + 2].code == 44 ||
                        isSpace(text[listCur + 2].code))
                ) {
                    extraYears.add(text.substring(start, start + 4) + text[listCur + 1])
                    listCur += 2
                }
                cur = listCur
            }
        } else if (!u.isUnpairedSurrogate && (isLetter(u.cp, false) || isDigit(u.cp))) {
            return null
        }
    }

    var locator: String? = null
    if (cur < limit) {
        val rest = text.substring(cur, limit)
        var matchedPrefix: String? = null
        for (lp in LOCATOR_PREFIXES) {
            if (rest.startsWith(lp)) {
                matchedPrefix = lp
                break
            }
        }
        if (matchedPrefix == null) return null
        var numPos = cur + matchedPrefix.length
        var d1 = 0
        while (numPos + d1 < limit && isDigit(text[numPos + d1].code)) d1++
        if (d1 !in 1..5) return null
        numPos += d1

        if (matchedPrefix == ", pp. ") {
            if (numPos < limit && (text[numPos].code == 45 || text[numPos].code == 0x2013)) {
                numPos++
                var d2 = 0
                while (numPos + d2 < limit && isDigit(text[numPos + d2].code)) d2++
                if (d2 !in 1..5) return null
                numPos += d2
            }
        }
        if (numPos != limit) return null
        locator = text.substring(cur + 2, limit)
        cur = limit
    }

    return ParsedYearAndLocator(baseYear, extraYears, locator, cur)
}

private fun parseAuthorContinuation(text: String, afterSurname: Int, limit: Int): Int {
    if (text.startsWith(" et al.", afterSurname)) {
        return afterSurname + " et al.".length
    }
    val conj = when {
        text.startsWith(" and ", afterSurname) -> " and "
        text.startsWith(" & ", afterSurname) -> " & "
        else -> null
    }
    if (conj != null) {
        val secondStart = afterSurname + conj.length
        val second = parseSurnameAt(text, secondStart, limit)
        if (second != null) return second.endPos
    }
    return afterSurname
}

private fun parseAuthorYearItem(rawItem: String): AuthorYearQuery? {
    val item = trimSpaceLocal(rawItem)
    if (item.isEmpty()) return null
    var cur = 0
    val lowerStart = normLower(item.substring(0, minOf(item.length, 10)))
    for (prefix in AUTHOR_YEAR_PREFIXES) {
        if (lowerStart.startsWith(prefix)) {
            cur += prefix.length
            while (cur < item.length && isSpace(item[cur].code)) cur++
            break
        }
    }

    val s1 = parseSurnameAt(item, cur, item.length) ?: return null
    var afterAuthor = parseAuthorContinuation(item, s1.endPos, item.length)
    if (afterAuthor < item.length && item[afterAuthor].code == 44) afterAuthor++
    if (afterAuthor >= item.length || item[afterAuthor].code != 32) return null
    val yearStart = afterAuthor + 1
    val parsedYear = parseYearAndLocatorAt(item, yearStart, item.length) ?: return null
    if (parsedYear.endPos != item.length) return null

    return AuthorYearQuery(
        surname = s1.surname,
        surnameFolded = foldLatin(stripParticlesLower(normLower(s1.surname))),
        year = parsedYear.year,
        extraYears = parsedYear.extraYears,
        isOrgAcronym = s1.isOrgAcronym,
        locator = parsedYear.locator,
    )
}

private fun tryParseAuthorYearParen(text: String, p: Int, q: Int): CitationMarker? {
    val inner = text.substring(p + 1, q)
    val rawItems = splitByChar(inner, ';')
    if (rawItems.isEmpty()) return null
    val authorYears = mutableListOf<AuthorYearQuery>()
    for (item in rawItems) {
        val parsed = parseAuthorYearItem(item) ?: return null
        authorYears.add(parsed)
    }
    return CitationMarker(
        start = p,
        end = q + 1,
        rawText = text.substring(p, q + 1),
        rule = CitationRuleKind.AUTHOR_YEAR_PAREN,
        kind = MarkerKind.HEURISTIC,
        narrative = false,
        keys = emptyList(),
        numericIds = emptyList(),
        authorYears = authorYears,
    )
}

private fun tryParseAuthorYearNarrative(
    text: String,
    p: Int,
    q: Int,
    lastMarkerEnd: Int,
): CitationMarker? {
    if (p < 2 || text[p - 1].code != 32) return null
    val innerTrimmed = trimSpaceLocal(text.substring(p + 1, q))
    val parsedYear = parseYearAndLocatorAt(innerTrimmed, 0, innerTrimmed.length) ?: return null
    if (parsedYear.endPos != innerTrimmed.length) return null

    val nameEnd = p - 1
    var lookbackStart = maxOf(lastMarkerEnd, p - MAX_NARRATIVE_LOOKBACK)
    var scanBackStart = nameEnd - 1
    if (nameEnd >= 7 &&
        text[nameEnd - 1].code == 0x2E &&
        normLower(text.substring(nameEnd - 7, nameEnd)) == " et al."
    ) {
        scanBackStart = nameEnd - 8
    }
    for (k in scanBackStart downTo lookbackStart) {
        val cp = text[k].code
        if (isMaskChar(cp) || isSentenceStopChar(cp)) {
            lookbackStart = k + 1
            break
        }
    }

    for (cand in lookbackStart until nameEnd) {
        if (!isWordBoundaryBefore(text, cand)) continue
        val s1 = parseSurnameAt(text, cand, nameEnd) ?: continue
        val fullEnd = parseAuthorContinuation(text, s1.endPos, nameEnd)
        if (fullEnd == nameEnd) {
            return CitationMarker(
                start = cand,
                end = q + 1,
                rawText = text.substring(cand, q + 1),
                rule = CitationRuleKind.AUTHOR_YEAR_NARRATIVE,
                kind = MarkerKind.HEURISTIC,
                narrative = true,
                keys = emptyList(),
                numericIds = emptyList(),
                authorYears = listOf(
                    AuthorYearQuery(
                        surname = s1.surname,
                        surnameFolded = foldLatin(stripParticlesLower(normLower(s1.surname))),
                        year = parsedYear.year,
                        extraYears = parsedYear.extraYears,
                        isOrgAcronym = s1.isOrgAcronym,
                        locator = parsedYear.locator,
                    ),
                ),
            )
        }
    }
    return null
}

private fun isPandocTrailingStopChar(code: Int): Boolean =
    code == 46 || code == 63 || code == 58 || code == 39

private fun tryParsePandocNarrative(
    text: String,
    p: Int,
    stopLimit: Int,
    bibKeys: Set<String>?,
    bibKeysLower: Map<String, String>?,
    maxBibKeyLen: Int,
    maxBibKeyTrailingStops: Int,
): CitationMarker? {
    if (bibKeys == null || bibKeys.isEmpty() || maxBibKeyLen <= 0) return null
    if (p > 0) {
        val chBefore = text[p - 1].code
        var prevStart = p - 1
        if (chBefore in 0xDC00..0xDFFF && prevStart > 0) {
            val high = text[prevStart - 1].code
            if (high in 0xD800..0xDBFF) prevStart--
        }
        if (chBefore == 46 ||
            chBefore == 91 ||
            isDigit(chBefore) ||
            isMaskChar(chBefore) ||
            isLetterAt(text, prevStart)
        ) {
            return null
        }
    }

    var endPos = p + 1
    while (endPos < stopLimit) {
        val cu = text[endPos].code
        if (cu < 0x80) {
            if (!isKeyChar(cu)) break
            endPos++
            continue
        }
        val unit = codePointAtSafe(text, endPos)
        if (unit.isUnpairedSurrogate || !isKeyChar(unit.cp)) break
        endPos += unit.len
    }

    var coreEnd = endPos
    while (coreEnd > p + 1 && isPandocTrailingStopChar(text[coreEnd - 1].code)) {
        coreEnd--
    }
    if (coreEnd - (p + 1) > maxBibKeyLen) return null

    var testEnd = minOf(endPos, coreEnd + maxBibKeyTrailingStops, p + 1 + maxBibKeyLen)
    while (testEnd > p + 1 && testEnd >= coreEnd) {
        val candidate = text.substring(p + 1, testEnd)
        if (candidate in bibKeys || (bibKeysLower != null && normLower(candidate) in bibKeysLower)) {
            return CitationMarker(
                start = p,
                end = testEnd,
                rawText = text.substring(p, testEnd),
                rule = CitationRuleKind.PANDOC_NARRATIVE,
                kind = MarkerKind.EXPLICIT,
                narrative = true,
                keys = listOf(candidate),
                numericIds = emptyList(),
                authorYears = emptyList(),
            )
        }
        val lastCh = candidate[candidate.length - 1].code
        if (isPandocTrailingStopChar(lastCh)) {
            testEnd--
            continue
        }
        break
    }
    return null
}

fun scanCitations(text: String, options: ScanCitationsOptions? = null): List<CitationMarker> {
    val n = text.length
    val delims = buildBackwardDelims(text)
    val sortedDocx = options?.docxMarkers?.sortedBy { it.start } ?: emptyList()

    var bibKeysLower: MutableMap<String, String>? = null
    var maxBibKeyLen = 0
    var maxBibKeyTrailingStops = 0
    val bibKeys = options?.bibKeys
    if (bibKeys != null && bibKeys.isNotEmpty()) {
        bibKeysLower = HashMap()
        for (k in bibKeys) {
            val low = normLower(k)
            if (k.length > maxBibKeyLen) maxBibKeyLen = k.length
            if (low.length > maxBibKeyLen) maxBibKeyLen = low.length
            var kStops = 0
            while (kStops < k.length && isPandocTrailingStopChar(k[k.length - 1 - kStops].code)) kStops++
            if (kStops > maxBibKeyTrailingStops) maxBibKeyTrailingStops = kStops
            var lStops = 0
            while (lStops < low.length && isPandocTrailingStopChar(low[low.length - 1 - lStops].code)) lStops++
            if (lStops > maxBibKeyTrailingStops) maxBibKeyTrailingStops = lStops
            if (low !in bibKeysLower) bibKeysLower[low] = k
        }
    }

    val markers = mutableListOf<CitationMarker>()
    var p = 0
    var docxIdx = 0
    var lastMarkerEnd = 0
    val numericLookback = NumericLookbackState()

    while (p < n) {
        while (docxIdx < sortedDocx.size && sortedDocx[docxIdx].end <= p) docxIdx++
        val nextDocx = sortedDocx.getOrNull(docxIdx)
        val nextDocxStart = nextDocx?.start ?: n

        if (nextDocx != null && p == nextDocx.start) {
            markers.add(
                CitationMarker(
                    start = nextDocx.start,
                    end = nextDocx.end,
                    rawText = text.substring(nextDocx.start, nextDocx.end),
                    rule = nextDocx.kind,
                    kind = MarkerKind.EXPLICIT,
                    narrative = false,
                    keys = nextDocx.keys ?: emptyList(),
                    numericIds = nextDocx.numericIds ?: emptyList(),
                    authorYears = emptyList(),
                    authoritativeRefIds = nextDocx.refIds,
                ),
            )
            lastMarkerEnd = nextDocx.end
            p = nextDocx.end
            docxIdx++
            continue
        }

        val ch = text[p].code
        if (isMaskChar(ch)) {
            p++
            continue
        }

        if (ch == 92) {
            if (p + 1 < nextDocxStart && !isAsciiLetter(text[p + 1].code)) {
                p += 2
                continue
            }
            val m = parseLatexCiteCandidate(text, p, delims, nextDocxStart, options?.customCiteMacros)
            if (m != null) {
                markers.add(m)
                lastMarkerEnd = m.end
                p = m.end
                continue
            }
            var cmdEnd = p + 1
            while (cmdEnd < nextDocxStart && isAsciiLetter(text[cmdEnd].code)) cmdEnd++
            p = if (cmdEnd > p + 1) cmdEnd else p + 1
            continue
        }

        if (ch == 91) {
            val q = delims.nextCloseBracket[p + 1]
            val nextOpen = delims.nextOpenBracket[p + 1]
            val nextM = delims.nextMask[p + 1]
            if (q < nextDocxStart && q < nextM && nextOpen > q && q - p <= MAX_BRACKET_LEN) {
                val afterCh = if (q + 1 < n) text[q + 1].code else -1
                if (afterCh != 40 && afterCh != 91) {
                    val pandoc = tryParsePandocBracket(text, p, q)
                    if (pandoc != null) {
                        markers.add(pandoc)
                        lastMarkerEnd = pandoc.end
                        p = pandoc.end
                        continue
                    }
                    val numeric = tryParseNumericBracket(text, p, q, lastMarkerEnd, numericLookback, options)
                    if (numeric != null) {
                        markers.add(numeric)
                        lastMarkerEnd = numeric.end
                        p = numeric.end
                        continue
                    }
                }
            }
            p++
            continue
        }

        if (ch == 64) {
            val pandocNar = tryParsePandocNarrative(
                text, p, nextDocxStart, bibKeys, bibKeysLower, maxBibKeyLen, maxBibKeyTrailingStops,
            )
            if (pandocNar != null) {
                markers.add(pandocNar)
                lastMarkerEnd = pandocNar.end
                p = pandocNar.end
                continue
            }
            p++
            continue
        }

        if (ch == 40) {
            val q = delims.nextCloseParen[p + 1]
            val nextOpen = delims.nextOpenParen[p + 1]
            val nextM = delims.nextMask[p + 1]
            if (q < nextDocxStart && q < nextM && nextOpen > q && q - p <= MAX_PAREN_LEN) {
                val paren = tryParseAuthorYearParen(text, p, q)
                if (paren != null) {
                    markers.add(paren)
                    lastMarkerEnd = paren.end
                    p = paren.end
                    continue
                }
                val nar = tryParseAuthorYearNarrative(text, p, q, lastMarkerEnd)
                if (nar != null) {
                    markers.add(nar)
                    lastMarkerEnd = nar.end
                    p = nar.end
                    continue
                }
            }
            p++
            continue
        }

        p++
    }

    return markers
}

fun extractLatexBibStyle(source: String): String? {
    val needle = "\\bibliographystyle"
    var pos = 0
    while (pos < source.length) {
        val idx = source.indexOf(needle, pos)
        if (idx == -1) return null
        val after = idx + needle.length
        if (after < source.length && !isAsciiLetter(source[after].code)) {
            val adj = skipAdjacentWhitespace(source, after, source.length)
            if (!adj.crossedBlankLine && adj.pos < source.length && source[adj.pos].code == 123) {
                val close = source.indexOf('}', adj.pos + 1)
                if (close != -1 && close - adj.pos <= 128) {
                    return trimSpaceLocal(source.substring(adj.pos + 1, close))
                }
            }
        }
        pos = after
    }
    return null
}

fun extractMarkdownNumberedReferences(
    source: String,
    preMaskResult: PreMaskResult,
): List<MarkdownNumberedRef> {
    val refs = mutableListOf<MarkdownNumberedRef>()
    val transitions = preMaskResult.sectionTransitions
    if (transitions.isEmpty()) return refs

    fun isInReferences(offset: Int): Boolean {
        var curLabel = CanonicalSectionLabel.UNLABELED
        for (tr in transitions) {
            if (tr.offset <= offset) {
                curLabel = tr.state.label
            } else {
                break
            }
        }
        return curLabel == CanonicalSectionLabel.REFERENCES
    }

    val n = source.length
    var lineStart = 0
    while (lineStart < n) {
        var lineEnd = lineStart
        while (lineEnd < n && source[lineEnd].code != 10 && source[lineEnd].code != 13) lineEnd++
        val nextStart = when {
            lineEnd < n && source[lineEnd].code == 13 && lineEnd + 1 < n && source[lineEnd + 1].code == 10 -> lineEnd + 2
            lineEnd < n -> lineEnd + 1
            else -> n
        }

        if (isInReferences(lineStart)) {
            var sp = 0
            while (sp < 3 && lineStart + sp < lineEnd && source[lineStart + sp].code == 32) sp++
            val p = lineStart + sp
            if (p < lineEnd) {
                if (source[p].code == 91) {
                    var d = 0
                    while (p + 1 + d < lineEnd && isDigit(source[p + 1 + d].code)) d++
                    if (d in 1..4 &&
                        p + 1 + d < lineEnd &&
                        source[p + 1 + d].code == 93 &&
                        p + 2 + d < lineEnd &&
                        (source[p + 2 + d].code == 32 || source[p + 2 + d].code == 9)
                    ) {
                        val idx = source.substring(p + 1, p + 1 + d).toInt()
                        refs.add(
                            MarkdownNumberedRef(
                                index = idx,
                                text = trimSpaceLocal(source.substring(p + 3 + d, lineEnd)),
                                lineStart = lineStart,
                            ),
                        )
                    }
                } else if (isDigit(source[p].code)) {
                    var d = 0
                    while (p + d < lineEnd && isDigit(source[p + d].code)) d++
                    if (d in 1..4 &&
                        p + d < lineEnd &&
                        source[p + d].code == 46 &&
                        p + d + 1 < lineEnd &&
                        (source[p + d + 1].code == 32 || source[p + d + 1].code == 9)
                    ) {
                        val idx = source.substring(p, p + d).toInt()
                        refs.add(
                            MarkdownNumberedRef(
                                index = idx,
                                text = trimSpaceLocal(source.substring(p + d + 2, lineEnd)),
                                lineStart = lineStart,
                            ),
                        )
                    }
                }
            }
        }
        lineStart = nextStart
    }
    return refs
}

fun extractCorporateInitials(corporateAuthor: String): String {
    val words = extractWordSpans(corporateAuthor)
    val sb = StringBuilder()
    for (w in words) {
        val unit = codePointAtSafe(w.text, 0)
        if (!unit.isUnpairedSurrogate && isUpper(unit.cp)) {
            sb.append(w.text, 0, unit.len)
        }
    }
    return sb.toString()
}

private fun entryMatchesAuthorYear(entry: BibliographyEntry, q: AuthorYearQuery): Boolean {
    val entryYear = entry.year ?: return false
    val yearsMatch = entryYear == q.year || (q.extraYears.isNotEmpty() && entryYear in q.extraYears)
    if (!yearsMatch) return false

    if (q.isOrgAcronym) {
        val lowerQ = normLower(q.surname)
        if (entry.shortauthor != null && normLower(entry.shortauthor) == lowerQ) return true
        if (entry.shorthand != null && normLower(entry.shorthand) == lowerQ) return true
        if (entry.corporateAuthor != null) {
            val initials = extractCorporateInitials(entry.corporateAuthor)
            if (initials.length >= 2 && normLower(initials) == lowerQ) return true
        }
        return false
    }

    val family = entry.firstAuthorFamily ?: return false
    val entryFamilyFolded = foldLatin(stripParticlesLower(normLower(family)))
    return entryFamilyFolded == q.surnameFolded
}

private fun recordUnique(arr: MutableList<String>, value: String) {
    if (!arr.contains(value)) arr.add(value)
}

fun resolveCitationMarkers(
    markers: List<CitationMarker>,
    options: ResolveCitationsOptions? = null,
): CitationResolutionResult {
    val entries = options?.entries ?: emptyList()
    val report = options?.report ?: ImportQualityReport()

    val exactKeyMap = HashMap<String, MutableList<BibliographyEntry>>()
    val lowerKeyMap = HashMap<String, MutableList<BibliographyEntry>>()
    for (e in entries) {
        exactKeyMap.getOrPut(e.key) { mutableListOf() }.add(e)
        lowerKeyMap.getOrPut(normLower(e.key)) { mutableListOf() }.add(e)
    }

    val numberedOrderRefMap = HashMap<Int, String>()
    var hasExplicitOrder = false

    val bibItems = options?.bibItems
    val docxNumberedRefs = options?.docxNumberedRefs
    val markdownNumberedRefs = options?.markdownNumberedRefs
    val bibStyle = options?.bibStyle

    if (bibItems != null && bibItems.isNotEmpty()) {
        hasExplicitOrder = true
        for (idx in bibItems.indices) {
            val item = bibItems[idx]
            val found = exactKeyMap[item.key]?.firstOrNull() ?: lowerKeyMap[normLower(item.key)]?.firstOrNull()
            numberedOrderRefMap[idx + 1] = found?.refId ?: "bibitem:${idx + 1}:${item.key}"
        }
    } else if (docxNumberedRefs != null && docxNumberedRefs.isNotEmpty()) {
        hasExplicitOrder = true
        for (idx in docxNumberedRefs.indices) {
            numberedOrderRefMap[idx + 1] = docxNumberedRefs[idx]
        }
    } else if (markdownNumberedRefs != null && markdownNumberedRefs.isNotEmpty()) {
        hasExplicitOrder = true
        for (ref in markdownNumberedRefs) {
            if (ref.index >= 1 && ref.index !in numberedOrderRefMap) {
                numberedOrderRefMap[ref.index] = "mdref:${ref.index}"
            }
        }
    } else if (bibStyle != null) {
        val lowerStyle = normLower(bibStyle)
        val isFirstCitationOrder = FIRST_CITATION_ORDER_STYLES.any {
            containsAsciiSubstrCaseInsensitive(lowerStyle, it)
        }
        if (isFirstCitationOrder && entries.isNotEmpty()) {
            hasExplicitOrder = true
            val ordered = entries.sortedBy { it.orderIndex ?: 0 }
            for (idx in ordered.indices) {
                numberedOrderRefMap[idx + 1] = ordered[idx].refId
            }
        }
    }

    val resolvedMarkers = mutableListOf<ResolvedCitationMarker>()
    val allResolvedRefIds = mutableListOf<String>()
    val allUnresolvedKeys = mutableListOf<String>()
    val possibleCitations = mutableListOf<PossibleCitationRecord>()
    val ambiguousMarkers = mutableListOf<ResolvedCitationMarker>()

    for (m in markers) {
        val refIds = mutableListOf<String>()
        val unresolved = mutableListOf<String>()
        val ambiguous = mutableListOf<String>()
        var numericPromotedExplicit = false

        when (m.rule) {
            CitationRuleKind.DOCX_FIELD, CitationRuleKind.DOCX_SUPERSCRIPT -> {
                val authIds = m.authoritativeRefIds
                if (authIds != null && authIds.isNotEmpty()) {
                    for (id in authIds) recordUnique(refIds, id)
                } else {
                    for (k in m.keys) {
                        val hit = exactKeyMap[k]?.firstOrNull() ?: lowerKeyMap[normLower(k)]?.firstOrNull()
                        if (hit != null) recordUnique(refIds, hit.refId) else unresolved.add(k)
                    }
                    for (num in m.numericIds) {
                        val targetRef = if (num >= 1) numberedOrderRefMap[num] else null
                        if (targetRef != null) recordUnique(refIds, targetRef) else unresolved.add(num.toString())
                    }
                }
            }
            CitationRuleKind.LATEX_CITE, CitationRuleKind.PANDOC_BRACKET, CitationRuleKind.PANDOC_NARRATIVE -> {
                for (k in m.keys) {
                    val exactHits = exactKeyMap[k]
                    if (exactHits != null && exactHits.size == 1) {
                        recordUnique(refIds, exactHits[0].refId)
                    } else if (exactHits != null && exactHits.size > 1) {
                        for (h in exactHits) recordUnique(ambiguous, h.refId)
                    } else {
                        val lowHits = lowerKeyMap[normLower(k)]
                        if (lowHits != null && lowHits.size == 1) {
                            recordUnique(refIds, lowHits[0].refId)
                        } else if (lowHits != null && lowHits.size > 1) {
                            for (h in lowHits) recordUnique(ambiguous, h.refId)
                        } else {
                            unresolved.add(k)
                        }
                    }
                }
            }
            CitationRuleKind.NUMERIC_BRACKET -> {
                val effectiveExplicit = hasExplicitOrder || m.kind == MarkerKind.EXPLICIT
                numericPromotedExplicit = effectiveExplicit
                if (effectiveExplicit) {
                    for (num in m.numericIds) {
                        val targetRef = if (num >= 1) numberedOrderRefMap[num] else null
                        if (targetRef != null) recordUnique(refIds, targetRef) else unresolved.add(num.toString())
                    }
                }
            }
            CitationRuleKind.AUTHOR_YEAR_PAREN, CitationRuleKind.AUTHOR_YEAR_NARRATIVE -> {
                for (q in m.authorYears) {
                    val matches = entries.filter { entryMatchesAuthorYear(it, q) }
                    if (matches.size == 1) {
                        recordUnique(refIds, matches[0].refId)
                    } else if (matches.size > 1) {
                        for (h in matches) recordUnique(ambiguous, h.refId)
                    }
                }
            }
        }

        val isExplicit = if (m.rule == CitationRuleKind.NUMERIC_BRACKET) {
            numericPromotedExplicit
        } else {
            m.kind == MarkerKind.EXPLICIT
        }
        val resolvedMarkerObj = if (isExplicit && m.kind != MarkerKind.EXPLICIT) {
            m.copy(kind = MarkerKind.EXPLICIT)
        } else {
            m
        }

        val status = when {
            isExplicit && unresolved.isNotEmpty() -> {
                for (uk in unresolved) {
                    recordUnique(allUnresolvedKeys, uk)
                    recordUnique(report.unresolvedKeys, uk)
                }
                MarkerResolutionStatus.UNRESOLVED_KEY
            }
            ambiguous.isNotEmpty() -> MarkerResolutionStatus.AMBIGUOUS
            refIds.isEmpty() -> {
                if (isExplicit) {
                    MarkerResolutionStatus.UNRESOLVED_KEY
                } else {
                    possibleCitations.add(PossibleCitationRecord(TextRange(m.start, m.end), m.rawText))
                    report.possibleCitations.add(m.rawText)
                    MarkerResolutionStatus.POSSIBLE_CITATION
                }
            }
            else -> {
                for (id in refIds) recordUnique(allResolvedRefIds, id)
                MarkerResolutionStatus.RESOLVED
            }
        }

        val resolvedEntry = ResolvedCitationMarker(
            marker = resolvedMarkerObj,
            status = status,
            refIds = refIds,
            unresolvedKeys = unresolved,
            ambiguousCandidates = ambiguous,
        )
        resolvedMarkers.add(resolvedEntry)
        if (status == MarkerResolutionStatus.AMBIGUOUS) {
            ambiguousMarkers.add(resolvedEntry)
        }
    }

    return CitationResolutionResult(
        resolvedMarkers = resolvedMarkers,
        resolvedRefIds = allResolvedRefIds,
        unresolvedKeys = allUnresolvedKeys,
        possibleCitations = possibleCitations,
        ambiguousMarkers = ambiguousMarkers,
        report = report,
    )
}
