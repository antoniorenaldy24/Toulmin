package app.toulmin.core

val CITE_COMMANDS: Set<String> = setOf(
    "cite", "Cite", "citep", "Citep", "citet", "Citet", "citealp", "Citealp",
    "citealt", "Citealt", "citenum", "parencite", "Parencite", "textcite", "Textcite",
    "autocite", "Autocite", "footcite", "smartcite", "supercite", "citeauthor",
    "Citeauthor", "citeyear", "cites", "parencites", "textcites", "autocites", "footcites",
)

val NARRATIVE_CITE_COMMANDS: Set<String> = setOf(
    "citet", "Citet", "textcite", "Textcite", "textcites", "citeauthor", "Citeauthor",
)

private val FORMATTING_UNWRAP_COMMANDS: Set<String> = setOf(
    "emph", "textit", "textbf", "textrm", "textsc", "mathrm",
    "mathit", "mathbf", "text", "textsf", "underline", "hl",
)

private val COLOR_UNWRAP_COMMANDS: Set<String> = setOf(
    "textcolor", "colorbox",
)

private val DRAFT_DELETE_COMMANDS: Set<String> = setOf(
    "todo", "note", "fixme", "marginpar",
)

private val SI_UNIT_MACROS: Map<String, String> = mapOf(
    "milli" to "m",
    "micro" to "\u03BC",
    "nano" to "n",
    "kilo" to "k",
    "gram" to "g",
    "litre" to "L",
    "liter" to "L",
    "metre" to "m",
    "meter" to "m",
    "mole" to "mol",
    "second" to "s",
    "minute" to "min",
    "hour" to "h",
    "day" to "d",
    "percent" to "%",
    "per" to "/",
    "squared" to "^2",
    "cubed" to "^3",
)

private val KNOWN_SPACE_COMMANDS: Set<String> = setOf("quad", "qquad")

private val SKIPPED_SECTION_OR_META_COMMANDS: Set<String> = setOf("begin", "end", "item")

private const val MAX_SUBSTITUTION_DEPTH = 3

interface TextRangeLike {
    val start: Int
    val end: Int
}

data class TextRange(
    override val start: Int,
    override val end: Int,
) : TextRangeLike

data class LatexSubstitutionsOptions(
    val userMacros: Map<String, String>? = null,
    val customCiteMacros: Set<String>? = null,
    val report: ImportQualityReport? = null,
)

class LatexSubstitutionsResult(
    val text: String,
    val map: IntArray,
    val unregisteredCommands: List<String>,
)

