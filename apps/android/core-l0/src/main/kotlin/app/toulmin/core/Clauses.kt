package app.toulmin.core

val STRONG_BOUNDARIES: List<String> = listOf(
    ";",
    ", but ",
    ", whereas ",
    ", while ",
    ", although ",
    ", though ",
    ", however, ",
    ", yet ",
    " but ",
    " whereas ",
)

val RELATIVIZERS: Set<String> = setOf(
    "which", "who", "whom", "whose", "that", "as", "where", "when",
)

val INNER_SPLITS: List<String> = listOf(
    ", and ",
    ", but ",
    ", while ",
    ", whereas ",
    ", although ",
    " and ",
)

val REPORTING_FRAMES: List<String> = listOf(
    "as demonstrated by",
    "as described by",
    "as described in",
    "as reported by",
    "as reported in",
    "as shown by",
    "as shown in",
    "according to",
    "as found by",
    "as noted by",
    "see",
    "in",
)

val LEADING_FRAMES: List<String> = listOf(
    "previous studies have shown that",
    "in line with previous studies",
    "consistent with previous work",
    "consistent with prior work",
    "it has been reported that",
    "as described previously",
    "as previously reported",
    "as described elsewhere",
    "it has been shown that",
    "as reported previously",
    "as previously shown",
    "as shown previously",
    "as shown before",
)

val LEAD_CONNECTORS: List<String> = listOf(
    "furthermore",
    "in addition",
    "additionally",
    "therefore",
    "although",
    "moreover",
    "whereas",
    "however",
    "though",
    "while",
    "which",
    "thus",
    "also",
    "that",
    "with",
    "and",
    "but",
    "yet",
    "as",
)

val TRAIL_CONNECTORS: List<String> = listOf(
    "although",
    "whereas",
    "however",
    "though",
    "while",
    "and",
    "but",
    "yet",
    "or",
)

data class MarkerGroup(
    override val start: Int,
    override val end: Int,
    val markers: List<CitationMarker>,
    val narrative: Boolean,
) : TextRangeLike

data class ClauseSplitTrace(
    val betweenStart: Int,
    val betweenEnd: Int,
    val betweenWordCount: Int,
    val didSplit: Boolean,
    val relativizerMatched: String?,
    val splitOffset: Int?,
)

data class PartitionedClause(
    val clauseIndex: Int,
    val claimText: String,
    val span: TextRange,
    val range: TextRange,
    val groups: List<MarkerGroup>,
    val markers: List<CitationMarker>,
    val uncited: Boolean,
)

data class PartitionClausesWithTraceResult(
    val groups: List<MarkerGroup>,
    val clauses: List<PartitionedClause>,
    val splitTraces: List<ClauseSplitTrace>,
)

private fun isGapOnlyGroupSeparators(text: String, from: Int, to: Int): Boolean {
    for (i in from until to) {
        val ch = text[i].code
        if (!isSpace(ch) && ch != 44 && ch != 59) return false
    }
    return true
}

fun groupMarkers(
    sentenceText: String,
    markers: List<CitationMarker>,
): List<MarkerGroup> {
    if (markers.isEmpty()) return emptyList()
    val sorted = markers.sortedBy { it.start }
    val groups = mutableListOf<MarkerGroup>()

    var currentMarkers = mutableListOf(sorted[0])
    var gStart = sorted[0].start
    var gEnd = sorted[0].end

    for (i in 1 until sorted.size) {
        val next = sorted[i]
        if (next.start >= gEnd && isGapOnlyGroupSeparators(sentenceText, gEnd, next.start)) {
            currentMarkers.add(next)
            gEnd = next.end
        } else {
            groups.add(MarkerGroup(gStart, gEnd, currentMarkers, currentMarkers[0].narrative))
            currentMarkers = mutableListOf(next)
            gStart = next.start
            gEnd = next.end
        }
    }

    groups.add(MarkerGroup(gStart, gEnd, currentMarkers, currentMarkers[0].narrative))
    return groups
}

private class SearchView(
    val searchStr: String,
    val origStartMap: IntArray,
)

private fun buildSearchView(input: String): SearchView {
    val lowered = normLowerWithMap(input)
    val txt = lowered.text
    var hasNonAsciiSpace = false
    for (i in txt.indices) {
        val ch = txt[i].code
        if (ch == 9 || ch == 10 || ch == 13) {
            hasNonAsciiSpace = true
            break
        }
    }
    if (!hasNonAsciiSpace) {
        return SearchView(txt, lowered.map)
    }
    val chars = CharArray(txt.length)
    for (i in txt.indices) {
        val ch = txt[i]
        chars[i] = if (isSpace(ch.code)) ' ' else ch
    }
    return SearchView(String(chars), lowered.map)
}

