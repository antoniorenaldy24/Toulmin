package app.toulmin.core

enum class SanitizeTier(val wireName: String) {
    CLEAN("clean"),
    LOGGED("logged"),
    BLOCKED("blocked"),
    ;

    companion object {
        fun fromWireName(wire: String): SanitizeTier =
            entries.firstOrNull { it.wireName == wire }
                ?: error("Unknown SanitizeTier: $wire")
    }
}

enum class MetadataFieldName(val wireName: String) {
    TITLE("title"),
    VENUE("venue"),
    FIRST_AUTHOR("first_author"),
    DOI("doi"),
    ;

    companion object {
        fun fromWireName(wire: String): MetadataFieldName =
            entries.firstOrNull { it.wireName == wire }
                ?: error("Unknown MetadataFieldName: $wire")
    }
}

const val INVISIBLE_CHARS_BLOCK_THRESHOLD = 3
const val MIXED_SCRIPT_BLOCK_THRESHOLD = 2
const val INJ12_URL_MAX_LEN = 200
const val DOI_SUFFIX_MAX_LEN = 300
const val DOI_PREFIX_MIN_DIGITS = 4
const val DOI_PREFIX_MAX_DIGITS = 9

data class SanitizeOptions(
    val hiddenPdfText: Boolean = false,
)

class SanitizeResult(
    val text: String,
    val map: IntArray,
    val detectText: String,
    val tier: SanitizeTier,
    val reasons: List<String>,
    val blockReasons: List<String>,
    val logReasons: List<String>,
    val blocked: Boolean,
    val invisibleCharCount: Int,
    val mixedScriptWordCount: Int,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SanitizeResult) return false
        return text == other.text &&
            map.contentEquals(other.map) &&
            detectText == other.detectText &&
            tier == other.tier &&
            reasons == other.reasons &&
            blockReasons == other.blockReasons &&
            logReasons == other.logReasons &&
            blocked == other.blocked &&
            invisibleCharCount == other.invisibleCharCount &&
            mixedScriptWordCount == other.mixedScriptWordCount
    }

    override fun hashCode(): Int {
        var result = text.hashCode()
        result = 31 * result + map.contentHashCode()
        result = 31 * result + detectText.hashCode()
        result = 31 * result + tier.hashCode()
        result = 31 * result + reasons.hashCode()
        return result
    }
}

data class SanitizeMetadataResult(
    val field: MetadataFieldName,
    val value: String,
    val withheld: Boolean,
    val sanitizeResult: SanitizeResult,
)

private fun buildCodePointMap(record: Map<String, String>): Map<Int, String> {
    val out = HashMap<Int, String>(record.size * 2)
    for ((k, v) in record) {
        if (k.isNotEmpty()) {
            out[codePointAtSafe(k, 0).cp] = v
        }
    }
    return out
}

private val SYMBOL_PUA_MAP: Map<Int, String> by lazy { buildCodePointMap(NormTableData.normTable.symbolPuaTable) }
private val COMPAT_FOLD_MAP: Map<Int, String> by lazy { buildCodePointMap(NormTableData.normTable.compatFold) }
private val CONFUSABLES_MAP: Map<Int, String> by lazy { buildCodePointMap(NormTableData.normTable.confusables) }

private val INJ01_TRIGGERS = hashSetOf("ignore", "disregard", "forget", "override")
private val INJ01_QUALIFIERS = hashSetOf("previous", "prior", "above", "earlier", "all", "any")
private val INJ01_TARGETS = hashSetOf("instruction", "instructions", "prompt", "prompts", "rules", "directions")
private val INJ02_ROLES = hashSetOf("system", "developer", "assistant")
private val INJ02_NOUNS = hashSetOf("prompt", "message", "instruction", "instructions")
private val INJ03_DETS = hashSetOf("a", "an", "the", "my")
private val INJ03_MODELS = hashSetOf("ai", "assistant", "model", "chatbot", "llm", "gpt")
private val INJ04_VERBS = hashSetOf("respond", "reply", "answer", "output", "return", "print")
private val INJ04_PREPS = hashSetOf("with", "as", "in")
private val INJ04_SINGLE_TARGETS = hashSetOf("json", "yes", "no", "true", "false", "supported", "contradicts")
private val INJ05_ADJS = hashSetOf("new", "revised", "real", "actual", "hidden")
private val INJ05_NOUNS = hashSetOf("instruction", "instructions", "task", "rules")
private val INJ06_TAGS = hashSetOf("system", "assistant", "user", "evidence", "instruction", "im_start", "im_end")
private val INJ07_LITERALS = listOf("[inst]", "[/inst]", "<<sys>>", "<</sys>>", "<<evidence", "<</evidence")
private val INJ08_WORDS = hashSetOf("instruction", "instructions", "system", "task", "prompt")
private val INJ09_ADJS = hashSetOf("correct", "right", "true")
private val INJ09_NOUNS = hashSetOf("verdict", "answer", "label")
private val INJ10_VERBS = hashSetOf("follow", "obey")
private val INJ10_MODS = hashSetOf("the", "your", "any", "previous")
private val INJ10_NOUNS = hashSetOf("instruction", "instructions", "rules", "system")
private val INJ11_BOUNDARY = hashSetOf("begin", "end")
private val INJ11_TARGETS = hashSetOf("system", "instructions", "prompt")
private val INJ12_PARAMS = hashSetOf("prompt", "instruction", "q")
private val LOG_VERDICT_WORDS = hashSetOf("supported", "contradicts", "contradicted")
private val LOG_LABEL_WORDS = hashSetOf("label", "classification", "verdict")