private fun lowerBoundProtectedEnd(spans: List<TextRangeLike>, pos: Int): Int {
    var lo = 0
    var hi = spans.size
    while (lo < hi) {
        val mid = (lo + hi) ushr 1
        if (spans[mid].end <= pos) {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    return lo
}

private fun buildBraceCloseMapSkippingProtected(
    input: String,
    protectedSpans: List<TextRangeLike>,
): IntArray {
    if (protectedSpans.isEmpty()) {
        return buildBraceCloseMap(input)
    }
    val n = input.length
    val closeMap = IntArray(n) { -1 }
    val stack = IntBuf(16)
    var protIdx = 0
    var i = 0

    while (i < n) {
        val prot = protectedSpans.getOrNull(protIdx)
        if (prot != null && i >= prot.start) {
            if (i < prot.end) {
                i = prot.end
            }
            protIdx++
            continue
        }
        val ch = input[i].code
        if (ch == 92) {
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

private class OutBuffer(collectMap: Boolean) {
    val chars = CharBuf(64)
    val map: IntBuf? = if (collectMap) IntBuf(64) else null
}

private fun pushOutChar(buf: OutBuffer, ch: Char, orig: Int) {
    buf.chars.add(ch)
    buf.map?.add(orig)
}

private data class MappedPiece(val ch: Char, val orig: Int)

private fun pushMappedPieces(buf: OutBuffer, pieces: List<MappedPiece>) {
    val m = buf.map
    if (m == null) {
        for (piece in pieces) buf.chars.add(piece.ch)
        return
    }
    for (piece in pieces) {
        buf.chars.add(piece.ch)
        m.add(piece.orig)
    }
}

private fun recordDistinctCmd(list: MutableList<String>, report: ImportQualityReport?, name: String) {
    if (!list.contains(name)) list.add(name)
    if (report != null && !report.unregisteredCommands.contains(name)) {
        report.unregisteredCommands.add(name)
    }
}

private fun recordDistinctMacroOverflow(report: ImportQualityReport?, name: String) {
    if (report != null && !report.macrosNotExpanded.contains(name)) {
        report.macrosNotExpanded.add(name)
    }
}

private fun translateSiUnitWithOffsets(
    input: String,
    start: Int,
    end: Int,
    fixedOrigin: Int?,
): List<MappedPiece> {
    val pieces = mutableListOf<MappedPiece>()
    var i = start

    while (i < end) {
        val ch = input[i].code
        if (ch == 92) {
            if (i + 1 >= end) {
                i++
                continue
            }
            val next = input[i + 1].code
            if (isAsciiLetter(next)) {
                var nameEnd = i + 2
                while (nameEnd < end && isAsciiLetter(input[nameEnd].code)) nameEnd++
                val unitCmd = input.substring(i + 1, nameEnd)
                val mapped = SI_UNIT_MACROS[unitCmd]
                val orig = fixedOrigin ?: i
                if (mapped != null) {
                    for (k in mapped.indices) {
                        pieces.add(MappedPiece(mapped[k], orig))
                    }
                }
                var after = nameEnd
                while (after < end && (input[after].code == 32 || input[after].code == 9)) after++
                i = after
                continue
            }
            if (next == 37) {
                pieces.add(MappedPiece('%', fixedOrigin ?: i))
            }
            i += 2
            continue
        }
        if (ch == 123 || ch == 125) {
            i++
            continue
        }
        if (isSpace(ch)) {
            if (pieces.isNotEmpty() && pieces.last().ch != ' ') {
                pieces.add(MappedPiece(' ', fixedOrigin ?: i))
            }
            i++
            continue
        }
        pieces.add(MappedPiece(input[i], fixedOrigin ?: i))
        i++
    }

    var left = 0
    while (left < pieces.size && pieces[left].ch == ' ') left++
    var right = pieces.size
    while (right > left && pieces[right - 1].ch == ' ') right--
    return pieces.subList(left, right)
}

private fun translateCeBodyWithOffsets(
    input: String,
    start: Int,
    end: Int,
    fixedOrigin: Int?,
): List<MappedPiece> {
    val pieces = mutableListOf<MappedPiece>()
    var i = start
    while (i < end) {
        val ch = input[i].code
        if (ch == 92 && i + 1 < end) {
            val next = input[i + 1].code
            if (next == 123 || next == 125 || next == 37 || next == 36 || next == 38 || next == 35 || next == 95) {
                pieces.add(MappedPiece(input[i + 1], fixedOrigin ?: i))
                i += 2
                continue
            }
            if (next == 44 || next == 59 || next == 58 || next == 32) {
                pieces.add(MappedPiece(' ', fixedOrigin ?: i))
                i += 2
                continue
            }
            if (next == 33) {
                i += 2
                continue
            }
            if (isAsciiLetter(next)) {
                var nameEnd = i + 2
                while (nameEnd < end && isAsciiLetter(input[nameEnd].code)) nameEnd++
                i = nameEnd
                continue
            }
            i += 2
            continue
        }
        if (ch == 123 || ch == 125) {
            i++
            continue
        }
        pieces.add(MappedPiece(input[i], fixedOrigin ?: i))
        i++
    }
    return pieces
}

private data class SimpleOneArgResult(val innerStart: Int, val innerEnd: Int, val after: Int)

private fun isSimpleOneArgBracedMacro(
    input: String,
    braceClose: IntArray,
    cmdEnd: Int,
    end: Int,
): SimpleOneArgResult? {
    val adj = skipAdjacentWhitespace(input, cmdEnd, end)
    if (adj.crossedBlankLine || adj.pos >= end || input[adj.pos].code != 123) return null
    val close = braceClose[adj.pos]
    if (close == -1 || close >= end) return null
    return SimpleOneArgResult(adj.pos + 1, close, close + 1)
}

private data class BracePair(val open: Int, val close: Int)

private data class OptAndBracesResult(val braces: List<BracePair>, val after: Int)

private fun scanOptBracketAndRequiredBraces(
    input: String,
    braceClose: IntArray,
    cmdEnd: Int,
    end: Int,
    requiredBraces: Int,
): OptAndBracesResult? {
    var cur = cmdEnd
    if (cur < end && input[cur].code == 42) cur++
    var adj = skipAdjacentWhitespace(input, cur, end)
    if (adj.crossedBlankLine) return null
    cur = adj.pos
    if (cur < end && input[cur].code == 91) {
        val closeBrk = scanBracketGroup(input, braceClose, cur, end, 200)
        if (closeBrk != -1) {
            adj = skipAdjacentWhitespace(input, closeBrk + 1, end)
            if (adj.crossedBlankLine) return null
            cur = adj.pos
        }
    }
    val braces = mutableListOf<BracePair>()
    for (b in 0 until requiredBraces) {
        if (b > 0) {
            adj = skipAdjacentWhitespace(input, cur, end)
            if (adj.crossedBlankLine) return null
            cur = adj.pos
        }
        if (cur >= end || input[cur].code != 123) return null
        val close = braceClose[cur]
        if (close == -1 || close >= end) return null
        braces.add(BracePair(cur, close))
        cur = close + 1
    }
    return OptAndBracesResult(braces, cur)
}

private fun substituteSlice(
    input: String,
    braceClose: IntArray,
    start: Int,
    end: Int,
    macroDepth: Int,
    unregDepth: Int,
    fixedOrigin: Int?,
    options: LatexSubstitutionsOptions?,
    protectedSpans: List<TextRangeLike>?,
    unregList: MutableList<String>,
    out: OutBuffer,
) {
    val userMacros = options?.userMacros
    val customCiteMacros = options?.customCiteMacros
    val report = options?.report
    val activeProtected = if (fixedOrigin == null) protectedSpans else null
    var protIdx = if (activeProtected != null && activeProtected.isNotEmpty()) {
        lowerBoundProtectedEnd(activeProtected, start)
    } else {
        0
    }
    var i = start

    while (i < end) {
        var nextProt: TextRangeLike? = null
        if (activeProtected != null) {
            while (protIdx < activeProtected.size && activeProtected[protIdx].end <= i) {
                protIdx++
            }
            nextProt = activeProtected.getOrNull(protIdx)
            if (nextProt != null && i >= nextProt.start) {
                val stop = minOf(end, nextProt.end)
                for (k in i until stop) {
                    pushOutChar(out, input[k], k)
                }
                i = stop
                continue
            }
        }

        val ch = input[i].code
        val originHere = fixedOrigin ?: i

        if (ch == 126) {
            pushOutChar(out, ' ', originHere)
            i++
            continue
        }

        if (ch == 45) {
            if (i + 2 < end && input[i + 1].code == 45 && input[i + 2].code == 45) {
                pushOutChar(out, '-', originHere)
                i += 3
                continue
            }
            if (i + 1 < end && input[i + 1].code == 45) {
                pushOutChar(out, '-', originHere)
                i += 2
                continue
            }
        }

        if (ch == 96 && i + 1 < end && input[i + 1].code == 96) {
            pushOutChar(out, '"', originHere)
            i += 2
            continue
        }

        if (ch == 39 && i + 1 < end && input[i + 1].code == 39) {
            pushOutChar(out, '"', originHere)
            i += 2
            continue
        }

        if (ch == 92) {
            if (i + 1 >= end) {
                pushOutChar(out, '\\', originHere)
                i++
                continue
            }
            val next = input[i + 1].code

            if (next == 37 || next == 36 || next == 38 || next == 35 || next == 95) {
                pushOutChar(out, input[i + 1], originHere)
                i += 2
                continue
            }

            if (next == 44 || next == 59 || next == 58 || next == 32) {
                pushOutChar(out, ' ', originHere)
                i += 2
                continue
            }

            if (next == 33) {
                i += 2
                continue
            }

            if (!isAsciiLetter(next)) {
                pushOutChar(out, '\\', originHere)
                pushOutChar(out, input[i + 1], fixedOrigin ?: (i + 1))
                i += 2
                continue
            }

            var cmdEnd = i + 2
            while (cmdEnd < end && isAsciiLetter(input[cmdEnd].code)) cmdEnd++
            val cmd = input.substring(i + 1, cmdEnd)

            if (cmd in CITE_COMMANDS ||
                (customCiteMacros != null && cmd in customCiteMacros) ||
                cmd in STRUCTURAL_COMMANDS ||
                cmd in SECTION_COMMANDS ||
                cmd in FOOTNOTE_COMMANDS ||
                cmd in MACRO_DEF_COMMANDS ||
                cmd in SKIPPED_SECTION_OR_META_COMMANDS
            ) {
                for (k in i until cmdEnd) {
                    pushOutChar(out, input[k], fixedOrigin ?: k)
                }
                i = cmdEnd
                continue
            }

            if (cmd in KNOWN_SPACE_COMMANDS) {
                pushOutChar(out, ' ', originHere)
                i = cmdEnd
                continue
            }

            if (cmd in FORMATTING_UNWRAP_COMMANDS) {
                val arg = isSimpleOneArgBracedMacro(input, braceClose, cmdEnd, end)
                if (arg != null) {
                    substituteSlice(
                        input, braceClose, arg.innerStart, arg.innerEnd,
                        macroDepth, unregDepth, fixedOrigin, options, activeProtected, unregList, out,
                    )
                    i = arg.after
                    continue
                }
                i = cmdEnd
                continue
            }

            if (cmd in COLOR_UNWRAP_COMMANDS) {
                val parsed = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 2)
                val target = parsed?.braces?.getOrNull(1)
                if (parsed != null && target != null) {
                    substituteSlice(
                        input, braceClose, target.open + 1, target.close,
                        macroDepth, unregDepth, fixedOrigin, options, activeProtected, unregList, out,
                    )
                    i = parsed.after
                    continue
                }
                val parsedColorOnly = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 1)
                i = parsedColorOnly?.after ?: cmdEnd
                continue
            }

            if (cmd == "textsuperscript" || cmd == "textsubscript") {
                val arg = isSimpleOneArgBracedMacro(input, braceClose, cmdEnd, end)
                if (arg != null) {
                    pushOutChar(out, if (cmd == "textsuperscript") '^' else '_', originHere)
                    substituteSlice(
                        input, braceClose, arg.innerStart, arg.innerEnd,
                        macroDepth, unregDepth, fixedOrigin, options, activeProtected, unregList, out,
                    )
                    i = arg.after
                    continue
                }
                i = cmdEnd
                continue
            }

            if (cmd == "ce") {
                val arg = isSimpleOneArgBracedMacro(input, braceClose, cmdEnd, end)
                if (arg != null) {
                    val pieces = translateCeBodyWithOffsets(input, arg.innerStart, arg.innerEnd, fixedOrigin)
                    pushMappedPieces(out, pieces)
                    i = arg.after
                    continue
                }
                i = cmdEnd
                continue
            }

            if (cmd in DRAFT_DELETE_COMMANDS) {
                val seq = scanArgumentSequence(input, braceClose, cmdEnd, end)
                if (seq.braces.isNotEmpty() || seq.brackets.isNotEmpty()) {
                    i = seq.end
                    continue
                }
                i = cmdEnd
                continue
            }

            if (cmd == "SI" || cmd == "qty") {
                val parsed = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 2)
                val valArg = parsed?.braces?.getOrNull(0)
                val unitArg = parsed?.braces?.getOrNull(1)
                if (parsed != null && valArg != null && unitArg != null) {
                    substituteSlice(
                        input, braceClose, valArg.open + 1, valArg.close,
                        macroDepth, unregDepth, fixedOrigin, options, activeProtected, unregList, out,
                    )
                    val unitPieces = translateSiUnitWithOffsets(input, unitArg.open + 1, unitArg.close, fixedOrigin)
                    if (unitPieces.isNotEmpty()) {
                        pushOutChar(out, ' ', fixedOrigin ?: unitArg.open)
                        pushMappedPieces(out, unitPieces)
                    }
                    i = parsed.after
                    continue
                }
                val parsedValOnly = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 1)
                val partialVal = parsedValOnly?.braces?.getOrNull(0)
                if (parsedValOnly != null && partialVal != null) {
                    substituteSlice(
                        input, braceClose, partialVal.open + 1, partialVal.close,
                        macroDepth, unregDepth, fixedOrigin, options, activeProtected, unregList, out,
                    )
                    i = parsedValOnly.after
                    continue
                }
                i = cmdEnd
                continue
            }

            if (cmd == "num") {
                val parsed = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 1)
                val valArg = parsed?.braces?.getOrNull(0)
                if (parsed != null && valArg != null) {
                    var k = valArg.open + 1
                    while (k < valArg.close) {
                        val c = input[k].code
                        val origK = fixedOrigin ?: k
                        if (c == 123 || c == 125) {
                            k++
                            continue
                        }
                        if (c == 126) {
                            pushOutChar(out, ' ', origK)
                            k++
                            continue
                        }
                        if (c == 92 && k + 1 < valArg.close) {
                            val nextC = input[k + 1].code
                            if (nextC == 44 || nextC == 59 || nextC == 58 || nextC == 32) {
                                pushOutChar(out, ' ', origK)
                                k += 2
                                continue
                            }
                            if (nextC == 33) {
                                k += 2
                                continue
                            }
                            if (isAsciiLetter(nextC)) {
                                var innerCmdEnd = k + 2
                                while (innerCmdEnd < valArg.close && isAsciiLetter(input[innerCmdEnd].code)) {
                                    innerCmdEnd++
                                }
                                val innerCmd = input.substring(k + 1, innerCmdEnd)
                                if (innerCmd in KNOWN_SPACE_COMMANDS) {
                                    pushOutChar(out, ' ', origK)
                                    k = innerCmdEnd
                                    continue
                                }
                            } else {
                                pushOutChar(out, '\\', origK)
                                pushOutChar(out, input[k + 1], fixedOrigin ?: (k + 1))
                                k += 2
                                continue
                            }
                        }
                        pushOutChar(out, input[k], origK)
                        k++
                    }
                    i = parsed.after
                    continue
                }
                i = cmdEnd
                continue
            }

            if (cmd == "SIrange" || cmd == "qtyrange") {
                val parsed = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 3)
                val aArg = parsed?.braces?.getOrNull(0)
                val bArg = parsed?.braces?.getOrNull(1)
                val uArg = parsed?.braces?.getOrNull(2)
                if (parsed != null && aArg != null && bArg != null && uArg != null) {
                    substituteSlice(
                        input, braceClose, aArg.open + 1, aArg.close,
                        macroDepth, unregDepth, fixedOrigin, options, activeProtected, unregList, out,
                    )
                    pushOutChar(out, '-', fixedOrigin ?: aArg.close)
                    substituteSlice(
                        input, braceClose, bArg.open + 1, bArg.close,
                        macroDepth, unregDepth, fixedOrigin, options, activeProtected, unregList, out,
                    )
                    val unitPieces = translateSiUnitWithOffsets(input, uArg.open + 1, uArg.close, fixedOrigin)
                    if (unitPieces.isNotEmpty()) {
                        pushOutChar(out, ' ', fixedOrigin ?: uArg.open)
                        pushMappedPieces(out, unitPieces)
                    }
                    i = parsed.after
                    continue
                }
                i = cmdEnd
                continue
            }

            val macroBody = userMacros?.get(cmd)
            if (macroBody != null) {
                if (macroDepth < MAX_SUBSTITUTION_DEPTH) {
                    val macroBraceClose = buildBraceCloseMap(macroBody)
                    substituteSlice(
                        macroBody, macroBraceClose, 0, macroBody.length,
                        macroDepth + 1, unregDepth, originHere, options, null, unregList, out,
                    )
                } else {
                    recordDistinctMacroOverflow(report, cmd)
                }
                i = cmdEnd
                continue
            }

            recordDistinctCmd(unregList, report, cmd)
            var afterName = cmdEnd
            if (afterName < end && input[afterName].code == 42) {
                val starAdj = skipAdjacentWhitespace(input, afterName + 1, end)
                val chAfterStar = if (starAdj.pos < end) input[starAdj.pos].code else -1
                if (!starAdj.crossedBlankLine && (chAfterStar == 91 || chAfterStar == 123)) {
                    afterName++
                }
            }
            val seq = scanArgumentSequence(input, braceClose, afterName, end)
            val lastBrace = seq.braces.lastOrNull()
            if (lastBrace != null) {
                if (unregDepth < MAX_SUBSTITUTION_DEPTH) {
                    substituteSlice(
                        input, braceClose, lastBrace.start + 1, lastBrace.end - 1,
                        macroDepth, unregDepth + 1, fixedOrigin, options, activeProtected, unregList, out,
                    )
                } else {
                    for (k in (lastBrace.start + 1) until (lastBrace.end - 1)) {
                        pushOutChar(out, input[k], fixedOrigin ?: k)
                    }
                }
                i = seq.end
                continue
            }
            i = cmdEnd
            continue
        }

        if (out.map == null) {
            var runLimit = end
            if (nextProt != null && nextProt.start < runLimit) {
                runLimit = nextProt.start
            }
            var runEnd = i + 1
            while (runEnd < runLimit) {
                val c = input[runEnd].code
                if (c == 126 || c == 45 || c == 96 || c == 39 || c == 92) break
                runEnd++
            }
            for (k in i until runEnd) {
                out.chars.add(input[k])
            }
            i = runEnd
            continue
        }

        out.chars.add(input[i])
        out.map.add(originHere)
        i++
    }
}

