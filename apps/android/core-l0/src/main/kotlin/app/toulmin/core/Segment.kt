package app.toulmin.core

val CLASS_N_ABBREVS: Set<String> = setOf(
    "e.g.", "i.e.", "cf.", "vs.", "viz.", "fig.", "figs.", "eq.", "eqs.",
    "ref.", "refs.", "no.", "nos.", "vol.", "vols.", "pp.", "p.", "dr.",
    "mr.", "mrs.", "ms.", "prof.", "st.", "jr.", "sr.", "dept.", "univ.",
    "ch.", "tab.", "suppl.", "ca.", "approx.", "n.b.", "op.", "ed.", "eds.",
)

val CLASS_T_ABBREVS: Set<String> = setOf(
    "etc.", "al.", "min.", "max.", "avg.", "std.", "resp.", "inc.",
    "ltd.", "co.", "corp.", "a.m.", "p.m.", "u.s.", "u.k.", "e.u.",
    "sec.", "i.v.", "i.p.", "s.c.", "p.o.", "b.i.d.", "t.i.d.", "q.d.",
)

val INITIAL_TERMINAL_PRECEDERS: Set<String> = setOf(
    "group", "groups", "vitamin", "type", "phase", "class", "stage", "grade",
    "arm", "cohort", "panel", "figure", "table", "appendix", "part", "section",
    "condition", "site", "strain", "model", "protocol", "hepatitis", "factor",
    "version", "plan", "schedule", "block", "ward", "zone", "level",
)

data class SegmentedSentence(
    val start: Int,
    val end: Int,
    val rawText: String,
    val maskedText: String,
    val markers: List<CitationMarker>,
    val section: CanonicalSectionLabel,
    val subsection: String?,
    val normText: String,
    val sentenceHash: String,
    val occurrenceIndex: Int,
    val eligible: Boolean,
    val wordCount: Int,
)

data class SegmentOptions(
    val frontMatterMath: Boolean? = null,
    val preMaskResult: PreMaskResult? = null,
    val citationOptions: ScanCitationsOptions? = null,
    val customCiteMacros: Set<String>? = null,
    val report: ImportQualityReport? = null,
)

data class SegmentDocumentResult(
    val sentences: List<SegmentedSentence>,
    val preMaskResult: PreMaskResult,
    val allMarkers: List<CitationMarker>,
    val report: ImportQualityReport,
)

private fun isMaskCode(code: Int): Boolean = code == 0xE000

private fun isHorizontalSpaceCode(code: Int): Boolean = code == 0x20 || code == 0x09

private fun isOpeningDelimiterChar(cp: Int): Boolean =
    cp == 0x28 || cp == 0x5B || cp == 0x7B || cp == 0x22 || cp == 0x27 || cp == 0x201C || cp == 0x2018

private fun stripLeadingOpenDelimiters(token: String): String {
    var i = 0
    while (i < token.length) {
        val unit = codePointAtSafe(token, i)
        if (unit.isUnpairedSurrogate || !isOpeningDelimiterChar(unit.cp)) break
        i += unit.len
    }
    return token.substring(i)
}

private fun isAsciiAlphaCode(cu: Int): Boolean = (cu in 65..90) || (cu in 97..122)

private fun isAsciiDigitCode(cu: Int): Boolean = cu in 48..57

