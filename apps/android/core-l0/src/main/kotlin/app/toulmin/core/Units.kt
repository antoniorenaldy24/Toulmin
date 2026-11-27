package app.toulmin.core

enum class UnitFamily(val wireName: String) {
    PERCENT("percent"),
    PERCENTAGE_POINTS("percentage_points"),
    COUNT("count"),
    MASS("mass"),
    MASS_CONCENTRATION("mass_concentration"),
    MOLAR_CONCENTRATION("molar_concentration"),
    DOSE_PER_BODY_MASS("dose_per_body_mass"),
    TIME_SHORT("time_short"),
    TIME_LONG("time_long"),
    CURRENCY_USD("currency_usd"),
    CURRENCY_EUR("currency_eur"),
    CURRENCY_GBP("currency_gbp"),
    CURRENCY_IDR("currency_idr"),
    RATIO_OR("ratio_or"),
    RATIO_HR("ratio_hr"),
    RATIO_RR("ratio_rr"),
    RATIO_IRR("ratio_irr"),
    NONE("none"),
    UNKNOWN("unknown"),
}

data class UnitMatch(
    val family: UnitFamily,
    val unitCanon: String,
    val factor: Double,
    val startNorm: Int,
    val endNorm: Int,
    val isSampleSizePrefix: Boolean,
    val isRatioPrefix: Boolean,
)

private data class SuffixUnitSpec(
    val variant: String,
    val family: UnitFamily,
    val unitCanon: String,
    val factor: Double,
    val requiresPctContext: Boolean = false,
    val isSymbol: Boolean = false,
)

private val CANON_TO_FAMILY: Map<String, UnitFamily> = hashMapOf(
    "%" to UnitFamily.PERCENT,
    "pp" to UnitFamily.PERCENTAGE_POINTS,
    "count" to UnitFamily.COUNT,
    "mg" to UnitFamily.MASS,
    "mg/L" to UnitFamily.MASS_CONCENTRATION,
    "mmol/L" to UnitFamily.MOLAR_CONCENTRATION,
    "mg/kg" to UnitFamily.DOSE_PER_BODY_MASS,
    "s" to UnitFamily.TIME_SHORT,
    "month" to UnitFamily.TIME_LONG,
    "usd" to UnitFamily.CURRENCY_USD,
    "eur" to UnitFamily.CURRENCY_EUR,
    "gbp" to UnitFamily.CURRENCY_GBP,
    "idr" to UnitFamily.CURRENCY_IDR,
    "ratio:or" to UnitFamily.RATIO_OR,
    "ratio:hr" to UnitFamily.RATIO_HR,
    "ratio:rr" to UnitFamily.RATIO_RR,
    "ratio:irr" to UnitFamily.RATIO_IRR,
    "" to UnitFamily.NONE,
)

