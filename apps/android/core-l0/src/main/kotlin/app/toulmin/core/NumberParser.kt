package app.toulmin.core

import java.math.BigInteger
import kotlin.math.ceil

data class PrepareInputOptions(
    val lang: String? = null,
    val format: SourceFormat? = null,
    val applyLatex: Boolean? = null,
)

class PreparedInput(
    val rawText: String,
    val subText: String,
    val latexMap: IntArray?,
    val normText: String,
    val normLowerText: String,
    val normMap: IntArray,
    val isEnglish: Boolean,
    val isCleanIdentityMap: Boolean,
)

data class ParsedNumber(
    val startNorm: Int,
    val endNorm: Int,
    val value: Double,
    val sigDigits: Int,
    val mantissaNormalized: String,
    val expInt: Int,
    val hasExponent: Boolean,
    val hasDecimalSeparator: Boolean,
    val isYearIntCandidate: Boolean,
    val rawStartSub: Int,
    val rawEndSub: Int,
)

data class ParsedWordNumber(
    val value: Long,
    val endNorm: Int,
)

private val SINGLE_DIGIT_STRINGS = arrayOf("0", "1", "2", "3", "4", "5", "6", "7", "8", "9")

private val WORD_UNITS_0_19: Map<String, Long> = hashMapOf(
    "zero" to 0L,
    "one" to 1L,
    "two" to 2L,
    "three" to 3L,
    "four" to 4L,
    "five" to 5L,
    "six" to 6L,
    "seven" to 7L,
    "eight" to 8L,
    "nine" to 9L,
    "ten" to 10L,
    "eleven" to 11L,
    "twelve" to 12L,
    "thirteen" to 13L,
    "fourteen" to 14L,
    "fifteen" to 15L,
    "sixteen" to 16L,
    "seventeen" to 17L,
    "eighteen" to 18L,
    "nineteen" to 19L,
)

private val WORD_TENS: Map<String, Long> = hashMapOf(
    "twenty" to 20L,
    "thirty" to 30L,
    "forty" to 40L,
    "fifty" to 50L,
    "sixty" to 60L,
    "seventy" to 70L,
    "eighty" to 80L,
    "ninety" to 90L,
)

private val FORBIDDEN_ONE_NEXT: Set<String> = hashSetOf(
    "of",
    "can",
    "or",
    "another",
    "hand",
    "way",
)

private fun superscriptDigitValue(cu: Int): Int = when (cu) {
    0x2070 -> 0
    0x00B9 -> 1
    0x00B2 -> 2
    0x00B3 -> 3
    0x2074 -> 4
    0x2075 -> 5
    0x2076 -> 6
    0x2077 -> 7
    0x2078 -> 8
    0x2079 -> 9
    else -> -1
}

fun asciiLower(s: String): String {
    val n = s.length
    var sb: StringBuilder? = null
    for (i in 0 until n) {
        val cu = s[i].code
        if (cu in 65..90) {
            if (sb == null) {
                sb = StringBuilder(n)
                sb.append(s, 0, i)
            }
            sb.append((cu + 32).toChar())
        } else {
            sb?.append(s[i])
        }
    }
    return sb?.toString() ?: s
}

fun isEnglishLang(lang: String?): Boolean {
    if (lang == null) return true
    val trimmed = trimSpace(lang)
    if (trimmed.isEmpty()) return true
    var baseEnd = trimmed.length
    for (i in 0 until trimmed.length) {
        val ch = trimmed[i].code
        if (ch == 45 /* '-' */ || ch == 95 /* '_' */) {
            baseEnd = i
            break
        }
    }
    return asciiLower(trimmed.substring(0, baseEnd)) == "en"
}

fun isAsciiDigitCode(cu: Int): Boolean = cu in 48..57

fun isWordCharAt(text: String, idx: Int): Boolean {
    if (idx < 0 || idx >= text.length) return false
    val u = codePointAtSafe(text, idx)
    return isBaseLetter(u.cp) || isDigit(u.cp)
}

private fun codePointBefore(text: String, endIdx: Int): Pair<Int, Int> {
    val cu = text[endIdx - 1].code
    if (cu in 0xDC00..0xDFFF && endIdx >= 2) {
        val hi = text[endIdx - 2].code
        if (hi in 0xD800..0xDBFF) {
            return (((hi - 0xD800) shl 10) + (cu - 0xDC00) + 0x10000) to 2
        }
    }
    return cu to 1
}

fun isWordCharBefore(text: String, idx: Int): Boolean {
    if (idx <= 0) return false
    val (cp, _) = codePointBefore(text, idx)
    return isBaseLetter(cp) || isDigit(cp)
}

fun skipSpaces(text: String, idx: Int, limit: Int = text.length): Int {
    var k = idx
    while (k < limit && text[k].code == 32) {
        k++
    }
    return k
}

fun matchWordLowerAt(normLowerText: String, idx: Int, wordLower: String): Int {
    if (idx < 0 || idx + wordLower.length > normLowerText.length) return -1
    if (!normLowerText.startsWith(wordLower, idx)) return -1
    val end = idx + wordLower.length
    if (isWordCharBefore(normLowerText, idx) || isWordCharAt(normLowerText, end)) return -1
    return end
}

fun normalizeZero(value: Double): Double = if (value == 0.0) 0.0 else value

/**
 * Runs optional LaTeX substitution followed by Unicode 15.1 `norm()` and index-aligned lowercasing.
 */
