package app.toulmin.core

const val MASK_CHAR: Char = '\uE000'

const val YAML_FRONT_MATTER_MAX_LEN = 20_000
const val HTML_COMMENT_MAX_LEN = 100_000
const val FENCED_CODE_MAX_LEN = 200_000
const val INLINE_CODE_MAX_LEN = 400
const val DISPLAY_MATH_MAX_LEN = 20_000
const val INLINE_MATH_MAX_LEN = 400
const val NON_PROSE_ENV_MAX_LEN = 200_000
const val CAPTION_MAX_LEN = 5_000
const val FOOTNOTE_MAX_LEN = 5_000
const val SECTION_TITLE_MAX_LEN = 2_000
const val ARG_BRACKET_MAX_LEN = 200
const val ARG_BRACE_MAX_LEN = 2_000
const val ARG_MAX_BRACKETS = 2
const val ARG_MAX_BRACES = 3
const val MACRO_PARAM_MAX_LEN = 40
const val MACRO_BODY_MAX_LEN = 2_000
const val USER_MACRO_MAX_BODY_LEN = 200
const val USER_MACRO_MAX_COUNT = 200

val DISPLAY_MATH_ENVS: Set<String> = setOf(
    "equation", "align", "gather", "multline", "eqnarray", "math", "displaymath",
)

val NON_PROSE_ENVS: Set<String> = setOf(
    "figure", "table", "tabular", "tabularx", "longtable",
    "lstlisting", "verbatim", "minted", "algorithm", "tikzpicture",
    "comment", "thebibliography",
)

val RAW_NON_PROSE_ENVS: Set<String> = setOf(
    "lstlisting", "verbatim", "minted", "comment",
)

val TABLE_ENVS: Set<String> = setOf(
    "tabular", "tabularx", "longtable",
)

val KNOWN_PROSE_ENVS: Set<String> = setOf(
    "abstract", "document", "itemize", "enumerate", "description", "list", "trivlist",
    "quote", "quotation", "verse", "center", "flushleft", "flushright", "minipage",
    "parbox", "theorem", "lemma", "proposition", "corollary", "definition", "remark",
    "example", "proof", "cases", "acknowledgments", "acknowledgements", "appendix", "appendices",
)

val STRUCTURAL_COMMANDS: Set<String> = setOf(
    "documentclass", "usepackage", "label", "ref", "eqref", "autoref", "cref", "Cref",
    "pageref", "includegraphics", "bibliography", "bibliographystyle", "addbibresource",
    "DeclareMathOperator", "input", "include", "subfile", "vspace", "hspace", "maketitle",
    "tableofcontents", "nocite", "setlength", "graphicspath",
)

val SECTION_COMMANDS: Set<String> = setOf(
    "part", "chapter", "section", "subsection", "subsubsection", "paragraph",
)

val FOOTNOTE_COMMANDS: Set<String> = setOf(
    "footnote", "footnotetext",
)

val MACRO_DEF_COMMANDS: Set<String> = setOf(
    "newcommand", "renewcommand", "providecommand", "def", "let", "DeclareCiteCommand",
)

enum class SourceFormat(val wireName: String) {
    LATEX("latex"),
    MD("md"),
    ;

    companion object {
        fun fromWireName(wire: String): SourceFormat = when (wire) {
            "latex" -> LATEX
            "md" -> MD
            else -> error("Unknown SourceFormat: $wire")
        }
    }
}

data class MaskedSpan(
    val start: Int,
    val end: Int,
)

enum class MaskedRegionKind(val wireName: String) {
    YAML_FRONT_MATTER("yaml_front_matter"),
    LATEX_COMMENT("latex_comment"),
    HTML_COMMENT("html_comment"),
    DISPLAY_MATH("display_math"),
    INLINE_MATH("inline_math"),
    NON_PROSE_ENV("non_prose_env"),
    FOOTNOTE("footnote"),
    STRUCTURAL_COMMAND("structural_command"),
    MACRO_DEF("macro_def"),
    SECTION_HEADING("section_heading"),
    ABSTRACT_TAG("abstract_tag"),
    ENV_TAG("env_tag"),
    LIST_ITEM("list_item"),
    FENCED_CODE("fenced_code"),
    INLINE_CODE("inline_code"),
    MD_HEADING("md_heading"),
    MD_TABLE("md_table"),
}

data class MaskedRegion(
    val kind: MaskedRegionKind,
    override val start: Int,
    override val end: Int,
    val isBlockBoundary: Boolean,
) : TextRangeLike

data class MathRegionRecord(
    val kind: String, // "display" | "inline"
    override val start: Int,
    override val end: Int,
    val raw: String,
    val text: String,
) : TextRangeLike

data class ExtractedProseStream(
    val kind: String, // "caption" | "footnote"
    val start: Int,
    val end: Int,
    val rawText: String,
    val section: SectionState,
)

data class ExtractedTable(
    val sourceKind: String, // "latex_tabular" | "md_table"
    val envName: String? = null,
    val start: Int,
    val end: Int,
    val headers: List<String>,
    val rows: List<List<String>>,
    val section: SectionState,
)

data class ExtractedBibItem(
    val label: String?,
    val key: String,
    val text: String,
    val start: Int,
    val end: Int,
)

data class SectionTransition(
    val offset: Int,
    val bodyStart: Int,
    val state: SectionState,
)

data class FrontMatterMetadata(
    val bibliography: String? = null,
    val lang: String? = null,
    val math: Boolean? = null,
)

data class PreMaskOptions(
    val frontMatterMath: Boolean? = null,
    val report: ImportQualityReport? = null,
)

data class PreMaskResult(
    val format: SourceFormat,
    val maskedText: String,
    val regions: List<MaskedRegion>,
    val blockRegions: List<MaskedSpan>,
    val mathRegions: List<MathRegionRecord>,
    val proseStreams: List<ExtractedProseStream>,
    val tables: List<ExtractedTable>,
    val bibItems: List<ExtractedBibItem>,
    val sectionTransitions: List<SectionTransition>,
    val listItemStarts: List<Int>,
    val userMacros: Map<String, String>,
    val customCiteMacros: Set<String>,
    val frontMatter: FrontMatterMetadata,
    val report: ImportQualityReport,
)

fun isAsciiLetter(code: Int): Boolean = code in 65..90 || code in 97..122

private fun isHorizontalSpace(code: Int): Boolean = code == 32 || code == 9

private fun isLineBreakCode(code: Int): Boolean = code == 10 || code == 13

private fun stripTrailingStar(envName: String): String =
    if (envName.endsWith("*")) envName.substring(0, envName.length - 1) else envName

private fun recordDistinct(list: MutableList<String>, value: String) {
    if (!list.contains(value)) {
        list.add(value)
    }
}

private fun containsCiteAsciiCaseInsensitive(name: String): Boolean {
    val n = name.length
    for (i in 0 until n - 3) {
        val c0 = name[i].code
        val c1 = name[i + 1].code
        val c2 = name[i + 2].code
        val c3 = name[i + 3].code
        if ((c0 == 99 || c0 == 67) &&
            (c1 == 105 || c1 == 73) &&
            (c2 == 116 || c2 == 84) &&
            (c3 == 101 || c3 == 69)
        ) {
            return true
        }
    }
    return false
}

fun countPrecedingBackslashes(input: String, index: Int): Int {
    var count = 0
    var k = index - 1
    while (k >= 0 && input[k].code == 92) {
        count++
        k--
    }
    return count
}

private fun isOnOwnLine(input: String, start: Int, end: Int): Boolean {
    var left = start - 1
    while (left >= 0) {
        val code = input[left].code
        if (isLineBreakCode(code)) break
        if (!isHorizontalSpace(code)) return false
        left--
    }
    var right = end
    while (right < input.length) {
        val code = input[right].code
        if (isLineBreakCode(code)) break
        if (!isHorizontalSpace(code)) return false
        right++
    }
    return true
}

data class AdjacentWhitespaceResult(
    val pos: Int,
    val crossedBlankLine: Boolean,
)

fun skipAdjacentWhitespace(input: String, start: Int, end: Int): AdjacentWhitespaceResult {
    var cur = start
    var lineBreaks = 0
    while (cur < end) {
        val code = input[cur].code
        if (isHorizontalSpace(code)) {
            cur++
        } else if (code == 13) {
            if (lineBreaks >= 1) {
                return AdjacentWhitespaceResult(cur, true)
            }
            lineBreaks++
            cur += if (cur + 1 < end && input[cur + 1].code == 10) 2 else 1
        } else if (code == 10) {
            if (lineBreaks >= 1) {
                return AdjacentWhitespaceResult(cur, true)
            }
            lineBreaks++
            cur++
        } else {
            break
        }
    }
    return AdjacentWhitespaceResult(cur, false)
}

fun scanBracketGroup(
    input: String,
    braceClose: IntArray,
    openIdx: Int,
    endLimit: Int,
    maxLen: Int,
): Int {
    if (openIdx >= endLimit || input[openIdx].code != 91) {
        return -1
    }
    val stop = minOf(endLimit, openIdx + maxLen)
    var i = openIdx + 1
    while (i < stop) {
        val code = input[i].code
        if (code == 92) {
            i += 2
            continue
        }
        if (code == 123) {
            val close = braceClose[i]
            if (close != -1 && close < stop) {
                i = close + 1
                continue
            }
            return -1
        }
        if (code == 93) {
            return i
        }
        if (code == 91) {
            return -1
        }
        i++
    }
    return -1
}

