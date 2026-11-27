package app.toulmin.core

import java.security.MessageDigest

enum class GeneralCategory(val code: String) {
    Cn("Cn"), Lu("Lu"), Ll("Ll"), Lt("Lt"), Lm("Lm"), Lo("Lo"),
    Mn("Mn"), Mc("Mc"), Me("Me"),
    Nd("Nd"), Nl("Nl"), No("No"),
    Pc("Pc"), Pd("Pd"), Ps("Ps"), Pe("Pe"), Pi("Pi"), Pf("Pf"), Po("Po"),
    Sm("Sm"), Sc("Sc"), Sk("Sk"), So("So"),
    Zs("Zs"), Zl("Zl"), Zp("Zp"),
    Cc("Cc"), Cf("Cf"), Cs("Cs"), Co("Co"),
}

val GENERAL_CATEGORIES: List<GeneralCategory> = GeneralCategory.entries

private const val MAX_CODE_POINT = 0x10FFFF
private const val BMP_SIZE = 0x10000

data class CodePointUnit(
    val cp: Int,
    val len: Int,
    val isUnpairedSurrogate: Boolean,
)

class NormResult(
    val text: String,
    val map: IntArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is NormResult) return false
        return text == other.text && map.contentEquals(other.map)
    }

    override fun hashCode(): Int {
        var result = text.hashCode()
        result = 31 * result + map.contentHashCode()
        return result
    }

    override fun toString(): String = "NormResult(text='$text', map=${map.contentToString()})"
}

fun getUnicode151BinBytes(): ByteArray = NormTableData.unicodeBytes.copyOf()

private fun generalCategoryCode(cp: Int): Int {
    if (cp < 0 || cp > MAX_CODE_POINT) {
        return 0 // Cn
    }
    val table = NormTableData.unicodeTable
    if (cp < BMP_SIZE) {
        return table.bmpCategories[cp].toInt() and 0xFF
    }
    val starts = table.suppCatStarts
    val ends = table.suppCatEnds
    var lo = 0
    var hi = starts.size - 1
    while (lo <= hi) {
        val mid = (lo + hi) ushr 1
        val s = starts[mid]
        if (cp < s) {
            hi = mid - 1
        } else if (cp > ends[mid]) {
            lo = mid + 1
        } else {
            return table.suppCatCodes[mid].toInt() and 0xFF
        }
    }
    return 0
}

fun generalCategory(cp: Int): GeneralCategory = GENERAL_CATEGORIES[generalCategoryCode(cp)]

fun simpleLowerCodePoint(cp: Int): Int {
    if (cp < 0 || cp > MAX_CODE_POINT) {
        return cp
    }
    val table = NormTableData.unicodeTable
    if (cp < BMP_SIZE) {
        val mapped = table.bmpSimpleLower[cp]
        return if (mapped == 0 && cp != 0) cp else mapped
    }
    val srcs = table.suppLowerSrc
    var lo = 0
    var hi = srcs.size - 1
    while (lo <= hi) {
        val mid = (lo + hi) ushr 1
        val s = srcs[mid]
        if (cp < s) {
            hi = mid - 1
        } else if (cp > s) {
            lo = mid + 1
        } else {
            return table.suppLowerDst[mid]
        }
    }
    return cp
}

fun codePointAtSafe(text: String, index: Int): CodePointUnit {
    if (index < 0 || index >= text.length) {
        throw IndexOutOfBoundsException("codePointAtSafe: index $index out of bounds for length ${text.length}")
    }
    val cu0 = text[index].code
    if (cu0 in 0xD800..0xDBFF) {
        if (index + 1 < text.length) {
            val cu1 = text[index + 1].code
            if (cu1 in 0xDC00..0xDFFF) {
                val cp = ((cu0 - 0xD800) shl 10) + (cu1 - 0xDC00) + 0x10000
                return CodePointUnit(cp, 2, false)
            }
        }
        return CodePointUnit(cu0, 1, true)
    }
    if (cu0 in 0xDC00..0xDFFF) {
        return CodePointUnit(cu0, 1, true)
    }
    return CodePointUnit(cu0, 1, false)
}

private data class PrevCodePoint(
    val start: Int,
    val cp: Int,
    val isUnpairedSurrogate: Boolean,
)