private fun applyLatexSubstitutionsWithProtected(
    input: String,
    options: LatexSubstitutionsOptions?,
    protectedSpans: List<TextRangeLike>,
    collectMap: Boolean = true,
): LatexSubstitutionsResult {
    val braceClose = buildBraceCloseMapSkippingProtected(input, protectedSpans)
    val out = OutBuffer(collectMap)
    val unregList = mutableListOf<String>()

    substituteSlice(
        input, braceClose, 0, input.length, 0, 0, null, options, protectedSpans, unregList, out,
    )
    out.map?.add(input.length)

    return LatexSubstitutionsResult(
        text = out.chars.buildString(),
        map = out.map?.toArray() ?: IntArray(0),
        unregisteredCommands = unregList,
    )
}

fun applyLatexSubstitutions(
    input: String,
    options: LatexSubstitutionsOptions? = null,
): LatexSubstitutionsResult = applyLatexSubstitutionsWithProtected(input, options, emptyList())

data class MathSpanInput(
    override val start: Int,
    override val end: Int,
    val text: String? = null,
) : TextRangeLike

data class NormSentenceOptions(
    val format: SourceFormat = SourceFormat.LATEX,
    val frontMatterMath: Boolean? = null,
    val markerRanges: List<TextRangeLike>? = null,
    val mathRegions: List<MathSpanInput>? = null,
    val maskedRegions: List<TextRangeLike>? = null,
    val userMacros: Map<String, String>? = null,
    val customCiteMacros: Set<String>? = null,
)