data class ArgumentSequenceResult(
    val end: Int,
    val brackets: List<TextRange>,
    val braces: List<TextRange>,
)

fun scanArgumentSequence(
    input: String,
    braceClose: IntArray,
    startPos: Int,
    endLimit: Int = input.length,
): ArgumentSequenceResult {
    val brackets = mutableListOf<TextRange>()
    val braces = mutableListOf<TextRange>()
    var acceptedEnd = startPos

    while (brackets.size < ARG_MAX_BRACKETS || braces.size < ARG_MAX_BRACES) {
        val adj = skipAdjacentWhitespace(input, acceptedEnd, endLimit)
        if (adj.crossedBlankLine || adj.pos >= endLimit) break
        val ch = input[adj.pos].code
        if (ch == 91 && brackets.size < ARG_MAX_BRACKETS) {
            val close = scanBracketGroup(input, braceClose, adj.pos, endLimit, ARG_BRACKET_MAX_LEN)
            if (close == -1) break
            brackets.add(TextRange(adj.pos, close + 1))
            acceptedEnd = close + 1
            continue
        }
        if (ch == 123 && braces.size < ARG_MAX_BRACES) {
            val close = braceClose[adj.pos]
            if (close == -1 || close >= endLimit || close + 1 - adj.pos > ARG_BRACE_MAX_LEN) break
            braces.add(TextRange(adj.pos, close + 1))
            acceptedEnd = close + 1
            continue
        }
        break
    }

    return ArgumentSequenceResult(acceptedEnd, brackets, braces)
}

private data class LineEndInfo(
    val contentEnd: Int,
    val nextLineStart: Int,
)

private fun advanceLineEnd(input: String, start: Int, end: Int): LineEndInfo {
    var i = start
    while (i < end) {
        val code = input[i].code
        if (code == 13) {
            val next = if (i + 1 < end && input[i + 1].code == 10) i + 2 else i + 1
            return LineEndInfo(i, next)
        }
        if (code == 10) {
            return LineEndInfo(i, i + 1)
        }
        i++
    }
    return LineEndInfo(end, end)
}

private fun trimHorizontal(input: String): String {
    var s = 0
    while (s < input.length && isHorizontalSpace(input[s].code)) s++
    var e = input.length
    while (e > s && isHorizontalSpace(input[e - 1].code)) e--
    return input.substring(s, e)
}

private fun unquoteYamlValue(raw: String): String {
    var value = trimHorizontal(raw)
    var inSingle = false
    var inDouble = false
    for (k in value.indices) {
        val ch = value[k].code
        if (ch == 34 && !inSingle) {
            inDouble = !inDouble
        } else if (ch == 39 && !inDouble) {
            inSingle = !inSingle
        } else if (ch == 35 && !inSingle && !inDouble && (k == 0 || isHorizontalSpace(value[k - 1].code))) {
            value = trimHorizontal(value.substring(0, k))
            break
        }
    }
    if (value.length >= 2) {
        val first = value[0].code
        val last = value[value.length - 1].code
        if ((first == 34 && last == 34) || (first == 39 && last == 39)) {
            return value.substring(1, value.length - 1)
        }
    }
    return value
}

private class MissFrontier(var failedBefore: Int = 0)

private data class YamlParseResult(
    val end: Int,
    val metadata: FrontMatterMetadata,
)

private fun parseYamlFrontMatter(source: String, missFence: MissFrontier): YamlParseResult? {
    if (!source.startsWith("---")) return null
    val firstLine = advanceLineEnd(source, 0, source.length)
    if (trimHorizontal(source.substring(0, firstLine.contentEnd)) != "---") return null
    val limit = minOf(source.length, YAML_FRONT_MATTER_MAX_LEN)
    if (missFence.failedBefore >= limit) return null

    var cursor = firstLine.nextLineStart
    while (cursor < limit) {
        val line = advanceLineEnd(source, cursor, source.length)
        val trimmed = trimHorizontal(source.substring(cursor, line.contentEnd))
        if (trimmed == "---" || trimmed == "...") {
            if (line.contentEnd > YAML_FRONT_MATTER_MAX_LEN) return null
            var pos = firstLine.nextLineStart
            var bibliography: String? = null
            var lang: String? = null
            var math: Boolean? = null

            while (pos < cursor) {
                val entryLine = advanceLineEnd(source, pos, cursor)
                val text = trimHorizontal(source.substring(pos, entryLine.contentEnd))
                pos = entryLine.nextLineStart
                if (text.isEmpty() || text.startsWith("#")) continue
                val colon = text.indexOf(':')
                if (colon <= 0) continue
                val key = trimHorizontal(text.substring(0, colon))
                val valStr = unquoteYamlValue(text.substring(colon + 1))
                when (key) {
                    "bibliography" -> if (valStr.isNotEmpty()) bibliography = valStr
                    "lang" -> if (valStr.isNotEmpty()) lang = valStr
                    "math" -> when (asciiLower(valStr)) {
                        "true" -> math = true
                        "false" -> math = false
                    }
                }
            }
            return YamlParseResult(
                line.contentEnd,
                FrontMatterMetadata(bibliography = bibliography, lang = lang, math = math),
            )
        }
        if (line.nextLineStart >= limit && trimmed != "---" && trimmed != "...") break
        cursor = line.nextLineStart
    }
    missFence.failedBefore = limit
    return null
}

private fun findUnescapedDelimiterForward(
    source: String,
    delim: String,
    searchStart: Int,
    maxEnd: Int,
    missFrontier: MissFrontier,
): Int {
    val actualStart = maxOf(searchStart, missFrontier.failedBefore)
    var pos = actualStart
    while (pos + delim.length <= maxEnd) {
        val found = source.indexOf(delim, pos)
        if (found == -1) {
            missFrontier.failedBefore = source.length
            return -1
        }
        if (found + delim.length > maxEnd) {
            if (found > missFrontier.failedBefore) {
                missFrontier.failedBefore = found
            }
            return -1
        }
        if (countPrecedingBackslashes(source, found) % 2 == 0) {
            return found
        }
        pos = if (delim == "$$") found + 1 else found + delim.length
    }
    if (pos > missFrontier.failedBefore) {
        missFrontier.failedBefore = pos
    }
    return -1
}

private fun findVerbatimDelimiterForward(
    source: String,
    delim: String,
    searchStart: Int,
    maxEnd: Int,
    missFrontier: MissFrontier,
): Int {
    val actualStart = maxOf(searchStart, missFrontier.failedBefore)
    if (actualStart + delim.length > maxEnd) return -1
    val found = source.indexOf(delim, actualStart)
    if (found == -1) {
        missFrontier.failedBefore = source.length
        return -1
    }
    if (found + delim.length > maxEnd) {
        if (found > missFrontier.failedBefore) {
            missFrontier.failedBefore = found
        }
        return -1
    }
    return found
}

private fun computeNestableEnvMatchMap(source: String, envName: String): Map<Int, Int> {
    val beginTag = "\\begin{$envName}"
    val endTag = "\\end{$envName}"
    if (source.indexOf(endTag) == -1) return emptyMap()

    val result = HashMap<Int, Int>()
    val stack = IntBuf(16)
    val n = source.length
    var cursor = 0
    var scanPos = 0
    var inComment = false

    while (cursor < n) {
        val nextBegin = source.indexOf(beginTag, cursor)
        val nextEnd = source.indexOf(endTag, cursor)
        val pos: Int
        val isBegin: Boolean
        if (nextBegin != -1 && (nextEnd == -1 || nextBegin < nextEnd)) {
            pos = nextBegin
            isBegin = true
        } else if (nextEnd != -1) {
            pos = nextEnd
            isBegin = false
        } else {
            break
        }

        while (scanPos < pos) {
            if (inComment) {
                val nl = source.indexOf('\n', scanPos)
                val cr = source.indexOf('\r', scanPos)
                val brk = when {
                    nl != -1 && (cr == -1 || nl < cr) -> nl
                    cr != -1 -> cr
                    else -> -1
                }
                if (brk == -1 || brk >= pos) {
                    scanPos = pos
                    break
                }
                inComment = false
                scanPos = brk + 1
                continue
            }
            val ch = source[scanPos].code
            when {
                ch == 10 || ch == 13 -> {
                    inComment = false
                    scanPos++
                }
                ch == 92 -> {
                    if (scanPos + 1 < pos) scanPos += 2 else break
                }
                ch == 37 -> {
                    inComment = true
                    scanPos++
                }
                else -> scanPos++
            }
        }

        val escaped = scanPos == pos - 1 && source[scanPos].code == 92
        if (!inComment && !escaped) {
            if (isBegin) {
                stack.add(pos)
            } else if (stack.size > 0) {
                result[stack.popLast()] = pos + endTag.length
            }
        }
        cursor = pos + if (isBegin) beginTag.length else endTag.length
    }
    return result
}

private fun stripLatexCommentsInSlice(slice: String): String {
    val sb = StringBuilder(slice.length)
    var i = 0
    var chunkStart = 0
    val n = slice.length
    while (i < n) {
        val ch = slice[i].code
        if (ch == 92) {
            i += 2
            continue
        }
        if (ch == 37) {
            sb.append(slice, chunkStart, i)
            while (i < n && !isLineBreakCode(slice[i].code)) {
                i++
            }
            chunkStart = i
            continue
        }
        i++
    }
    if (chunkStart < n) {
        sb.append(slice, chunkStart, n)
    }
    return sb.toString()
}