private fun readPrevCodePointBefore(text: String, endIndex: Int): PrevCodePoint? {
    if (endIndex <= 0) return null
    val cu1 = text[endIndex - 1].code
    if (cu1 in 0xDC00..0xDFFF) {
        if (endIndex >= 2) {
            val cu0 = text[endIndex - 2].code
            if (cu0 in 0xD800..0xDBFF) {
                val cp = ((cu0 - 0xD800) shl 10) + (cu1 - 0xDC00) + 0x10000
                return PrevCodePoint(endIndex - 2, cp, false)
            }
        }
        return PrevCodePoint(endIndex - 1, cu1, true)
    }
    if (cu1 in 0xD800..0xDBFF) {
        return PrevCodePoint(endIndex - 1, cu1, true)
    }
    return PrevCodePoint(endIndex - 1, cu1, false)
}

fun isJoinerPreservedScript(cp: Int): Boolean {
    val starts = NormTableData.joinerRangeStarts
    val ends = NormTableData.joinerRangeEnds
    var lo = 0
    var hi = starts.size - 1
    while (lo <= hi) {
        val mid = (lo + hi) ushr 1
        if (cp < starts[mid]) {
            hi = mid - 1
        } else if (cp > ends[mid]) {
            lo = mid + 1
        } else {
            return true
        }
    }
    return false
}

// General_Category numeric codes: 1:Lu, 2:Ll, 3:Lt, 4:Lm, 5:Lo, 6:Mn, 7:Mc, 8:Me, 12..18:P*
private fun isBaseLetterCode(code: Int): Boolean = code in 1..5

fun isBaseLetter(cp: Int): Boolean = isBaseLetterCode(generalCategoryCode(cp))

fun isCombiningMark(cp: Int): Boolean {
    val code = generalCategoryCode(cp)
    return code == 6 || code == 7
}

fun isMarkMnOrMe(cp: Int): Boolean {
    val code = generalCategoryCode(cp)
    return code == 6 || code == 8
}

fun isPunctuation(cp: Int): Boolean {
    val code = generalCategoryCode(cp)
    return code in 12..18
}

fun isLetter(cp: Int, prevIsLetter: Boolean = false): Boolean {
    val code = generalCategoryCode(cp)
    if (isBaseLetterCode(code)) return true
    return prevIsLetter && (code == 6 || code == 7)
}

fun isLetterAt(text: String, index: Int): Boolean {
    if (index < 0 || index >= text.length) return false
    val unit = codePointAtSafe(text, index)
    if (unit.isUnpairedSurrogate) return false
    val code = generalCategoryCode(unit.cp)
    if (isBaseLetterCode(code)) return true
    if (code != 6 && code != 7) return false

    var cursor = index
    while (cursor > 0) {
        val prev = readPrevCodePointBefore(text, cursor) ?: return false
        if (prev.isUnpairedSurrogate) return false
        val prevCode = generalCategoryCode(prev.cp)
        if (isBaseLetterCode(prevCode)) return true
        if (prevCode == 6 || prevCode == 7) {
            cursor = prev.start
            continue
        }
        return false
    }
    return false
}

fun isUpper(cp: Int): Boolean {
    val code = generalCategoryCode(cp)
    return code == 1 || code == 3
}

fun isLower(cp: Int): Boolean = generalCategoryCode(cp) == 2

fun isDigit(cp: Int): Boolean = cp in 0x30..0x39

fun isSpace(cp: Int): Boolean = cp == 0x20 || cp == 0x09 || cp == 0x0A || cp == 0x0D

fun isPunctSent(cp: Int): Boolean = cp == 0x2E || cp == 0x3F || cp == 0x21

fun isCloser(cp: Int): Boolean =
    cp == 0x22 || cp == 0x27 || cp == 0x29 || cp == 0x5D || cp == 0x7D

fun isKeyChar(cp: Int): Boolean {
    if (cp in 0x30..0x39) return true // 0-9
    if (cp in 0x41..0x5A) return true // A-Z
    if (cp in 0x61..0x7A) return true // a-z
    return when (cp) {
        0x5F, // _
        0x3A, // :
        0x2E, // .
        0x23, // #
        0x24, // $
        0x25, // %
        0x26, // &
        0x2D, // -
        0x2B, // +
        0x3F, // ?
        0x3C, // <
        0x3E, // >
        0x7E, // ~
        0x2F, // /
        0x27, // '
        -> true
        else -> false
    }
}

private fun normAsciiDigitChar(cp: Int): Char? {
    if (cp in 0x30..0x39) return cp.toChar()
    if (cp in 0xFF10..0xFF19) return (cp - 0xFEE0).toChar()
    return null
}