private fun buildProtectedMask(sentenceText: String, groups: List<MarkerGroup>): BooleanArray {
    val n = sentenceText.length
    val mask = BooleanArray(n)
    for (i in 0 until n) {
        if (sentenceText[i].code == 0xE000) mask[i] = true
    }
    for (g in groups) {
        val s = maxOf(0, g.start)
        val e = minOf(n, g.end)
        for (k in s until e) mask[k] = true
    }
    return mask
}

private fun isRangeOutsideProtectedMask(
    protectedMask: BooleanArray,
    rawStart: Int,
    rawEnd: Int,
): Boolean {
    for (i in rawStart until rawEnd) {
        if (protectedMask[i]) return false
    }
    return true
}

private fun isWordBoundaryInStr(s: String, index: Int, isStart: Boolean): Boolean {
    if (isStart) {
        if (index <= 0) return true
        var prevStart = index - 1
        val cu = s[prevStart].code
        if (cu in 0xDC00..0xDFFF && prevStart > 0) {
            val high = s[prevStart - 1].code
            if (high in 0xD800..0xDBFF) prevStart--
        }
        val prev = codePointAtSafe(s, prevStart)
        return prev.isUnpairedSurrogate || (!isLetter(prev.cp, false) && !isDigit(prev.cp))
    }
    if (index >= s.length) return true
    val next = codePointAtSafe(s, index)
    return next.isUnpairedSurrogate || (!isLetter(next.cp, false) && !isDigit(next.cp))
}

private fun findNextWholePhrase(haystack: String, phrase: String, from: Int): Int {
    var pos = maxOf(0, from)
    while (pos + phrase.length <= haystack.length) {
        val idx = haystack.indexOf(phrase, pos)
        if (idx == -1) return -1
        if (isWordBoundaryInStr(haystack, idx, true) &&
            isWordBoundaryInStr(haystack, idx + phrase.length, false)
        ) {
            return idx
        }
        pos = idx + 1
    }
    return -1
}

private fun splitAtStrongBoundaries(
    sentenceText: String,
    groups: List<MarkerGroup>,
): List<TextRange> {
    val n = sentenceText.length
    if (n == 0) return emptyList()
    val protectedMask = buildProtectedMask(sentenceText, groups)
    val view = buildSearchView(sentenceText)
    val s = view.searchStr
    val spans = mutableListOf<TextRange>()

    val nextHit = IntArray(STRONG_BOUNDARIES.size) { -2 }
    var notOnlyPos = findNextWholePhrase(s, "not only", 0)

    var rawSpanStart = 0
    var currentSearchSpanStart = 0
    var searchFrom = 0

    while (searchFrom < s.length) {
        var bestSearchIdx = -1
        var bestPat = ""

        for (pi in STRONG_BOUNDARIES.indices) {
            var hit = nextHit[pi]
            if (hit == -1) continue
            val pat = STRONG_BOUNDARIES[pi]
            if (hit < searchFrom) {
                var probe = searchFrom
                hit = -1
                while (probe + pat.length <= s.length) {
                    val cand = s.indexOf(pat, probe)
                    if (cand == -1) break
                    val rStart = view.origStartMap.getOrNull(cand) ?: n
                    val rEnd = view.origStartMap.getOrNull(cand + pat.length) ?: n
                    if (isRangeOutsideProtectedMask(protectedMask, rStart, rEnd)) {
                        hit = cand
                        break
                    }
                    probe = cand + 1
                }
                nextHit[pi] = hit
            }
            if (hit != -1 && (bestSearchIdx == -1 || hit < bestSearchIdx)) {
                bestSearchIdx = hit
                bestPat = pat
            }
        }

        if (bestSearchIdx == -1) break

        val afterMatch = bestSearchIdx + bestPat.length
        if ((bestPat == " but " || bestPat == ", but ") &&
            s.startsWith("also", afterMatch) &&
            isWordBoundaryInStr(s, afterMatch + 4, false)
        ) {
            if (notOnlyPos != -1 && notOnlyPos < currentSearchSpanStart) {
                notOnlyPos = findNextWholePhrase(s, "not only", currentSearchSpanStart)
            }
            if (notOnlyPos != -1 && notOnlyPos < bestSearchIdx) {
                searchFrom = afterMatch
                continue
            }
        }

        val rawCut = view.origStartMap.getOrNull(afterMatch) ?: n
        spans.add(TextRange(rawSpanStart, rawCut))
        rawSpanStart = rawCut
        currentSearchSpanStart = afterMatch
        searchFrom = afterMatch
    }

    if (rawSpanStart < n) {
        spans.add(TextRange(rawSpanStart, n))
    } else if (spans.isEmpty()) {
        spans.add(TextRange(0, n))
    }
    return spans
}