private val BOOKTABS_RULE_NAMES: Set<String> = setOf(
    "hline", "toprule", "midrule", "bottomrule", "cline", "cmidrule", "addlinespace",
)

private fun cleanBooktabsAndRules(cellOrRow: String): String {
    val braceClose = buildBraceCloseMap(cellOrRow)
    val sb = StringBuilder(cellOrRow.length)
    var i = 0
    val n = cellOrRow.length

    while (i < n) {
        if (cellOrRow[i].code == 92) {
            var nameEnd = i + 1
            while (nameEnd < n && isAsciiLetter(cellOrRow[nameEnd].code)) {
                nameEnd++
            }
            val cmd = cellOrRow.substring(i + 1, nameEnd)
            if (cmd in BOOKTABS_RULE_NAMES) {
                var cur = nameEnd
                if (cmd == "cmidrule" || cmd == "addlinespace") {
                    while (cur < n && isHorizontalSpace(cellOrRow[cur].code)) cur++
                    if (cur < n && cellOrRow[cur].code == 40) {
                        val closeParen = cellOrRow.indexOf(')', cur + 1)
                        if (closeParen != -1 && closeParen - cur < 20) {
                            cur = closeParen + 1
                        }
                    }
                    if (cur < n && cellOrRow[cur].code == 91) {
                        val closeBrk = scanBracketGroup(cellOrRow, braceClose, cur, n, 100)
                        if (closeBrk != -1) cur = closeBrk + 1
                    }
                }
                if (cmd == "cline" || cmd == "cmidrule") {
                    while (cur < n && isHorizontalSpace(cellOrRow[cur].code)) cur++
                    if (cur < n && cellOrRow[cur].code == 123) {
                        val closeBr = braceClose[cur]
                        if (closeBr != -1) cur = closeBr + 1
                    }
                }
                i = cur
                continue
            }
            val endSlice = minOf(n, if (nameEnd > i + 1) nameEnd else i + 2)
            sb.append(cellOrRow, i, endSlice)
            i = endSlice
            continue
        }
        sb.append(cellOrRow[i])
        i++
    }
    return sb.toString()
}

private fun splitTopLevelLatexRows(body: String): List<String> {
    val cleaned = stripLatexCommentsInSlice(body)
    val rows = mutableListOf<String>()
    var rowStart = 0
    var braceDepth = 0
    var i = 0
    val n = cleaned.length

    while (i < n) {
        val ch = cleaned[i].code
        if (ch == 92) {
            if (braceDepth == 0 && i + 1 < n && cleaned[i + 1].code == 92) {
                rows.add(cleaned.substring(rowStart, i))
                var next = i + 2
                if (next < n && cleaned[next].code == 42) next++
                while (next < n && isHorizontalSpace(cleaned[next].code)) next++
                if (next < n && cleaned[next].code == 91) {
                    val close = cleaned.indexOf(']', next + 1)
                    if (close != -1 && close - next <= 40) {
                        next = close + 1
                    }
                }
                rowStart = next
                i = next
                continue
            }
            i += 2
            continue
        }
        if (ch == 123) {
            braceDepth++
        } else if (ch == 125 && braceDepth > 0) {
            braceDepth--
        }
        i++
    }
    if (rowStart < n) {
        rows.add(cleaned.substring(rowStart, n))
    }
    return rows
}

private fun splitTopLevelLatexCells(row: String): List<String> {
    val cells = mutableListOf<String>()
    var cellStart = 0
    var braceDepth = 0
    var i = 0
    val n = row.length

    while (i < n) {
        val ch = row[i].code
        if (ch == 92) {
            i += 2
            continue
        }
        if (ch == 123) {
            braceDepth++
        } else if (ch == 125 && braceDepth > 0) {
            braceDepth--
        } else if (ch == 38 && braceDepth == 0) {
            cells.add(row.substring(cellStart, i))
            cellStart = i + 1
        }
        i++
    }
    cells.add(row.substring(cellStart, n))
    return cells
}

private fun expandMulticolumnCell(rawCell: String): List<String> {
    val trimmed = collapseAndTrimAsciiSpace(cleanBooktabsAndRules(rawCell))
    if (!trimmed.startsWith("\\multicolumn")) return listOf(trimmed)
    val afterCmd = "\\multicolumn".length
    if (afterCmd < trimmed.length && isAsciiLetter(trimmed[afterCmd].code)) {
        return listOf(trimmed)
    }
    val braceClose = buildBraceCloseMap(trimmed)
    val seq = scanArgumentSequence(trimmed, braceClose, afterCmd, trimmed.length)
    if (seq.braces.size < 3 || seq.brackets.isNotEmpty()) return listOf(trimmed)
    val b0 = seq.braces[0]
    val b2 = seq.braces[2]
    val kStr = collapseAndTrimAsciiSpace(trimmed.substring(b0.start + 1, b0.end - 1))
    var count = 1
    if (kStr.length in 1..2 && kStr.all { isDigit(it.code) }) {
        count = kStr.toInt().coerceIn(1, 64)
    }
    val cellText = collapseAndTrimAsciiSpace(trimmed.substring(b2.start + 1, b2.end - 1))
    return List(count) { cellText }
}

private fun parseLatexTabularSlice(
    source: String,
    envName: String,
    envStart: Int,
    tagEnd: Int,
    bodyEnd: Int,
    endTagLen: Int,
    braceClose: IntArray,
    section: SectionState,
): ExtractedTable {
    val baseEnv = stripTrailingStar(envName)
    var contentStart = tagEnd
    val bracesToSkip = if (envName == "tabular*" || baseEnv == "tabularx") 2 else 1
    for (b in 0 until bracesToSkip) {
        var adj = skipAdjacentWhitespace(source, contentStart, bodyEnd)
        if (!adj.crossedBlankLine && adj.pos < bodyEnd && source[adj.pos].code == 91) {
            val closeBrk = scanBracketGroup(source, braceClose, adj.pos, bodyEnd, ARG_BRACKET_MAX_LEN)
            if (closeBrk != -1) {
                contentStart = closeBrk + 1
                adj = skipAdjacentWhitespace(source, contentStart, bodyEnd)
            }
        }
        if (!adj.crossedBlankLine && adj.pos < bodyEnd && source[adj.pos].code == 123) {
            val close = braceClose[adj.pos]
            if (close != -1 && close < bodyEnd) {
                contentStart = close + 1
            }
        }
    }

    val rawRows = splitTopLevelLatexRows(source.substring(contentStart, bodyEnd))
    val parsedRows = mutableListOf<List<String>>()
    for (rawRow in rawRows) {
        val cells = splitTopLevelLatexCells(rawRow)
        val expandedRow = mutableListOf<String>()
        for (cell in cells) {
            expandedRow.addAll(expandMulticolumnCell(cell))
        }
        if (expandedRow.any { it.isNotEmpty() }) {
            parsedRows.add(expandedRow)
        }
    }

    val headers = parsedRows.firstOrNull() ?: emptyList()
    val dataRows = if (parsedRows.size > 1) parsedRows.subList(1, parsedRows.size) else emptyList()
    return ExtractedTable(
        sourceKind = "latex_tabular",
        envName = envName,
        start = envStart,
        end = bodyEnd + endTagLen,
        headers = headers,
        rows = dataRows,
        section = section,
    )
}

private fun extractCaptionsFromLatexSlice(
    source: String,
    start: Int,
    end: Int,
    braceClose: IntArray,
    section: SectionState,
    streams: MutableList<ExtractedProseStream>,
) {
    var i = start
    while (i < end) {
        val code = source[i].code
        if (code == 37 && countPrecedingBackslashes(source, i) % 2 == 0) {
            while (i < end && !isLineBreakCode(source[i].code)) i++
            continue
        }
        if (code == 92) {
            if (source.startsWith("\\caption", i)) {
                var after = i + "\\caption".length
                if (after >= end || !isAsciiLetter(source[after].code)) {
                    if (after < end && source[after].code == 42) after++
                    val adj1 = skipAdjacentWhitespace(source, after, end)
                    var cur = adj1.pos
                    if (!adj1.crossedBlankLine && cur < end && source[cur].code == 91) {
                        val brkClose = scanBracketGroup(source, braceClose, cur, end, ARG_BRACKET_MAX_LEN)
                        if (brkClose != -1) {
                            val adj2 = skipAdjacentWhitespace(source, brkClose + 1, end)
                            if (!adj2.crossedBlankLine) cur = adj2.pos
                        }
                    }
                    if (cur < end && source[cur].code == 123) {
                        val close = braceClose[cur]
                        if (close != -1 && close < end && close + 1 - cur <= CAPTION_MAX_LEN) {
                            streams.add(
                                ExtractedProseStream(
                                    kind = "caption",
                                    start = i,
                                    end = close + 1,
                                    rawText = source.substring(cur + 1, close),
                                    section = section,
                                ),
                            )
                            i = close + 1
                            continue
                        }
                    }
                }
            }
            i += 2
            continue
        }
        i++
    }
}