private fun isSuperscriptDigit(cp: Int): Boolean =
    cp == 0x2070 || cp == 0x00B9 || cp == 0x00B2 || cp == 0x00B3 || cp in 0x2074..0x2079

private fun isStage2Superscript(cp: Int): Boolean =
    isSuperscriptDigit(cp) || cp == 0x207A || cp == 0x207B

private fun pushStrUnits(units: CharBuf, offs: IntBuf, str: String, srcOffset: Int, startFrom: Int = 0) {
    for (i in startFrom until str.length) {
        units.add(str[i])
        offs.add(srcOffset)
    }
}

private fun pushCodePointUnits(units: CharBuf, offs: IntBuf, cp: Int, srcOffset: Int) {
    if (cp <= 0xFFFF) {
        units.addCodeUnit(cp)
        offs.add(srcOffset)
    } else {
        val u = cp - 0x10000
        units.addCodeUnit(0xD800 + (u shr 10))
        offs.add(srcOffset)
        units.addCodeUnit(0xDC00 + (u and 0x3FF))
        offs.add(srcOffset)
    }
}

fun norm(x: String): NormResult {
    val xLen = x.length
    var isCleanAscii = true
    var prevSpace = false
    for (idx in 0 until xLen) {
        val cu = x[idx].code
        if (cu >= 0x80 || cu == 0x0D || cu == 0x09) {
            isCleanAscii = false
            break
        }
        if (cu == 0x20) {
            if (prevSpace) {
                isCleanAscii = false
                break
            }
            prevSpace = true
        } else {
            prevSpace = false
        }
    }
    if (isCleanAscii) {
        val map = IntArray(xLen + 1) { it }
        return NormResult(x, map)
    }

    // Stage 1: latin_compose
    val s1Cps = IntBuf(xLen)
    val s1Offs = IntBuf(xLen)
    val latinCompose = NormTableData.normTable.latinCompose
    val maxSeq = NormTableData.maxLatinComposeSeqUnits

    var i = 0
    while (i < xLen) {
        val unit = codePointAtSafe(x, i)
        var end = i + unit.len
        while (end < xLen) {
            val cu = x[end].code
            if (cu in 0x0300..0x036F) {
                end++
            } else {
                break
            }
        }
        if (end > i + unit.len) {
            if (!unit.isUnpairedSurrogate &&
                (unit.cp < 0x0300 || unit.cp > 0x036F) &&
                end - i <= maxSeq
            ) {
                val seq = x.substring(i, end)
                val composed = latinCompose[seq]
                if (composed != null) {
                    s1Cps.add(codePointAtSafe(composed, 0).cp)
                    s1Offs.add(i)
                    i = end
                    continue
                }
            }
            s1Cps.add(unit.cp)
            s1Offs.add(i)
            for (m in (i + unit.len) until end) {
                s1Cps.add(x[m].code)
                s1Offs.add(m)
            }
            i = end
            continue
        }
        s1Cps.add(unit.cp)
        s1Offs.add(i)
        i += unit.len
    }

    // Stage 2: one-code-point mapping table & contextual rules
    val s2Units = CharBuf(s1Cps.size + 8)
    val s2Offs = IntBuf(s1Cps.size + 8)
    val s1Len = s1Cps.size
    val stage2Map = NormTableData.stage2MapByCp
    var prevWasSuperscript = false

    var k = 0
    while (k < s1Len) {
        val cp = s1Cps[k]
        val srcOff = s1Offs[k]

        // CRLF -> LF
        if (cp == 0x000D && k + 1 < s1Len && s1Cps[k + 1] == 0x000A) {
            s2Units.add('\n')
            s2Offs.add(srcOff)
            prevWasSuperscript = false
            k += 2
            continue
        }

        // Script-aware U+200C / U+200D
        if (cp == 0x200C || cp == 0x200D) {
            if (k > 0 &&
                k + 1 < s1Len &&
                isJoinerPreservedScript(s1Cps[k - 1]) &&
                isJoinerPreservedScript(s1Cps[k + 1])
            ) {
                s2Units.addCodeUnit(cp)
                s2Offs.add(srcOff)
            }
            prevWasSuperscript = false
            k++
            continue
        }

        // Lancet decimal U+00B7 vs multiplication dot
        if (cp == 0x00B7) {
            prevWasSuperscript = false
            val prevDigit = if (k > 0) normAsciiDigitChar(s1Cps[k - 1]) else null
            val nextDigit = if (k + 1 < s1Len) normAsciiDigitChar(s1Cps[k + 1]) else null
            var isLancetDecimal = prevDigit != null && nextDigit != null
            if (isLancetDecimal && nextDigit == '1' && k + 3 < s1Len) {
                val secondDigit = normAsciiDigitChar(s1Cps[k + 2])
                if (secondDigit == '0') {
                    val after10 = s1Cps[k + 3]
                    if (after10 == 0x005E ||
                        after10 == 0xFF3E ||
                        isSuperscriptDigit(after10) ||
                        ((after10 == 0x207A || after10 == 0x207B) &&
                            k + 4 < s1Len &&
                            isSuperscriptDigit(s1Cps[k + 4]))
                    ) {
                        isLancetDecimal = false
                    }
                }
            }
            s2Units.addCodeUnit(if (isLancetDecimal) 0x002E else 0x00D7)
            s2Offs.add(srcOff)
            k++
            continue
        }

        // Superscripts sharing one leading "^"
        if (isStage2Superscript(cp)) {
            val mapped = stage2Map[cp]!!
            pushStrUnits(s2Units, s2Offs, mapped, srcOff, if (prevWasSuperscript) 1 else 0)
            prevWasSuperscript = true
            k++
            continue
        }

        prevWasSuperscript = false
        if (cp < 0x80) {
            s2Units.addCodeUnit(if (cp == 0x0D) 0x0A else cp)
            s2Offs.add(srcOff)
            k++
            continue
        }
        val mapped = stage2Map[cp]
        if (mapped != null) {
            pushStrUnits(s2Units, s2Offs, mapped, srcOff)
        } else {
            pushCodePointUnits(s2Units, s2Offs, cp, srcOff)
        }
        k++
    }

    // Stage 3: collapse U+0020 / U+0009 runs to one U+0020 without trimming
    val s2Len = s2Units.size
    val s3Units = CharBuf(s2Len)
    val map = IntBuf(s2Len + 1)

    var j = 0
    while (j < s2Len) {
        val u = s2Units[j]
        if (u == ' ' || u == '\t') {
            s3Units.add(' ')
            map.add(s2Offs[j])
            j++
            while (j < s2Len && (s2Units[j] == ' ' || s2Units[j] == '\t')) {
                j++
            }
        } else {
            s3Units.add(u)
            map.add(s2Offs[j])
            j++
        }
    }

    map.add(xLen)
    return NormResult(s3Units.buildString(), map.toArray())
}

