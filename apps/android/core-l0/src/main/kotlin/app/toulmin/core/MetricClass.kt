package app.toulmin.core

enum class MetricClass(val wireName: String) {
    SAMPLE_SIZE("sample_size"),
    PERCENTAGE("percentage"),
    EFFECT_SIZE("effect_size"),
    P_VALUE("p_value"),
    DURATION("duration"),
    DOSE("dose"),
    CONCENTRATION("concentration"),
    CURRENCY("currency"),
    COUNT("count"),
    RATIO("ratio"),
    OTHER("other"),
    ;

    companion object {
        fun fromWireName(wire: String): MetricClass =
            entries.firstOrNull { it.wireName == wire }
                ?: error("Unknown MetricClass: $wire")
    }
}

data class MetricClassInput(
    val unitFamily: UnitFamily,
    val isRule4PValue: Boolean,
    val isSampleSizePrefix: Boolean,
    val windowWordsLower: List<String>,
    val windowTextLower: String,
    val preNormalized: Boolean = false,
)

data class MetricClassification(
    val metricClass: MetricClass,
    val metricFromUnit: Boolean,
)

data class DocMetricCues(
    val hasEffectCue: Boolean,
    val hasSampleCue: Boolean,
    val hasDoseCue: Boolean,
)

private val EFFECT_SIZE_SINGLE_WORDS: Set<String> = hashSetOf(
    "beta",
    "\u03B2",
    "correlation",
    "auc",
    "smd",
    "md",
)

private val SAMPLE_SIZE_SINGLE_WORDS: Set<String> = hashSetOf(
    "enrolled",
    "recruited",
    "randomized",
    "randomised",
    "included",
    "total",
    "cohort",
)

private val DOSE_SINGLE_WORDS: Set<String> = hashSetOf(
    "dose",
    "dosage",
    "administered",
    "given",
)

fun detectDocMetricCues(
    normLowerText: String,
    wordSpans: List<WordSpan>,
    hasLetterMask: ByteArray,
    tableWindowWords: List<String>?,
    tableCombinedLower: String,
): DocMetricCues {
    var hasEffectCue = normLowerText.contains("=") ||
        normLowerText.contains("r^2") ||
        normLowerText.contains("r\u00B2") ||
        tableCombinedLower.contains("=") ||
        tableCombinedLower.contains("r^2") ||
        tableCombinedLower.contains("r\u00B2")
    var hasSampleCue = false
    var hasDoseCue = false

    fun inspectWord(w: String): Boolean {
        if (!hasEffectCue &&
            (EFFECT_SIZE_SINGLE_WORDS.contains(w) ||
                w == "effect" ||
                w == "cohen" ||
                w == "cohen's" ||
                w == "cohen\u2019s")
        ) {
            hasEffectCue = true
        }
        if (!hasSampleCue && (SAMPLE_SIZE_SINGLE_WORDS.contains(w) || w == "sample")) {
            hasSampleCue = true
        }
        if (!hasDoseCue && DOSE_SINGLE_WORDS.contains(w)) {
            hasDoseCue = true
        }
        return hasEffectCue && hasSampleCue && hasDoseCue
    }

    if (tableWindowWords != null) {
        for (i in tableWindowWords.indices) {
            if (inspectWord(tableWindowWords[i])) {
                return DocMetricCues(hasEffectCue, hasSampleCue, hasDoseCue)
            }
        }
    }

    for (i in wordSpans.indices) {
        if (hasLetterMask[i].toInt() != 1) continue
        if (inspectWord(wordSpans[i].text)) break
    }

    return DocMetricCues(hasEffectCue, hasSampleCue, hasDoseCue)
}

private fun isWordCharAsciiOrLetter(text: String, idx: Int): Boolean {
    if (idx < 0 || idx >= text.length) return false
    val code = text[idx].code
    return isBaseLetter(code) || isDigit(code)
}