private fun extractNestedTablesFromNonProseEnv(
    source: String,
    sliceStart: Int,
    sliceEnd: Int,
    braceClose: IntArray,
    section: SectionState,
    envMatchCache: MutableMap<String, Map<Int, Int>>,
    tables: MutableList<ExtractedTable>,
    report: ImportQualityReport,
) {
    var i = sliceStart
    while (i < sliceEnd) {
        val code = source[i].code
        if (code == 37 && countPrecedingBackslashes(source, i) % 2 == 0) {
            while (i < sliceEnd && !isLineBreakCode(source[i].code)) i++
            continue
        }
        if (code == 92) {
            if (source.startsWith("\\begin{", i) && countPrecedingBackslashes(source, i) % 2 == 0) {
                val closeBrace = source.indexOf('}', i + 7)
                if (closeBrace != -1 && closeBrace < sliceEnd && closeBrace - (i + 7) <= 64) {
                    val envName = source.substring(i + 7, closeBrace)
                    val base = stripTrailingStar(envName)
                    if (base in TABLE_ENVS) {
                        val map = envMatchCache.getOrPut(envName) {
                            computeNestableEnvMatchMap(source, envName)
                        }
                        val endPos = map[i]
                        if (endPos != null && endPos <= sliceEnd && endPos - i <= NON_PROSE_ENV_MAX_LEN) {
                            val endTagLen = "\\end{$envName}".length
                            tables.add(
                                parseLatexTabularSlice(
                                    source = source,
                                    envName = envName,
                                    envStart = i,
                                    tagEnd = closeBrace + 1,
                                    bodyEnd = endPos - endTagLen,
                                    endTagLen = endTagLen,
                                    braceClose = braceClose,
                                    section = section,
                                ),
                            )
                            report.tablesParsed++
                            i = endPos
                            continue
                        }
                    }
                }
            }
            i += 2
            continue
        }
        i++
    }
}

private data class BibHit(
    val itemStart: Int,
    val label: String?,
    val key: String,
    val textStart: Int,
)

private fun extractBibItemsFromLatexEnv(
    source: String,
    tagEnd: Int,
    bodyEnd: Int,
    braceClose: IntArray,
    bibItems: MutableList<ExtractedBibItem>,
) {
    var pos = tagEnd
    val adj = skipAdjacentWhitespace(source, pos, bodyEnd)
    if (adj.pos < bodyEnd && source[adj.pos].code == 123) {
        val close = braceClose[adj.pos]
        if (close != -1 && close < bodyEnd) {
            pos = close + 1
        }
    }

    val hits = mutableListOf<BibHit>()
    var i = pos
    while (i < bodyEnd) {
        val ch = source[i].code
        if (ch == 37 && countPrecedingBackslashes(source, i) % 2 == 0) {
            while (i < bodyEnd && !isLineBreakCode(source[i].code)) i++
            continue
        }
        if (ch == 92 && source.startsWith("\\bibitem", i)) {
            val afterCmd = i + "\\bibitem".length
            if (afterCmd < bodyEnd && !isAsciiLetter(source[afterCmd].code)) {
                var cur = skipAdjacentWhitespace(source, afterCmd, bodyEnd).pos
                var label: String? = null
                if (cur < bodyEnd && source[cur].code == 91) {
                    val closeBrk = scanBracketGroup(source, braceClose, cur, bodyEnd, ARG_BRACKET_MAX_LEN)
                    if (closeBrk != -1) {
                        label = collapseAndTrimAsciiSpace(source.substring(cur + 1, closeBrk))
                        cur = skipAdjacentWhitespace(source, closeBrk + 1, bodyEnd).pos
                    }
                }
                if (cur < bodyEnd && source[cur].code == 123) {
                    val closeKey = braceClose[cur]
                    if (closeKey != -1 && closeKey < bodyEnd) {
                        val key = trimHorizontal(source.substring(cur + 1, closeKey))
                        hits.add(BibHit(i, label, key, closeKey + 1))
                        i = closeKey + 1
                        continue
                    }
                }
            }
            i += 2
            continue
        }
        if (ch == 92) {
            i += 2
            continue
        }
        i++
    }

    for (h in hits.indices) {
        val item = hits[h]
        val nextItem = hits.getOrNull(h + 1)
        val itemEnd = nextItem?.itemStart ?: bodyEnd
        val cleaned = collapseAndTrimAsciiSpace(
            stripLatexCommentsInSlice(source.substring(item.textStart, itemEnd)),
        )
        bibItems.add(
            ExtractedBibItem(
                label = item.label,
                key = item.key,
                text = cleaned,
                start = item.itemStart,
                end = itemEnd,
            ),
        )
    }
}

private data class MacroParseResult(
    val end: Int,
    val name: String,
    val body: String?,
    val expandable: Boolean,
    val isCiteEligible: Boolean,
)

private fun tryParseNewcommandMacro(
    source: String,
    cmdEnd: Int,
    braceClose: IntArray,
): MacroParseResult? {
    val n = source.length
    var cur = cmdEnd
    if (cur < n && source[cur].code == 42) cur++
    cur = skipAdjacentWhitespace(source, cur, n).pos
    if (cur >= n) return null

    val macroName: String
    if (source[cur].code == 123) {
        val close = braceClose[cur]
        if (close == -1) return null
        val inner = trimHorizontal(source.substring(cur + 1, close))
        if (inner.length < 2 || inner[0].code != 92) return null
        for (j in 1 until inner.length) {
            if (!isAsciiLetter(inner[j].code)) return null
        }
        macroName = inner.substring(1)
        cur = close + 1
    } else if (source[cur].code == 92) {
        var nameEnd = cur + 1
        while (nameEnd < n && isAsciiLetter(source[nameEnd].code)) nameEnd++
        if (nameEnd == cur + 1) return null
        macroName = source.substring(cur + 1, nameEnd)
        cur = nameEnd
    } else {
        return null
    }

    var paramCount = 0
    var adj = skipAdjacentWhitespace(source, cur, n)
    cur = adj.pos
    if (!adj.crossedBlankLine && cur < n && source[cur].code == 91) {
        val closeArgCount = scanBracketGroup(source, braceClose, cur, n, 10)
        if (closeArgCount == -1) return null
        val digitText = trimHorizontal(source.substring(cur + 1, closeArgCount))
        if (digitText.length != 1 || digitText[0].code !in 48..57) return null
        paramCount = digitText[0].code - 48
        cur = closeArgCount + 1

        adj = skipAdjacentWhitespace(source, cur, n)
        cur = adj.pos
        if (paramCount >= 1 && !adj.crossedBlankLine && cur < n && source[cur].code == 91) {
            val closeDef = scanBracketGroup(source, braceClose, cur, n, ARG_BRACKET_MAX_LEN)
            if (closeDef == -1) return null
            cur = closeDef + 1
            adj = skipAdjacentWhitespace(source, cur, n)
            cur = adj.pos
        }
    }

    if (adj.crossedBlankLine || cur >= n || source[cur].code != 123) return null
    val bodyClose = braceClose[cur]
    if (bodyClose == -1 || bodyClose + 1 - cur > MACRO_BODY_MAX_LEN) return null
    val body = source.substring(cur + 1, bodyClose)
    val expandable = paramCount == 0 && body.length <= USER_MACRO_MAX_BODY_LEN && !body.contains('#')

    return MacroParseResult(
        end = bodyClose + 1,
        name = macroName,
        body = body,
        expandable = expandable,
        isCiteEligible = containsCiteAsciiCaseInsensitive(macroName),
    )
}

private fun tryParseDefMacro(
    source: String,
    cmdEnd: Int,
    braceClose: IntArray,
): MacroParseResult? {
    val n = source.length
    val cur0 = skipAdjacentWhitespace(source, cmdEnd, n).pos
    if (cur0 >= n || source[cur0].code != 92) return null
    var nameEnd = cur0 + 1
    while (nameEnd < n && isAsciiLetter(source[nameEnd].code)) nameEnd++
    if (nameEnd == cur0 + 1) return null
    val macroName = source.substring(cur0 + 1, nameEnd)

    val stop = minOf(n, nameEnd + MACRO_PARAM_MAX_LEN)
    var braceOpen = -1
    var k = nameEnd
    while (k < stop) {
        val ch = source[k].code
        if (ch == 123) {
            braceOpen = k
            break
        }
        if (ch == 125 || isLineBreakCode(ch)) return null
        k++
    }
    if (braceOpen == -1) return null
    val paramText = trimHorizontal(source.substring(nameEnd, braceOpen))
    val bodyClose = braceClose[braceOpen]
    if (bodyClose == -1 || bodyClose + 1 - braceOpen > MACRO_BODY_MAX_LEN) return null
    val body = source.substring(braceOpen + 1, bodyClose)
    val expandable = paramText.isEmpty() && body.length <= USER_MACRO_MAX_BODY_LEN && !body.contains('#')

    return MacroParseResult(
        end = bodyClose + 1,
        name = macroName,
        body = body,
        expandable = expandable,
        isCiteEligible = containsCiteAsciiCaseInsensitive(macroName),
    )
}

private data class LetMacroResult(
    val end: Int,
    val name: String,
    val targetName: String?,
)

