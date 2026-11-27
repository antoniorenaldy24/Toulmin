package app.toulmin.core

enum class CanonicalSectionLabel(val wireName: String) {
    ABSTRACT("abstract"),
    INTRODUCTION("introduction"),
    METHODS("methods"),
    RESULTS("results"),
    DISCUSSION("discussion"),
    LIMITATIONS("limitations"),
    CONCLUSION("conclusion"),
    SUPPLEMENTARY("supplementary"),
    REFERENCES("references"),
    UNLABELED("unlabeled"),
    ;

    companion object {
        fun fromWireName(wire: String): CanonicalSectionLabel =
            entries.firstOrNull { it.wireName == wire }
                ?: error("Unknown CanonicalSectionLabel: $wire")
    }
}

enum class LatexSectionCommand(val level: Int) {
    part(1),
    chapter(2),
    section(3),
    subsection(4),
    subsubsection(5),
    paragraph(6),
}

val LATEX_SECTION_LEVELS: Map<LatexSectionCommand, Int> =
    LatexSectionCommand.entries.associateWith { it.level }

val LATEX_SECTION_LEVELS_BY_NAME: Map<String, Int> =
    LatexSectionCommand.entries.associate { it.name to it.level }

data class SectionState(
    val label: CanonicalSectionLabel,
    val subsection: String?,
)

data class HeadingInput(
    val level: Int,
    val heading: String,
)

data class SkippedFileRecord(
    val file: String,
    val reason: String,
)

data class MathRegionCounts(
    var inline: Int = 0,
    var display: Int = 0,
)

data class ImportQualityReport(
    var filesRead: Int = 0,
    var filesSkipped: Int = 0,
    val skippedFiles: MutableList<SkippedFileRecord> = mutableListOf(),
    val unresolvedInputs: MutableList<String> = mutableListOf(),
    val macrosNotExpanded: MutableList<String> = mutableListOf(),
    val unregisteredCommands: MutableList<String> = mutableListOf(),
    val unknownEnvironments: MutableList<String> = mutableListOf(),
    var tablesParsed: Int = 0,
    val mathRegions: MathRegionCounts = MathRegionCounts(),
    var footnotes: Int = 0,
    val parseTimeouts: MutableList<String> = mutableListOf(),
    val unresolvedKeys: MutableList<String> = mutableListOf(),
    val possibleCitations: MutableList<String> = mutableListOf(),
)

private data class PrefixRule(
    val label: CanonicalSectionLabel,
    val prefixes: List<String>,
)

private val CANONICAL_PREFIX_RULES: List<PrefixRule> = listOf(
    PrefixRule(
        CanonicalSectionLabel.INTRODUCTION,
        listOf(
            "introduction",
            "background",
            "related work",
            "literature review",
            "prior work",
            "motivation",
        ),
    ),
    PrefixRule(
        CanonicalSectionLabel.METHODS,
        listOf(
            "method",
            "materials and methods",
            "material and methods",
            "methodology",
            "experimental design",
            "experimental setup",
            "experimental procedures",
            "study design",
            "study population",
            "participants",
            "patients and methods",
            "data and methods",
            "data collection",
            "statistical analysis",
            "statistical methods",
            "measures",
            "procedure",
        ),
    ),
    PrefixRule(
        CanonicalSectionLabel.RESULTS,
        listOf("result", "findings"),
    ),
    PrefixRule(
        CanonicalSectionLabel.DISCUSSION,
        listOf("discussion", "general discussion"),
    ),
    PrefixRule(
        CanonicalSectionLabel.LIMITATIONS,
        listOf("limitation"),
    ),
    PrefixRule(
        CanonicalSectionLabel.CONCLUSION,
        listOf("conclusion", "concluding remarks"),
    ),
    PrefixRule(
        CanonicalSectionLabel.SUPPLEMENTARY,
        listOf("supplement", "appendix", "supporting information"),
    ),
    PrefixRule(
        CanonicalSectionLabel.REFERENCES,
        listOf(
            "references",
            "bibliography",
            "works cited",
            "literature cited",
            "reference list",
        ),
    ),
)

fun trimSpace(input: String): String {
    val n = input.length
    var start = 0
    while (start < n && isSpace(input[start].code)) {
        start++
    }
    var end = n
    while (end > start && isSpace(input[end - 1].code)) {
        end--
    }
    return input.substring(start, end)
}

private fun isLowerAsciiLetter(code: Int): Boolean = code in 97..122

private fun isRomanLowerChar(code: Int): Boolean =
    code == 105 || // i
        code == 118 || // v
        code == 120 || // x
        code == 108 || // l
        code == 99 || // c
        code == 100 || // d
        code == 109 // m