fun normLowerWithMap(x: String): NormResult {
    val xLen = x.length
    var allAsciiClean = true
    var prevSpace = false
    for (i in 0 until xLen) {
        val cu = x[i].code
        if (cu >= 0x80 || cu == 0x0D || cu == 0x09) {
            allAsciiClean = false
            break
        }
        if (cu == 0x20) {
            if (prevSpace) {
                allAsciiClean = false
                break
            }
            prevSpace = true
        } else {
            prevSpace = false
        }
    }

    if (allAsciiClean) {
        val outMap = IntArray(xLen + 1) { it }
        var sb: StringBuilder? = null
        for (i in 0 until xLen) {
            val ch = x[i]
            val cu = ch.code
            if (cu in 0x41..0x5A) {
                if (sb == null) {
                    sb = StringBuilder(xLen)
                    sb.append(x, 0, i)
                }
                sb.append((cu + 32).toChar())
            } else {
                sb?.append(ch)
            }
        }
        return NormResult(sb?.toString() ?: x, outMap)
    }

    val normed = norm(x)
    val text = normed.text
    val map = normed.map
    val outUnits = CharBuf(text.length)
    val outMap = IntBuf(text.length + 1)
    val lowerOverrides = NormTableData.lowerOverridesByCp

    var i = 0
    while (i < text.length) {
        val rawOff = if (i < map.size) map[i] else xLen
        val cu0 = text[i].code
        if (cu0 < 0x80) {
            outUnits.addCodeUnit(if (cu0 in 0x41..0x5A) cu0 + 32 else cu0)
            outMap.add(rawOff)
            i++
            continue
        }
        val unit = codePointAtSafe(text, i)
        if (unit.isUnpairedSurrogate) {
            outUnits.addCodeUnit(unit.cp)
            outMap.add(rawOff)
            i++
            continue
        }
        val override = lowerOverrides[unit.cp]
        if (override != null) {
            pushStrUnits(outUnits, outMap, override, rawOff)
        } else {
            val lowerCp = simpleLowerCodePoint(unit.cp)
            pushCodePointUnits(outUnits, outMap, lowerCp, rawOff)
        }
        i += unit.len
    }

    outMap.add(xLen)
    return NormResult(outUnits.buildString(), outMap.toArray())
}