private data class InnerSplitResult(
    val offset: Int?,
    val relativizer: String?,
)

private fun findInnerSplitOffset(between: String): InnerSplitResult {
    var leadTrim = 0
    while (leadTrim < between.length) {
        val c = between[leadTrim].code
        if (c == 44 || isSpace(c)) leadTrim++ else break
    }
    val leadWords = extractWordSpans(between, leadTrim, between.length)
    val fw = leadWords.firstOrNull() ?: return InnerSplitResult(null, null)
    val fwLower = normLowerWithMap(fw.text).text
    if (fwLower !in RELATIVIZERS) return InnerSplitResult(null, null)

    val allWords = extractWordSpans(between, 0, between.length)
    if (allWords.size < 3) return InnerSplitResult(null, fwLower)
    val minRawOffset = allWords[1].end

    val view = buildSearchView(between)
    val s = view.searchStr
    var bestRawOffset: Int? = null

    for (pat in INNER_SPLITS) {
        var probe = 0
        while (probe + pat.length <= s.length) {
            val hit = s.indexOf(pat, probe)
            if (hit == -1) break
            val rawIdx = view.origStartMap.getOrNull(hit) ?: between.length
            if (rawIdx >= minRawOffset) {
                if (bestRawOffset == null || rawIdx < bestRawOffset) {
                    bestRawOffset = rawIdx
                }
                break
            }
            probe = hit + 1
        }
    }

    return InnerSplitResult(bestRawOffset, fwLower)
}

private class DraftClause(
    var range: TextRange,
    val groups: MutableList<MarkerGroup>,
    var uncited: Boolean,
)

private fun isLeadingTrimCode(c: Int): Boolean =
    isSpace(c) || c == 44 || c == 59 || c == 58

private fun isTrailingTrimCode(c: Int): Boolean =
    isSpace(c) || c == 44 || c == 59 || c == 58 || c == 46

private fun isPunctBeforeSpaceTargetCode(c: Int): Boolean =
    c == 44 || c == 59 || c == 58 || c == 46

private data class WindowLowerCodes(
    val lowered: String,
    val slotIdxForLowerChar: IntArray,
)

private fun buildWindowLowerCodes(codes: CharArray, from: Int, to: Int): WindowLowerCodes {
    var allAscii = true
    for (i in from until to) {
        if (codes[i].code >= 128) {
            allAscii = false
            break
        }
    }
    if (allAscii) {
        val len = to - from
        val outCodes = CharArray(len)
        val map = IntArray(len + 1)
        for (k in 0 until len) {
            var c = codes[from + k].code
            if (isSpace(c)) {
                c = 32
            } else if (c in 65..90) {
                c += 32
            }
            outCodes[k] = c.toChar()
            map[k] = from + k
        }
        map[len] = to
        return WindowLowerCodes(String(outCodes), map)
    }

    val rawChars = CharArray(to - from) { k ->
        val c = codes[from + k]
        if (isSpace(c.code)) ' ' else c
    }
    val res = normLowerWithMap(String(rawChars))
    val map = IntArray(res.map.size) { from + res.map[it] }
    return WindowLowerCodes(res.text, map)
}

private fun buildPrefixLowerCodes(
    codes: CharArray,
    startIdx: Int,
    endIdx: Int,
    maxSlots: Int,
): WindowLowerCodes = buildWindowLowerCodes(codes, startIdx, minOf(endIdx, startIdx + maxSlots))

private fun buildSuffixLowerCodes(
    codes: CharArray,
    startIdx: Int,
    endIdx: Int,
    maxSlots: Int,
): WindowLowerCodes = buildWindowLowerCodes(codes, maxOf(startIdx, endIdx - maxSlots), endIdx)

private fun isCodeWordChar(code: Int): Boolean = isLetter(code, false) || isDigit(code)