private fun pushCodePointWithOffset(outUnits: CharBuf, outMap: IntBuf, cp: Int, rawOffset: Int) {
    if (cp <= 0xFFFF) {
        outUnits.addCodeUnit(cp)
        outMap.add(rawOffset)
        return
    }
    val v = cp - 0x10000
    outUnits.addCodeUnit(0xD800 + (v shr 10))
    outMap.add(rawOffset)
    outUnits.addCodeUnit(0xDC00 + (v and 0x3FF))
    outMap.add(rawOffset)
}

private fun pushStringWithOffset(outUnits: CharBuf, outMap: IntBuf, str: String, rawOffset: Int) {
    for (k in 0 until str.length) {
        outUnits.add(str[k])
        outMap.add(rawOffset)
    }
}

private fun isSimpleControlToDelete(cp: Int): Boolean {
    if (cp <= 0x001F) {
        return cp != 0x0009 && cp != 0x000A && cp != 0x000D
    }
    return cp in 0x007F..0x009F
}

private fun isBidiOverrideControl(cp: Int): Boolean =
    (cp in 0x202A..0x202E) || (cp in 0x2066..0x2069)

private fun isDirectionalMark(cp: Int): Boolean =
    cp == 0x200E || cp == 0x200F || cp == 0x061C

private fun isZeroWidthOrInvisible(cp: Int): Boolean =
    cp == 0x200B ||
        (cp in 0x2060..0x2064) ||
        cp == 0xFEFF ||
        cp == 0x034F ||
        (cp in 0xFE00..0xFE0F) ||
        cp == 0x3164 ||
        cp == 0xFFA0 ||
        cp == 0x115F ||
        cp == 0x1160 ||
        cp == 0x180E

private fun prevValidCodePoint(rawText: String, endIndex: Int): Int? {
    if (endIndex <= 0) return null
    val cu1 = rawText[endIndex - 1].code
    if (cu1 in 0xDC00..0xDFFF) {
        if (endIndex >= 2) {
            val cu0 = rawText[endIndex - 2].code
            if (cu0 in 0xD800..0xDBFF) {
                return ((cu0 - 0xD800) shl 10) + (cu1 - 0xDC00) + 0x10000
            }
        }
        return null
    }
    if (cu1 in 0xD800..0xDBFF) return null
    return cu1
}

private fun nextValidCodePoint(rawText: String, startIndex: Int): Int? {
    if (startIndex >= rawText.length) return null
    val unit = codePointAtSafe(rawText, startIndex)
    return if (unit.isUnpairedSurrogate) null else unit.cp
}

private class CharacterCleanResult(
    val cleanedText: String,
    val cleanMap: IntArray,
    val invisibleCharCount: Int,
    val hasTagChars: Boolean,
    val hasBidiOverride: Boolean,
    val hasPuaUnmapped: Boolean,
)

private fun cleanCharactersAndCount(rawText: String): CharacterCleanResult {
    val n = rawText.length
    val outUnits = CharBuf(n + 8)
    val cleanMap = IntBuf(n + 8)
    var invisibleCharCount = 0
    var hasTagChars = false
    var hasBidiOverride = false
    var hasPuaUnmapped = false

    var i = 0
    while (i < n) {
        val cu0 = rawText[i].code
        if (cu0 < 0x80) {
            if (isSimpleControlToDelete(cu0)) {
                i += 1
                continue
            }
            outUnits.addCodeUnit(cu0)
            cleanMap.add(i)
            i += 1
            continue
        }

        val unit = codePointAtSafe(rawText, i)
        if (unit.isUnpairedSurrogate) {
            outUnits.addCodeUnit(unit.cp)
            cleanMap.add(i)
            i += 1
            continue
        }

        val cp = unit.cp
        if (cp in 0x0080..0x009F) {
            i += unit.len
            continue
        }
        if (cp in 0xE0000..0xE007F) {
            hasTagChars = true
            i += unit.len
            continue
        }
        if (isBidiOverrideControl(cp)) {
            hasBidiOverride = true
            i += unit.len
            continue
        }
        if (isDirectionalMark(cp)) {
            i += unit.len
            continue
        }
        if (isZeroWidthOrInvisible(cp)) {
            invisibleCharCount += 1
            i += unit.len
            continue
        }
        if (cp == 0x200C || cp == 0x200D) {
            val prevCp = prevValidCodePoint(rawText, i)
            val nextCp = nextValidCodePoint(rawText, i + unit.len)
            if (prevCp != null &&
                nextCp != null &&
                isJoinerPreservedScript(prevCp) &&
                isJoinerPreservedScript(nextCp)
            ) {
                outUnits.addCodeUnit(cp)
                cleanMap.add(i)
            } else {
                invisibleCharCount += 1
            }
            i += unit.len
            continue
        }
        if (cp in 0xE000..0xF8FF) {
            val puaReplacement = SYMBOL_PUA_MAP[cp]
            if (puaReplacement != null) {
                pushStringWithOffset(outUnits, cleanMap, puaReplacement, i)
            } else {
                hasPuaUnmapped = true
            }
            i += unit.len
            continue
        }

        pushCodePointWithOffset(outUnits, cleanMap, cp, i)
        i += unit.len
    }

    cleanMap.add(n)
    return CharacterCleanResult(
        cleanedText = outUnits.buildString(),
        cleanMap = cleanMap.toArray(),
        invisibleCharCount = invisibleCharCount,
        hasTagChars = hasTagChars,
        hasBidiOverride = hasBidiOverride,
        hasPuaUnmapped = hasPuaUnmapped,
    )
}