fun normLower(x: String): String {
    val xLen = x.length
    var allAscii = true
    var needsRewrite = false
    var prevSpace = false

    for (i in 0 until xLen) {
        val cu = x[i].code
        if (cu >= 0x80) {
            allAscii = false
            break
        }
        if ((cu in 0x41..0x5A) || cu == 0x0D || cu == 0x09) {
            needsRewrite = true
            prevSpace = cu == 0x09
        } else if (cu == 0x20) {
            if (prevSpace) {
                needsRewrite = true
            }
            prevSpace = true
        } else {
            prevSpace = false
        }
    }

    if (allAscii) {
        if (!needsRewrite) {
            return x
        }
        val outUnits = CharBuf(xLen)
        var inSpace = false
        var i = 0
        while (i < xLen) {
            val cu = x[i].code
            if (cu == 0x20 || cu == 0x09) {
                if (!inSpace) {
                    outUnits.add(' ')
                    inSpace = true
                }
            } else if (cu == 0x0D) {
                if (i + 1 < xLen && x[i + 1].code == 0x0A) {
                    i++
                }
                outUnits.add('\n')
                inSpace = false
            } else if (cu in 0x41..0x5A) {
                outUnits.addCodeUnit(cu + 32)
                inSpace = false
            } else {
                outUnits.addCodeUnit(cu)
                inSpace = false
            }
            i++
        }
        return outUnits.buildString()
    }

    return normLowerWithMap(x).text
}

fun lowercaseNormalized(normText: String): String {
    val len = normText.length
    var allAscii = true
    var hasUpper = false
    for (i in 0 until len) {
        val cu = normText[i].code
        if (cu >= 0x80) {
            allAscii = false
            break
        }
        if (cu in 0x41..0x5A) {
            hasUpper = true
        }
    }
    if (allAscii) {
        if (!hasUpper) return normText
        val out = CharArray(len)
        for (i in 0 until len) {
            val cu = normText[i].code
            out[i] = (if (cu in 0x41..0x5A) cu + 32 else cu).toChar()
        }
        return String(out)
    }

    val outUnits = CharBuf(len)
    val lowerOverrides = NormTableData.lowerOverridesByCp
    var i = 0
    while (i < len) {
        val cu0 = normText[i].code
        if (cu0 < 0x80) {
            outUnits.addCodeUnit(if (cu0 in 0x41..0x5A) cu0 + 32 else cu0)
            i++
            continue
        }
        val unit = codePointAtSafe(normText, i)
        if (unit.isUnpairedSurrogate) {
            outUnits.addCodeUnit(unit.cp)
            i++
            continue
        }
        val override = lowerOverrides[unit.cp]
        if (override != null) {
            for (k in 0 until override.length) {
                outUnits.add(override[k])
            }
        } else {
            val lowerCp = simpleLowerCodePoint(unit.cp)
            if (lowerCp <= 0xFFFF) {
                outUnits.addCodeUnit(lowerCp)
            } else {
                val u = lowerCp - 0x10000
                outUnits.addCodeUnit(0xD800 + (u shr 10))
                outUnits.addCodeUnit(0xDC00 + (u and 0x3FF))
            }
        }
        i += unit.len
    }
    return outUnits.buildString()
}