private fun advanceLeadingTrimCode(codes: CharArray, startIdx: Int, endIdx: Int): Int {
    var idx = startIdx
    while (idx < endIdx && isLeadingTrimCode(codes[idx].code)) idx++
    return idx
}

private fun isSlotSurrogateWordChar(codes: CharArray, highIdx: Int): Boolean {
    val hi = codes[highIdx].code
    val lo = codes[highIdx + 1].code
    if (hi in 0xD800..0xDBFF && lo in 0xDC00..0xDFFF) {
        val cp = 0x10000 + (((hi - 0xD800) shl 10) or (lo - 0xDC00))
        return isLetter(cp, false) || isDigit(cp)
    }
    return false
}

private data class CleanedClauseResult(
    val claimText: String,
    val span: TextRange,
)

private data class DeletionInterval(val start: Int, val end: Int)

private fun cleanClauseSlice(
    sentenceText: String,
    range: TextRange,
    groups: List<MarkerGroup>,
): CleanedClauseResult {
    val rStart = range.start
    val rEnd = range.end
    val sliceLen = maxOf(0, rEnd - rStart)
    if (sliceLen == 0) {
        return CleanedClauseResult("", TextRange(rStart, rStart))
    }

    val sortedGroups = if (groups.size <= 1) groups else groups.sortedBy { it.start }
    val deletions = mutableListOf<DeletionInterval>()

    for (g in sortedGroups) {
        var delStart = maxOf(rStart, g.start)
        val delEnd = minOf(rEnd, g.end)

        if (g.narrative) {
            var frameEnd = delStart
            while (frameEnd > rStart && isSpace(sentenceText[frameEnd - 1].code)) {
                frameEnd--
            }
            if (frameEnd > rStart) {
                val windowStart = maxOf(rStart, frameEnd - 64)
                val prefixSlice = sentenceText.substring(windowStart, frameEnd)
                val lowInfo = buildSearchView(prefixSlice)
                val lowStr = lowInfo.searchStr
                for (frame in REPORTING_FRAMES) {
                    if (lowStr.endsWith(frame)) {
                        val matchIdxInLow = lowStr.length - frame.length
                        val rawOffsetInPrefix = lowInfo.origStartMap.getOrNull(matchIdxInLow) ?: prefixSlice.length
                        val rawCandidateStart = windowStart + rawOffsetInPrefix
                        val leftBoundaryOk = if (matchIdxInLow > 0) {
                            isWordBoundaryInStr(lowStr, matchIdxInLow, true)
                        } else {
                            rawCandidateStart == rStart || isWordBoundaryInStr(sentenceText, rawCandidateStart, true)
                        }
                        if (leftBoundaryOk) {
                            delStart = rawCandidateStart
                            break
                        }
                    }
                }
            }
        }
        deletions.add(DeletionInterval(delStart, delEnd))
    }

    val codes = CharArray(sliceLen)
    val origs = IntArray(sliceLen)

    // Pass 1 + Cleanup (a) fused
    var wA = 0
    var delIdx = 0
    var pendingMarkerTag = false
    var pos = rStart

    while (pos < rEnd) {
        while (delIdx < deletions.size && deletions[delIdx].end <= pos) delIdx++
        val activeDel = deletions.getOrNull(delIdx)
        if (activeDel != null && pos >= activeDel.start && pos < activeDel.end) {
            pendingMarkerTag = true
            pos = activeDel.end
            delIdx++
            continue
        }
        val ch = sentenceText[pos]
        if (ch.code == 0xE000) {
            pos++
            continue
        }
        if (pendingMarkerTag) {
            while (wA > 0 && isSpace(codes[wA - 1].code)) wA--
            pendingMarkerTag = false
        }
        codes[wA] = ch
        origs[wA] = pos
        wA++
        pos++
    }
    if (pendingMarkerTag) {
        while (wA > 0 && isSpace(codes[wA - 1].code)) wA--
    }

    // Cleanup (b): delete pairs of commas enclosing only spaces
    var wB = 0
    var bi = 0
    while (bi < wA) {
        val ch = codes[bi]
        if (ch.code == 44) {
            var look = bi + 1
            while (look < wA && isSpace(codes[look].code)) look++
            if (look < wA && codes[look].code == 44) {
                bi = look + 1
                continue
            }
        }
        codes[wB] = ch
        origs[wB] = origs[bi]
        wB++
        bi++
    }

    // Cleanup (c): delete every space immediately before ",", ";", ":" or "."
    var wC = 0
    for (ci in 0 until wB) {
        val ch = codes[ci]
        if (isPunctBeforeSpaceTargetCode(ch.code)) {
            while (wC > 0 && isSpace(codes[wC - 1].code)) wC--
        }
        codes[wC] = ch
        origs[wC] = origs[ci]
        wC++
    }

    // Cleanup (d)
    var endIdx = wC
    var startIdx = advanceLeadingTrimCode(codes, 0, endIdx)

    // Strip a LEADING_FRAME at start (+ optional ",")
    if (startIdx < endIdx) {
        val win = buildPrefixLowerCodes(codes, startIdx, endIdx, 64)
        for (frame in LEADING_FRAMES) {
            if (win.lowered.startsWith(frame) && isWordBoundaryInStr(win.lowered, frame.length, false)) {
                var dropTo = win.slotIdxForLowerChar.getOrNull(frame.length) ?: endIdx
                if (dropTo < endIdx && codes[dropTo].code == 44) dropTo++
                startIdx = advanceLeadingTrimCode(codes, dropTo, endIdx)
                break
            }
        }
    }

    // Repeat at most 3 times: strip one LEAD_CONNECTOR at start (+ optional ",")
    for (iter in 0 until 3) {
        if (startIdx >= endIdx) break
        val win = buildPrefixLowerCodes(codes, startIdx, endIdx, 32)
        var stripped = false
        for (conn in LEAD_CONNECTORS) {
            if (win.lowered.startsWith(conn) && isWordBoundaryInStr(win.lowered, conn.length, false)) {
                var dropTo = win.slotIdxForLowerChar.getOrNull(conn.length) ?: endIdx
                if (dropTo < endIdx && codes[dropTo].code == 44) dropTo++
                startIdx = advanceLeadingTrimCode(codes, dropTo, endIdx)
                stripped = true
                break
            }
        }
        if (!stripped) break
    }

    fun trimTrailingEnd() {
        while (endIdx > startIdx && isTrailingTrimCode(codes[endIdx - 1].code)) endIdx--
    }

    for (iter in 0 until 2) {
        trimTrailingEnd()
        if (startIdx >= endIdx) break
        val win = buildSuffixLowerCodes(codes, startIdx, endIdx, 24)
        var stripped = false
        for (conn in TRAIL_CONNECTORS) {
            if (win.lowered.endsWith(conn)) {
                val startCharIdx = win.lowered.length - conn.length
                val startSlotIdx = win.slotIdxForLowerChar.getOrNull(startCharIdx) ?: startIdx
                val precededByBoundary = when {
                    startSlotIdx == startIdx -> true
                    startSlotIdx >= 2 && codes[startSlotIdx - 1].code in 0xDC00..0xDFFF ->
                        !isSlotSurrogateWordChar(codes, startSlotIdx - 2)
                    else -> !isCodeWordChar(codes[startSlotIdx - 1].code)
                }
                if (precededByBoundary) {
                    endIdx = startSlotIdx
                    stripped = true
                    break
                }
            }
        }
        if (!stripped) break
    }
    trimTrailingEnd()

    while (startIdx < endIdx && isSpace(codes[startIdx].code)) startIdx++
    while (endIdx > startIdx && isSpace(codes[endIdx - 1].code)) endIdx--

    if (startIdx >= endIdx) {
        return CleanedClauseResult("", TextRange(range.start, range.start))
    }

    val spanStartOrig = origs[startIdx]
    val spanEndOrig = origs[endIdx - 1] + 1

    var outW = startIdx
    var inSpace = false
    for (i in startIdx until endIdx) {
        val ch = codes[i]
        if (isSpace(ch.code)) {
            if (!inSpace) {
                codes[outW++] = ' '
                inSpace = true
            }
        } else {
            codes[outW++] = ch
            inSpace = false
        }
    }

    val claimText = String(codes, startIdx, outW - startIdx)
    return CleanedClauseResult(claimText, TextRange(spanStartOrig, spanEndOrig))
}