fun compatFold(input: String): String {
    val n = input.length
    var sb: StringBuilder? = null
    var i = 0
    while (i < n) {
        val cu0 = input[i].code
        if (cu0 < 0x80) {
            sb?.append(input[i])
            i += 1
            continue
        }
        val unit = codePointAtSafe(input, i)
        if (unit.isUnpairedSurrogate) {
            sb?.append(input[i])
            i += 1
            continue
        }
        val folded = COMPAT_FOLD_MAP[unit.cp]
        if (folded != null) {
            if (sb == null) {
                sb = StringBuilder(n)
                sb.append(input, 0, i)
            }
            sb.append(folded)
        } else if (sb != null) {
            sb.append(input, i, i + unit.len)
        }
        i += unit.len
    }
    return sb?.toString() ?: input
}

fun stripMarks(input: String): String {
    val n = input.length
    var sb: StringBuilder? = null
    var i = 0
    while (i < n) {
        val cu0 = input[i].code
        if (cu0 < 0x80) {
            sb?.append(input[i])
            i += 1
            continue
        }
        val unit = codePointAtSafe(input, i)
        if (!unit.isUnpairedSurrogate && isMarkMnOrMe(unit.cp)) {
            if (sb == null) {
                sb = StringBuilder(n)
                sb.append(input, 0, i)
            }
        } else if (sb != null) {
            sb.append(input, i, i + unit.len)
        }
        i += unit.len
    }
    return sb?.toString() ?: input
}

fun foldConfusables(input: String): String {
    val n = input.length
    var sb: StringBuilder? = null
    var i = 0
    while (i < n) {
        val cu0 = input[i].code
        if (cu0 < 0x80) {
            sb?.append(input[i])
            i += 1
            continue
        }
        val unit = codePointAtSafe(input, i)
        if (unit.isUnpairedSurrogate) {
            sb?.append(input[i])
            i += 1
            continue
        }
        val mapped = CONFUSABLES_MAP[unit.cp]
        if (mapped != null) {
            if (sb == null) {
                sb = StringBuilder(n)
                sb.append(input, 0, i)
            }
            sb.append(mapped)
        } else if (sb != null) {
            sb.append(input, i, i + unit.len)
        }
        i += unit.len
    }
    return sb?.toString() ?: input
}

fun buildDetectText(cleanedText: String): String =
    foldConfusables(stripMarks(compatFold(normLower(cleanedText))))

private fun isLatinBaseLetterCp(cp: Int): Boolean {
    if (!isBaseLetter(cp)) return false
    return (cp in 0x0041..0x005A) ||
        (cp in 0x0061..0x007A) ||
        (cp in 0x00C0..0x00D6) ||
        (cp in 0x00D8..0x00F6) ||
        (cp in 0x00F8..0x02AF) ||
        (cp in 0x1D00..0x1D25) ||
        (cp in 0x1D2C..0x1DBF) ||
        (cp in 0x1E00..0x1EFF) ||
        (cp in 0x2C60..0x2C7F) ||
        (cp in 0xA720..0xA7FF) ||
        (cp in 0xAB30..0xAB6F) ||
        (cp in 0xFB00..0xFB06) ||
        (cp in 0xFF21..0xFF3A) ||
        (cp in 0xFF41..0xFF5A)
}

private fun isCyrillicBaseLetterCp(cp: Int): Boolean {
    if (!isBaseLetter(cp)) return false
    return (cp in 0x0400..0x052F) ||
        (cp in 0x1C80..0x1C8F) ||
        (cp in 0x2DE0..0x2DFF) ||
        (cp in 0xA640..0xA69F)
}

private fun isConfusableGreekLetterCp(cp: Int): Boolean =
    ((cp in 0x0370..0x03FF) || (cp in 0x1F00..0x1FFF) || (cp in 0x1D26..0x1D2B)) &&
        CONFUSABLES_MAP.containsKey(cp)

private fun isNextWordLetterOrDigit(text: String, idx: Int): Boolean {
    if (idx >= text.length) return false
    val cu = text[idx].code
    if (cu < 0x80) {
        return (cu in 0x61..0x7A) || (cu in 0x41..0x5A) || (cu in 0x30..0x39)
    }
    val u = codePointAtSafe(text, idx)
    if (u.isUnpairedSurrogate) return false
    return isBaseLetter(u.cp) || isDigit(u.cp)
}