fun prepareInput(text: String, options: PrepareInputOptions? = null): PreparedInput {
    val shouldLatex = options?.applyLatex != false && text.contains("\\")
    var subText = text
    var latexMap: IntArray? = null
    if (shouldLatex) {
        val latexRes = applyLatexSubstitutions(text)
        subText = latexRes.text
        latexMap = latexRes.map
    }
    val normRes = norm(subText)
    val normText = normRes.text
    val normMap = normRes.map
    val normLowerText = lowercaseNormalized(normText)
    return PreparedInput(
        rawText = text,
        subText = subText,
        latexMap = latexMap,
        normText = normText,
        normLowerText = normLowerText,
        normMap = normMap,
        isEnglish = isEnglishLang(options?.lang),
        isCleanIdentityMap = latexMap == null && normText == subText,
    )
}

fun toRawSpan(prep: PreparedInput, startNorm: Int, endNorm: Int): TextRange {
    if (prep.isCleanIdentityMap) {
        return TextRange(startNorm, endNorm)
    }
    val subStart = if (startNorm in prep.normMap.indices) prep.normMap[startNorm] else 0
    val subEnd = if (endNorm in prep.normMap.indices) prep.normMap[endNorm] else prep.subText.length
    val lMap = prep.latexMap ?: return TextRange(subStart, subEnd)
    val rawStart = if (subStart in lMap.indices) lMap[subStart] else 0
    val rawEnd = if (subEnd in lMap.indices) lMap[subEnd] else prep.rawText.length
    return TextRange(rawStart, maxOf(rawStart, rawEnd))
}

fun computeSigDigits(mantissaDigitsNormalized: String): Int {
    val hasDecimal = mantissaDigitsNormalized.contains(".")
    if (hasDecimal) {
        var firstNonZeroSeen = false
        var count = 0
        for (i in 0 until mantissaDigitsNormalized.length) {
            val cu = mantissaDigitsNormalized[i].code
            if (isAsciiDigitCode(cu)) {
                if (!firstNonZeroSeen) {
                    if (cu != 48) {
                        firstNonZeroSeen = true
                        count = 1
                    }
                } else {
                    count++
                }
            }
        }
        return if (count > 0) count else 1
    }

    var first = -1
    var last = -1
    for (i in 0 until mantissaDigitsNormalized.length) {
        val cu = mantissaDigitsNormalized[i].code
        if (isAsciiDigitCode(cu) && cu != 48) {
            if (first == -1) first = i
            last = i
        }
    }
    if (first == -1) return 1
    var count = 0
    for (i in first..last) {
        if (isAsciiDigitCode(mantissaDigitsNormalized[i].code)) {
            count++
        }
    }
    return if (count > 0) count else 1
}

private val DRAGON4_POW10: Array<BigInteger> = run {
    val arr = Array(330) { BigInteger.ONE }
    var cur = BigInteger.ONE
    for (i in 1 until 330) {
        cur = cur.multiply(BigInteger.TEN)
        arr[i] = cur
    }
    arr
}

private fun dragon4Pow10(exp: Int): BigInteger =
    if (exp in DRAGON4_POW10.indices) DRAGON4_POW10[exp] else BigInteger.TEN.pow(exp)

/**
 * Formats an IEEE-754 double identically to ECMAScript `Number::toString` (ECMA-262 §6.1.6.1.20, `01` §3.2)
 * using exact Burger-Dybvig (Dragon4) shortest round-trip decimal digits:
 * always uses `.` as decimal separator, preserves `-` on negatives, and never emits `-0` or leading `+`.
 */