fun foldLatin(x: String): String {
    val xLen = x.length
    val latinCompose = NormTableData.normTable.latinCompose
    val latinFold = NormTableData.normTable.latinFold
    val maxSeq = NormTableData.maxLatinComposeSeqUnits

    // Stage 1: latin_compose
    val s1Units = ArrayList<String>(xLen)
    var i = 0
    while (i < xLen) {
        val unit = codePointAtSafe(x, i)
        var end = i + unit.len
        while (end < xLen) {
            val cu = x[end].code
            if (cu in 0x0300..0x036F) {
                end++
            } else {
                break
            }
        }
        if (end > i + unit.len) {
            if (!unit.isUnpairedSurrogate &&
                (unit.cp < 0x0300 || unit.cp > 0x036F) &&
                end - i <= maxSeq
            ) {
                val seq = x.substring(i, end)
                val composed = latinCompose[seq]
                if (composed != null) {
                    s1Units.add(composed)
                    i = end
                    continue
                }
            }
            s1Units.add(x.substring(i, i + unit.len))
            for (m in (i + unit.len) until end) {
                s1Units.add(x.substring(m, m + 1))
            }
            i = end
            continue
        }
        s1Units.add(x.substring(i, i + unit.len))
        i += unit.len
    }

    val sb = StringBuilder(xLen)
    var prevWasLatin = false
    for (ch in s1Units) {
        val folded = latinFold[ch]
        if (folded != null) {
            sb.append(folded)
            prevWasLatin = true
            continue
        }
        val unit = codePointAtSafe(ch, 0)
        if (!unit.isUnpairedSurrogate && unit.cp in 0x0300..0x036F && prevWasLatin) {
            continue
        }
        sb.append(ch)
        prevWasLatin = !unit.isUnpairedSurrogate &&
            ((unit.cp in 0x41..0x5A) ||
                (unit.cp in 0x61..0x7A) ||
                (unit.cp in 0x00C0..0x024F && isBaseLetter(unit.cp)) ||
                (unit.cp in 0x1E00..0x1EFF && isBaseLetter(unit.cp)))
    }
    return sb.toString()
}

fun utf8Encode(x: String): ByteArray {
    val n = x.length
    var allAscii = true
    for (i in 0 until n) {
        if (x[i].code >= 0x80) {
            allAscii = false
            break
        }
    }
    if (allAscii) {
        return ByteArray(n) { x[it].code.toByte() }
    }

    val buf = ByteArray(n * 3)
    var pos = 0
    var i = 0
    while (i < n) {
        val cu = x[i].code
        if (cu <= 0x7F) {
            buf[pos++] = cu.toByte()
            i++
            continue
        }
        val unit = codePointAtSafe(x, i)
        val cp = if (unit.isUnpairedSurrogate) 0xFFFD else unit.cp
        if (cp <= 0x7FF) {
            buf[pos++] = (0xC0 or (cp shr 6)).toByte()
            buf[pos++] = (0x80 or (cp and 0x3F)).toByte()
        } else if (cp <= 0xFFFF) {
            buf[pos++] = (0xE0 or (cp shr 12)).toByte()
            buf[pos++] = (0x80 or ((cp shr 6) and 0x3F)).toByte()
            buf[pos++] = (0x80 or (cp and 0x3F)).toByte()
        } else {
            buf[pos++] = (0xF0 or (cp shr 18)).toByte()
            buf[pos++] = (0x80 or ((cp shr 12) and 0x3F)).toByte()
            buf[pos++] = (0x80 or ((cp shr 6) and 0x3F)).toByte()
            buf[pos++] = (0x80 or (cp and 0x3F)).toByte()
        }
        i += unit.len
    }
    return buf.copyOf(pos)
}

private val SHA256_DIGEST: ThreadLocal<MessageDigest> = ThreadLocal.withInitial {
    MessageDigest.getInstance("SHA-256")
}

private val HEX_DIGITS = charArrayOf(
    '0', '1', '2', '3', '4', '5', '6', '7',
    '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
)

private fun digestBytesToHex(digest: ByteArray, byteCount: Int): String {
    val chars = CharArray(byteCount * 2)
    for (i in 0 until byteCount) {
        val b = digest[i].toInt() and 0xFF
        chars[i * 2] = HEX_DIGITS[b ushr 4]
        chars[i * 2 + 1] = HEX_DIGITS[b and 0x0F]
    }
    return String(chars)
}

fun sha256hexBytes(bytes: ByteArray): String {
    val md = SHA256_DIGEST.get()
    md.reset()
    val digest = md.digest(bytes)
    return digestBytesToHex(digest, 32)
}

fun sha256hex(x: String): String = sha256hexBytes(utf8Encode(x))

interface Sha256PrefixHasher {
    fun digestHex32(suffix: String): String
    fun digestHex(suffix: String): String
}

fun createSha256PrefixHasher(prefix: String): Sha256PrefixHasher {
    val prefixBytes = utf8Encode(prefix)
    return object : Sha256PrefixHasher {
        override fun digestHex32(suffix: String): String = hashSuffix(suffix, true)
        override fun digestHex(suffix: String): String = hashSuffix(suffix, false)

        private fun hashSuffix(suffix: String, hex32Only: Boolean): String {
            val md = SHA256_DIGEST.get()
            md.reset()
            md.update(prefixBytes)
            md.update(utf8Encode(suffix))
            val digest = md.digest()
            return digestBytesToHex(digest, if (hex32Only) 16 else 32)
        }
    }
}