fun countMixedScriptWords(loweredText: String): Int {
    val n = loweredText.length
    var mixedCount = 0

    var inWord = false
    var hasDigitOrHyphen = false
    var latinCount = 0
    var cyrillicCount = 0
    var pendingGreekConfusable = false
    var hasGreekBetweenLatin = false

    fun flushWord() {
        if (!inWord) return
        if (!hasDigitOrHyphen) {
            if ((latinCount >= 2 && cyrillicCount >= 1) || hasGreekBetweenLatin) {
                mixedCount += 1
            }
        }
        inWord = false
        hasDigitOrHyphen = false
        latinCount = 0
        cyrillicCount = 0
        pendingGreekConfusable = false
        hasGreekBetweenLatin = false
    }

    var i = 0
    while (i < n) {
        val cu0 = loweredText[i].code
        if (cu0 < 0x80) {
            val isAsciiAlpha = (cu0 in 0x61..0x7A) || (cu0 in 0x41..0x5A)
            if (isAsciiAlpha) {
                inWord = true
                latinCount += 1
                if (pendingGreekConfusable) {
                    hasGreekBetweenLatin = true
                    pendingGreekConfusable = false
                }
            } else if (isDigit(cu0)) {
                inWord = true
                hasDigitOrHyphen = true
            } else if (cu0 == 0x2D || cu0 == 0x27) {
                if (inWord && isNextWordLetterOrDigit(loweredText, i + 1)) {
                    if (cu0 == 0x2D) hasDigitOrHyphen = true
                } else {
                    flushWord()
                }
            } else {
                flushWord()
            }
            i += 1
            continue
        }

        val unit = codePointAtSafe(loweredText, i)
        if (unit.isUnpairedSurrogate) {
            flushWord()
            i += 1
            continue
        }

        val cp = unit.cp
        if (isBaseLetter(cp)) {
            inWord = true
            if (isLatinBaseLetterCp(cp)) {
                latinCount += 1
                if (pendingGreekConfusable) {
                    hasGreekBetweenLatin = true
                    pendingGreekConfusable = false
                }
            } else if (isCyrillicBaseLetterCp(cp)) {
                cyrillicCount += 1
            } else if (isConfusableGreekLetterCp(cp)) {
                if (latinCount > 0) {
                    pendingGreekConfusable = true
                }
            }
        } else if (isCombiningMark(cp)) {
            // stay inside word across combining marks
        } else {
            flushWord()
        }
        i += unit.len
    }

    flushWord()
    return mixedCount
}

private data class DetectWord(
    val text: String,
    val start: Int,
    val end: Int,
)

private fun extractDetectWords(detectText: String): List<DetectWord> {
    val n = detectText.length
    val words = ArrayList<DetectWord>()
    var wordStart = -1
    var i = 0

    while (i < n) {
        val cu0 = detectText[i].code
        if (cu0 < 0x80) {
            val isAlnum = (cu0 in 0x61..0x7A) || (cu0 in 0x30..0x39)
            if (isAlnum) {
                if (wordStart == -1) wordStart = i
            } else if (wordStart != -1) {
                words.add(DetectWord(detectText.substring(wordStart, i), wordStart, i))
                wordStart = -1
            }
            i += 1
            continue
        }

        val unit = codePointAtSafe(detectText, i)
        val isAlnum = !unit.isUnpairedSurrogate && (isBaseLetter(unit.cp) || isDigit(unit.cp))
        if (isAlnum) {
            if (wordStart == -1) wordStart = i
        } else if (wordStart != -1) {
            words.add(DetectWord(detectText.substring(wordStart, i), wordStart, i))
            wordStart = -1
        }
        i += unit.len
    }

    if (wordStart != -1) {
        words.add(DetectWord(detectText.substring(wordStart, n), wordStart, n))
    }
    return words
}

private fun hasOnlySpaceBetween(text: String, start: Int, end: Int): Boolean {
    if (end <= start) return false
    for (i in start until end) {
        if (!isSpace(text[i].code)) return false
    }
    return true
}

private fun detectInj01(words: List<DetectWord>): Boolean {
    var lastTrigger = -1
    var lastQual = -1
    for (i in words.indices) {
        val w = words[i].text
        if (lastQual != -1 && (i - lastQual) in 1..5 && INJ01_TARGETS.contains(w)) {
            return true
        }
        if (lastTrigger != -1 && (i - lastTrigger) in 1..9 && INJ01_QUALIFIERS.contains(w)) {
            lastQual = i
        }
        if (INJ01_TRIGGERS.contains(w)) {
            lastTrigger = i
        }
    }
    return false
}

private fun detectInj05ColonAfterWords(
    detectText: String,
    words: List<DetectWord>,
    nounWordIdx: Int,
): Boolean {
    val startSearch = words[nounWordIdx].end
    val maxWordIdx = minOf(words.size - 1, nounWordIdx + 3)
    val scanEnd = words[maxWordIdx].end

    for (i in startSearch until detectText.length) {
        val ch = detectText[i].code
        if (ch == 0x3A /* ':' */) return true
        if (ch == 0x0A || ch == 0x2E || ch == 0x3F || ch == 0x21) return false
        if (i >= scanEnd && !isSpace(ch)) return false
    }
    return false
}