fun formatCanonicalDecimal(value: Double): String {
    if (value.isNaN()) return "NaN"
    if (value == 0.0) return "0"
    if (value.isInfinite()) return if (value < 0.0) "-Infinity" else "Infinity"

    val negative = value < 0.0
    val absVal = if (negative) -value else value

    // Exact-integer fast path for |v| < 1e15: ULP <= 0.25 < 0.5, so integer literal is uniquely shortest.
    if (absVal < 1e15) {
        val asLong = absVal.toLong()
        if (asLong.toDouble() == absVal) {
            return if (negative) "-$asLong" else asLong.toString()
        }
    }

    val bits = absVal.toRawBits()
    val rawExp = ((bits ushr 52) and 0x7FFL).toInt()
    val rawMant = bits and 0x000F_FFFF_FFFF_FFFFL

    val f: Long
    val e: Int
    val isPow2Boundary: Boolean
    if (rawExp == 0) {
        f = rawMant
        e = -1074
        isPow2Boundary = false
    } else {
        f = (1L shl 52) or rawMant
        e = rawExp - 1075
        isPow2Boundary = (rawMant == 0L && rawExp > 1)
    }

    val inclusive = (f and 1L) == 0L
    val shift = if (isPow2Boundary) e - 2 else e - 1
    val numMant = if (isPow2Boundary) f * 4L else f * 2L
    val deltaPlusMant = if (isPow2Boundary) 2L else 1L

    var r: BigInteger
    var s: BigInteger
    var mMinus: BigInteger
    var mPlus: BigInteger
    if (shift >= 0) {
        r = BigInteger.valueOf(numMant).shiftLeft(shift)
        s = BigInteger.ONE
        mMinus = BigInteger.ONE.shiftLeft(shift)
        mPlus = BigInteger.valueOf(deltaPlusMant).shiftLeft(shift)
    } else {
        r = BigInteger.valueOf(numMant)
        s = BigInteger.ONE.shiftLeft(-shift)
        mMinus = BigInteger.ONE
        mPlus = BigInteger.valueOf(deltaPlusMant)
    }

    // Smallest decimal exponent n such that upper bound < 10^n (inclusive) or <= 10^n (exclusive).
    val bitDiff = r.bitLength() - s.bitLength()
    var n = ceil(bitDiff * 0.3010299956639812).toInt()

    if (n > 0) {
        s = s.multiply(dragon4Pow10(n))
    } else if (n < 0) {
        val factor = dragon4Pow10(-n)
        r = r.multiply(factor)
        mMinus = mMinus.multiply(factor)
        mPlus = mPlus.multiply(factor)
    }

    fun upperWithinUnit(): Boolean {
        val cmp = r.add(mPlus).compareTo(s)
        return if (inclusive) cmp < 0 else cmp <= 0
    }

    while (true) {
        val upperTen = r.add(mPlus).multiply(BigInteger.TEN)
        val cmp = upperTen.compareTo(s)
        val fitsLowerN = if (inclusive) cmp < 0 else cmp <= 0
        if (!fitsLowerN) break
        r = r.multiply(BigInteger.TEN)
        mMinus = mMinus.multiply(BigInteger.TEN)
        mPlus = mPlus.multiply(BigInteger.TEN)
        n--
    }
    while (!upperWithinUnit()) {
        s = s.multiply(BigInteger.TEN)
        n++
    }

    val digitBuf = StringBuilder(20)
    while (true) {
        r = r.multiply(BigInteger.TEN)
        mMinus = mMinus.multiply(BigInteger.TEN)
        mPlus = mPlus.multiply(BigInteger.TEN)

        val divRem = r.divideAndRemainder(s)
        val q = divRem[0].toInt()
        r = divRem[1]

        val lowCmp = r.compareTo(mMinus)
        val low = if (inclusive) lowCmp <= 0 else lowCmp < 0

        val highCmp = r.add(mPlus).compareTo(s)
        val high = if (inclusive) highCmp >= 0 else highCmp > 0

        if (!low && !high) {
            digitBuf.append(('0'.code + q).toChar())
            continue
        }
        val finalDigit = if (low && !high) {
            q
        } else if (high && !low) {
            q + 1
        } else {
            val cmpTwo = r.shiftLeft(1).compareTo(s)
            if (cmpTwo < 0) q else if (cmpTwo > 0) q + 1 else if ((q and 1) == 0) q else q + 1
        }
        digitBuf.append(('0'.code + finalDigit).toChar())
        break
    }

    val digits = digitBuf.toString()
    val k = digits.length
    val sb = StringBuilder(k + 24)
    if (negative) sb.append('-')

    if (k <= n && n <= 21) {
        sb.append(digits)
        repeat(n - k) { sb.append('0') }
    } else if (n in 1 until k) {
        sb.append(digits, 0, n)
        sb.append('.')
        sb.append(digits, n, k)
    } else if (n in -5..0) {
        sb.append("0.")
        repeat(-n) { sb.append('0') }
        sb.append(digits)
    } else {
        if (k == 1) {
            sb.append(digits[0])
        } else {
            sb.append(digits[0])
            sb.append('.')
            sb.append(digits, 1, k)
        }
        val exp = n - 1
        sb.append('e')
        sb.append(if (exp >= 0) '+' else '-')
        sb.append(if (exp >= 0) exp else -exp)
    }
    return sb.toString()
}

private fun factorPow10Exp(factor: Double): Int? = when (factor) {
    1.0 -> 0
    10.0 -> 1
    1e3 -> 3
    1e4 -> 4
    1e6 -> 6
    1e-3 -> -3
    1e-6 -> -6
    else -> null
}

private fun scaleDecimalMantissa(mantissaNormalized: String, baseExp: Int, deltaExp: Int): Double {
    val totalExp = baseExp + deltaExp
    val raw = if (totalExp == 0) {
        mantissaNormalized.toDouble()
    } else {
        "${mantissaNormalized}e$totalExp".toDouble()
    }
    return if (raw.isFinite()) normalizeZero(raw) else raw
}

fun scaleParsedNumber(num: ParsedNumber, factor: Double): Double {
    if (factor == 1.0) {
        return if (num.value.isFinite()) normalizeZero(num.value) else num.value
    }
    val deltaExp = factorPow10Exp(factor)
    if (deltaExp != null) {
        return scaleDecimalMantissa(num.mantissaNormalized, num.expInt, deltaExp)
    }
    val prod = num.value * factor
    return if (prod.isFinite()) normalizeZero(prod) else prod
}

fun scaleWordNumber(value: Long, factor: Double): Double {
    if (factor == 1.0) {
        return normalizeZero(value.toDouble())
    }
    val deltaExp = factorPow10Exp(factor)
    if (deltaExp != null) {
        return scaleDecimalMantissa(value.toString(), 0, deltaExp)
    }
    val prod = value.toDouble() * factor
    return if (prod.isFinite()) normalizeZero(prod) else prod
}

private fun isThinSpaceSeparatorAt(
    normText: String,
    normIdx: Int,
    rawSubText: String,
    normMap: IntArray,
): Boolean {
    if (normIdx < 0 || normIdx >= normText.length || normText[normIdx].code != 32) {
        return false
    }
    if (normIdx + 1 >= normMap.size) return false
    val rawStart = normMap[normIdx]
    val rawEnd = normMap[normIdx + 1]
    if (rawEnd <= rawStart) return false
    for (r in rawStart until rawEnd) {
        val cu = rawSubText[r].code
        if (cu != 0x2009 && cu != 0x202F) {
            return false
        }
    }
    return true
}

private fun countDigitsAt(text: String, pos: Int): Int {
    var k = pos
    while (k < text.length && isAsciiDigitCode(text[k].code)) {
        k++
    }
    return k - pos
}