private fun tryParseLetMacro(source: String, cmdEnd: Int): LetMacroResult? {
    val n = source.length
    var cur = cmdEnd
    while (cur < n && isHorizontalSpace(source[cur].code)) cur++
    if (cur >= n || source[cur].code != 92) return null
    var nameEnd = cur + 1
    while (nameEnd < n && isAsciiLetter(source[nameEnd].code)) nameEnd++
    if (nameEnd == cur + 1) return null
    val name = source.substring(cur + 1, nameEnd)
    cur = nameEnd
    while (cur < n && isHorizontalSpace(source[cur].code)) cur++
    if (cur < n && source[cur].code == 61) {
        cur++
        while (cur < n && isHorizontalSpace(source[cur].code)) cur++
    }
    if (cur >= n) return null
    if (source[cur].code == 92) {
        var tEnd = cur + 1
        while (tEnd < n && isAsciiLetter(source[tEnd].code)) tEnd++
        if (tEnd == cur + 1) {
            return if (tEnd < n) LetMacroResult(tEnd + 1, name, null) else null
        }
        return LetMacroResult(tEnd, name, source.substring(cur + 1, tEnd))
    }
    return LetMacroResult(cur + 1, name, null)
}

private data class DeclareCiteResult(val end: Int, val name: String)

private fun tryParseDeclareCiteCommand(
    source: String,
    cmdEnd: Int,
    braceClose: IntArray,
): DeclareCiteResult? {
    val n = source.length
    var cur = cmdEnd
    if (cur < n && source[cur].code == 42) cur++
    cur = skipAdjacentWhitespace(source, cur, n).pos
    if (cur >= n) return null
    val macroName: String
    if (source[cur].code == 123) {
        val close = braceClose[cur]
        if (close == -1) return null
        val inner = trimHorizontal(source.substring(cur + 1, close))
        if (inner.length < 2 || inner[0].code != 92) return null
        for (j in 1 until inner.length) {
            if (!isAsciiLetter(inner[j].code)) return null
        }
        macroName = inner.substring(1)
        cur = close + 1
    } else if (source[cur].code == 92) {
        var nameEnd = cur + 1
        while (nameEnd < n && isAsciiLetter(source[nameEnd].code)) nameEnd++
        if (nameEnd == cur + 1) return null
        macroName = source.substring(cur + 1, nameEnd)
        cur = nameEnd
    } else {
        return null
    }

    var endPos = cur
    for (round in 0 until 6) {
        val adj = skipAdjacentWhitespace(source, endPos, n)
        if (adj.crossedBlankLine || adj.pos >= n) break
        val ch = source[adj.pos].code
        if (ch == 91) {
            val brk = scanBracketGroup(source, braceClose, adj.pos, n, ARG_BRACKET_MAX_LEN)
            if (brk == -1) break
            endPos = brk + 1
        } else if (ch == 123) {
            val close = braceClose[adj.pos]
            if (close == -1 || close + 1 - adj.pos > MACRO_BODY_MAX_LEN) break
            endPos = close + 1
        } else {
            break
        }
    }
    return DeclareCiteResult(endPos, macroName)
}

private data class MdTableParseResult(
    val end: Int,
    val table: ExtractedTable,
)

private fun parseMdTableBlock(
    source: String,
    startPos: Int,
    section: SectionState,
): MdTableParseResult? {
    val n = source.length
    var pos = startPos
    val rawLines = mutableListOf<String>()
    var blockEnd = startPos

    while (pos < n) {
        val line = advanceLineEnd(source, pos, n)
        val trimmed = trimHorizontal(source.substring(pos, line.contentEnd))
        if (trimmed.length >= 2 && trimmed.startsWith("|") && trimmed.endsWith("|")) {
            rawLines.add(trimmed)
            blockEnd = line.contentEnd
            pos = line.nextLineStart
        } else {
            break
        }
    }
    if (rawLines.size < 2) return null

    fun isSeparatorLine(line: String): Boolean {
        var sawDash = false
        for (k in line.indices) {
            val ch = line[k].code
            if (ch == 45) {
                sawDash = true
            } else if (ch != 124 && ch != 58 && !isHorizontalSpace(ch)) {
                return false
            }
        }
        return sawDash
    }

    fun splitPipeCells(line: String): List<String> {
        val cells = mutableListOf<String>()
        var cellStart = 1
        val end = line.length - 1
        var k = 1
        while (k < end) {
            val ch = line[k].code
            if (ch == 92) {
                k += 2
                continue
            }
            if (ch == 124) {
                cells.add(collapseAndTrimAsciiSpace(line.substring(cellStart, k)))
                cellStart = k + 1
            }
            k++
        }
        cells.add(collapseAndTrimAsciiSpace(line.substring(cellStart, end)))
        return cells
    }

    val parsedRows = mutableListOf<List<String>>()
    for (line in rawLines) {
        if (!isSeparatorLine(line)) {
            parsedRows.add(splitPipeCells(line))
        }
    }
    if (parsedRows.isEmpty()) return null

    val headers = parsedRows[0]
    val dataRows = if (parsedRows.size > 1) parsedRows.subList(1, parsedRows.size) else emptyList()
    return MdTableParseResult(
        end = blockEnd,
        table = ExtractedTable(
            sourceKind = "md_table",
            start = startPos,
            end = blockEnd,
            headers = headers,
            rows = dataRows,
            section = section,
        ),
    )
}

private data class FenceCloseEntry(
    val lineStart: Int,
    val contentEnd: Int,
    val runLen: Int,
)

private class FenceCloseTree(
    val entries: List<FenceCloseEntry>,
    val maxTree: IntArray,
)

private class MdFenceCloseIndex(
    val backtick: FenceCloseTree,
    val tilde: FenceCloseTree,
)

private fun buildFenceCloseTree(entries: List<FenceCloseEntry>): FenceCloseTree {
    if (entries.isEmpty()) return FenceCloseTree(entries, IntArray(0))
    val tree = IntArray(entries.size * 4)
    fun build(node: Int, l: Int, r: Int) {
        if (l == r) {
            tree[node] = entries[l].runLen
            return
        }
        val mid = (l + r) shr 1
        build(node * 2, l, mid)
        build(node * 2 + 1, mid + 1, r)
        val leftVal = tree[node * 2]
        val rightVal = tree[node * 2 + 1]
        tree[node] = if (leftVal >= rightVal) leftVal else rightVal
    }
    build(1, 0, entries.size - 1)
    return FenceCloseTree(entries, tree)
}

private fun buildMdFenceIndex(source: String): MdFenceCloseIndex {
    val backticks = mutableListOf<FenceCloseEntry>()
    val tildes = mutableListOf<FenceCloseEntry>()
    val n = source.length
    var cursor = 0

    while (cursor < n) {
        val line = advanceLineEnd(source, cursor, n)
        var sp = 0
        while (sp < 3 && cursor + sp < line.contentEnd && source[cursor + sp].code == 32) {
            sp++
        }
        val start = cursor + sp
        if (start < line.contentEnd) {
            val ch = source[start].code
            if (ch == 96 || ch == 126) {
                var runLen = 0
                while (start + runLen < line.contentEnd && source[start + runLen].code == ch) {
                    runLen++
                }
                if (runLen >= 3) {
                    var onlySpaceAfter = true
                    for (k in (start + runLen) until line.contentEnd) {
                        if (!isHorizontalSpace(source[k].code)) {
                            onlySpaceAfter = false
                            break
                        }
                    }
                    if (onlySpaceAfter) {
                        val entry = FenceCloseEntry(cursor, line.contentEnd, runLen)
                        if (ch == 96) backticks.add(entry) else tildes.add(entry)
                    }
                }
            }
        }
        cursor = line.nextLineStart
    }
    return MdFenceCloseIndex(buildFenceCloseTree(backticks), buildFenceCloseTree(tildes))
}