private fun detectInj06XmlRoleTag(detectText: String): Boolean {
    val n = detectText.length
    var i = 0
    while (i < n) {
        val lt = detectText.indexOf('<', i)
        if (lt == -1) return false
        var cur = lt + 1
        while (cur < n && isSpace(detectText[cur].code)) {
            cur++
        }
        if (cur < n && detectText[cur].code == 0x2F /* '/' */) {
            cur++
        }
        val hasLeadingPipe = cur < n && detectText[cur].code == 0x7C /* '|' */
        if (hasLeadingPipe) cur++

        val wordStart = cur
        while (cur < n) {
            val ch = detectText[cur].code
            if (ch in 0x61..0x7A || ch == 0x5F) {
                cur++
            } else {
                break
            }
        }
        if (cur > wordStart) {
            val tagWord = detectText.substring(wordStart, cur)
            val validPipeTag = !hasLeadingPipe || tagWord == "im_start" || tagWord == "im_end"
            if (validPipeTag && INJ06_TAGS.contains(tagWord)) {
                val nextValid = if (cur >= n) {
                    true
                } else {
                    val u = codePointAtSafe(detectText, cur)
                    u.isUnpairedSurrogate || (!isBaseLetter(u.cp) && !isDigit(u.cp) && u.cp != 0x5F)
                }
                if (nextValid) return true
            }
        }
        i = lt + 1
    }
    return false
}

private fun detectInj07Delimiters(detectText: String): Boolean {
    for (lit in INJ07_LITERALS) {
        if (detectText.contains(lit)) return true
    }
    return false
}

private fun detectInj08MarkdownHeading(detectText: String): Boolean {
    val n = detectText.length
    var i = 0
    while (i < n) {
        while (i < n && (detectText[i].code == 0x20 || detectText[i].code == 0x09)) {
            i++
        }
        var hashes = 0
        while (i < n && detectText[i].code == 0x23 /* '#' */) {
            hashes++
            i++
        }
        if (hashes >= 2) {
            while (i < n && (detectText[i].code == 0x20 || detectText[i].code == 0x09)) {
                i++
            }
            val wordStart = i
            while (i < n && detectText[i].code in 0x61..0x7A) {
                i++
            }
            if (i > wordStart && INJ08_WORDS.contains(detectText.substring(wordStart, i))) {
                val atWordEnd = if (i >= n) {
                    true
                } else {
                    val u = codePointAtSafe(detectText, i)
                    u.isUnpairedSurrogate || (!isBaseLetter(u.cp) && !isDigit(u.cp) && u.cp != 0x5F)
                }
                if (atWordEnd) return true
            }
        }
        val nl = detectText.indexOf('\n', i)
        if (nl == -1) break
        i = nl + 1
    }
    return false
}

private fun detectInj12QueryUrl(detectText: String): Boolean {
    val n = detectText.length
    var i = 0
    while (i < n) {
        val httpIdx = detectText.indexOf("http", i)
        if (httpIdx == -1) return false
        val schemeLen = when {
            detectText.startsWith("http://", httpIdx) -> 7
            detectText.startsWith("https://", httpIdx) -> 8
            else -> {
                i = httpIdx + 4
                continue
            }
        }
        if (httpIdx > 0 && detectText[httpIdx - 1].code in 0x61..0x7A) {
            i = httpIdx + schemeLen
            continue
        }

        val maxUrlEnd = minOf(n, httpIdx + INJ12_URL_MAX_LEN)
        var urlEnd = httpIdx + schemeLen
        while (urlEnd < maxUrlEnd) {
            val ch = detectText[urlEnd].code
            if (isSpace(ch) || ch == 0x22 || ch == 0x27 || ch == 0x3C || ch == 0x3E ||
                ch == 0x29 || ch == 0x5D || ch == 0x7D
            ) {
                break
            }
            urlEnd++
        }

        val urlSlice = detectText.substring(httpIdx, urlEnd)
        val qMark = urlSlice.indexOf('?')
        if (qMark != -1) {
            val hashMark = urlSlice.indexOf('#', qMark + 1)
            val queryPart = if (hashMark == -1) urlSlice.substring(qMark + 1) else urlSlice.substring(qMark + 1, hashMark)
            val pairs = queryPart.split('&')
            for (seg in pairs) {
                val eq = seg.indexOf('=')
                if (eq > 0 && INJ12_PARAMS.contains(seg.substring(0, eq))) {
                    return true
                }
            }
        }

        i = if (urlEnd > httpIdx) urlEnd else httpIdx + schemeLen
    }
    return false
}

private fun isWordBoundaryAt(text: String, idx: Int): Boolean {
    if (idx < 0 || idx >= text.length) return true
    val u = codePointAtSafe(text, idx)
    return u.isUnpairedSurrogate || (!isBaseLetter(u.cp) && !isDigit(u.cp) && u.cp != 0x5F)
}