private fun isShortUncitedClause(sentenceText: String, c: DraftClause): Boolean {
    if (!c.uncited) return false
    val rawWc = countWords(sentenceText, c.range.start, c.range.end)
    if (rawWc < 4) return true
    if (rawWc >= 17) return false
    val cleaned = cleanClauseSlice(sentenceText, c.range, c.groups)
    return countWords(cleaned.claimText) < 4
}

private fun mergeShortUncited(sentenceText: String, clauses: List<DraftClause>): List<DraftClause> {
    if (clauses.size <= 1) return clauses

    val head = clauses[0]
    var nextIdx = 1
    while (nextIdx < clauses.size && isShortUncitedClause(sentenceText, head)) {
        val next = clauses[nextIdx]
        head.range = TextRange(head.range.start, next.range.end)
        head.groups.addAll(next.groups)
        head.uncited = next.uncited
        nextIdx++
    }

    val merged = mutableListOf(head)
    for (idx in nextIdx until clauses.size) {
        val c = clauses[idx]
        if (isShortUncitedClause(sentenceText, c)) {
            val prev = merged.last()
            prev.range = TextRange(prev.range.start, c.range.end)
            continue
        }
        merged.add(c)
    }
    return merged
}

fun partitionClausesWithTrace(
    sentenceText: String,
    markers: List<CitationMarker>,
): PartitionClausesWithTraceResult {
    val groups = groupMarkers(sentenceText, markers)
    val strongSpans = splitAtStrongBoundaries(sentenceText, groups)

    var drafts = mutableListOf<DraftClause>()
    val splitTraces = mutableListOf<ClauseSplitTrace>()
    var gCursor = 0

    for (pSpan in strongSpans) {
        while (gCursor < groups.size && groups[gCursor].end <= pSpan.start) gCursor++
        val spanGroups = mutableListOf<MarkerGroup>()
        while (gCursor < groups.size && groups[gCursor].end <= pSpan.end) {
            if (groups[gCursor].start >= pSpan.start) {
                spanGroups.add(groups[gCursor])
            }
            gCursor++
        }

        if (spanGroups.isEmpty()) {
            drafts.add(DraftClause(pSpan, mutableListOf(), true))
            continue
        }

        val pieceRanges = mutableListOf<TextRange>()
        var openStart = pSpan.start

        for (j in 1 until spanGroups.size) {
            val a = spanGroups[j - 1]
            val b = spanGroups[j]
            val between = sentenceText.substring(a.end, b.start)
            val wc = countWords(sentenceText, a.end, b.start)

            var didSplit = false
            var relMatched: String? = null
            var splitOffset: Int? = null

            if (!a.narrative && !b.narrative && wc >= 4) {
                var x = a.end
                val innerRes = findInnerSplitOffset(between)
                relMatched = innerRes.relativizer
                if (innerRes.offset != null) {
                    x = a.end + innerRes.offset
                }
                didSplit = true
                splitOffset = x
                pieceRanges.add(TextRange(openStart, x))
                openStart = x
            }

            splitTraces.add(
                ClauseSplitTrace(
                    betweenStart = a.end,
                    betweenEnd = b.start,
                    betweenWordCount = wc,
                    didSplit = didSplit,
                    relativizerMatched = relMatched,
                    splitOffset = splitOffset,
                ),
            )
        }

        pieceRanges.add(TextRange(openStart, pSpan.end))

        var pgCursor = 0
        for (pr in pieceRanges) {
            val pieceGroups = mutableListOf<MarkerGroup>()
            while (pgCursor < spanGroups.size && spanGroups[pgCursor].end <= pr.end) {
                if (spanGroups[pgCursor].start >= pr.start) {
                    pieceGroups.add(spanGroups[pgCursor])
                }
                pgCursor++
            }
            drafts.add(DraftClause(pr, pieceGroups, pieceGroups.isEmpty()))
        }
    }

    drafts = mergeShortUncited(sentenceText, drafts).toMutableList()

    val clauses = mutableListOf<PartitionedClause>()
    for (idx in drafts.indices) {
        val d = drafts[idx]
        val cleaned = cleanClauseSlice(sentenceText, d.range, d.groups)
        val flattenedMarkers = mutableListOf<CitationMarker>()
        for (g in d.groups) flattenedMarkers.addAll(g.markers)
        clauses.add(
            PartitionedClause(
                clauseIndex = idx,
                claimText = cleaned.claimText,
                span = cleaned.span,
                range = d.range,
                groups = d.groups,
                markers = flattenedMarkers,
                uncited = d.uncited,
            ),
        )
    }

    return PartitionClausesWithTraceResult(groups, clauses, splitTraces)
}

fun partitionClauses(
    sentenceText: String,
    markers: List<CitationMarker>,
): List<PartitionedClause> = partitionClausesWithTrace(sentenceText, markers).clauses