private fun makeOverflowNumber(
    pos: Int,
    endPos: Int,
    negative: Boolean,
    rawSubText: String,
    normMap: IntArray,
): ParsedNumber = ParsedNumber(
    startNorm = pos,
    endNorm = endPos,
    value = if (negative) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY,
    sigDigits = 1,
    mantissaNormalized = "",
    expInt = 0,
    hasExponent = false,
    hasDecimalSeparator = false,
    isYearIntCandidate = false,
    rawStartSub = if (pos in normMap.indices) normMap[pos] else 0,
    rawEndSub = if (endPos in normMap.indices) normMap[endPos] else rawSubText.length,
)

private data class ThousandsScanResult(
    val groupCount: Int,
    val endScan: Int,
    val firstNonZeroGroup: Int,
)

private fun isThousandsSepAt(
    normText: String,
    rawSubText: String,
    normMap: IntArray,
    idx: Int,
    sepCode: Int,
    checkThinSpace: Boolean,
): Boolean {
    if (normText[idx].code != sepCode) return false
    return !checkThinSpace || isThinSpaceSeparatorAt(normText, idx, rawSubText, normMap)
}

private fun scanThousandsGroups(
    normText: String,
    rawSubText: String,
    normMap: IntArray,
    startIdx: Int,
    sepCode: Int,
    checkThinSpace: Boolean,
): ThousandsScanResult {
    val n = normText.length
    var scan = startIdx
    var groupCount = 0
    var firstNonZeroGroup = -1
    while (scan + 3 < n &&
        isThousandsSepAt(normText, rawSubText, normMap, scan, sepCode, checkThinSpace) &&
        isAsciiDigitCode(normText[scan + 1].code) &&
        isAsciiDigitCode(normText[scan + 2].code) &&
        isAsciiDigitCode(normText[scan + 3].code) &&
        (scan + 4 >= n || !isAsciiDigitCode(normText[scan + 4].code))
    ) {
        if (firstNonZeroGroup == -1 &&
            (normText[scan + 1].code != 48 ||
                normText[scan + 2].code != 48 ||
                normText[scan + 3].code != 48)
        ) {
            firstNonZeroGroup = groupCount
        }
        groupCount++
        scan += 4
    }
    return ThousandsScanResult(groupCount, scan, firstNonZeroGroup)
}

private fun buildThousandsIntClean(
    normText: String,
    g0Str: String,
    g0Len: Int,
    g0End: Int,
    scanRes: ThousandsScanResult,
): String? {
    if (g0Str[0].code == 48) {
        if (scanRes.firstNonZeroGroup == -1) return "0"
        val nzBase = g0End + scanRes.firstNonZeroGroup * 4
        val lz = when {
            normText[nzBase + 1].code != 48 -> 0
            normText[nzBase + 2].code != 48 -> 1
            else -> 2
        }
        val effDigits = (3 - lz) + (scanRes.groupCount - 1 - scanRes.firstNonZeroGroup) * 3
        if (effDigits > 309) return null
        val sb = StringBuilder(effDigits)
        sb.append(normText, nzBase + 1 + lz, nzBase + 4)
        var k = nzBase + 4
        for (g in (scanRes.firstNonZeroGroup + 1) until scanRes.groupCount) {
            sb.append(normText, k + 1, k + 4)
            k += 4
        }
        return sb.toString()
    }

    if (g0Len + scanRes.groupCount * 3 > 309) return null
    val sb = StringBuilder(g0Len + scanRes.groupCount * 3)
    sb.append(g0Str)
    var k = g0End
    for (g in 0 until scanRes.groupCount) {
        sb.append(normText, k + 1, k + 4)
        k += 4
    }
    return sb.toString()
}