private fun isWordStartBoundaryBefore(text: String, idx: Int): Boolean {
    if (idx <= 0) return true
    val cu = text[idx - 1].code
    if (cu < 0x80) {
        return !((cu in 0x61..0x7A) || (cu in 0x41..0x5A) || isDigit(cu)) && cu != 0x5F
    }
    val prev = prevValidCodePoint(text, idx) ?: return true
    return !isBaseLetter(prev) && !isDigit(prev)
}

private fun detectInj13SchemaVocab(detectText: String): Boolean {
    val n = detectText.length

    var qCursor = 0
    while (qCursor < n) {
        val pos = detectText.indexOf("\"verdict\"", qCursor)
        if (pos == -1) break
        var p = pos + 9
        while (p < n && (detectText[p].code == 0x20 || detectText[p].code == 0x09)) {
            p++
        }
        if (p < n && detectText[p].code == 0x3A /* ':' */) return true
        qCursor = pos + 9
    }

    var neiCursor = 0
    while (neiCursor < n) {
        val pos = detectText.indexOf("nei_silent_escalate", neiCursor)
        if (pos == -1) break
        if (isWordStartBoundaryBefore(detectText, pos) && isWordBoundaryAt(detectText, pos + 19)) {
            return true
        }
        neiCursor = pos + 19
    }

    var sCursor = 0
    while (sCursor < n) {
        val pos = detectText.indexOf("s0", sCursor)
        if (pos == -1) break
        if (pos + 4 < n && isWordStartBoundaryBefore(detectText, pos)) {
            val d = detectText[pos + 2].code
            val u = detectText[pos + 3].code
            if (d in 0x31..0x34 && u == 0x5F) {
                var end = pos + 4
                var hasSuffixChar = false
                while (end < n) {
                    val c = detectText[end].code
                    if ((c in 0x61..0x7A) || c == 0x5F) {
                        hasSuffixChar = true
                        end++
                    } else {
                        break
                    }
                }
                if (hasSuffixChar && isWordBoundaryAt(detectText, end)) return true
            }
        }
        sCursor = pos + 2
    }

    return false
}

private data class PatternEvalResult(
    val blockInjIds: List<String>,
    val logReasons: List<String>,
)