private fun findFirstFenceCloseIndex(
    tree: FenceCloseTree,
    minLineStart: Int,
    minLen: Int,
): Int {
    val entries = tree.entries
    val m = entries.size
    if (m == 0) return -1
    var lo = 0
    var hi = m
    while (lo < hi) {
        val mid = (lo + hi) shr 1
        if (entries[mid].lineStart < minLineStart) {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    if (lo >= m) return -1

    val maxTree = tree.maxTree
    fun search(node: Int, l: Int, r: Int): Int {
        if (r < lo || maxTree[node] < minLen) return -1
        if (l == r) return l
        val mid = (l + r) shr 1
        val leftHit = search(node * 2, l, mid)
        if (leftHit != -1) return leftHit
        return search(node * 2 + 1, mid + 1, r)
    }
    return search(1, 0, m - 1)
}

private fun tryMatchMdFence(
    source: String,
    lineStart: Int,
    getFenceIndex: () -> MdFenceCloseIndex,
): Int {
    val n = source.length
    var spaces = 0
    while (spaces < 3 && lineStart + spaces < n && source[lineStart + spaces].code == 32) {
        spaces++
    }
    val fenceStart = lineStart + spaces
    if (fenceStart + 2 >= n) return -1
    val fenceChar = source[fenceStart].code
    if (fenceChar != 96 && fenceChar != 126) return -1
    var fenceLen = 0
    while (fenceStart + fenceLen < n && source[fenceStart + fenceLen].code == fenceChar) {
        fenceLen++
    }
    if (fenceLen < 3) return -1
    val openLine = advanceLineEnd(source, fenceStart + fenceLen, n)
    if (fenceChar == 96) {
        for (k in (fenceStart + fenceLen) until openLine.contentEnd) {
            if (source[k].code == 96) return -1
        }
    }

    val index = getFenceIndex()
    val tree = if (fenceChar == 96) index.backtick else index.tilde
    val hitIdx = findFirstFenceCloseIndex(tree, openLine.nextLineStart, fenceLen)
    if (hitIdx == -1) return -1
    val hitEntry = tree.entries[hitIdx]
    return if (hitEntry.contentEnd - lineStart <= FENCED_CODE_MAX_LEN) hitEntry.contentEnd else -1
}

private fun buildLatexBraceCloseMap(source: String): IntArray {
    val n = source.length
    val closeMap = IntArray(n) { -1 }
    val stack = IntBuf(16)
    val localRawEnvMissMap = HashMap<String, MissFrontier>()

    var i = 0
    while (i < n) {
        val ch = source[i].code
        if (ch == 37) {
            while (i < n && !isLineBreakCode(source[i].code)) i++
            continue
        }
        if (ch == 92) {
            if (source.startsWith("\\begin{", i)) {
                val closeBrace = source.indexOf('}', i + 7)
                if (closeBrace != -1 && closeBrace - (i + 7) <= 64) {
                    val envName = source.substring(i + 7, closeBrace)
                    val baseEnv = stripTrailingStar(envName)
                    if (baseEnv in RAW_NON_PROSE_ENVS) {
                        val endTag = "\\end{$envName}"
                        val limit = minOf(n, i + NON_PROSE_ENV_MAX_LEN)
                        val miss = localRawEnvMissMap.getOrPut(endTag) { MissFrontier() }
                        val closeIdx = findVerbatimDelimiterForward(source, endTag, closeBrace + 1, limit, miss)
                        if (closeIdx != -1) {
                            i = closeIdx + endTag.length
                            continue
                        }
                        i = closeBrace + 1
                        continue
                    }
                }
            }
            i += 2
            continue
        }
        if (ch == 123) {
            stack.add(i)
        } else if (ch == 125) {
            if (stack.size > 0) {
                closeMap[stack.popLast()] = i
            }
        }
        i++
    }
    return closeMap
}

fun preMask(
    source: String,
    format: SourceFormat,
    options: PreMaskOptions? = null,
): PreMaskResult {
    val n = source.length
    val out = source.toCharArray()

    val report = options?.report ?: ImportQualityReport()
    val tracker = SectionTracker()
    val regions = mutableListOf<MaskedRegion>()
    val blockRegions = mutableListOf<MaskedSpan>()
    val mathRegions = mutableListOf<MathRegionRecord>()
    val proseStreams = mutableListOf<ExtractedProseStream>()
    val tables = mutableListOf<ExtractedTable>()
    val bibItems = mutableListOf<ExtractedBibItem>()
    val sectionTransitions = mutableListOf<SectionTransition>()
    val listItemStarts = mutableListOf<Int>()
    val userMacros = LinkedHashMap<String, String>()
    val customCiteMacros = LinkedHashSet<String>()
    var frontMatter = FrontMatterMetadata()

    fun maskSpan(kind: MaskedRegionKind, start: Int, end: Int, isBlockBoundary: Boolean) {
        for (k in start until end) {
            out[k] = MASK_CHAR
        }
        regions.add(MaskedRegion(kind, start, end, isBlockBoundary))
        if (isBlockBoundary) {
            blockRegions.add(MaskedSpan(start, end))
        }
    }

    val envMatchCache = HashMap<String, Map<Int, Int>>()
    val rawEnvMissMap = HashMap<String, MissFrontier>()
    fun getRawEnvMiss(endTag: String): MissFrontier = rawEnvMissMap.getOrPut(endTag) { MissFrontier() }

    val braceClose = if (format == SourceFormat.LATEX) {
        buildLatexBraceCloseMap(source)
    } else {
        buildBraceCloseMap(source)
    }
    val missDoubleBracket = MissFrontier()
    val missDoubleDollar = MissFrontier()
    val missInlineParen = MissFrontier()
    val missHtmlComment = MissFrontier()
    val missYaml = MissFrontier()
    var mdFenceIndexCache: MdFenceCloseIndex? = null
    val getMdFenceIndex: () -> MdFenceCloseIndex = {
        mdFenceIndexCache ?: buildMdFenceIndex(source).also { mdFenceIndexCache = it }
    }

    var frontMatterMath = options?.frontMatterMath == true
    var i = 0
    var atLineStart = true

    while (i < n) {
        val ch = source[i].code

        if (ch == 10 || ch == 13) {
            atLineStart = true
            i++
            continue
        }

        if (format == SourceFormat.MD) {
            if (i == 0 && atLineStart) {
                val yaml = parseYamlFrontMatter(source, missYaml)
                if (yaml != null) {
                    frontMatter = yaml.metadata
                    if (yaml.metadata.math == true) {
                        frontMatterMath = true
                    } else if (yaml.metadata.math == false) {
                        frontMatterMath = false
                    }
                    maskSpan(MaskedRegionKind.YAML_FRONT_MATTER, 0, yaml.end, true)
                    i = yaml.end
                    atLineStart = false
                    continue
                }
            }

            if (atLineStart) {
                val fenceEnd = tryMatchMdFence(source, i, getMdFenceIndex)
                if (fenceEnd != -1) {
                    maskSpan(MaskedRegionKind.FENCED_CODE, i, fenceEnd, true)
                    i = fenceEnd
                    atLineStart = false
                    continue
                }

                var sp = 0
                while (sp < 3 && i + sp < n && source[i + sp].code == 32) sp++
                var hashCount = 0
                while (hashCount < 7 && i + sp + hashCount < n && source[i + sp + hashCount].code == 35) {
                    hashCount++
                }
                if (hashCount in 1..6 &&
                    i + sp + hashCount < n &&
                    (source[i + sp + hashCount].code == 32 || source[i + sp + hashCount].code == 9)
                ) {
                    val line = advanceLineEnd(source, i, n)
                    val headingRaw = source.substring(i + sp + hashCount + 1, line.contentEnd)
                    val state = tracker.pushHeading(hashCount, headingRaw)
                    sectionTransitions.add(SectionTransition(i, line.nextLineStart, state))
                    maskSpan(MaskedRegionKind.MD_HEADING, i, line.contentEnd, true)
                    i = line.contentEnd
                    atLineStart = false
                    continue
                }

                var firstNonHoriz = i
                while (firstNonHoriz < n && isHorizontalSpace(source[firstNonHoriz].code)) firstNonHoriz++
                if (firstNonHoriz < n && source[firstNonHoriz].code == 124) {
                    val mdTable = parseMdTableBlock(source, i, tracker.current)
                    if (mdTable != null) {
                        tables.add(mdTable.table)
                        report.tablesParsed++
                        maskSpan(MaskedRegionKind.MD_TABLE, i, mdTable.end, true)
                        i = mdTable.end
                        atLineStart = false
                        continue
                    }
                }
            }

            atLineStart = false

            if (ch == 60 && source.startsWith("<!--", i)) {
                val limit = minOf(n, i + HTML_COMMENT_MAX_LEN)
                val close = findVerbatimDelimiterForward(source, "-->", i + 4, limit, missHtmlComment)
                if (close != -1) {
                    maskSpan(MaskedRegionKind.HTML_COMMENT, i, close + 3, false)
                    i = close + 3
                    continue
                }
                i += 4
                continue
            }

            if (ch == 96) {
                var tickLen = 1
                while (i + tickLen < n && source[i + tickLen].code == 96) tickLen++
                val limit = minOf(n, i + INLINE_CODE_MAX_LEN)
                var j = i + tickLen
                var matchEnd = -1
                while (j + tickLen <= limit) {
                    val cj = source[j].code
                    if (isLineBreakCode(cj)) break
                    if (cj == 96) {
                        var run = 1
                        while (j + run < limit && source[j + run].code == 96) run++
                        if (run == tickLen) {
                            matchEnd = j + run
                            break
                        }
                        j += run
                        continue
                    }
                    j++
                }
                if (matchEnd != -1) {
                    maskSpan(MaskedRegionKind.INLINE_CODE, i, matchEnd, false)
                    i = matchEnd
                    continue
                }
                i += tickLen
                continue
            }

            if (ch == 92 && frontMatterMath && source.startsWith("\\[", i)) {
                val limit = minOf(n, i + DISPLAY_MATH_MAX_LEN)
                val close = findUnescapedDelimiterForward(source, "\\]", i + 2, limit, missDoubleBracket)
                if (close != -1) {
                    val end = close + 2
                    val raw = source.substring(i, end)
                    val ownLine = isOnOwnLine(source, i, end)
                    maskSpan(MaskedRegionKind.DISPLAY_MATH, i, end, ownLine)
                    mathRegions.add(MathRegionRecord("display", i, end, raw, mathText(raw)))
                    report.mathRegions.display++
                    i = end
                    continue
                }
            }

            if (ch == 92 && source.startsWith("\\begin{", i) && frontMatterMath) {
                val closeBrace = source.indexOf('}', i + 7)
                if (closeBrace != -1 && closeBrace - (i + 7) <= 64) {
                    val envName = source.substring(i + 7, closeBrace)
                    val base = stripTrailingStar(envName)
                    if (base in DISPLAY_MATH_ENVS) {
                        val limit = minOf(n, i + DISPLAY_MATH_MAX_LEN)
                        val endTag = "\\end{$envName}"
                        val closeIdx = findVerbatimDelimiterForward(
                            source,
                            endTag,
                            closeBrace + 1,
                            limit,
                            getRawEnvMiss(endTag),
                        )
                        if (closeIdx != -1) {
                            val end = closeIdx + endTag.length
                            val raw = source.substring(i, end)
                            val ownLine = isOnOwnLine(source, i, end)
                            maskSpan(MaskedRegionKind.DISPLAY_MATH, i, end, ownLine)
                            mathRegions.add(MathRegionRecord("display", i, end, raw, mathText(raw)))
                            report.mathRegions.display++
                            i = end
                            continue
                        }
                    }
                }
            }

            if (ch == 92) {
                if (i + 1 < n &&
                    (source[i + 1].code == 92 || source[i + 1].code == 36 || source[i + 1].code == 96)
                ) {
                    i += 2
                    continue
                }
                i++
                continue
            }

            if (ch == 36 && i + 1 < n && source[i + 1].code == 36) {
                if (frontMatterMath) {
                    val limit = minOf(n, i + DISPLAY_MATH_MAX_LEN)
                    val close = findUnescapedDelimiterForward(source, "$$", i + 2, limit, missDoubleDollar)
                    if (close != -1) {
                        val end = close + 2
                        val raw = source.substring(i, end)
                        val ownLine = isOnOwnLine(source, i, end)
                        maskSpan(MaskedRegionKind.DISPLAY_MATH, i, end, ownLine)
                        mathRegions.add(MathRegionRecord("display", i, end, raw, mathText(raw)))
                        report.mathRegions.display++
                        i = end
                        continue
                    }
                }
                i += 2
                continue
            }

            if (ch == 36 && i + 1 < n && !isSpace(source[i + 1].code) && source[i + 1].code != 36) {
                val limit = minOf(n, i + INLINE_MATH_MAX_LEN)
                var j = i + 1
                var matchEnd = -1
                while (j < limit) {
                    val cj = source[j].code
                    if (isLineBreakCode(cj)) break
                    if (cj == 92) {
                        if (j + 1 >= n || isLineBreakCode(source[j + 1].code)) break
                        j += 2
                        continue
                    }
                    if (cj == 36) {
                        val precededByNonSpace = !isSpace(source[j - 1].code)
                        val notDoubleDollar = j + 1 >= n || source[j + 1].code != 36
                        val notFollowedByDigit = j + 1 >= n || !isDigit(source[j + 1].code)
                        if (precededByNonSpace && notDoubleDollar && notFollowedByDigit) {
                            matchEnd = j + 1
                        }
                        break
                    }
                    j++
                }
                if (matchEnd != -1) {
                    val raw = source.substring(i, matchEnd)
                    maskSpan(MaskedRegionKind.INLINE_MATH, i, matchEnd, false)
                    mathRegions.add(MathRegionRecord("inline", i, matchEnd, raw, mathText(raw)))
                    report.mathRegions.inline++
                    i = matchEnd
                    continue
                }
            }

            i++
            continue
        }

        // ==================== LaTeX Scope ====================
        atLineStart = false

        if (ch == 37) {
            var end = i + 1
            while (end < n && !isLineBreakCode(source[end].code)) end++
            maskSpan(MaskedRegionKind.LATEX_COMMENT, i, end, false)
            i = end
            continue
        }

        if (ch == 36 && i + 1 < n && source[i + 1].code == 36) {
            val limit = minOf(n, i + DISPLAY_MATH_MAX_LEN)
            val close = findUnescapedDelimiterForward(source, "$$", i + 2, limit, missDoubleDollar)
            if (close != -1) {
                val end = close + 2
                val raw = source.substring(i, end)
                val ownLine = isOnOwnLine(source, i, end)
                maskSpan(MaskedRegionKind.DISPLAY_MATH, i, end, ownLine)
                mathRegions.add(MathRegionRecord("display", i, end, raw, mathText(raw)))
                report.mathRegions.display++
                i = end
                continue
            }
            i += 2
            continue
        }

        if (ch == 36) {
            val limit = minOf(n, i + INLINE_MATH_MAX_LEN)
            var j = i + 1
            var matchEnd = -1
            while (j < limit) {
                val cj = source[j].code
                if (isLineBreakCode(cj)) break
                if (cj == 92) {
                    if (j + 1 >= n || isLineBreakCode(source[j + 1].code)) break
                    j += 2
                    continue
                }
                if (cj == 36) {
                    if (j + 1 >= n || source[j + 1].code != 36) {
                        matchEnd = j + 1
                    }
                    break
                }
                j++
            }
            if (matchEnd != -1) {
                val raw = source.substring(i, matchEnd)
                maskSpan(MaskedRegionKind.INLINE_MATH, i, matchEnd, false)
                mathRegions.add(MathRegionRecord("inline", i, matchEnd, raw, mathText(raw)))
                report.mathRegions.inline++
                i = matchEnd
                continue
            }
            i++
            continue
        }

        if (ch == 92) {
            if (i + 1 >= n) {
                i++
                continue
            }
            val next = source[i + 1].code

            if (next == 91) {
                val limit = minOf(n, i + DISPLAY_MATH_MAX_LEN)
                val close = findUnescapedDelimiterForward(source, "\\]", i + 2, limit, missDoubleBracket)
                if (close != -1) {
                    val end = close + 2
                    val raw = source.substring(i, end)
                    val ownLine = isOnOwnLine(source, i, end)
                    maskSpan(MaskedRegionKind.DISPLAY_MATH, i, end, ownLine)
                    mathRegions.add(MathRegionRecord("display", i, end, raw, mathText(raw)))
                    report.mathRegions.display++
                    i = end
                    continue
                }
                i += 2
                continue
            }

            if (next == 40) {
                val limit = minOf(n, i + INLINE_MATH_MAX_LEN)
                val close = findUnescapedDelimiterForward(source, "\\)", i + 2, limit, missInlineParen)
                if (close != -1) {
                    val end = close + 2
                    val raw = source.substring(i, end)
                    maskSpan(MaskedRegionKind.INLINE_MATH, i, end, false)
                    mathRegions.add(MathRegionRecord("inline", i, end, raw, mathText(raw)))
                    report.mathRegions.inline++
                    i = end
                    continue
                }
                i += 2
                continue
            }

            if (!isAsciiLetter(next)) {
                i += 2
                continue
            }

            var cmdEnd = i + 2
            while (cmdEnd < n && isAsciiLetter(source[cmdEnd].code)) cmdEnd++
            val cmd = source.substring(i + 1, cmdEnd)

            if (cmd == "begin" && cmdEnd < n && source[cmdEnd].code == 123) {
                val closeBrace = source.indexOf('}', cmdEnd + 1)
                if (closeBrace != -1 && closeBrace - (cmdEnd + 1) <= 64) {
                    val envName = source.substring(cmdEnd + 1, closeBrace)
                    val baseEnv = stripTrailingStar(envName)
                    val tagEnd = closeBrace + 1

                    if (baseEnv in DISPLAY_MATH_ENVS) {
                        val limit = minOf(n, i + DISPLAY_MATH_MAX_LEN)
                        val endTag = "\\end{$envName}"
                        val closeIdx = findVerbatimDelimiterForward(
                            source,
                            endTag,
                            tagEnd,
                            limit,
                            getRawEnvMiss(endTag),
                        )
                        if (closeIdx != -1) {
                            val end = closeIdx + endTag.length
                            val raw = source.substring(i, end)
                            val ownLine = isOnOwnLine(source, i, end)
                            maskSpan(MaskedRegionKind.DISPLAY_MATH, i, end, ownLine)
                            mathRegions.add(MathRegionRecord("display", i, end, raw, mathText(raw)))
                            report.mathRegions.display++
                            i = end
                            continue
                        }
                        i = tagEnd
                        continue
                    }

                    if (baseEnv == "abstract") {
                        val state = tracker.enterAbstract()
                        sectionTransitions.add(SectionTransition(i, tagEnd, state))
                        maskSpan(MaskedRegionKind.ABSTRACT_TAG, i, tagEnd, true)
                        i = tagEnd
                        continue
                    }

                    if (baseEnv in NON_PROSE_ENVS) {
                        val endTag = "\\end{$envName}"
                        var envEnd = -1
                        if (baseEnv in RAW_NON_PROSE_ENVS) {
                            val limit = minOf(n, i + NON_PROSE_ENV_MAX_LEN)
                            val closeIdx = findVerbatimDelimiterForward(
                                source,
                                endTag,
                                tagEnd,
                                limit,
                                getRawEnvMiss(endTag),
                            )
                            if (closeIdx != -1) {
                                envEnd = closeIdx + endTag.length
                            }
                        } else {
                            val matchMap = envMatchCache.getOrPut(envName) {
                                computeNestableEnvMatchMap(source, envName)
                            }
                            val candidate = matchMap[i]
                            if (candidate != null && candidate - i <= NON_PROSE_ENV_MAX_LEN) {
                                envEnd = candidate
                            }
                        }

                        if (envEnd != -1) {
                            val bodyEnd = envEnd - endTag.length
                            if (baseEnv !in RAW_NON_PROSE_ENVS) {
                                extractCaptionsFromLatexSlice(
                                    source,
                                    tagEnd,
                                    bodyEnd,
                                    braceClose,
                                    tracker.current,
                                    proseStreams,
                                )
                                if (baseEnv in TABLE_ENVS) {
                                    tables.add(
                                        parseLatexTabularSlice(
                                            source,
                                            envName,
                                            i,
                                            tagEnd,
                                            bodyEnd,
                                            endTag.length,
                                            braceClose,
                                            tracker.current,
                                        ),
                                    )
                                    report.tablesParsed++
                                } else {
                                    extractNestedTablesFromNonProseEnv(
                                        source,
                                        tagEnd,
                                        bodyEnd,
                                        braceClose,
                                        tracker.current,
                                        envMatchCache,
                                        tables,
                                        report,
                                    )
                                }
                                if (baseEnv == "thebibliography") {
                                    extractBibItemsFromLatexEnv(source, tagEnd, bodyEnd, braceClose, bibItems)
                                }
                            }
                            maskSpan(MaskedRegionKind.NON_PROSE_ENV, i, envEnd, true)
                            i = envEnd
                            continue
                        }
                        i = tagEnd
                        continue
                    }

                    if (baseEnv !in KNOWN_PROSE_ENVS) {
                        recordDistinct(report.unknownEnvironments, baseEnv)
                    }
                    maskSpan(MaskedRegionKind.ENV_TAG, i, tagEnd, isOnOwnLine(source, i, tagEnd))
                    i = tagEnd
                    continue
                }
            }

            if (cmd == "end" && cmdEnd < n && source[cmdEnd].code == 123) {
                val closeBrace = source.indexOf('}', cmdEnd + 1)
                if (closeBrace != -1 && closeBrace - (cmdEnd + 1) <= 64) {
                    val envName = source.substring(cmdEnd + 1, closeBrace)
                    val baseEnv = stripTrailingStar(envName)
                    val tagEnd = closeBrace + 1
                    if (baseEnv == "abstract") {
                        val state = tracker.exitAbstract()
                        sectionTransitions.add(SectionTransition(i, tagEnd, state))
                        maskSpan(MaskedRegionKind.ABSTRACT_TAG, i, tagEnd, true)
                        i = tagEnd
                        continue
                    }
                    if (baseEnv !in NON_PROSE_ENVS && baseEnv !in DISPLAY_MATH_ENVS) {
                        maskSpan(MaskedRegionKind.ENV_TAG, i, tagEnd, isOnOwnLine(source, i, tagEnd))
                        i = tagEnd
                        continue
                    }
                }
            }

            if (cmd in SECTION_COMMANDS) {
                var cur = cmdEnd
                if (cur < n && source[cur].code == 42) cur++
                val adj1 = skipAdjacentWhitespace(source, cur, n)
                if (!adj1.crossedBlankLine) {
                    cur = adj1.pos
                    if (cur < n && source[cur].code == 91) {
                        val closeBrk = scanBracketGroup(source, braceClose, cur, n, SECTION_TITLE_MAX_LEN)
                        if (closeBrk != -1) {
                            val adj2 = skipAdjacentWhitespace(source, closeBrk + 1, n)
                            cur = if (adj2.crossedBlankLine) -1 else adj2.pos
                        }
                    }
                    if (cur in 0 until n && source[cur].code == 123) {
                        val close = braceClose[cur]
                        if (close != -1 && close + 1 - cur <= SECTION_TITLE_MAX_LEN) {
                            val end = close + 1
                            val rawHeading = source.substring(cur + 1, close)
                            val level = LATEX_SECTION_LEVELS_BY_NAME[cmd]!!
                            val state = tracker.pushHeading(level, rawHeading)
                            sectionTransitions.add(SectionTransition(i, end, state))
                            maskSpan(MaskedRegionKind.SECTION_HEADING, i, end, true)
                            i = end
                            continue
                        }
                    }
                }
            }

            if (cmd in FOOTNOTE_COMMANDS) {
                var cur = cmdEnd
                if (cur < n && source[cur].code == 42) cur++
                val adj1 = skipAdjacentWhitespace(source, cur, n)
                if (!adj1.crossedBlankLine) {
                    cur = adj1.pos
                    if (cur < n && source[cur].code == 91) {
                        val closeBrk = scanBracketGroup(source, braceClose, cur, n, ARG_BRACKET_MAX_LEN)
                        if (closeBrk != -1) {
                            val adj2 = skipAdjacentWhitespace(source, closeBrk + 1, n)
                            cur = if (adj2.crossedBlankLine) -1 else adj2.pos
                        }
                    }
                    if (cur in 0 until n && source[cur].code == 123) {
                        val close = braceClose[cur]
                        if (close != -1 && close + 1 - cur <= FOOTNOTE_MAX_LEN) {
                            val end = close + 1
                            proseStreams.add(
                                ExtractedProseStream(
                                    kind = "footnote",
                                    start = i,
                                    end = end,
                                    rawText = source.substring(cur + 1, close),
                                    section = tracker.current,
                                ),
                            )
                            report.footnotes++
                            maskSpan(MaskedRegionKind.FOOTNOTE, i, end, false)
                            i = end
                            continue
                        }
                    }
                }
            }

            if (cmd in STRUCTURAL_COMMANDS) {
                var cur = cmdEnd
                if (cur < n && source[cur].code == 42) cur++
                val args = scanArgumentSequence(source, braceClose, cur, n)
                maskSpan(MaskedRegionKind.STRUCTURAL_COMMAND, i, args.end, false)
                i = args.end
                continue
            }

            if (cmd == "newcommand" || cmd == "renewcommand" || cmd == "providecommand") {
                val parsed = tryParseNewcommandMacro(source, cmdEnd, braceClose)
                if (parsed != null) {
                    if (parsed.isCiteEligible) customCiteMacros.add(parsed.name)
                    if (parsed.expandable && parsed.body != null) {
                        if (parsed.name in userMacros || userMacros.size < USER_MACRO_MAX_COUNT) {
                            userMacros[parsed.name] = parsed.body
                        } else {
                            recordDistinct(report.macrosNotExpanded, parsed.name)
                        }
                    } else {
                        if (cmd == "renewcommand") userMacros.remove(parsed.name)
                        recordDistinct(report.macrosNotExpanded, parsed.name)
                    }
                    maskSpan(MaskedRegionKind.MACRO_DEF, i, parsed.end, false)
                    i = parsed.end
                    continue
                }
            }

            if (cmd == "def") {
                val parsed = tryParseDefMacro(source, cmdEnd, braceClose)
                if (parsed != null) {
                    if (parsed.isCiteEligible) customCiteMacros.add(parsed.name)
                    if (parsed.expandable && parsed.body != null) {
                        if (parsed.name in userMacros || userMacros.size < USER_MACRO_MAX_COUNT) {
                            userMacros[parsed.name] = parsed.body
                        } else {
                            recordDistinct(report.macrosNotExpanded, parsed.name)
                        }
                    } else {
                        userMacros.remove(parsed.name)
                        recordDistinct(report.macrosNotExpanded, parsed.name)
                    }
                    maskSpan(MaskedRegionKind.MACRO_DEF, i, parsed.end, false)
                    i = parsed.end
                    continue
                }
            }

            if (cmd == "let") {
                val parsed = tryParseLetMacro(source, cmdEnd)
                if (parsed != null) {
                    if (containsCiteAsciiCaseInsensitive(parsed.name)) {
                        customCiteMacros.add(parsed.name)
                    }
                    if (parsed.targetName != null) {
                        val aliasedBody = userMacros[parsed.targetName]
                        if (aliasedBody != null) {
                            if (parsed.name in userMacros || userMacros.size < USER_MACRO_MAX_COUNT) {
                                userMacros[parsed.name] = aliasedBody
                            } else {
                                recordDistinct(report.macrosNotExpanded, parsed.name)
                            }
                        } else {
                            userMacros.remove(parsed.name)
                        }
                    } else {
                        userMacros.remove(parsed.name)
                    }
                    maskSpan(MaskedRegionKind.MACRO_DEF, i, parsed.end, false)
                    i = parsed.end
                    continue
                }
            }

            if (cmd == "DeclareCiteCommand") {
                val parsed = tryParseDeclareCiteCommand(source, cmdEnd, braceClose)
                if (parsed != null) {
                    if (containsCiteAsciiCaseInsensitive(parsed.name)) {
                        customCiteMacros.add(parsed.name)
                    }
                    maskSpan(MaskedRegionKind.MACRO_DEF, i, parsed.end, false)
                    i = parsed.end
                    continue
                }
            }

            if (cmd == "item") {
                var end = cmdEnd
                val adj = skipAdjacentWhitespace(source, cmdEnd, n)
                if (!adj.crossedBlankLine && adj.pos < n && source[adj.pos].code == 91) {
                    val closeBrk = scanBracketGroup(source, braceClose, adj.pos, n, ARG_BRACKET_MAX_LEN)
                    if (closeBrk != -1) end = closeBrk + 1
                }
                listItemStarts.add(i)
                maskSpan(MaskedRegionKind.LIST_ITEM, i, end, true)
                i = end
                continue
            }

            i = cmdEnd
            continue
        }

        i++
    }

    return PreMaskResult(
        format = format,
        maskedText = String(out),
        regions = regions,
        blockRegions = blockRegions,
        mathRegions = mathRegions,
        proseStreams = proseStreams,
        tables = tables,
        bibItems = bibItems,
        sectionTransitions = sectionTransitions,
        listItemStarts = listItemStarts,
        userMacros = userMacros,
        customCiteMacros = customCiteMacros,
        frontMatter = frontMatter,
        report = report,
    )
}