private fun parsePlainNumberAt(
    normText: String,
    rawSubText: String,
    normMap: IntArray,
    pos: Int,
    isEnglish: Boolean,
    allowSign: Boolean,
    allowWordCharBefore: Boolean = false,
): ParsedNumber? {
    val n = normText.length
    if (pos < 0 || pos >= n) return null

    if (pos > 0 && normText[pos - 1].code == 94 /* '^' */) return null
    if (pos >= 2 &&
        normText[pos - 2].code == 94 /* '^' */ &&
        (normText[pos - 1].code == 45 || normText[pos - 1].code == 43)
    ) {
        return null
    }

    var cur = pos
    var negative = false
    val cu0 = normText[cur].code
    if (cu0 == 45 /* '-' */ || cu0 == 43 /* '+' */) {
        if (!allowSign) return null
        if (cur > 0) {
            val prevCu = normText[cur - 1].code
            if (prevCu == 41 || prevCu == 93 || isWordCharBefore(normText, cur)) {
                return null
            }
        }
        if (cur + 1 >= n) return null
        val afterSign = normText[cur + 1].code
        val isLeadingDotDec = afterSign == 46 && cur + 2 < n && isAsciiDigitCode(normText[cur + 2].code)
        if (!isAsciiDigitCode(afterSign) && !isLeadingDotDec) return null
        negative = cu0 == 45
        cur++
    } else if (!allowWordCharBefore && isWordCharBefore(normText, cur)) {
        return null
    }

    // Rule 6: Leading `.` decimal (`.045`).
    if (normText[cur].code == 46 /* '.' */) {
        if (cur + 1 >= n || !isAsciiDigitCode(normText[cur + 1].code)) return null
        if (cur > 0 && normText[cur - 1].code == 46) return null
        val fracDigitsLen = countDigitsAt(normText, cur + 1)
        val fracEnd = cur + 1 + fracDigitsLen
        if (fracEnd + 1 < n && normText[fracEnd].code == 46 && isAsciiDigitCode(normText[fracEnd + 1].code)) {
            return null
        }
        val fracStr = normText.substring(cur + 1, fracEnd)
        val canonStr = (if (negative) "-" else "") + "0." + fracStr
        val value = canonStr.toDouble()
        if (!value.isFinite()) return null
        return ParsedNumber(
            startNorm = pos,
            endNorm = fracEnd,
            value = value,
            sigDigits = computeSigDigits("0.$fracStr"),
            mantissaNormalized = canonStr,
            expInt = 0,
            hasExponent = false,
            hasDecimalSeparator = true,
            isYearIntCandidate = false,
            rawStartSub = if (pos in normMap.indices) normMap[pos] else 0,
            rawEndSub = if (fracEnd in normMap.indices) normMap[fracEnd] else rawSubText.length,
        )
    }

    if (!isAsciiDigitCode(normText[cur].code)) return null

    val g0Len = countDigitsAt(normText, cur)
    val g0Start = cur
    val g0End = cur + g0Len

    // Fast path for clean 1-3 digit unsigned integers.
    if (!negative && g0Len <= 3) {
        val nextCh = if (g0End < n) normText[g0End].code else 0
        if (nextCh != 44 && nextCh != 46 &&
            (nextCh != 32 || !isThinSpaceSeparatorAt(normText, g0End, rawSubText, normMap))
        ) {
            val d0 = normText[g0Start].code - 48
            var fastVal = d0
            var sig = 1
            if (g0Len == 2) {
                val d1 = normText[g0Start + 1].code - 48
                fastVal = d0 * 10 + d1
                if (d0 != 0) sig = if (d1 != 0) 2 else 1
            } else if (g0Len == 3) {
                val d1 = normText[g0Start + 1].code - 48
                val d2 = normText[g0Start + 2].code - 48
                fastVal = d0 * 100 + d1 * 10 + d2
                sig = if (d0 == 0) {
                    if (d1 != 0 && d2 != 0) 2 else 1
                } else {
                    if (d2 != 0) 3 else if (d1 != 0) 2 else 1
                }
            }
            return ParsedNumber(
                startNorm = pos,
                endNorm = g0End,
                value = fastVal.toDouble(),
                sigDigits = sig,
                mantissaNormalized = if (g0Len == 1) SINGLE_DIGIT_STRINGS[d0] else normText.substring(g0Start, g0End),
                expInt = 0,
                hasExponent = false,
                hasDecimalSeparator = false,
                isYearIntCandidate = false,
                rawStartSub = if (pos in normMap.indices) normMap[pos] else 0,
                rawEndSub = if (g0End in normMap.indices) normMap[g0End] else rawSubText.length,
            )
        }
    }

    val g0Str = normText.substring(g0Start, g0End)
    var intClean = g0Str
    var fracClean = ""
    var hasDecimal = false
    var endPos = g0End

    if (g0End < n) {
        val sep = normText[g0End].code
        if (sep == 44 /* ',' */) {
            val canScanCommaThousands = g0Len <= 3 && (g0Str[0].code != 48 || g0Len == 1)
            val commaRes = if (canScanCommaThousands) {
                scanThousandsGroups(normText, rawSubText, normMap, g0End, 44, false)
            } else {
                ThousandsScanResult(0, g0End, -1)
            }
            val commaLooksLikeThousands = commaRes.groupCount > 0 &&
                g0Len <= 3 &&
                (g0Str[0].code != 48 || (g0Len == 1 && commaRes.groupCount > 1)) &&
                (isEnglish ||
                    commaRes.groupCount >= 2 ||
                    (commaRes.endScan + 1 < n &&
                        normText[commaRes.endScan].code == 46 &&
                        isAsciiDigitCode(normText[commaRes.endScan + 1].code)))

            if (commaLooksLikeThousands) {
                endPos = commaRes.endScan
                if (endPos + 1 < n && normText[endPos].code == 46 && isAsciiDigitCode(normText[endPos + 1].code)) {
                    val fLen = countDigitsAt(normText, endPos + 1)
                    fracClean = normText.substring(endPos + 1, endPos + 1 + fLen)
                    hasDecimal = true
                    endPos = endPos + 1 + fLen
                }
                val built = buildThousandsIntClean(normText, g0Str, g0Len, g0End, commaRes)
                    ?: return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap)
                intClean = built
            } else if (!isEnglish && g0End + 1 < n && isAsciiDigitCode(normText[g0End + 1].code)) {
                val fLen = countDigitsAt(normText, g0End + 1)
                fracClean = normText.substring(g0End + 1, g0End + 1 + fLen)
                hasDecimal = true
                endPos = g0End + 1 + fLen
            }
        } else if (sep == 32 &&
            g0Len <= 3 &&
            g0Str[0].code != 48 &&
            isThinSpaceSeparatorAt(normText, g0End, rawSubText, normMap)
        ) {
            val thinRes = scanThousandsGroups(normText, rawSubText, normMap, g0End, 32, true)
            if (thinRes.groupCount > 0) {
                endPos = thinRes.endScan
                if (endPos + 1 < n && isAsciiDigitCode(normText[endPos + 1].code)) {
                    val trailingSep = normText[endPos].code
                    if (trailingSep == 46 || (!isEnglish && trailingSep == 44)) {
                        val fLen = countDigitsAt(normText, endPos + 1)
                        fracClean = normText.substring(endPos + 1, endPos + 1 + fLen)
                        hasDecimal = true
                        endPos = endPos + 1 + fLen
                    }
                }
                val built = buildThousandsIntClean(normText, g0Str, g0Len, g0End, thinRes)
                    ?: return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap)
                intClean = built
            }
        } else if (sep == 46 /* '.' */ && g0End + 1 < n && isAsciiDigitCode(normText[g0End + 1].code)) {
            var dotRes: ThousandsScanResult? = null
            var dotGroupCount = 0
            if (!isEnglish && g0Len in 1..3 && g0Str[0].code != 48) {
                dotRes = scanThousandsGroups(normText, rawSubText, normMap, g0End, 46, false)
                dotGroupCount = dotRes.groupCount
                if (dotGroupCount > 0 &&
                    dotRes.endScan + 1 < n &&
                    normText[dotRes.endScan].code == 46 &&
                    isAsciiDigitCode(normText[dotRes.endScan + 1].code)
                ) {
                    dotGroupCount = 0
                }
            }

            if (dotGroupCount > 0 && dotRes != null) {
                endPos = dotRes.endScan
                if (endPos + 1 < n && normText[endPos].code == 44 && isAsciiDigitCode(normText[endPos + 1].code)) {
                    val fLen = countDigitsAt(normText, endPos + 1)
                    fracClean = normText.substring(endPos + 1, endPos + 1 + fLen)
                    hasDecimal = true
                    endPos = endPos + 1 + fLen
                }
                val built = buildThousandsIntClean(normText, g0Str, g0Len, g0End, dotRes)
                    ?: return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap)
                intClean = built
            } else {
                val fLen = countDigitsAt(normText, g0End + 1)
                val fEnd = g0End + 1 + fLen
                if (fEnd + 1 < n && normText[fEnd].code == 46 && isAsciiDigitCode(normText[fEnd + 1].code)) {
                    return null
                }
                fracClean = normText.substring(g0End + 1, fEnd)
                hasDecimal = true
                endPos = fEnd
            }
        }
    }

    var leadZeros = 0
    while (leadZeros < intClean.length && intClean[leadZeros].code == 48) {
        leadZeros++
    }
    if (intClean.length - leadZeros > 309) {
        return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap)
    }

    val unsignedMantissa = if (hasDecimal) "$intClean.$fracClean" else intClean
    val signedMantissa = (if (negative) "-" else "") + unsignedMantissa
    val value = signedMantissa.toDouble()
    if (!value.isFinite()) {
        return makeOverflowNumber(pos, endPos, negative, rawSubText, normMap)
    }

    val isYearIntCandidate = !negative &&
        !hasDecimal &&
        g0Len == 4 &&
        endPos == g0End &&
        value >= 1900.0 &&
        value <= 2099.0

    return ParsedNumber(
        startNorm = pos,
        endNorm = endPos,
        value = value,
        sigDigits = computeSigDigits(unsignedMantissa),
        mantissaNormalized = signedMantissa,
        expInt = 0,
        hasExponent = false,
        hasDecimalSeparator = hasDecimal,
        isYearIntCandidate = isYearIntCandidate,
        rawStartSub = if (pos in normMap.indices) normMap[pos] else 0,
        rawEndSub = if (endPos in normMap.indices) normMap[endPos] else rawSubText.length,
    )
}