private fun evaluatePatternsOnDetectText(detectText: String): PatternEvalResult {
    val words = extractDetectWords(detectText)
    val wc = words.size

    var m01 = false
    var m02 = false
    var m03 = false
    var m04 = false
    var m05 = false
    var m09 = false
    var m10 = false
    var m11 = false

    var logVerdictWord = false
    var logRoleplay = false
    var logLabelPrefix = false

    if (wc > 0) {
        m01 = detectInj01(words)

        for (i in 0 until wc) {
            val w0 = words[i]
            val t0 = w0.text

            if (LOG_VERDICT_WORDS.contains(t0)) {
                logVerdictWord = true
            }
            if (t0 == "pretend") {
                logRoleplay = true
            } else if ((t0 == "act" || t0 == "behave") && i + 1 < wc) {
                val w1 = words[i + 1]
                if (w1.text == "as" && hasOnlySpaceBetween(detectText, w0.end, w1.start)) {
                    logRoleplay = true
                }
            }
            if (LOG_LABEL_WORDS.contains(t0) && w0.end < detectText.length && detectText[w0.end].code == 0x3A) {
                val precededByQuote = w0.start > 0 && detectText[w0.start - 1].code == 0x22
                if (!precededByQuote) {
                    logLabelPrefix = true
                }
            }

            if (i + 1 >= wc) continue
            val w1 = words[i + 1]
            val t1 = w1.text
            val sp01 = hasOnlySpaceBetween(detectText, w0.end, w1.start)

            if (!m02 && sp01 && INJ02_ROLES.contains(t0) && INJ02_NOUNS.contains(t1)) {
                m02 = true
            }

            if (!m05 && sp01 && INJ05_ADJS.contains(t0) && INJ05_NOUNS.contains(t1)) {
                if (detectInj05ColonAfterWords(detectText, words, i + 1)) {
                    m05 = true
                }
            }

            if (!m03 && sp01 && t0 == "you" && t1 == "are") {
                var j = i + 2
                if (j < wc && words[j].text == "now" && hasOnlySpaceBetween(detectText, words[j - 1].end, words[j].start)) {
                    j++
                }
                if (j < wc && INJ03_DETS.contains(words[j].text) && hasOnlySpaceBetween(detectText, words[j - 1].end, words[j].start)) {
                    j++
                }
                if (j < wc && hasOnlySpaceBetween(detectText, words[j - 1].end, words[j].start)) {
                    val cand = words[j].text
                    if (INJ03_MODELS.contains(cand)) {
                        m03 = true
                    } else if (cand == "language" &&
                        j + 1 < wc &&
                        words[j + 1].text == "model" &&
                        hasOnlySpaceBetween(detectText, words[j].end, words[j + 1].start)
                    ) {
                        m03 = true
                    }
                }
            }

            if (!m04 && INJ04_VERBS.contains(t0)) {
                var j = i + 1
                if (j < wc && words[j].text == "only" && hasOnlySpaceBetween(detectText, w0.end, words[j].start)) {
                    j++
                }
                if (j < wc && INJ04_PREPS.contains(words[j].text) && hasOnlySpaceBetween(detectText, words[j - 1].end, words[j].start)) {
                    val tj = j + 1
                    if (tj < wc && hasOnlySpaceBetween(detectText, words[j].end, words[tj].start)) {
                        val targetWord = words[tj].text
                        if (INJ04_SINGLE_TARGETS.contains(targetWord)) {
                            m04 = true
                        } else if (tj + 1 < wc && hasOnlySpaceBetween(detectText, words[tj].end, words[tj + 1].start)) {
                            val nextWord = words[tj + 1].text
                            if ((targetWord == "the" && nextWord == "following") ||
                                (targetWord == "a" && nextWord == "verdict")
                            ) {
                                m04 = true
                            }
                        }
                    }
                }
            }

            if (!m09 && sp01 && INJ09_ADJS.contains(t0) && INJ09_NOUNS.contains(t1)) {
                if (i + 2 < wc && words[i + 2].text == "is" && hasOnlySpaceBetween(detectText, w1.end, words[i + 2].start)) {
                    m09 = true
                } else {
                    var p = w1.end
                    while (p < detectText.length && (detectText[p].code == 0x20 || detectText[p].code == 0x09)) {
                        p++
                    }
                    if (p < detectText.length && detectText[p].code == 0x3D) {
                        m09 = true
                    }
                }
            }

            if (!m10 && sp01 && t0 == "do" && t1 == "not" && i + 2 < wc) {
                val w2 = words[i + 2]
                if (INJ10_VERBS.contains(w2.text) && hasOnlySpaceBetween(detectText, w1.end, w2.start)) {
                    var j = i + 3
                    if (j < wc && INJ10_MODS.contains(words[j].text) && hasOnlySpaceBetween(detectText, w2.end, words[j].start)) {
                        j++
                    }
                    if (j < wc && INJ10_NOUNS.contains(words[j].text) && hasOnlySpaceBetween(detectText, words[j - 1].end, words[j].start)) {
                        m10 = true
                    }
                }
            }

            if (!m11 && INJ11_BOUNDARY.contains(t0)) {
                var j = i + 1
                if (j < wc && words[j].text == "of" && hasOnlySpaceBetween(detectText, w0.end, words[j].start)) {
                    j++
                }
                if (j < wc && INJ11_TARGETS.contains(words[j].text) && hasOnlySpaceBetween(detectText, words[j - 1].end, words[j].start)) {
                    m11 = true
                }
            }
        }
    }

    val m06 = detectInj06XmlRoleTag(detectText)
    val m07 = detectInj07Delimiters(detectText)
    val m08 = detectInj08MarkdownHeading(detectText)
    val m12 = detectInj12QueryUrl(detectText)
    val m13 = detectInj13SchemaVocab(detectText)

    val blockInjIds = ArrayList<String>()
    if (m01) blockInjIds.add("INJ-01")
    if (m02) blockInjIds.add("INJ-02")
    if (m03) blockInjIds.add("INJ-03")
    if (m04) blockInjIds.add("INJ-04")
    if (m05) blockInjIds.add("INJ-05")
    if (m06) blockInjIds.add("INJ-06")
    if (m07) blockInjIds.add("INJ-07")
    if (m08) blockInjIds.add("INJ-08")
    if (m09) blockInjIds.add("INJ-09")
    if (m10) blockInjIds.add("INJ-10")
    if (m11) blockInjIds.add("INJ-11")
    if (m12) blockInjIds.add("INJ-12")
    if (m13) blockInjIds.add("INJ-13")

    val logReasons = ArrayList<String>()
    if (logVerdictWord) logReasons.add("LOG_VERDICT_WORD")
    if (logRoleplay) logReasons.add("LOG_ROLEPLAY")
    if (logLabelPrefix) logReasons.add("LOG_LABEL_PREFIX")

    return PatternEvalResult(blockInjIds, logReasons)
}

fun sanitizeText(rawText: String, options: SanitizeOptions? = null): SanitizeResult {
    val cleaned = cleanCharactersAndCount(rawText)
    val normRes = norm(cleaned.cleanedText)
    val outLen = normRes.text.length
    val composedMap = IntArray(outLen + 1)
    for (j in 0 until outLen) {
        val cleanIdx = normRes.map[j]
        composedMap[j] = if (cleanIdx in cleaned.cleanMap.indices) cleaned.cleanMap[cleanIdx] else rawText.length
    }
    composedMap[outLen] = rawText.length

    val cleanedLowered = normLower(cleaned.cleanedText)
    val detectText = foldConfusables(stripMarks(compatFold(cleanedLowered)))
    val mixedScriptWordCount = countMixedScriptWords(cleanedLowered)
    val patternEval = evaluatePatternsOnDetectText(detectText)

    val blockReasons = ArrayList<String>()
    if (cleaned.hasTagChars) blockReasons.add("TAG_CHARS")
    if (cleaned.hasBidiOverride) blockReasons.add("BIDI_OVERRIDE")
    if (cleaned.invisibleCharCount >= INVISIBLE_CHARS_BLOCK_THRESHOLD) {
        blockReasons.add("INVISIBLE_CHARS")
    }
    if (mixedScriptWordCount >= MIXED_SCRIPT_BLOCK_THRESHOLD) {
        blockReasons.add("MIXED_SCRIPT")
    }
    if (options?.hiddenPdfText == true) {
        blockReasons.add("HIDDEN_PDF_TEXT")
    }
    blockReasons.addAll(patternEval.blockInjIds)

    val logReasons = ArrayList<String>()
    if (cleaned.hasPuaUnmapped) {
        logReasons.add("PUA_UNMAPPED")
    }
    logReasons.addAll(patternEval.logReasons)

    val reasons = ArrayList<String>(blockReasons.size + logReasons.size)
    reasons.addAll(blockReasons)
    reasons.addAll(logReasons)

    val tier = when {
        blockReasons.isNotEmpty() -> SanitizeTier.BLOCKED
        logReasons.isNotEmpty() -> SanitizeTier.LOGGED
        else -> SanitizeTier.CLEAN
    }

    return SanitizeResult(
        text = normRes.text,
        map = composedMap,
        detectText = detectText,
        tier = tier,
        reasons = reasons,
        blockReasons = blockReasons,
        logReasons = logReasons,
        blocked = tier == SanitizeTier.BLOCKED,
        invisibleCharCount = cleaned.invisibleCharCount,
        mixedScriptWordCount = mixedScriptWordCount,
    )
}