private data class ReplacementSegment(
    val start: Int,
    val end: Int,
    val kind: Int, // 0=cite, 1=math, 2=masked
    val replacement: String,
)

private fun appendRawProseWithoutMasks(slice: String, sb: StringBuilder): Int {
    var segStart = 0
    while (segStart < slice.length) {
        val maskIdx = slice.indexOf(MASK_CHAR, segStart)
        if (maskIdx == -1) {
            sb.append(slice, segStart, slice.length)
            break
        }
        if (maskIdx > segStart) {
            sb.append(slice, segStart, maskIdx)
        }
        segStart = maskIdx + 1
    }
    return sb.length
}

fun normSentence(s: String, options: NormSentenceOptions? = null): String {
    val format = options?.format ?: SourceFormat.LATEX

    val mathSpans: List<MathSpanInput>
    val maskedSpans: List<TextRangeLike>
    var effectiveUserMacros = options?.userMacros
    var effectiveCustomCiteMacros = options?.customCiteMacros

    if (options?.mathRegions != null || options?.maskedRegions != null) {
        mathSpans = options.mathRegions ?: emptyList()
        maskedSpans = options.maskedRegions ?: emptyList()
    } else {
        val maskRes = preMask(
            s,
            format,
            options?.frontMatterMath?.let { PreMaskOptions(frontMatterMath = it) },
        )
        mathSpans = maskRes.mathRegions.map { MathSpanInput(it.start, it.end, it.text) }
        maskedSpans = maskRes.regions.filter {
            it.kind != MaskedRegionKind.INLINE_MATH && it.kind != MaskedRegionKind.DISPLAY_MATH
        }
        if (effectiveUserMacros == null && maskRes.userMacros.isNotEmpty()) {
            effectiveUserMacros = maskRes.userMacros
        }
        if (effectiveCustomCiteMacros == null && maskRes.customCiteMacros.isNotEmpty()) {
            effectiveCustomCiteMacros = maskRes.customCiteMacros
        }
    }

    val segments = mutableListOf<ReplacementSegment>()
    options?.markerRanges?.forEach { r ->
        if (r.start >= 0 && r.end > r.start && r.end <= s.length) {
            segments.add(ReplacementSegment(r.start, r.end, 0, "\u27E6c\u27E7"))
        }
    }
    for (m in mathSpans) {
        if (m.start >= 0 && m.end > m.start && m.end <= s.length) {
            segments.add(
                ReplacementSegment(
                    m.start,
                    m.end,
                    1,
                    m.text ?: mathText(s.substring(m.start, m.end)),
                ),
            )
        }
    }
    for (r in maskedSpans) {
        if (r.start >= 0 && r.end > r.start && r.end <= s.length) {
            segments.add(ReplacementSegment(r.start, r.end, 2, ""))
        }
    }

    segments.sortWith { a, b ->
        if (a.start != b.start) a.start.compareTo(b.start)
        else if (a.kind != b.kind) a.kind.compareTo(b.kind)
        else b.end.compareTo(a.end)
    }

    val sb = StringBuilder(s.length)
    val protectedSpans = mutableListOf<TextRangeLike>()
    var cursor = 0

    for (seg in segments) {
        if (seg.start < cursor) continue
        if (seg.start > cursor) {
            appendRawProseWithoutMasks(s.substring(cursor, seg.start), sb)
        }
        if (seg.replacement.isNotEmpty()) {
            val pStart = sb.length
            sb.append(seg.replacement)
            if (seg.kind == 0 || seg.kind == 1) {
                protectedSpans.add(TextRange(pStart, sb.length))
            }
        }
        cursor = seg.end
    }
    if (cursor < s.length) {
        appendRawProseWithoutMasks(s.substring(cursor), sb)
    }

    val assembled = sb.toString()
    val substituted = if (format == SourceFormat.LATEX) {
        applyLatexSubstitutionsWithProtected(
            assembled,
            LatexSubstitutionsOptions(
                userMacros = effectiveUserMacros,
                customCiteMacros = effectiveCustomCiteMacros,
            ),
            protectedSpans,
            collectMap = false,
        ).text
    } else {
        assembled
    }

    return collapseAndTrimAsciiSpace(normLower(substituted))
}

fun sentenceHash(s: String, options: NormSentenceOptions? = null): String =
    sha256hex(normSentence(s, options))