private fun containsWholeToken(haystackLower: String, needleLower: String): Boolean {
    var pos = 0
    val limit = haystackLower.length - needleLower.length
    while (pos <= limit) {
        val found = haystackLower.indexOf(needleLower, pos)
        if (found == -1) return false
        val leftOk = !isWordCharAsciiOrLetter(haystackLower, found - 1)
        val rightIdx = found + needleLower.length
        val rightOk = !isWordCharAsciiOrLetter(haystackLower, rightIdx)
        if (leftOk && rightOk) return true
        pos = found + 1
    }
    return false
}

private fun containsRequals(haystackLower: String): Boolean {
    var pos = 0
    val n = haystackLower.length
    while (pos < n) {
        val found = haystackLower.indexOf('r', pos)
        if (found == -1) return false
        if (!isWordCharAsciiOrLetter(haystackLower, found - 1)) {
            var j = found + 1
            while (j < n && haystackLower[j].code == 32) {
                j++
            }
            if (j < n && haystackLower[j].code == 61 /* '=' */) {
                return true
            }
        }
        pos = found + 1
    }
    return false
}

private fun hasAdjacentWords(wordsLower: List<String>, w0: String, w1: String): Boolean {
    for (i in 0 until wordsLower.size - 1) {
        if (wordsLower[i] == w0 && wordsLower[i + 1] == w1) return true
    }
    return false
}

private fun hasEffectSizeCue(wordsLower: List<String>, textLower: String): Boolean {
    for (i in wordsLower.indices) {
        if (EFFECT_SIZE_SINGLE_WORDS.contains(wordsLower[i])) return true
    }
    if (hasAdjacentWords(wordsLower, "effect", "size")) return true
    if (textLower.isEmpty() || textLower.contains("cohen")) {
        if (textLower.isNotEmpty() &&
            (containsWholeToken(textLower, "cohen's d") || containsWholeToken(textLower, "cohen\u2019s d"))
        ) {
            return true
        }
        if (hasAdjacentWords(wordsLower, "cohen", "d") ||
            hasAdjacentWords(wordsLower, "cohen's", "d") ||
            hasAdjacentWords(wordsLower, "cohen\u2019s", "d")
        ) {
            return true
        }
        for (i in 0 until wordsLower.size - 2) {
            if (wordsLower[i] == "cohen" && wordsLower[i + 1] == "s" && wordsLower[i + 2] == "d") {
                return true
            }
        }
    }
    if (textLower.contains("=") && containsRequals(textLower)) return true
    if ((textLower.contains("r^2") && containsWholeToken(textLower, "r^2")) ||
        (textLower.contains("r\u00B2") && containsWholeToken(textLower, "r\u00B2"))
    ) {
        return true
    }
    return false
}

private fun hasSampleSizeCue(wordsLower: List<String>): Boolean {
    for (i in wordsLower.indices) {
        if (SAMPLE_SIZE_SINGLE_WORDS.contains(wordsLower[i])) return true
    }
    return hasAdjacentWords(wordsLower, "sample", "size")
}

private fun hasDoseCue(wordsLower: List<String>): Boolean {
    for (i in wordsLower.indices) {
        if (DOSE_SINGLE_WORDS.contains(wordsLower[i])) return true
    }
    return false
}

private fun isRatioFamily(family: UnitFamily): Boolean =
    family == UnitFamily.RATIO_OR ||
        family == UnitFamily.RATIO_HR ||
        family == UnitFamily.RATIO_RR ||
        family == UnitFamily.RATIO_IRR

private fun isCurrencyFamily(family: UnitFamily): Boolean =
    family == UnitFamily.CURRENCY_USD ||
        family == UnitFamily.CURRENCY_EUR ||
        family == UnitFamily.CURRENCY_GBP ||
        family == UnitFamily.CURRENCY_IDR