fun stripLeadingSectionNumbering(lowerTrimmed: String): String {
    val n = lowerTrimmed.length
    if (n == 0) return lowerTrimmed

    // 1. Decimal prefix
    if (isDigit(lowerTrimmed[0].code)) {
        var i = 0
        while (i < n && isDigit(lowerTrimmed[i].code)) {
            i++
        }
        while (i + 1 < n && lowerTrimmed[i].code == 46 && isDigit(lowerTrimmed[i + 1].code)) {
            i++
            while (i < n && isDigit(lowerTrimmed[i].code)) {
                i++
            }
        }
        if (i < n && (lowerTrimmed[i].code == 46 || lowerTrimmed[i].code == 41)) {
            i++
        }
        if (i < n && isSpace(lowerTrimmed[i].code)) {
            while (i < n && isSpace(lowerTrimmed[i].code)) {
                i++
            }
            if (i < n) {
                return lowerTrimmed.substring(i)
            }
        }
    }

    // 2. Single letter + '.' / ')' + space(s)
    if (n >= 4 &&
        isLowerAsciiLetter(lowerTrimmed[0].code) &&
        (lowerTrimmed[1].code == 46 || lowerTrimmed[1].code == 41) &&
        isSpace(lowerTrimmed[2].code)
    ) {
        var i = 2
        while (i < n && isSpace(lowerTrimmed[i].code)) {
            i++
        }
        if (i < n) {
            return lowerTrimmed.substring(i)
        }
    }

    // 3. Roman numeral + '.' / ')' + space(s)
    if (isRomanLowerChar(lowerTrimmed[0].code)) {
        var i = 0
        while (i < n && isRomanLowerChar(lowerTrimmed[i].code)) {
            i++
        }
        if (i < n && (lowerTrimmed[i].code == 46 || lowerTrimmed[i].code == 41)) {
            i++
            if (i < n && isSpace(lowerTrimmed[i].code)) {
                while (i < n && isSpace(lowerTrimmed[i].code)) {
                    i++
                }
                if (i < n) {
                    return lowerTrimmed.substring(i)
                }
            }
        }
    }

    return lowerTrimmed
}

fun matchCanonicalSectionLabel(rawHeading: String, isFirstHeading: Boolean): CanonicalSectionLabel? {
    val lowered = trimSpace(normLower(rawHeading))
    val candidate = trimSpace(stripLeadingSectionNumbering(lowered))
    if (candidate.isEmpty()) return null

    if (candidate == "abstract") return CanonicalSectionLabel.ABSTRACT
    if (isFirstHeading && candidate == "summary") return CanonicalSectionLabel.ABSTRACT

    for (rule in CANONICAL_PREFIX_RULES) {
        for (prefix in rule.prefixes) {
            if (candidate.startsWith(prefix)) {
                return rule.label
            }
        }
    }
    return null
}

private data class SectionFrame(
    val level: Int,
    val label: CanonicalSectionLabel,
    val subsection: String?,
)

class SectionTracker {
    private val stack = mutableListOf<SectionFrame>()
    private var hasSeenHeading = false
    private var savedBeforeAbstract: List<SectionFrame>? = null
    private var activeState = SectionState(CanonicalSectionLabel.UNLABELED, null)

    val current: SectionState
        get() = activeState

    fun enterAbstract(): SectionState {
        if (savedBeforeAbstract == null) {
            savedBeforeAbstract = stack.toList()
        }
        activeState = SectionState(CanonicalSectionLabel.ABSTRACT, null)
        return activeState
    }

    fun exitAbstract(): SectionState {
        val saved = savedBeforeAbstract
        if (saved != null) {
            stack.clear()
            stack.addAll(saved)
            savedBeforeAbstract = null
        }
        val top = stack.lastOrNull()
        activeState = if (top != null) {
            SectionState(top.label, top.subsection)
        } else {
            SectionState(CanonicalSectionLabel.UNLABELED, null)
        }
        return activeState
    }

    fun pushHeading(level: Int, rawHeading: String): SectionState {
        savedBeforeAbstract = null
        val isFirst = !hasSeenHeading
        hasSeenHeading = true

        while (stack.isNotEmpty() && stack.last().level >= level) {
            stack.removeAt(stack.size - 1)
        }

        val parent = stack.lastOrNull()
        val matched = matchCanonicalSectionLabel(rawHeading, isFirst)

        val nextState = if (matched != null) {
            SectionState(matched, null)
        } else {
            val normalizedRaw = trimSpace(norm(rawHeading).text)
            val inheritedLabel = parent?.label ?: CanonicalSectionLabel.UNLABELED
            SectionState(
                label = inheritedLabel,
                subsection = normalizedRaw.ifEmpty { null },
            )
        }

        stack.add(SectionFrame(level, nextState.label, nextState.subsection))
        activeState = nextState
        return nextState
    }

    fun pushLatexHeading(command: LatexSectionCommand, rawHeading: String): SectionState =
        pushHeading(command.level, rawHeading)
}

fun resolveHeadingSequence(headings: List<HeadingInput>): List<SectionState> {
    val tracker = SectionTracker()
    return headings.map { tracker.pushHeading(it.level, it.heading) }
}