private fun extractFirstWordSpan(
    text: String,
    start: Int,
    limit: Int,
    insideMarkerMask: BooleanArray?,
    markerByStart: Map<Int, CitationMarker>?,
): WordSpan? {
    var i = start
    var nonMarkerSteps = 0
    var markersSkipped = 0
    while (i < limit && nonMarkerSteps < 160) {
        if (insideMarkerMask != null && insideMarkerMask[i]) {
            val m = markerByStart?.get(i)
            if (m != null && m.end > i) {
                markersSkipped++
                if (markersSkipped >= 8) return null
                i = minOf(limit, m.end)
                continue
            }
            nonMarkerSteps++
            i++
            continue
        }
        nonMarkerSteps++
        val cu = text[i].code
        if (cu == 0xE000) {
            i++
            continue
        }
        val wordStart: Int
        var cur: Int
        var prevIsLetter: Boolean

        if (cu < 0x80) {
            if (isAsciiAlphaCode(cu)) {
                wordStart = i
                prevIsLetter = true
                cur = i + 1
            } else if (isAsciiDigitCode(cu)) {
                wordStart = i
                prevIsLetter = false
                cur = i + 1
            } else {
                i++
                continue
            }
        } else {
            val unit = codePointAtSafe(text, i)
            if (unit.isUnpairedSurrogate) {
                i += unit.len
                continue
            }
            val startIsLetter = isLetter(unit.cp, false)
            if (startIsLetter || isDigit(unit.cp)) {
                wordStart = i
                prevIsLetter = startIsLetter
                cur = i + unit.len
            } else {
                i += unit.len
                continue
            }
        }

        while (cur < limit) {
            if (insideMarkerMask != null && insideMarkerMask[cur]) break
            val nextCu = text[cur].code
            if (nextCu == 0xE000) break
            if (nextCu < 0x80) {
                if (isAsciiAlphaCode(nextCu)) {
                    prevIsLetter = true
                    cur++
                    continue
                }
                if (isAsciiDigitCode(nextCu)) {
                    prevIsLetter = false
                    cur++
                    continue
                }
                if ((nextCu == 0x27 || nextCu == 0x2D) &&
                    cur + 1 < limit &&
                    (insideMarkerMask == null || !insideMarkerMask[cur + 1])
                ) {
                    val afterCu = text[cur + 1].code
                    if (afterCu != 0xE000) {
                        if (afterCu < 0x80) {
                            if (isAsciiAlphaCode(afterCu) || isAsciiDigitCode(afterCu)) {
                                prevIsLetter = isAsciiAlphaCode(afterCu)
                                cur += 2
                                continue
                            }
                        } else {
                            val after = codePointAtSafe(text, cur + 1)
                            if (!after.isUnpairedSurrogate) {
                                val afterIsLetter = isLetter(after.cp, false)
                                if (afterIsLetter || isDigit(after.cp)) {
                                    prevIsLetter = afterIsLetter
                                    cur += 1 + after.len
                                    continue
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
                prevIsLetter = nextIsLetter
                cur += nextUnit.len
                continue
            }
            break
        }

        return WordSpan(wordStart, cur, text.substring(wordStart, cur))
    }
    return null
}

private fun extractLastWordSpanBefore(
    text: String,
    startBound: Int,
    endBound: Int,
): WordSpan? {
    var cursor = endBound
    var foundWordBase = false
    while (cursor > startBound) {
        val cu1 = text[cursor - 1].code
        if (cu1 < 0x80) {
            if (isAsciiAlphaCode(cu1) || isAsciiDigitCode(cu1)) {
                foundWordBase = true
                break
            }
            cursor--
            continue
        }
        if (cu1 in 0xDC00..0xDFFF && cursor - 2 >= startBound) {
            val cu0 = text[cursor - 2].code
            if (cu0 in 0xD800..0xDBFF) {
                val cp = 0x10000 + (((cu0 - 0xD800) shl 10) or (cu1 - 0xDC00))
                if (isBaseLetter(cp) || isDigit(cp)) {
                    foundWordBase = true
                    break
                }
                cursor -= 2
                continue
            }
        }
        if (cu1 in 0xD800..0xDFFF) {
            cursor--
            continue
        }
        if (isBaseLetter(cu1) || isDigit(cu1)) {
            foundWordBase = true
            break
        }
        cursor--
    }

    if (!foundWordBase) return null

    var localStart = cursor
    while (localStart > startBound) {
        val cu = text[localStart - 1].code
        if (cu == 0xE000) break
        if (cu < 0x80) {
            if (isAsciiAlphaCode(cu) || isAsciiDigitCode(cu) || cu == 0x27 || cu == 0x2D) {
                localStart--
                continue
            }
            break
        }
        if (cu in 0xDC00..0xDFFF && localStart - 2 >= startBound) {
            val cu0 = text[localStart - 2].code
            if (cu0 in 0xD800..0xDBFF) {
                val cp = 0x10000 + (((cu0 - 0xD800) shl 10) or (cu - 0xDC00))
                if (isBaseLetter(cp) || isDigit(cp) || isCombiningMark(cp)) {
                    localStart -= 2
                    continue
                }
                break
            }
        }
        if (cu in 0xD800..0xDFFF) break
        if (isBaseLetter(cu) || isDigit(cu) || isCombiningMark(cu)) {
            localStart--
            continue
        }
        break
    }

    val words = extractWordSpans(text, localStart, endBound)
    return words.lastOrNull()
}

private fun countLettersInString(s: String): Int {
    var count = 0
    var i = 0
    var prevIsLetter = false
    while (i < s.length) {
        val unit = codePointAtSafe(s, i)
        if (!unit.isUnpairedSurrogate && isLetter(unit.cp, prevIsLetter)) {
            count++
            prevIsLetter = true
        } else {
            prevIsLetter = false
        }
        i += unit.len
    }
    return count
}

private fun isSingleUpperInitialWithDot(cleanToken: String): Boolean {
    if (!cleanToken.endsWith(".") || cleanToken.length < 2) return false
    val body = cleanToken.substring(0, cleanToken.length - 1)
    val first = codePointAtSafe(body, 0)
    if (first.isUnpairedSurrogate || !isUpper(first.cp)) return false
    var pos = first.len
    while (pos < body.length) {
        val next = codePointAtSafe(body, pos)
        if (next.isUnpairedSurrogate || !isLetter(next.cp, true) || isUpper(next.cp) || isLower(next.cp)) {
            return false
        }
        if (isLetter(next.cp, false)) return false
        pos += next.len
    }
    return pos == body.length
}

private fun matchesLowercaseBoundaryException(wordText: String): Boolean {
    var pos = 0
    var lowerCount = 0
    while (pos < wordText.length && lowerCount < 4) {
        val unit = codePointAtSafe(wordText, pos)
        if (unit.isUnpairedSurrogate) return false
        if (isLower(unit.cp)) {
            lowerCount++
            pos += unit.len
            continue
        }
        if (isLetter(unit.cp, true) && !isLetter(unit.cp, false) && lowerCount > 0) {
            pos += unit.len
            continue
        }
        break
    }

    if (lowerCount !in 1..3 || pos >= wordText.length) return false
    val unitAfter = codePointAtSafe(wordText, pos)
    if (unitAfter.isUnpairedSurrogate) return false
    if (isUpper(unitAfter.cp) || isDigit(unitAfter.cp)) return true

    if (lowerCount <= 2 && unitAfter.cp == 0x2D && pos + 1 < wordText.length) {
        val unitPastHyphen = codePointAtSafe(wordText, pos + 1)
        if (!unitPastHyphen.isUnpairedSurrogate &&
            (isLetter(unitPastHyphen.cp, false) || isDigit(unitPastHyphen.cp))
        ) {
            return true
        }
    }
    return false
}

private fun isInlineNumberedListTokenAt(text: String, pos: Int, limit: Int): Boolean {
    var d = 0
    while (pos + d < limit && d < 3 && isDigit(text[pos + d].code)) d++
    return (d == 1 || d == 2) && pos + d < limit && text[pos + d].code == 0x29
}

private fun isCompletelyEnclosedInQuotes(trimmed: String): Boolean {
    val n = trimmed.length
    if (n < 2) return false
    val first = trimmed[0].code
    val last = trimmed[n - 1].code

    if (first == 0x22 && last == 0x22) {
        for (i in 1 until n - 1) {
            if (trimmed[i].code == 0x22) return false
        }
        return true
    }
    if (first == 0x27 && last == 0x27) {
        for (i in 1 until n - 1) {
            if (trimmed[i].code == 0x27) return false
        }
        return true
    }
    if (first == 0x201C && last == 0x201D) {
        var depth = 0
        for (i in 0 until n - 1) {
            val ch = trimmed[i].code
            if (ch == 0x201C) depth++
            else if (ch == 0x201D) {
                depth--
                if (depth <= 0) return false
            }
        }
        return depth == 1
    }
    if (first == 0x2018 && last == 0x2019) {
        var depth = 0
        for (i in 0 until n - 1) {
            val ch = trimmed[i].code
            if (ch == 0x2018) depth++
            else if (ch == 0x2019) {
                depth--
                if (depth <= 0) return false
            }
        }
        return depth == 1
    }
    return false
}

data class Stage1EligibilityResult(
    val eligible: Boolean,
    val wordCount: Int,
)

fun checkStage1Eligibility(
    rawText: String,
    maskedText: String,
    markers: List<CitationMarker>,
    section: CanonicalSectionLabel,
    sentenceStartInWorkingCopy: Int = 0,
): Stage1EligibilityResult {
    val relativeExclusions = markers.map { m ->
        TextRange(m.start - sentenceStartInWorkingCopy, m.end - sentenceStartInWorkingCopy)
    }
    val stats = getWordSpanStats(maskedText, 0, maskedText.length, relativeExclusions)

    var hasNonMaskNonSpace = false
    for (i in maskedText.indices) {
        val ch = maskedText[i].code
        if (!isSpace(ch) && !isMaskCode(ch)) {
            hasNonMaskNonSpace = true
            break
        }
    }

    var trimLeft = 0
    while (trimLeft < rawText.length && isSpace(rawText[trimLeft].code)) trimLeft++
    var trimRight = rawText.length
    while (trimRight > trimLeft && isSpace(rawText[trimRight - 1].code)) trimRight--
    val trimmedRaw = rawText.substring(trimLeft, trimRight)

    val eligible = stats.wordCount >= 6 &&
        hasNonMaskNonSpace &&
        stats.hasLongWord &&
        section != CanonicalSectionLabel.REFERENCES &&
        !isCompletelyEnclosedInQuotes(trimmedRaw)

    return Stage1EligibilityResult(eligible, stats.wordCount)
}

private data class HardSegmentRange(val start: Int, val end: Int)

private fun collectMdListMarkerPrefixLen(text: String, lineStart: Int, lineEnd: Int): Int {
    var sp = 0
    while (lineStart + sp < lineEnd && isHorizontalSpaceCode(text[lineStart + sp].code)) sp++
    val p = lineStart + sp
    if (p + 1 < lineEnd) {
        val ch = text[p].code
        if ((ch == 45 || ch == 42 || ch == 43) && text[p + 1].code == 32) {
            return p + 2 - lineStart
        }
    }
    if (p < lineEnd && isDigit(text[p].code)) {
        var d = 0
        while (p + d < lineEnd && d < 4 && isDigit(text[p + d].code)) d++
        if (d in 1..3 &&
            p + d + 1 < lineEnd &&
            text[p + d].code == 46 &&
            text[p + d + 1].code == 32
        ) {
            return p + d + 2 - lineStart
        }
    }
    return 0
}

private fun buildProseHardRanges(
    maskedText: String,
    format: SourceFormat,
    preMaskRes: PreMaskResult,
): List<HardSegmentRange> {
    val n = maskedText.length
    val blocked = preMaskRes.blockRegions.sortedBy { it.start }
    val blockMask = BooleanArray(n)
    for (r in blocked) {
        val s = maxOf(0, r.start)
        val e = minOf(n, r.end)
        for (k in s until e) blockMask[k] = true
    }

    val cutSet = HashSet<Int>()
    for (itemStart in preMaskRes.listItemStarts) {
        if (itemStart in 0 until n) cutSet.add(itemStart)
    }

    val ranges = mutableListOf<HardSegmentRange>()
    var cursor = 0

    while (cursor < n) {
        if (blockMask[cursor]) {
            cursor++
            continue
        }
        val segStart = cursor
        var pos = cursor

        while (pos < n && !blockMask[pos]) {
            if (pos > segStart && pos in cutSet) break
            val ch = maskedText[pos].code
            if (ch == 10 || ch == 13) {
                val afterFirstNl = if (ch == 13 && pos + 1 < n && maskedText[pos + 1].code == 10) pos + 2 else pos + 1
                var look = afterFirstNl
                while (look < n && !blockMask[look] && isHorizontalSpaceCode(maskedText[look].code)) look++
                if (look < n && !blockMask[look] && (maskedText[look].code == 10 || maskedText[look].code == 13)) {
                    break
                }
                if (format == SourceFormat.MD && afterFirstNl < n && !blockMask[afterFirstNl]) {
                    var lineEnd = afterFirstNl
                    while (lineEnd < n &&
                        !blockMask[lineEnd] &&
                        maskedText[lineEnd].code != 10 &&
                        maskedText[lineEnd].code != 13
                    ) {
                        lineEnd++
                    }
                    if (collectMdListMarkerPrefixLen(maskedText, afterFirstNl, lineEnd) > 0) {
                        ranges.add(HardSegmentRange(segStart, pos))
                        cursor = afterFirstNl
                        pos = -1
                        break
                    }
                }
            }
            pos++
        }

        if (pos == -1) continue
        if (pos > segStart) ranges.add(HardSegmentRange(segStart, pos))
        cursor = pos
        while (cursor < n && !blockMask[cursor]) {
            val c = maskedText[cursor].code
            if (isSpace(c) && (c == 10 || c == 13 || cursor > pos)) {
                cursor++
            } else {
                break
            }
        }
        if (cursor == pos && pos in cutSet) {
            while (cursor < n && blockMask[cursor]) cursor++
        }
    }

    return ranges
}

fun segmentDocument(
    source: String,
    format: SourceFormat,
    options: SegmentOptions? = null,
): SegmentDocumentResult {
    val useDirectSource = options?.preMaskResult != null
    val normRes = if (useDirectSource) null else norm(source)
    val workSource = normRes?.text ?: source

    val preMaskRes = options?.preMaskResult ?: preMask(
        workSource,
        format,
        PreMaskOptions(
            frontMatterMath = options?.frontMatterMath,
            report = options?.report,
        ),
    )

    val masked = preMaskRes.maskedText
    val n = masked.length

    val citOpts = options?.citationOptions
    val allMarkers = scanCitations(
        masked,
        ScanCitationsOptions(
            customCiteMacros = options?.customCiteMacros ?: preMaskRes.customCiteMacros,
            hasKnownNumberingOrder = citOpts?.hasKnownNumberingOrder,
            numberedBibSize = citOpts?.numberedBibSize,
            bibKeys = citOpts?.bibKeys,
            docxMarkers = citOpts?.docxMarkers,
        ),
    )

    val markerByStart = HashMap<Int, CitationMarker>(allMarkers.size * 2)
    for (m in allMarkers) markerByStart[m.start] = m

    val insideMarkerMask = BooleanArray(n)
    for (m in allMarkers) {
        val s = maxOf(0, m.start)
        val e = minOf(n, m.end)
        for (k in s until e) insideMarkerMask[k] = true
    }

    val hardRanges = buildProseHardRanges(masked, format, preMaskRes)
    val sentences = mutableListOf<SegmentedSentence>()
    val hashCounts = HashMap<String, Int>()

    val transitions = preMaskRes.sectionTransitions
    val mathRegions = preMaskRes.mathRegions
    val preRegions = preMaskRes.regions
    var markerCursor = 0
    var secCursor = 0
    var currentSecState = SectionState(CanonicalSectionLabel.UNLABELED, null)
    var mathCursor = 0
    var regionCursor = 0

    fun emitSentenceSpan(segStart: Int, segEnd: Int) {
        var s = segStart
        while (s < segEnd) {
            val ch = masked[s].code
            if (isSpace(ch) || isMaskCode(ch)) s++ else break
        }
        var e = segEnd
        while (e > s) {
            val ch = masked[e - 1].code
            if (isSpace(ch) || isMaskCode(ch)) e-- else break
        }
        if (s >= e) return

        val workMaskedSlice = masked.substring(s, e)
        val workRawSlice = workSource.substring(s, e)
        val rawStart = normRes?.map?.getOrNull(s) ?: s
        val rawEnd = normRes?.map?.getOrNull(e) ?: e
        val rawTextSlice = source.substring(rawStart, rawEnd)

        while (markerCursor < allMarkers.size && allMarkers[markerCursor].end <= s) {
            markerCursor++
        }
        val sentMarkers = mutableListOf<CitationMarker>()
        for (mIdx in markerCursor until allMarkers.size) {
            val m = allMarkers[mIdx]
            if (m.start >= e) break
            if (m.start >= s && m.end <= e) {
                sentMarkers.add(m.copy(start = m.start - s, end = m.end - s))
            }
            if (m.end <= e) {
                markerCursor = mIdx + 1
            }
        }

        while (secCursor < transitions.size && transitions[secCursor].offset <= s) {
            currentSecState = transitions[secCursor].state
            secCursor++
        }
        val secState = currentSecState

        while (mathCursor < mathRegions.size && mathRegions[mathCursor].end <= s) {
            mathCursor++
        }
        val relMath = mutableListOf<MathSpanInput>()
        for (mrIdx in mathCursor until mathRegions.size) {
            val mr = mathRegions[mrIdx]
            if (mr.start >= e) break
            if (mr.start >= s && mr.end <= e) {
                relMath.add(MathSpanInput(mr.start - s, mr.end - s, mr.text))
            }
            if (mr.end <= e) {
                mathCursor = mrIdx + 1
            }
        }

        while (regionCursor < preRegions.size && preRegions[regionCursor].end <= s) {
            regionCursor++
        }
        val relMasked = mutableListOf<TextRange>()
        for (rIdx in regionCursor until preRegions.size) {
            val r = preRegions[rIdx]
            if (r.start >= e) break
            if (r.kind != MaskedRegionKind.INLINE_MATH &&
                r.kind != MaskedRegionKind.DISPLAY_MATH &&
                r.end > s &&
                r.start < e
            ) {
                relMasked.add(TextRange(maxOf(0, r.start - s), minOf(e - s, r.end - s)))
            }
            if (r.end <= e) {
                regionCursor = rIdx + 1
            }
        }

        val normText = normSentence(
            workRawSlice,
            NormSentenceOptions(
                format = format,
                markerRanges = sentMarkers,
                mathRegions = relMath,
                maskedRegions = relMasked,
                userMacros = preMaskRes.userMacros,
                customCiteMacros = preMaskRes.customCiteMacros,
            ),
        )
        val hash = sha256hex(normText)
        val prevOcc = hashCounts[hash] ?: 0
        hashCounts[hash] = prevOcc + 1

        val elig = checkStage1Eligibility(workRawSlice, workMaskedSlice, sentMarkers, secState.label, 0)

        sentences.add(
            SegmentedSentence(
                start = rawStart,
                end = rawEnd,
                rawText = rawTextSlice,
                maskedText = workMaskedSlice,
                markers = sentMarkers,
                section = secState.label,
                subsection = secState.subsection,
                normText = normText,
                sentenceHash = hash,
                occurrenceIndex = prevOcc,
                eligible = elig.eligible,
                wordCount = elig.wordCount,
            ),
        )
    }

    for (hr in hardRanges) {
        var sentStart = hr.start
        var i = hr.start

        var mdListDotSkip = -1
        if (format == SourceFormat.MD) {
            var lineEnd = hr.start
            while (lineEnd < hr.end && masked[lineEnd].code != 10 && masked[lineEnd].code != 13) {
                lineEnd++
            }
            val pLen = collectMdListMarkerPrefixLen(masked, hr.start, lineEnd)
            if (pLen >= 3 && masked[hr.start + pLen - 2].code == 46) {
                mdListDotSkip = hr.start + pLen - 2
            }
        }

        while (i < hr.end) {
            val cu = masked[i].code
            if (isMaskCode(cu) || insideMarkerMask[i] || i == mdListDotSkip || !isPunctSent(cu)) {
                i++
                continue
            }

            var b = i + 1
            while (b < hr.end && isCloser(masked[b].code)) b++
            while (b < hr.end) {
                val att = markerByStart[b]
                if (att != null && att.end <= hr.end) {
                    b = att.end
                    continue
                }
                break
            }
            while (b < hr.end && isCloser(masked[b].code)) b++

            val isValidFollower = b >= hr.end || isSpace(masked[b].code) || isMaskCode(masked[b].code)
            if (!isValidFollower) {
                i++
                continue
            }

            var afterSpace = b
            while (afterSpace < hr.end &&
                (isSpace(masked[afterSpace].code) || isMaskCode(masked[afterSpace].code))
            ) {
                afterSpace++
            }

            var look = afterSpace
            var spacedCitationEnd = -1
            if (b < hr.end && isSpace(masked[b].code)) {
                val spacedMarker = markerByStart[look]
                if (spacedMarker != null &&
                    spacedMarker.end <= hr.end &&
                    (spacedMarker.rule == CitationRuleKind.NUMERIC_BRACKET ||
                        spacedMarker.rule == CitationRuleKind.DOCX_SUPERSCRIPT)
                ) {
                    spacedCitationEnd = spacedMarker.end
                    look = spacedMarker.end
                    while (look < hr.end &&
                        (isSpace(masked[look].code) || isMaskCode(masked[look].code))
                    ) {
                        look++
                    }
                }
            }

            var rejected = false
            val nextWord = extractFirstWordSpan(masked, look, hr.end, insideMarkerMask, markerByStart)

            var lookPastQuotes = look
            while (lookPastQuotes < hr.end &&
                (masked[lookPastQuotes].code == 0x22 ||
                    masked[lookPastQuotes].code == 0x27 ||
                    masked[lookPastQuotes].code == 0x201C ||
                    masked[lookPastQuotes].code == 0x2018)
            ) {
                lookPastQuotes++
            }
            val nextMarker = markerByStart[lookPastQuotes]
            val startsWithNarrativeCitation = nextMarker != null && nextMarker.narrative

            if (cu == 46) {
                if (i > hr.start &&
                    i + 1 < hr.end &&
                    isDigit(masked[i - 1].code) &&
                    isDigit(masked[i + 1].code)
                ) {
                    rejected = true
                }

                if (!rejected) {
                    var tokStart = i
                    while (tokStart > sentStart) {
                        val cPrev = masked[tokStart - 1].code
                        if (isSpace(cPrev) || isMaskCode(cPrev) || insideMarkerMask[tokStart - 1]) break
                        tokStart--
                    }
                    val rawTok = masked.substring(tokStart, i + 1)
                    val cleanTok = stripLeadingOpenDelimiters(rawTok)
                    val cleanLower = normLower(cleanTok)

                    if (cleanLower in CLASS_N_ABBREVS) {
                        rejected = true
                    }

                    if (!rejected && cleanLower in CLASS_T_ABBREVS) {
                        if (!startsWithNarrativeCitation && nextWord != null) {
                            val nwFirst = codePointAtSafe(nextWord.text, 0)
                            val nwLetters = countLettersInString(nextWord.text)
                            val nwFollowedByDot = nwLetters == 1 &&
                                nextWord.end < hr.end &&
                                masked[nextWord.end].code == 46
                            if (nwFirst.isUnpairedSurrogate ||
                                !isUpper(nwFirst.cp) ||
                                nwLetters < 2 ||
                                nwFollowedByDot
                            ) {
                                rejected = true
                            }
                        }
                    }

                    if (!rejected && isSingleUpperInitialWithDot(cleanTok)) {
                        val cleanTokOffset = tokStart + (rawTok.length - cleanTok.length)
                        val prevW = extractLastWordSpanBefore(masked, sentStart, cleanTokOffset)
                        val prevLower = if (prevW != null) normLower(prevW.text) else ""
                        val hasValidPreceder = prevLower in INITIAL_TERMINAL_PRECEDERS
                        var hasValidNext = startsWithNarrativeCitation
                        if (!hasValidNext && nextWord != null) {
                            val nwFirst = codePointAtSafe(nextWord.text, 0)
                            hasValidNext = !nwFirst.isUnpairedSurrogate &&
                                isUpper(nwFirst.cp) &&
                                countLettersInString(nextWord.text) >= 2
                        }
                        if (!(hasValidPreceder && hasValidNext)) {
                            rejected = true
                        }
                    }
                }
            }

            if (!rejected && !startsWithNarrativeCitation && nextWord != null) {
                val nwFirst = codePointAtSafe(nextWord.text, 0)
                if (!nwFirst.isUnpairedSurrogate && isLower(nwFirst.cp)) {
                    if (!matchesLowercaseBoundaryException(nextWord.text)) {
                        rejected = true
                    }
                }
            }

            if (!rejected && isInlineNumberedListTokenAt(masked, look, hr.end)) {
                rejected = true
            }

            if (rejected) {
                i = b
                continue
            }

            val finalBoundary = if (spacedCitationEnd != -1) spacedCitationEnd else b
            emitSentenceSpan(sentStart, finalBoundary)
            sentStart = finalBoundary
            i = finalBoundary
        }

        if (sentStart < hr.end) {
            emitSentenceSpan(sentStart, hr.end)
        }
    }

    return SegmentDocumentResult(
        sentences = sentences,
        preMaskResult = preMaskRes,
        allMarkers = allMarkers,
        report = preMaskRes.report,
    )
}

fun computeClaimId(
    docId: String,
    sentenceHash: String,
    occurrenceIndex: Int,
    clauseIndex: Int,
): String = sha256hex("$docId|$sentenceHash|$occurrenceIndex|$clauseIndex").substring(0, 32)
