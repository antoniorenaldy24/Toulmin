package app.toulmin.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class PorterSuffixRule(
    val suffix: String,
    val replacement: String,
    val minMeasure: Int? = null,
    val requiresVowel: Boolean? = null,
    val stemEndsWithAny: List<String>? = null,
)

data class Step1bRules(
    val eed: PorterSuffixRule,
    val pastOrProg: List<PorterSuffixRule>,
    val cleanupAppendE: List<String>,
    val doubleConsonantKeep: List<String>,
    val appendEOnMeasure1AndStarO: Boolean,
)

data class Step5aRules(
    val suffix: String,
    val removeIfMeasureGt: Int,
    val removeIfMeasureEqAndNotStarO: Int,
)

data class Step5bRules(
    val suffix: String,
    val requiresDoubleConsonant: Boolean,
    val minMeasure: Int,
)

data class PorterV1Table(
    val version: String,
    val standard: String,
    val vowels: List<String>,
    val step1a: List<PorterSuffixRule>,
    val step1b: Step1bRules,
    val step1c: List<PorterSuffixRule>,
    val step2: List<PorterSuffixRule>,
    val step3: List<PorterSuffixRule>,
    val step4: List<PorterSuffixRule>,
    val step5a: Step5aRules,
    val step5b: Step5bRules,
)

private fun parseSuffixRule(obj: JsonObject): PorterSuffixRule {
    val suffix = obj["suffix"]?.jsonPrimitive?.content ?: error("Missing suffix in porter_v1.json")
    val replacement = obj["replacement"]?.jsonPrimitive?.content ?: error("Missing replacement in porter_v1.json")
    val minMeasure = obj["minMeasure"]?.jsonPrimitive?.int
    val requiresVowel = obj["requiresVowel"]?.jsonPrimitive?.boolean
    val stemEnds = obj["stemEndsWithAny"]?.jsonArray?.map { it.jsonPrimitive.content }
    return PorterSuffixRule(
        suffix = suffix,
        replacement = replacement,
        minMeasure = minMeasure,
        requiresVowel = requiresVowel,
        stemEndsWithAny = stemEnds,
    )
}

private fun parseSuffixRules(arr: JsonArray): List<PorterSuffixRule> =
    arr.map { parseSuffixRule(it.jsonObject) }

private fun loadPorterV1Table(): PorterV1Table {
    val jsonText = NormTableData.loadResourceBytes("porter_v1.json").decodeToString()
    val root = Json.parseToJsonElement(jsonText).jsonObject
    val step1bObj = root["step1b"]!!.jsonObject
    val step5aObj = root["step5a"]!!.jsonObject
    val step5bObj = root["step5b"]!!.jsonObject
    return PorterV1Table(
        version = root["version"]!!.jsonPrimitive.content,
        standard = root["standard"]!!.jsonPrimitive.content,
        vowels = root["vowels"]!!.jsonArray.map { it.jsonPrimitive.content },
        step1a = parseSuffixRules(root["step1a"]!!.jsonArray),
        step1b = Step1bRules(
            eed = parseSuffixRule(step1bObj["eed"]!!.jsonObject),
            pastOrProg = parseSuffixRules(step1bObj["pastOrProg"]!!.jsonArray),
            cleanupAppendE = step1bObj["cleanupAppendE"]!!.jsonArray.map { it.jsonPrimitive.content },
            doubleConsonantKeep = step1bObj["doubleConsonantKeep"]!!.jsonArray.map { it.jsonPrimitive.content },
            appendEOnMeasure1AndStarO = step1bObj["appendEOnMeasure1AndStarO"]!!.jsonPrimitive.boolean,
        ),
        step1c = parseSuffixRules(root["step1c"]!!.jsonArray),
        step2 = parseSuffixRules(root["step2"]!!.jsonArray),
        step3 = parseSuffixRules(root["step3"]!!.jsonArray),
        step4 = parseSuffixRules(root["step4"]!!.jsonArray),
        step5a = Step5aRules(
            suffix = step5aObj["suffix"]!!.jsonPrimitive.content,
            removeIfMeasureGt = step5aObj["removeIfMeasureGt"]!!.jsonPrimitive.int,
            removeIfMeasureEqAndNotStarO = step5aObj["removeIfMeasureEqAndNotStarO"]!!.jsonPrimitive.int,
        ),
        step5b = Step5bRules(
            suffix = step5bObj["suffix"]!!.jsonPrimitive.content,
            requiresDoubleConsonant = step5bObj["requiresDoubleConsonant"]!!.jsonPrimitive.boolean,
            minMeasure = step5bObj["minMeasure"]!!.jsonPrimitive.int,
        ),
    )
}

val PORTER_V1: PorterV1Table by lazy { loadPorterV1Table() }

/**
 * Exact 63-word BM25 stopword list from docs/spec/02_L0_TIER_A_PRE_DECODE.md §8.1.
 * Negation terms ("not", "no", "nor", "never", "without") are intentionally excluded
 * so negation reaches retrieval and key-lemma matching.
 */
val BM25_STOPWORDS: Set<String> = hashSetOf(
    "a",
    "an",
    "the",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "from",
    "by",
    "with",
    "and",
    "or",
    "but",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "their",
    "there",
    "which",
    "who",
    "whom",
    "than",
    "then",
    "into",
    "over",
    "under",
    "between",
    "among",
    "we",
    "our",
    "us",
    "they",
    "them",
    "he",
    "she",
    "his",
    "her",
    "also",
    "such",
    "may",
    "might",
    "can",
    "could",
    "would",
    "should",
    "will",
    "shall",
    "do",
    "does",
    "did",
)