private val MC_P_VALUE = MetricClassification(MetricClass.P_VALUE, true)
private val MC_EFFECT_UNIT = MetricClassification(MetricClass.EFFECT_SIZE, true)
private val MC_EFFECT_CUE = MetricClassification(MetricClass.EFFECT_SIZE, false)
private val MC_SAMPLE_SIZE = MetricClassification(MetricClass.SAMPLE_SIZE, false)
private val MC_PERCENTAGE = MetricClassification(MetricClass.PERCENTAGE, false)
private val MC_DURATION = MetricClassification(MetricClass.DURATION, true)
private val MC_DOSE = MetricClassification(MetricClass.DOSE, false)
private val MC_CONCENTRATION = MetricClassification(MetricClass.CONCENTRATION, true)
private val MC_CURRENCY = MetricClassification(MetricClass.CURRENCY, true)
private val MC_COUNT = MetricClassification(MetricClass.COUNT, false)
private val MC_OTHER = MetricClassification(MetricClass.OTHER, false)

fun classifyUnitOnly(
    unitFamily: UnitFamily,
    isRule4PValue: Boolean,
    isSampleSizePrefix: Boolean,
): MetricClassification {
    if (isRule4PValue) return MC_P_VALUE
    if (isRatioFamily(unitFamily)) return MC_EFFECT_UNIT
    if (unitFamily == UnitFamily.COUNT && isSampleSizePrefix) return MC_SAMPLE_SIZE
    if (unitFamily == UnitFamily.PERCENT) return MC_PERCENTAGE
    if (unitFamily == UnitFamily.TIME_SHORT || unitFamily == UnitFamily.TIME_LONG) return MC_DURATION
    if (unitFamily == UnitFamily.MASS_CONCENTRATION || unitFamily == UnitFamily.MOLAR_CONCENTRATION) {
        return MC_CONCENTRATION
    }
    if (isCurrencyFamily(unitFamily)) return MC_CURRENCY
    if (unitFamily == UnitFamily.COUNT) return MC_COUNT
    return MC_OTHER
}

fun classifyMetricClass(input: MetricClassInput): MetricClassification {
    val unitFamily = input.unitFamily
    val wordsLower = input.windowWordsLower
    if (input.isRule4PValue) return MC_P_VALUE
    if (isRatioFamily(unitFamily)) return MC_EFFECT_UNIT
    if (wordsLower.isNotEmpty() || input.windowTextLower.isNotEmpty()) {
        val textLower = if (input.preNormalized) input.windowTextLower else normLower(input.windowTextLower)
        if (hasEffectSizeCue(wordsLower, textLower)) return MC_EFFECT_CUE
    }
    if ((unitFamily == UnitFamily.COUNT && input.isSampleSizePrefix) ||
        (unitFamily != UnitFamily.PERCENT && wordsLower.isNotEmpty() && hasSampleSizeCue(wordsLower))
    ) {
        return MC_SAMPLE_SIZE
    }
    if (unitFamily == UnitFamily.PERCENT) return MC_PERCENTAGE
    if (unitFamily == UnitFamily.TIME_SHORT || unitFamily == UnitFamily.TIME_LONG) return MC_DURATION
    if ((unitFamily == UnitFamily.MASS || unitFamily == UnitFamily.DOSE_PER_BODY_MASS) &&
        wordsLower.isNotEmpty() &&
        hasDoseCue(wordsLower)
    ) {
        return MC_DOSE
    }
    if (unitFamily == UnitFamily.MASS_CONCENTRATION || unitFamily == UnitFamily.MOLAR_CONCENTRATION) {
        return MC_CONCENTRATION
    }
    if (isCurrencyFamily(unitFamily)) return MC_CURRENCY
    if (unitFamily == UnitFamily.COUNT) return MC_COUNT
    return MC_OTHER
}

fun isMetricFromUnitClass(
    metricClass: MetricClass,
    decidedByRatioFamily: Boolean = false,
): Boolean = when (metricClass) {
    MetricClass.P_VALUE,
    MetricClass.DURATION,
    MetricClass.CONCENTRATION,
    MetricClass.CURRENCY,
    MetricClass.RATIO,
    -> true
    MetricClass.EFFECT_SIZE -> decidedByRatioFamily
    MetricClass.SAMPLE_SIZE,
    MetricClass.PERCENTAGE,
    MetricClass.DOSE,
    MetricClass.COUNT,
    MetricClass.OTHER,
    -> false
}