private fun clampExponentDigits(normText: String, dStart: Int, dEnd: Int, expNeg: Boolean): Int {
    var nz = dStart
    while (nz < dEnd && normText[nz].code == 48) {
        nz++
    }
    if (nz == dEnd) return 0
    if (dEnd - nz > 6) {
        return if (expNeg) -1_000_000 else 1_000_000
    }
    val mag = normText.substring(nz, dEnd).toInt()
    return if (expNeg) -mag else mag
}

private data class ExponentSuffix(val expInt: Int, val endNorm: Int)

private fun parseExponentSuffix(normText: String, afterMantissa: Int): ExponentSuffix? {
    val n = normText.length
    if (afterMantissa >= n) return null

    // Form A: e±b / E±b
    val ch = normText[afterMantissa].code
    if (ch == 101 || ch == 69) {
        var k = afterMantissa + 1
        var expNeg = false
        if (k < n && (normText[k].code == 45 || normText[k].code == 43)) {
            expNeg = normText[k].code == 45
            k++
        }
        val dStart = k
        while (k < n && isAsciiDigitCode(normText[k].code)) {
            k++
        }
        if (k > dStart && !isWordCharAt(normText, k)) {
            return ExponentSuffix(clampExponentDigits(normText, dStart, k, expNeg), k)
        }
    }

    // Form B: × 10^b, x 10^b, · 10^b
    var k = skipSpaces(normText, afterMantissa)
    if (k >= n) return null
    val op = normText[k].code
    if (op == 0x00D7 || op == 120 || op == 88 || op == 0x00B7) {
        k = skipSpaces(normText, k + 1)
        if (k + 2 <= n && normText[k].code == 49 && normText[k + 1].code == 48) {
            k = skipSpaces(normText, k + 2)
            if (k < n && normText[k].code == 94 /* '^' */) {
                k++
                val hasBrace = k < n && normText[k].code == 123
                if (hasBrace) k++
                var expNeg = false
                if (k < n && (normText[k].code == 45 || normText[k].code == 43)) {
                    expNeg = normText[k].code == 45
                    k++
                }
                val dStart = k
                while (k < n && isAsciiDigitCode(normText[k].code)) {
                    k++
                }
                if (k > dStart) {
                    val dEnd = k
                    if (hasBrace) {
                        if (k >= n || normText[k].code != 125) return null
                        k++
                    }
                    if (!isWordCharAt(normText, k)) {
                        return ExponentSuffix(clampExponentDigits(normText, dStart, dEnd, expNeg), k)
                    }
                }
            } else {
                var supIdx = k
                var expNeg = false
                if (supIdx < n) {
                    val sCh = normText[supIdx].code
                    if (sCh == 0x207B || sCh == 0x207A) {
                        expNeg = sCh == 0x207B
                        supIdx++
                    }
                }
                var digitCount = 0
                var nonZeroSeen = false
                var sigDigitsCount = 0
                var mag = 0
                while (supIdx < n) {
                    val d = superscriptDigitValue(normText[supIdx].code)
                    if (d < 0) break
                    digitCount++
                    if (d != 0 || nonZeroSeen) {
                        nonZeroSeen = true
                        sigDigitsCount++
                        if (sigDigitsCount <= 6) {
                            mag = mag * 10 + d
                        }
                    }
                    supIdx++
                }
                val trailCu = if (supIdx < n) normText[supIdx].code else 0
                if (digitCount > 0 &&
                    trailCu != 0x207B &&
                    trailCu != 0x207A &&
                    !isWordCharAt(normText, supIdx)
                ) {
                    val clampedMag = if (sigDigitsCount > 6) 1_000_000 else mag
                    val expInt = if (clampedMag == 0) 0 else if (expNeg) -clampedMag else clampedMag
                    return ExponentSuffix(expInt, supIdx)
                }
            }
        }
    }
    return null
}