private val SUFFIX_UNIT_SPECS: List<SuffixUnitSpec> = listOf(
    SuffixUnitSpec("percentage points", UnitFamily.PERCENTAGE_POINTS, "pp", 1.0),
    SuffixUnitSpec("percentage point", UnitFamily.PERCENTAGE_POINTS, "pp", 1.0),
    SuffixUnitSpec("participants", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("respondents", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("individuals", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("per cent", UnitFamily.PERCENT, "%", 1.0),
    SuffixUnitSpec("patients", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("subjects", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("children", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("students", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("percent", UnitFamily.PERCENT, "%", 1.0),
    SuffixUnitSpec("seconds", UnitFamily.TIME_SHORT, "s", 1.0),
    SuffixUnitSpec("minutes", UnitFamily.TIME_SHORT, "s", 60.0),
    SuffixUnitSpec("infants", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("animals", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("samples", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("dollars", UnitFamily.CURRENCY_USD, "usd", 1.0),
    SuffixUnitSpec("points", UnitFamily.PERCENTAGE_POINTS, "pp", 1.0, requiresPctContext = true),
    SuffixUnitSpec("people", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("adults", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("second", UnitFamily.TIME_SHORT, "s", 1.0),
    SuffixUnitSpec("minute", UnitFamily.TIME_SHORT, "s", 60.0),
    SuffixUnitSpec("months", UnitFamily.TIME_LONG, "month", 1.0),
    SuffixUnitSpec("mmol/l", UnitFamily.MOLAR_CONCENTRATION, "mmol/L", 1.0),
    SuffixUnitSpec("\u03BCmol/l", UnitFamily.MOLAR_CONCENTRATION, "mmol/L", 0.001),
    SuffixUnitSpec("umol/l", UnitFamily.MOLAR_CONCENTRATION, "mmol/L", 0.001),
    SuffixUnitSpec("nmol/l", UnitFamily.MOLAR_CONCENTRATION, "mmol/L", 1e-6),
    SuffixUnitSpec("mg/kg", UnitFamily.DOSE_PER_BODY_MASS, "mg/kg", 1.0),
    SuffixUnitSpec("\u03BCg/kg", UnitFamily.DOSE_PER_BODY_MASS, "mg/kg", 0.001),
    SuffixUnitSpec("ug/kg", UnitFamily.DOSE_PER_BODY_MASS, "mg/kg", 0.001),
    SuffixUnitSpec("mg/ml", UnitFamily.MASS_CONCENTRATION, "mg/L", 1000.0),
    SuffixUnitSpec("mg/dl", UnitFamily.MASS_CONCENTRATION, "mg/L", 10.0),
    SuffixUnitSpec("\u03BCg/ml", UnitFamily.MASS_CONCENTRATION, "mg/L", 1.0),
    SuffixUnitSpec("ug/ml", UnitFamily.MASS_CONCENTRATION, "mg/L", 1.0),
    SuffixUnitSpec("ng/ml", UnitFamily.MASS_CONCENTRATION, "mg/L", 0.001),
    SuffixUnitSpec("mol/l", UnitFamily.MOLAR_CONCENTRATION, "mmol/L", 1000.0),
    SuffixUnitSpec("month", UnitFamily.TIME_LONG, "month", 1.0),
    SuffixUnitSpec("years", UnitFamily.TIME_LONG, "month", 12.0),
    SuffixUnitSpec("weeks", UnitFamily.TIME_SHORT, "s", 604800.0),
    SuffixUnitSpec("hours", UnitFamily.TIME_SHORT, "s", 3600.0),
    SuffixUnitSpec("euros", UnitFamily.CURRENCY_EUR, "eur", 1.0),
    SuffixUnitSpec("women", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("cases", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("mg/l", UnitFamily.MASS_CONCENTRATION, "mg/L", 1.0),
    SuffixUnitSpec("g/dl", UnitFamily.MASS_CONCENTRATION, "mg/L", 10000.0),
    SuffixUnitSpec("\u03BCg/l", UnitFamily.MASS_CONCENTRATION, "mg/L", 0.001),
    SuffixUnitSpec("ug/l", UnitFamily.MASS_CONCENTRATION, "mg/L", 0.001),
    SuffixUnitSpec("g/kg", UnitFamily.DOSE_PER_BODY_MASS, "mg/kg", 1000.0),
    SuffixUnitSpec("year", UnitFamily.TIME_LONG, "month", 12.0),
    SuffixUnitSpec("week", UnitFamily.TIME_SHORT, "s", 604800.0),
    SuffixUnitSpec("hour", UnitFamily.TIME_SHORT, "s", 3600.0),
    SuffixUnitSpec("days", UnitFamily.TIME_SHORT, "s", 86400.0),
    SuffixUnitSpec("mice", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("rats", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("eyes", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("g/l", UnitFamily.MASS_CONCENTRATION, "mg/L", 1000.0),
    SuffixUnitSpec("mcg", UnitFamily.MASS, "mg", 0.001),
    SuffixUnitSpec("sec", UnitFamily.TIME_SHORT, "s", 1.0),
    SuffixUnitSpec("min", UnitFamily.TIME_SHORT, "s", 60.0),
    SuffixUnitSpec("hrs", UnitFamily.TIME_SHORT, "s", 3600.0),
    SuffixUnitSpec("day", UnitFamily.TIME_SHORT, "s", 86400.0),
    SuffixUnitSpec("yrs", UnitFamily.TIME_LONG, "month", 12.0),
    SuffixUnitSpec("pct", UnitFamily.PERCENT, "%", 1.0),
    SuffixUnitSpec("men", UnitFamily.COUNT, "count", 1.0),
    SuffixUnitSpec("usd", UnitFamily.CURRENCY_USD, "usd", 1.0),
    SuffixUnitSpec("eur", UnitFamily.CURRENCY_EUR, "eur", 1.0),
    SuffixUnitSpec("gbp", UnitFamily.CURRENCY_GBP, "gbp", 1.0),
    SuffixUnitSpec("idr", UnitFamily.CURRENCY_IDR, "idr", 1.0),
    SuffixUnitSpec("mg", UnitFamily.MASS, "mg", 1.0),
    SuffixUnitSpec("kg", UnitFamily.MASS, "mg", 1e6),
    SuffixUnitSpec("\u03BCg", UnitFamily.MASS, "mg", 0.001),
    SuffixUnitSpec("ug", UnitFamily.MASS, "mg", 0.001),
    SuffixUnitSpec("ng", UnitFamily.MASS, "mg", 1e-6),
    SuffixUnitSpec("ms", UnitFamily.TIME_SHORT, "s", 0.001),
    SuffixUnitSpec("hr", UnitFamily.TIME_SHORT, "s", 3600.0),
    SuffixUnitSpec("wk", UnitFamily.TIME_SHORT, "s", 604800.0),
    SuffixUnitSpec("mo", UnitFamily.TIME_LONG, "month", 1.0),
    SuffixUnitSpec("yr", UnitFamily.TIME_LONG, "month", 12.0),
    SuffixUnitSpec("pp", UnitFamily.PERCENTAGE_POINTS, "pp", 1.0),
    SuffixUnitSpec("rp", UnitFamily.CURRENCY_IDR, "idr", 1.0),
    SuffixUnitSpec("g", UnitFamily.MASS, "mg", 1000.0),
    SuffixUnitSpec("s", UnitFamily.TIME_SHORT, "s", 1.0),
    SuffixUnitSpec("h", UnitFamily.TIME_SHORT, "s", 3600.0),
    SuffixUnitSpec("d", UnitFamily.TIME_SHORT, "s", 86400.0),
    SuffixUnitSpec("y", UnitFamily.TIME_LONG, "month", 12.0),
    SuffixUnitSpec("%", UnitFamily.PERCENT, "%", 1.0, isSymbol = true),
    SuffixUnitSpec("$", UnitFamily.CURRENCY_USD, "usd", 1.0, isSymbol = true),
    SuffixUnitSpec("\u20AC", UnitFamily.CURRENCY_EUR, "eur", 1.0, isSymbol = true),
    SuffixUnitSpec("\u00A3", UnitFamily.CURRENCY_GBP, "gbp", 1.0, isSymbol = true),
)

private val SUFFIX_VARIANTS_BY_FIRST_CHAR: Map<Char, List<SuffixUnitSpec>> = run {
    val map = HashMap<Char, MutableList<SuffixUnitSpec>>()
    for (spec in SUFFIX_UNIT_SPECS) {
        map.getOrPut(spec.variant[0]) { ArrayList() }.add(spec)
    }
    map
}

val UNIT_WORDS: Set<String> = hashSetOf(
    "percent",
    "cent",
    "pct",
    "pp",
    "percentage",
    "point",
    "points",
    "participants",
    "patients",
    "subjects",
    "people",
    "individuals",
    "respondents",
    "children",
    "adults",
    "women",
    "men",
    "infants",
    "students",
    "cases",
    "animals",
    "mice",
    "rats",
    "samples",
    "eyes",
    "mg",
    "kg",
    "mcg",
    "ug",
    "ng",
    "ml",
    "dl",
    "mmol",
    "mol",
    "umol",
    "nmol",
    "\u03BCg",
    "\u03BCmol",
    "ms",
    "sec",
    "second",
    "seconds",
    "min",
    "minute",
    "minutes",
    "hr",
    "hrs",
    "hour",
    "hours",
    "day",
    "days",
    "wk",
    "week",
    "weeks",
    "month",
    "months",
    "mo",
    "year",
    "years",
    "yr",
    "yrs",
    "usd",
    "dollars",
    "eur",
    "euros",
    "gbp",
    "idr",
    "rp",
)

private val KNOWN_SUFFIX_WORD_UNITS: Set<String> = SUFFIX_UNIT_SPECS
    .filter { !it.isSymbol && it.variant != "points" }
    .mapTo(HashSet()) { it.variant }

fun isKnownSuffixWordUnit(word: String): Boolean = KNOWN_SUFFIX_WORD_UNITS.contains(normLower(word))

fun unitFamilyOf(unitCanonOrRaw: String): UnitFamily {
    CANON_TO_FAMILY[unitCanonOrRaw]?.let { return it }
    if (unitCanonOrRaw.startsWith("unknown:")) return UnitFamily.UNKNOWN
    val lower = normLower(unitCanonOrRaw)
    CANON_TO_FAMILY[lower]?.let { return it }
    if (lower.startsWith("unknown:")) return UnitFamily.UNKNOWN
    if (lower == "us$") return UnitFamily.CURRENCY_USD
    if (lower == "or" || lower == "odds ratio") return UnitFamily.RATIO_OR
    if (lower == "hazard ratio" || unitCanonOrRaw == "HR") return UnitFamily.RATIO_HR
    if (lower == "hr") return UnitFamily.TIME_SHORT
    if (lower == "rr" || lower == "risk ratio" || lower == "relative risk") return UnitFamily.RATIO_RR
    if (lower == "irr") return UnitFamily.RATIO_IRR
    for (spec in SUFFIX_UNIT_SPECS) {
        if (spec.variant == lower) return spec.family
    }
    return UnitFamily.UNKNOWN
}

fun sameFamily(unitA: String, unitB: String): Boolean {
    val fa = unitFamilyOf(unitA)
    val fb = unitFamilyOf(unitB)
    if (fa == UnitFamily.UNKNOWN || fb == UnitFamily.UNKNOWN) return false
    return fa == fb
}

private fun isWordBoundaryChar(text: String, idx: Int): Boolean {
    if (idx < 0 || idx >= text.length) return false
    val u = codePointAtSafe(text, idx)
    return isBaseLetter(u.cp) || isDigit(u.cp)
}

private fun codePointAtPrev(text: String, endIdx: Int): Pair<Int, Int> {
    val cu = text[endIdx - 1].code
    if (cu in 0xDC00..0xDFFF && endIdx >= 2) {
        val hi = text[endIdx - 2].code
        if (hi in 0xD800..0xDBFF) {
            return (((hi - 0xD800) shl 10) + (cu - 0xDC00) + 0x10000) to 2
        }
    }
    return cu to 1
}

private fun isBoundaryBefore(text: String, start: Int): Boolean {
    if (start <= 0) return true
    val (cp, _) = codePointAtPrev(text, start)
    return !isBaseLetter(cp) && !isDigit(cp)
}

private fun isValidSuffixBoundary(text: String, afterEnd: Int, isSymbol: Boolean): Boolean {
    if (afterEnd >= text.length) return true
    if (isSymbol) return !isDigit(text[afterEnd].code)
    if (isWordBoundaryChar(text, afterEnd)) return false
    if (text[afterEnd].code == 47 /* '/' */) return false
    return true
}

data class SuffixScanOptions(
    val hasPercentageContext: Boolean = false,
    val isFourDigitDecadeBase: Boolean = false,
)

fun scanSuffixUnitFast(
    normText: String,
    normLowerText: String,
    afterNumPos: Int,
    hasPercentageContext: Boolean,
    isFourDigitDecadeBase: Boolean,
): UnitMatch? {
    val n = normText.length
    if (afterNumPos >= n) return null

    var unitPos = afterNumPos
    var hadSpace = false
    while (unitPos < n && normText[unitPos].code == 32) {
        hadSpace = true
        unitPos++
    }
    if (unitPos >= n) return null

    val ch0 = normText[unitPos].code
    if (ch0 in 48..57) return null

    if (ch0 == 0x00B0) {
        var degEnd = unitPos + 1
        if (degEnd < n) {
            val nextLower = normLowerText[degEnd].code
            if ((nextLower == 99 || nextLower == 102) && !isWordBoundaryChar(normText, degEnd + 1)) {
                degEnd++
            }
        }
        return UnitMatch(
            family = UnitFamily.UNKNOWN,
            unitCanon = "unknown:" + normLowerText.substring(unitPos, degEnd),
            factor = 1.0,
            startNorm = unitPos,
            endNorm = degEnd,
            isSampleSizePrefix = false,
            isRatioPrefix = false,
        )
    }
    if (ch0 == 0x2103 || ch0 == 0x2109) {
        return UnitMatch(
            family = UnitFamily.UNKNOWN,
            unitCanon = "unknown:" + normLowerText.substring(unitPos, unitPos + 1),
            factor = 1.0,
            startNorm = unitPos,
            endNorm = unitPos + 1,
            isSampleSizePrefix = false,
            isRatioPrefix = false,
        )
    }

    if (!hadSpace &&
        isFourDigitDecadeBase &&
        normLowerText[afterNumPos].code == 115 &&
        !isWordBoundaryChar(normText, afterNumPos + 1) &&
        (afterNumPos + 1 >= n || normText[afterNumPos + 1].code != 47)
    ) {
        return null
    }

    val candidates = SUFFIX_VARIANTS_BY_FIRST_CHAR[normLowerText[unitPos]]
    if (candidates != null) {
        for (i in candidates.indices) {
            val spec = candidates[i]
            if (spec.requiresPctContext && !hasPercentageContext) continue
            if (spec.variant == "s" && !hadSpace && isFourDigitDecadeBase) continue
            val vLen = spec.variant.length
            if (unitPos + vLen <= n && normLowerText.startsWith(spec.variant, unitPos)) {
                if (isValidSuffixBoundary(normText, unitPos + vLen, spec.isSymbol)) {
                    return UnitMatch(
                        family = spec.family,
                        unitCanon = spec.unitCanon,
                        factor = spec.factor,
                        startNorm = unitPos,
                        endNorm = unitPos + vLen,
                        isSampleSizePrefix = false,
                        isRatioPrefix = false,
                    )
                }
            }
        }
    }

    if (!hadSpace) {
        var runEnd = afterNumPos
        var letterCount = 0
        while (runEnd < n) {
            val u = codePointAtSafe(normText, runEnd)
            if (isBaseLetter(u.cp)) {
                letterCount++
                runEnd += u.len
                if (letterCount > 12) return null
            } else {
                break
            }
        }
        if (letterCount >= 1 &&
            !isWordBoundaryChar(normText, runEnd) &&
            (runEnd >= n || normText[runEnd].code != 47)
        ) {
            val lowerRun = normLowerText.substring(afterNumPos, runEnd)
            if (lowerRun.isNotEmpty() && !BM25_STOPWORDS.contains(lowerRun)) {
                return UnitMatch(
                    family = UnitFamily.UNKNOWN,
                    unitCanon = "unknown:$lowerRun",
                    factor = 1.0,
                    startNorm = afterNumPos,
                    endNorm = runEnd,
                    isSampleSizePrefix = false,
                    isRatioPrefix = false,
                )
            }
        }
    }
    return null
}

fun scanSuffixUnit(
    normText: String,
    normLowerText: String,
    afterNumPos: Int,
    options: SuffixScanOptions? = null,
): UnitMatch? = scanSuffixUnitFast(
    normText,
    normLowerText,
    afterNumPos,
    options?.hasPercentageContext == true,
    options?.isFourDigitDecadeBase == true,
)

private data class PrefixCurrencySpec(
    val prefixLower: String,
    val family: UnitFamily,
    val unitCanon: String,
    val isWord: Boolean,
)

private val PREFIX_CURRENCIES = listOf(
    PrefixCurrencySpec("us$", UnitFamily.CURRENCY_USD, "usd", true),
    PrefixCurrencySpec("usd", UnitFamily.CURRENCY_USD, "usd", true),
    PrefixCurrencySpec("eur", UnitFamily.CURRENCY_EUR, "eur", true),
    PrefixCurrencySpec("gbp", UnitFamily.CURRENCY_GBP, "gbp", true),
    PrefixCurrencySpec("idr", UnitFamily.CURRENCY_IDR, "idr", true),
    PrefixCurrencySpec("rp", UnitFamily.CURRENCY_IDR, "idr", true),
    PrefixCurrencySpec("$", UnitFamily.CURRENCY_USD, "usd", false),
    PrefixCurrencySpec("\u20AC", UnitFamily.CURRENCY_EUR, "eur", false),
    PrefixCurrencySpec("\u00A3", UnitFamily.CURRENCY_GBP, "gbp", false),
)

private data class PrefixRatioSpec(
    val label: String,
    val caseSensitive: Boolean,
    val family: UnitFamily,
    val unitCanon: String,
)

private val PREFIX_RATIOS = listOf(
    PrefixRatioSpec("relative risk", false, UnitFamily.RATIO_RR, "ratio:rr"),
    PrefixRatioSpec("hazard ratio", false, UnitFamily.RATIO_HR, "ratio:hr"),
    PrefixRatioSpec("odds ratio", false, UnitFamily.RATIO_OR, "ratio:or"),
    PrefixRatioSpec("risk ratio", false, UnitFamily.RATIO_RR, "ratio:rr"),
    PrefixRatioSpec("IRR", true, UnitFamily.RATIO_IRR, "ratio:irr"),
    PrefixRatioSpec("OR", true, UnitFamily.RATIO_OR, "ratio:or"),
    PrefixRatioSpec("HR", true, UnitFamily.RATIO_HR, "ratio:hr"),
    PrefixRatioSpec("RR", true, UnitFamily.RATIO_RR, "ratio:rr"),
)

private val RATIO_CONNECTORS = listOf("=", ":", ",", "of", "was", "is")

fun scanPrefixUnit(
    normText: String,
    normLowerText: String,
    numStartNorm: Int,
    minBoundNorm: Int = 0,
): UnitMatch? {
    if (numStartNorm <= minBoundNorm) return null

    var endBeforeWs = numStartNorm
    var spacesCount = 0
    while (endBeforeWs > minBoundNorm && normText[endBeforeWs - 1].code == 32) {
        spacesCount++
        endBeforeWs--
    }
    if (endBeforeWs <= minBoundNorm) return null

    val prevLowerCode = normLowerText[endBeforeWs - 1].code
    if (spacesCount <= 1 &&
        (prevLowerCode == 36 || prevLowerCode == 0x20AC || prevLowerCode == 0x00A3 ||
            prevLowerCode == 100 || prevLowerCode == 114 || prevLowerCode == 112)
    ) {
        for (i in PREFIX_CURRENCIES.indices) {
            val c = PREFIX_CURRENCIES[i]
            val pLen = c.prefixLower.length
            val start = endBeforeWs - pLen
            if (start < minBoundNorm) continue
            if (normLowerText.startsWith(c.prefixLower, start)) {
                if (!c.isWord || isBoundaryBefore(normText, start)) {
                    return UnitMatch(
                        family = c.family,
                        unitCanon = c.unitCanon,
                        factor = 1.0,
                        startNorm = start,
                        endNorm = endBeforeWs,
                        isSampleSizePrefix = false,
                        isRatioPrefix = false,
                    )
                }
            }
        }
    }

    if (prevLowerCode == 61 /* '=' */) {
        var p = endBeforeWs - 1
        while (p > minBoundNorm && normText[p - 1].code == 32) {
            p--
        }
        if (p > minBoundNorm) {
            val chN = normText[p - 1].code
            if ((chN == 110 || chN == 78) && isBoundaryBefore(normText, p - 1)) {
                return UnitMatch(
                    family = UnitFamily.COUNT,
                    unitCanon = "count",
                    factor = 1.0,
                    startNorm = p - 1,
                    endNorm = endBeforeWs,
                    isSampleSizePrefix = true,
                    isRatioPrefix = false,
                )
            }
        }
    }

    if (spacesCount <= 2 &&
        (prevLowerCode == 61 || prevLowerCode == 58 || prevLowerCode == 44 ||
            prevLowerCode == 114 || prevLowerCode == 111 || prevLowerCode == 107 ||
            prevLowerCode == 102 || prevLowerCode == 115)
    ) {
        var labelEnd = endBeforeWs
        val chLast = normText[labelEnd - 1].code
        if (chLast == 61 || chLast == 58 || chLast == 44) {
            labelEnd--
            while (labelEnd > minBoundNorm && normText[labelEnd - 1].code == 32) {
                labelEnd--
            }
        } else {
            for (conn in RATIO_CONNECTORS) {
                if (conn.length > 1 && labelEnd - conn.length >= minBoundNorm) {
                    val cStart = labelEnd - conn.length
                    if (normLowerText.startsWith(conn, cStart) && isBoundaryBefore(normText, cStart)) {
                        labelEnd = cStart
                        while (labelEnd > minBoundNorm && normText[labelEnd - 1].code == 32) {
                            labelEnd--
                        }
                        break
                    }
                }
            }
        }

        for (i in PREFIX_RATIOS.indices) {
            val r = PREFIX_RATIOS[i]
            val lLen = r.label.length
            val lStart = labelEnd - lLen
            if (lStart < minBoundNorm) continue
            val matches = if (r.caseSensitive) {
                normText.startsWith(r.label, lStart)
            } else {
                normLowerText.startsWith(r.label, lStart)
            }
            if (matches && isBoundaryBefore(normText, lStart)) {
                return UnitMatch(
                    family = r.family,
                    unitCanon = r.unitCanon,
                    factor = 1.0,
                    startNorm = lStart,
                    endNorm = labelEnd,
                    isSampleSizePrefix = false,
                    isRatioPrefix = true,
                )
            }
        }
    }

    return null
}

fun scanLeadingPrefixCurrency(
    normText: String,
    normLowerText: String,
    pos: Int,
): UnitMatch? {
    val n = normText.length
    if (pos < 0 || pos >= n || !isBoundaryBefore(normText, pos)) return null
    val ch = normLowerText[pos].code
    if (ch != 36 && ch != 0x20AC && ch != 0x00A3 &&
        ch != 117 && ch != 101 && ch != 103 && ch != 105 && ch != 114
    ) {
        return null
    }
    for (i in PREFIX_CURRENCIES.indices) {
        val c = PREFIX_CURRENCIES[i]
        val pLen = c.prefixLower.length
        val end = pos + pLen
        if (end > n || !normLowerText.startsWith(c.prefixLower, pos)) continue
        if (c.isWord && end < n) {
            val nextUnit = codePointAtSafe(normText, end)
            if (isBaseLetter(nextUnit.cp)) continue
        }
        return UnitMatch(
            family = c.family,
            unitCanon = c.unitCanon,
            factor = 1.0,
            startNorm = pos,
            endNorm = end,
            isSampleSizePrefix = false,
            isRatioPrefix = false,
        )
    }
    return null
}

fun isNormSpaceChar(code: Int): Boolean = isSpace(code)