private val VOWEL_CODES: BooleanArray by lazy {
    val flags = BooleanArray(128)
    for (v in PORTER_V1.vowels) {
        if (v.isNotEmpty() && v[0].code < 128) {
            flags[v[0].code] = true
        }
    }
    flags
}

fun isStopword(word: String): Boolean = BM25_STOPWORDS.contains(asciiLower(word))

private fun isConsonant(word: String, index: Int): Boolean {
    val code = word[index].code
    if (code < 128 && VOWEL_CODES[code]) {
        return false
    }
    // 'y' is a consonant at index 0 or after a vowel, and a vowel after a consonant.
    if (code == 121) {
        return if (index == 0) true else !isConsonant(word, index - 1)
    }
    return true
}

private fun measure(stem: String): Int {
    val n = stem.length
    var i = 0
    while (i < n && isConsonant(stem, i)) {
        i++
    }
    var m = 0
    while (i < n) {
        while (i < n && !isConsonant(stem, i)) {
            i++
        }
        if (i >= n) {
            break
        }
        while (i < n && isConsonant(stem, i)) {
            i++
        }
        m++
    }
    return m
}

private fun containsVowel(stem: String): Boolean {
    for (i in 0 until stem.length) {
        if (!isConsonant(stem, i)) {
            return true
        }
    }
    return false
}

private fun endsWithDoubleConsonant(word: String): Boolean {
    val n = word.length
    if (n < 2) {
        return false
    }
    val last = word[n - 1].code
    if (last < 97 || last > 122 || last != word[n - 2].code) {
        return false
    }
    return isConsonant(word, n - 1)
}

private fun endsWithStarO(word: String): Boolean {
    val n = word.length
    if (n < 3) {
        return false
    }
    if (!isConsonant(word, n - 1) || isConsonant(word, n - 2) || !isConsonant(word, n - 3)) {
        return false
    }
    val last = word[n - 1].code
    return last != 119 && last != 120 && last != 121
}

private fun matchesStemEnding(stem: String, rule: PorterSuffixRule): Boolean {
    val ends = rule.stemEndsWithAny
    if (ends != null) {
        if (stem.isEmpty()) {
            return false
        }
        val lastChar = stem.substring(stem.length - 1)
        if (!ends.contains(lastChar)) {
            return false
        }
    }
    if (rule.requiresVowel == true && !containsVowel(stem)) {
        return false
    }
    val minM = rule.minMeasure
    if (minM != null && measure(stem) < minM) {
        return false
    }
    return true
}

private fun applyFirstSuffixStep(word: String, rules: List<PorterSuffixRule>): String {
    for (i in rules.indices) {
        val rule = rules[i]
        if (word.endsWith(rule.suffix)) {
            val stem = word.substring(0, word.length - rule.suffix.length)
            if (matchesStemEnding(stem, rule)) {
                return stem + rule.replacement
            }
            // In Porter 1980, only the first matching suffix rule is considered per step.
            return word
        }
    }
    return word
}

private fun applyStep1b(word: String): String {
    val s1b = PORTER_V1.step1b
    val eed = s1b.eed
    if (word.endsWith(eed.suffix)) {
        val stem = word.substring(0, word.length - eed.suffix.length)
        if (measure(stem) >= (eed.minMeasure ?: 1)) {
            return stem + eed.replacement
        }
        return word
    }

    var stemAfterPastOrProg: String? = null
    for (i in s1b.pastOrProg.indices) {
        val rule = s1b.pastOrProg[i]
        if (word.endsWith(rule.suffix)) {
            val stem = word.substring(0, word.length - rule.suffix.length)
            if (matchesStemEnding(stem, rule)) {
                stemAfterPastOrProg = stem + rule.replacement
            }
            break
        }
    }

    val w = stemAfterPastOrProg ?: return word
    for (i in s1b.cleanupAppendE.indices) {
        if (w.endsWith(s1b.cleanupAppendE[i])) {
            return "${w}e"
        }
    }

    if (endsWithDoubleConsonant(w)) {
        val lastChar = w.substring(w.length - 1)
        if (!s1b.doubleConsonantKeep.contains(lastChar)) {
            return w.substring(0, w.length - 1)
        }
        return w
    }

    if (s1b.appendEOnMeasure1AndStarO && measure(w) == 1 && endsWithStarO(w)) {
        return "${w}e"
    }

    return w
}

/**
 * Pure 1980 Porter stemmer strictly driven by `/packages/core-l0/porter_v1.json`.
 */
fun porterStem(input: String): String {
    val table = PORTER_V1
    var w = asciiLower(input)
    if (w.length <= 2) {
        return w
    }

    w = applyFirstSuffixStep(w, table.step1a)
    w = applyStep1b(w)
    w = applyFirstSuffixStep(w, table.step1c)
    w = applyFirstSuffixStep(w, table.step2)
    w = applyFirstSuffixStep(w, table.step3)
    w = applyFirstSuffixStep(w, table.step4)

    val step5a = table.step5a
    if (w.endsWith(step5a.suffix)) {
        val stem = w.substring(0, w.length - step5a.suffix.length)
        val m = measure(stem)
        if (m > step5a.removeIfMeasureGt ||
            (m == step5a.removeIfMeasureEqAndNotStarO && !endsWithStarO(stem))
        ) {
            w = stem
        }
    }

    val step5b = table.step5b
    if (w.endsWith(step5b.suffix) &&
        (!step5b.requiresDoubleConsonant || endsWithDoubleConsonant(w)) &&
        measure(w) >= step5b.minMeasure
    ) {
        w = w.substring(0, w.length - step5b.suffix.length)
    }

    return w
}