fun parseNumberOrScientificAt(
    normText: String,
    rawSubText: String,
    normMap: IntArray,
    pos: Int,
    isEnglish: Boolean,
    allowSign: Boolean,
    allowWordCharBefore: Boolean = false,
): ParsedNumber? {
    val base = parsePlainNumberAt(normText, rawSubText, normMap, pos, isEnglish, allowSign, allowWordCharBefore)
        ?: return null
    val chAfter = if (base.endNorm < normText.length) normText[base.endNorm].code else 0
    if (chAfter != 101 && chAfter != 69 && chAfter != 32 &&
        chAfter != 0x00D7 && chAfter != 120 && chAfter != 88 && chAfter != 0x00B7
    ) {
        return base
    }
    val exp = parseExponentSuffix(normText, base.endNorm) ?: return base
    if (!base.value.isFinite()) {
        return ParsedNumber(
            startNorm = base.startNorm,
            endNorm = exp.endNorm,
            value = base.value,
            sigDigits = 1,
            mantissaNormalized = "",
            expInt = 0,
            hasExponent = true,
            hasDecimalSeparator = false,
            isYearIntCandidate = false,
            rawStartSub = base.rawStartSub,
            rawEndSub = if (exp.endNorm in normMap.indices) normMap[exp.endNorm] else rawSubText.length,
        )
    }
    val sciVal = "${base.mantissaNormalized}e${exp.expInt}".toDouble()
    if (!sciVal.isFinite()) {
        val isNeg = base.value < 0.0 || base.mantissaNormalized.startsWith("-")
        return makeOverflowNumber(base.startNorm, exp.endNorm, isNeg, rawSubText, normMap)
    }
    return ParsedNumber(
        startNorm = base.startNorm,
        endNorm = exp.endNorm,
        value = normalizeZero(sciVal),
        sigDigits = base.sigDigits,
        mantissaNormalized = base.mantissaNormalized,
        expInt = exp.expInt,
        hasExponent = true,
        hasDecimalSeparator = base.hasDecimalSeparator,
        isYearIntCandidate = false,
        rawStartSub = base.rawStartSub,
        rawEndSub = if (exp.endNorm in normMap.indices) normMap[exp.endNorm] else rawSubText.length,
    )
}

fun parseFiniteNumberAt(
    normText: String,
    rawSubText: String,
    normMap: IntArray,
    pos: Int,
    isEnglish: Boolean,
    allowSign: Boolean,
    allowWordCharBefore: Boolean = false,
): ParsedNumber? {
    val num = parseNumberOrScientificAt(normText, rawSubText, normMap, pos, isEnglish, allowSign, allowWordCharBefore)
    return if (num != null && num.value.isFinite()) num else null
}

fun matchDateEndAt(normText: String, pos: Int): Int {
    val n = normText.length
    if (pos < 0 || pos >= n || !isAsciiDigitCode(normText[pos].code) || isWordCharBefore(normText, pos)) {
        return -1
    }
    val len0 = countDigitsAt(normText, pos)
    if (len0 != 1 && len0 != 2 && len0 != 4) return -1
    val sepIdx = pos + len0
    if (sepIdx >= n) return -1
    val sep = normText[sepIdx].code
    if (sep != 45 && sep != 47) return -1
    val p1 = sepIdx + 1
    val len1 = countDigitsAt(normText, p1)
    if (len1 != 1 && len1 != 2) return -1
    val sep2Idx = p1 + len1
    if (sep2Idx >= n || normText[sep2Idx].code != sep) return -1
    val p2 = sep2Idx + 1
    val len2 = countDigitsAt(normText, p2)
    if (len2 <= 0) return -1
    val end = p2 + len2
    if (isWordCharAt(normText, end) || (end < n && normText[end].code == sep)) return -1

    val v0 = normText.substring(pos, pos + len0).toLongOrNull() ?: return -1
    val v1 = normText.substring(p1, p1 + len1).toLongOrNull() ?: return -1
    val v2 = normText.substring(p2, p2 + len2).toLongOrNull() ?: return -1

    if (len0 == 4 && len1 == 2 && len2 == 2) {
        return if (v0 in 1800L..2199L && v1 in 1L..12L && v2 in 1L..31L) end else -1
    }
    if (sep == 47 && (len0 == 1 || len0 == 2) && (len1 == 1 || len1 == 2) && len2 == 4) {
        if (v2 in 1800L..2199L && v0 in 1L..31L && v1 in 1L..31L) return end
    }
    if (sep == 47 && len0 == 4 && (len1 == 1 || len1 == 2) && (len2 == 1 || len2 == 2)) {
        if (v0 in 1800L..2199L && v1 in 1L..12L && v2 in 1L..31L) return end
    }
    return -1
}

