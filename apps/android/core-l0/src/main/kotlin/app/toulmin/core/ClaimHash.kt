package app.toulmin.core

data class ClaimNormOptions(
    val lang: String? = null,
    val format: SourceFormat? = null,
    val applyLatex: Boolean? = null,
)

private data class NumberReplacement(
    val startNorm: Int,
    val endNorm: Int,
    val token: String,
)

private fun scanNumberTokensForClaim(prep: PreparedInput): List<NumberReplacement> {
    val normText = prep.normText
    val normLowerText = prep.normLowerText
    val isEnglish = prep.isEnglish
    val n = normText.length
    val pctContext = hasPercentageContext(normLowerText)
    val out = ArrayList<NumberReplacement>()
    var lastClaimTokEnd = 0
    var i = 0

    while (i < n) {
        val cu = normText[i].code
        if (cu == 46 && (i + 1 >= n || !isAsciiDigitCode(normText[i + 1].code))) {
            while (i < n && normText[i].code == 46 && (i + 1 >= n || !isAsciiDigitCode(normText[i + 1].code))) {
                i++
            }
            continue
        }

        val dateEnd = if (isAsciiDigitCode(cu)) matchDateEndAt(normText, i) else -1
        if (dateEnd != -1) {
            i = dateEnd
            continue
        }

        val num = if (isAsciiDigitCode(cu) || cu == 45 || cu == 43 || cu == 46) {
            parseNumberOrScientificAt(normText, prep.subText, prep.normMap, i, isEnglish, true)
        } else {
            null
        }
        if (num != null) {
            if (!num.value.isFinite()) {
                lastClaimTokEnd = num.endNorm
                i = num.endNorm
                continue
            }
            val suf = scanSuffixUnitFast(
                normText,
                normLowerText,
                num.endNorm,
                pctContext,
                num.isYearIntCandidate,
            )
            val prefix = if (suf == null) scanPrefixUnit(normText, normLowerText, i, lastClaimTokEnd) else null
            val effPrefix = if (prefix != null && !prefix.isSampleSizePrefix && !prefix.isRatioPrefix) prefix else null

            var startNorm = i
            var endNorm = num.endNorm
            var unitStr = ""
            var factor = 1.0

            if (suf != null) {
                endNorm = suf.endNorm
                factor = suf.factor
                unitStr = if (suf.family == UnitFamily.UNKNOWN) {
                    val s0 = if (suf.startNorm in prep.normMap.indices) prep.normMap[suf.startNorm] else 0
                    val s1 = if (suf.endNorm in prep.normMap.indices) prep.normMap[suf.endNorm] else prep.subText.length
                    prep.subText.substring(s0, s1)
                } else {
                    suf.unitCanon
                }
            } else if (effPrefix != null) {
                startNorm = effPrefix.startNorm
                factor = effPrefix.factor
                unitStr = effPrefix.unitCanon
            }

            val scaled = scaleParsedNumber(num, factor)
            if (!scaled.isFinite()) {
                lastClaimTokEnd = endNorm
                i = endNorm
                continue
            }
            val canonVal = formatCanonicalDecimal(scaled)
            out.add(NumberReplacement(startNorm, endNorm, "\u27E8v:$canonVal$unitStr\u27E9"))
            lastClaimTokEnd = endNorm
            i = endNorm
            continue
        }

        val firstCp = if (cu < 0x80) cu else codePointAtSafe(normText, i).cp
        if (isBaseLetter(firstCp)) {
            val leadCur = scanLeadingPrefixCurrency(normText, normLowerText, i)
            if (leadCur != null && leadCur.endNorm < n && isAsciiDigitCode(normText[leadCur.endNorm].code)) {
                val curNum = parseNumberOrScientificAt(
                    normText, prep.subText, prep.normMap, leadCur.endNorm, isEnglish, false, true,
                )
                if (curNum != null && curNum.value.isFinite()) {
                    val suf = scanSuffixUnitFast(
                        normText,
                        normLowerText,
                        curNum.endNorm,
                        pctContext,
                        curNum.isYearIntCandidate,
                    )
                    if (suf == null) {
                        val canonVal = formatCanonicalDecimal(scaleParsedNumber(curNum, leadCur.factor))
                        out.add(
                            NumberReplacement(
                                leadCur.startNorm,
                                curNum.endNorm,
                                "\u27E8v:$canonVal${leadCur.unitCanon}\u27E9",
                            ),
                        )
                        lastClaimTokEnd = curNum.endNorm
                        i = curNum.endNorm
                        continue
                    }
                }
            }
            while (i < n) {
                val c = normText[i].code
                if (c < 0x80) {
                    if (isBaseLetter(c) || isAsciiDigitCode(c)) {
                        i++
                    } else {
                        break
                    }
                } else {
                    val u = codePointAtSafe(normText, i)
                    if (isBaseLetter(u.cp) || isDigit(u.cp)) {
                        i += u.len
                    } else {
                        break
                    }
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

        i += if (cu < 0x80) 1 else codePointAtSafe(normText, i).len
    }

    return out
}

fun normalizedClaim(claimText: String, options: ClaimNormOptions? = null): String {
    val prep = prepareInput(
        claimText,
        PrepareInputOptions(
            lang = options?.lang,
            format = options?.format,
            applyLatex = options?.applyLatex,
        ),
    )
    val normLowerText = prep.normLowerText
    val n = normLowerText.length
    val replacements = scanNumberTokensForClaim(prep)

    val out = StringBuilder(n + replacements.size * 8)
    var hasEmitted = false
    var needSpace = false

    fun appendCleanedRange(startIdx: Int, endIdx: Int) {
        var idx = startIdx
        while (idx < endIdx) {
            val cu = normLowerText[idx].code
            if (cu < 0x80) {
                if ((cu in 97..122) || (cu in 48..57)) {
                    val runStart = idx
                    idx += 1
                    while (idx < endIdx) {
                        val c = normLowerText[idx].code
                        if ((c in 97..122) || (c in 48..57)) {
                            idx += 1
                        } else {
                            break
                        }
                    }
                    if (needSpace && hasEmitted) out.append(' ')
                    out.append(normLowerText, runStart, idx)
                    hasEmitted = true
                    needSpace = false
                    continue
                }
                if (cu == 32 || cu == 10 || cu == 9 || cu == 13) {
                    if (hasEmitted) needSpace = true
                    idx += 1
                    continue
                }
                if (cu == 60 /* '<' */) {
                    if (idx + 1 < endIdx && normLowerText[idx + 1].code == 61) {
                        if (hasEmitted) out.append(' ')
                        out.append('\u2264')
                        idx += 2
                    } else {
                        if (hasEmitted) out.append(' ')
                        out.append('<')
                        idx += 1
                    }
                    hasEmitted = true
                    needSpace = true
                    continue
                }
                if (cu == 62 /* '>' */) {
                    if (idx + 1 < endIdx && normLowerText[idx + 1].code == 61) {
                        if (hasEmitted) out.append(' ')
                        out.append('\u2265')
                        idx += 2
                    } else {
                        if (hasEmitted) out.append(' ')
                        out.append('>')
                        idx += 1
                    }
                    hasEmitted = true
                    needSpace = true
                    continue
                }
                if (cu == 61 /* '=' */) {
                    if (hasEmitted) out.append(' ')
                    out.append('=')
                    hasEmitted = true
                    needSpace = true
                    idx += 1
                    continue
                }
                if (!isPunctuation(cu)) {
                    if (isSpace(cu)) {
                        if (hasEmitted) needSpace = true
                    } else {
                        if (needSpace && hasEmitted) out.append(' ')
                        out.append(normLowerText[idx])
                        hasEmitted = true
                        needSpace = false
                    }
                }
                idx += 1
                continue
            }

            if (cu == 0x2264 || cu == 0x2265 || cu == 0x00B1 /* '±' */) {
                if (hasEmitted) out.append(' ')
                out.append(normLowerText[idx])
                hasEmitted = true
                needSpace = true
                idx += 1
                continue
            }

            val u = codePointAtSafe(normLowerText, idx)
            if (!isPunctuation(u.cp)) {
                if (isSpace(u.cp)) {
                    if (hasEmitted) needSpace = true
                } else {
                    if (needSpace && hasEmitted) out.append(' ')
                    out.append(normLowerText, idx, idx + u.len)
                    hasEmitted = true
                    needSpace = false
                }
            }
            idx += u.len
        }
    }

    var cursor = 0
    for (r in replacements.indices) {
        val rep = replacements[r]
        if (rep.startNorm > cursor) {
            appendCleanedRange(cursor, rep.startNorm)
        }
        if (needSpace && hasEmitted) out.append(' ')
        out.append(rep.token)
        hasEmitted = true
        needSpace = false
        cursor = rep.endNorm
    }
    if (cursor < n) {
        appendCleanedRange(cursor, n)
    }

    return out.toString()
}

fun normalizedClaimHash(claimText: String, options: ClaimNormOptions? = null): String =
    sha256hex(normalizedClaim(claimText, options))