fun escapeEvidenceDelimiters(text: String): String {
    if (!text.contains("<<") && !text.contains(">>")) return text
    val n = text.length
    val sb = StringBuilder(n)
    var segStart = 0
    var i = 0
    while (i < n) {
        val ch = text[i].code
        if (ch == 0x3C && i + 1 < n && text[i + 1].code == 0x3C) {
            if (i > segStart) sb.append(text, segStart, i)
            sb.append("\u2039\u2039")
            i += 2
            segStart = i
            continue
        }
        if (ch == 0x3E && i + 1 < n && text[i + 1].code == 0x3E) {
            if (i > segStart) sb.append(text, segStart, i)
            sb.append("\u203A\u203A")
            i += 2
            segStart = i
            continue
        }
        i += 1
    }
    if (segStart < n) {
        sb.append(text, segStart, n)
    }
    return sb.toString()
}

fun wrapEvidenceBlock(id: Int, sanitizedText: String): String =
    "<<EVIDENCE id=$id>>\n${escapeEvidenceDelimiters(sanitizedText)}\n<</EVIDENCE>>"

private fun isAllowedDoiSuffixChar(cp: Int): Boolean =
    isKeyChar(cp) ||
        cp == 0x28 ||
        cp == 0x29 ||
        cp == 0x3B ||
        cp == 0x3C ||
        cp == 0x3E ||
        cp == 0x5B ||
        cp == 0x5D

fun isValidPromptDoi(text: String): Boolean {
    if (!text.startsWith("10.")) return false
    val n = text.length
    var pos = 3
    var digitCount = 0
    while (pos < n && isDigit(text[pos].code)) {
        digitCount++
        pos++
    }
    if (digitCount < DOI_PREFIX_MIN_DIGITS || digitCount > DOI_PREFIX_MAX_DIGITS) return false
    if (pos >= n || text[pos].code != 0x2F /* '/' */) return false
    pos++
    var suffixCount = 0
    while (pos < n) {
        val unit = codePointAtSafe(text, pos)
        if (unit.isUnpairedSurrogate || !isAllowedDoiSuffixChar(unit.cp)) return false
        suffixCount++
        if (suffixCount > DOI_SUFFIX_MAX_LEN) return false
        pos += unit.len
    }
    return suffixCount >= 1
}

private fun withheldPlaceholder(field: MetadataFieldName): String = when (field) {
    MetadataFieldName.TITLE -> "[title withheld]"
    MetadataFieldName.VENUE -> "[venue withheld]"
    MetadataFieldName.FIRST_AUTHOR -> "[author withheld]"
    MetadataFieldName.DOI -> "[doi withheld]"
}

fun sanitizeMetadataField(field: MetadataFieldName, rawValue: String): SanitizeMetadataResult {
    val sanitizeResult = sanitizeText(rawValue)
    if (sanitizeResult.blocked) {
        return SanitizeMetadataResult(field, withheldPlaceholder(field), true, sanitizeResult)
    }
    if (field == MetadataFieldName.DOI && !isValidPromptDoi(sanitizeResult.text)) {
        return SanitizeMetadataResult(field, withheldPlaceholder(MetadataFieldName.DOI), true, sanitizeResult)
    }
    return SanitizeMetadataResult(field, escapeEvidenceDelimiters(sanitizeResult.text), false, sanitizeResult)
}

fun isEvidenceUnitBlocked(rawText: String, options: SanitizeOptions? = null): Boolean =
    sanitizeText(rawText, options).blocked

fun createSanitizerUnitBlocker(
    isHiddenUnit: ((Bm25IndexedUnit) -> Boolean)? = null,
): (Bm25IndexedUnit) -> Boolean = { unit ->
    val hidden = isHiddenUnit?.invoke(unit) == true
    sanitizeText(unit.text, if (hidden) SanitizeOptions(hiddenPdfText = true) else null).blocked
}