fun parseWordNumberAt(normText: String, normLowerText: String, pos: Int): ParsedWordNumber? {
    if (isWordCharBefore(normText, pos)) return null
    val n = normText.length
    var wEnd = pos
    while (wEnd < n && isBaseLetter(normLowerText[wEnd].code)) {
        wEnd++
    }
    if (wEnd == pos || (wEnd < n && isDigit(normLowerText[wEnd].code))) return null

    val w0 = normLowerText.substring(pos, wEnd)
    if (w0 == "no") {
        val nextPos = skipSpaces(normText, wEnd)
        val afterOne = matchWordLowerAt(normLowerText, nextPos, "one")
        return if (afterOne != -1) ParsedWordNumber(-1L, afterOne) else null
    }
    if (w0 == "one") {
        val nextPos = skipSpaces(normText, wEnd)
        var nEnd = nextPos
        while (nEnd < n && isBaseLetter(normLowerText[nEnd].code)) {
            nEnd++
        }
        if (nEnd > nextPos) {
            val nextWord = normLowerText.substring(nextPos, nEnd)
            if (FORBIDDEN_ONE_NEXT.contains(nextWord)) {
                return ParsedWordNumber(-1L, nEnd)
            }
        }
    }

    var value: Long? = WORD_UNITS_0_19[w0]
    var curEnd = wEnd

    if (value == null) {
        val tensVal = WORD_TENS[w0]
        if (tensVal != null) {
            value = tensVal
            if (curEnd < n && (normText[curEnd].code == 45 || normText[curEnd].code == 32)) {
                var uEnd = curEnd + 1
                while (uEnd < n && isBaseLetter(normLowerText[uEnd].code)) {
                    uEnd++
                }
                if (uEnd > curEnd + 1 && (uEnd >= n || !isDigit(normLowerText[uEnd].code))) {
                    val uWord = normLowerText.substring(curEnd + 1, uEnd)
                    val uVal = WORD_UNITS_0_19[uWord]
                    if (uVal != null && uVal in 1L..9L) {
                        value += uVal
                        curEnd = uEnd
                    }
                }
            }
        } else if (w0 == "hundred") {
            value = 100L
        } else if (w0 == "thousand") {
            value = 1000L
        }
    }

    var resolved = value ?: return null
    if (resolved in 1L..99L) {
        val afterSp = skipSpaces(normText, curEnd)
        val hEnd = matchWordLowerAt(normLowerText, afterSp, "hundred")
        if (hEnd != -1) {
            resolved *= 100L
            curEnd = hEnd
        }
        val afterSp2 = skipSpaces(normText, curEnd)
        val tEnd = matchWordLowerAt(normLowerText, afterSp2, "thousand")
        if (tEnd != -1) {
            resolved *= 1000L
            curEnd = tEnd
        }
    }
    return ParsedWordNumber(resolved, curEnd)
}

private fun isBaseLetterBefore(text: String, idx: Int): Boolean {
    if (idx <= 0) return false
    return isBaseLetter(codePointBefore(text, idx).first)
}

private fun hasPercentageContextInText(textLower: String): Boolean {
    if (textLower.contains("%")) return true
    val n = textLower.length
    var pos = textLower.indexOf('p')
    while (pos != -1) {
        if (!isBaseLetterBefore(textLower, pos)) {
            val next = if (pos + 1 < n) textLower[pos + 1].code else 0
            if (next == 112 /* 'p' */) {
                if (!isWordCharAt(textLower, pos + 2) &&
                    (pos + 2 >= n || textLower[pos + 2].code != 46 /* '.' */)
                ) {
                    return true
                }
            } else if (next == 99 /* 'c' */) {
                if (textLower.startsWith("pct", pos) && !isWordCharAt(textLower, pos + 3)) {
                    return true
                }
            } else if (next == 101 /* 'e' */) {
                if (textLower.startsWith("percent", pos)) {
                    if (!isWordCharAt(textLower, pos + 7)) return true
                    if (textLower.startsWith("percentage", pos) && !isWordCharAt(textLower, pos + 10)) {
                        return true
                    }
                } else if (textLower.startsWith("per", pos) && !isWordCharAt(textLower, pos + 3)) {
                    var sp = pos + 3
                    while (sp < n && (textLower[sp].code == 32 || textLower[sp].code == 10)) {
                        sp++
                    }
                    if (sp > pos + 3 && matchWordLowerAt(textLower, sp, "cent") != -1) {
                        return true
                    }
                }
            }
        }
        pos = textLower.indexOf('p', pos + 1)
    }
    return false
}

fun hasPercentageContext(primaryLower: String, secondaryLower: String? = null): Boolean {
    if (hasPercentageContextInText(primaryLower)) return true
    return !secondaryLower.isNullOrEmpty() && hasPercentageContextInText(secondaryLower)
}
