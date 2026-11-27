package app.toulmin.core

private val GREEK_LOWER: Map<String, String> = mapOf(
    "alpha" to "\u03B1",
    "beta" to "\u03B2",
    "gamma" to "\u03B3",
    "delta" to "\u03B4",
    "epsilon" to "\u03B5",
    "varepsilon" to "\u03B5",
    "zeta" to "\u03B6",
    "eta" to "\u03B7",
    "theta" to "\u03B8",
    "vartheta" to "\u03B8",
    "iota" to "\u03B9",
    "kappa" to "\u03BA",
    "lambda" to "\u03BB",
    "mu" to "\u03BC",
    "nu" to "\u03BD",
    "xi" to "\u03BE",
    "omicron" to "\u03BF",
    "pi" to "\u03C0",
    "varpi" to "\u03C0",
    "rho" to "\u03C1",
    "varrho" to "\u03C1",
    "sigma" to "\u03C3",
    "varsigma" to "\u03C2",
    "tau" to "\u03C4",
    "upsilon" to "\u03C5",
    "phi" to "\u03C6",
    "varphi" to "\u03C6",
    "chi" to "\u03C7",
    "psi" to "\u03C8",
    "omega" to "\u03C9",
)

private val GREEK_UPPER: Map<String, String> = mapOf(
    "Alpha" to "\u0391",
    "Beta" to "\u0392",
    "Gamma" to "\u0393",
    "Delta" to "\u0394",
    "Epsilon" to "\u0395",
    "Zeta" to "\u0396",
    "Eta" to "\u0397",
    "Theta" to "\u0398",
    "Iota" to "\u0399",
    "Kappa" to "\u039A",
    "Lambda" to "\u039B",
    "Mu" to "\u039C",
    "Nu" to "\u039D",
    "Xi" to "\u039E",
    "Omicron" to "\u039F",
    "Pi" to "\u03A0",
    "Rho" to "\u03A1",
    "Sigma" to "\u03A3",
    "Tau" to "\u03A4",
    "Upsilon" to "\u03A5",
    "Phi" to "\u03A6",
    "Chi" to "\u03A7",
    "Psi" to "\u03A8",
    "Omega" to "\u03A9",
)

private val MATH_OPERATORS: Map<String, String> = mapOf(
    "pm" to "\u00B1",
    "times" to "\u00D7",
    "cdot" to "\u00D7",
    "le" to "\u2264",
    "leq" to "\u2264",
    "leqslant" to "\u2264",
    "ge" to "\u2265",
    "geq" to "\u2265",
    "geqslant" to "\u2265",
    "neq" to "\u2260",
    "approx" to "\u2248",
    "sim" to "\u2248",
)

private val OUTER_MATH_ENVS: Set<String> = setOf(
    "equation", "equation*",
    "align", "align*",
    "gather", "gather*",
    "multline", "multline*",
    "eqnarray", "eqnarray*",
    "math", "math*",
    "displaymath", "displaymath*",
)

fun collapseAndTrimAsciiSpace(input: String): String {
    val n = input.length
    var start = 0
    while (start < n && isSpace(input[start].code)) {
        start++
    }
    var end = n
    while (end > start && isSpace(input[end - 1].code)) {
        end--
    }
    if (start >= end) {
        return ""
    }
    val sb = StringBuilder(end - start)
    var runStart = start
    var i = start
    while (i < end) {
        if (isSpace(input[i].code)) {
            if (i > runStart) {
                sb.append(input, runStart, i)
            }
            sb.append(' ')
            i++
            while (i < end && isSpace(input[i].code)) {
                i++
            }
            runStart = i
        } else {
            i++
        }
    }
    if (end > runStart) {
        sb.append(input, runStart, end)
    }
    return sb.toString()
}

fun buildBraceCloseMap(input: String): IntArray {
    val n = input.length
    val closeMap = IntArray(n) { -1 }
    val stack = IntBuf(16)
    var i = 0
    while (i < n) {
        val code = input[i].code
        if (code == 92) {
            i += 2
            continue
        }
        if (code == 123) {
            stack.add(i)
        } else if (code == 125) {
            if (stack.size > 0) {
                closeMap[stack.popLast()] = i
            }
        }
        i++
    }
    return closeMap
}

private data class MathDelimsResult(
    val inner: String,
    val startOffset: Int,
    val endOffset: Int,
)

private fun stripOuterMathDelimiters(region: String): MathDelimsResult {
    val n = region.length
    var left = 0
    var right = n
    while (left < right && isSpace(region[left].code)) {
        left++
    }
    while (right > left && isSpace(region[right - 1].code)) {
        right--
    }
    val len = right - left

    if (len >= 4 && region.startsWith("$$", left) && region.regionMatches(right - 2, "$$", 0, 2)) {
        return MathDelimsResult(region.substring(left + 2, right - 2), left + 2, right - 2)
    }
    if (len >= 4 && region.startsWith("\\[", left) && region.regionMatches(right - 2, "\\]", 0, 2)) {
        return MathDelimsResult(region.substring(left + 2, right - 2), left + 2, right - 2)
    }
    if (len >= 4 && region.startsWith("\\(", left) && region.regionMatches(right - 2, "\\)", 0, 2)) {
        return MathDelimsResult(region.substring(left + 2, right - 2), left + 2, right - 2)
    }
    if (len >= 2 && region[left].code == 36 && region[right - 1].code == 36) {
        if (!(len >= 3 && region[left + 1].code == 36) && !(len >= 3 && region[right - 2].code == 36)) {
            return MathDelimsResult(region.substring(left + 1, right - 1), left + 1, right - 1)
        }
    }
    if (len >= 13 && region.startsWith("\\begin{", left)) {
        val openBrace = left + 6
        val closeBrace = region.indexOf('}', openBrace + 1)
        if (closeBrace != -1 && closeBrace < right) {
            val envName = region.substring(openBrace + 1, closeBrace)
            val expectedEnd = "\\end{$envName}"
            if (envName in OUTER_MATH_ENVS &&
                right - expectedEnd.length >= closeBrace + 1 &&
                region.regionMatches(right - expectedEnd.length, expectedEnd, 0, expectedEnd.length)
            ) {
                return MathDelimsResult(
                    region.substring(closeBrace + 1, right - expectedEnd.length),
                    closeBrace + 1,
                    right - expectedEnd.length,
                )
            }
        }
    }
    return MathDelimsResult(region, 0, n)
}

private fun skipMathSpaces(input: String, start: Int, end: Int): Int {
    var i = start
    while (i < end && isSpace(input[i].code)) {
        i++
    }
    return i
}

private fun findMatchingBracket(
    input: String,
    braceClose: IntArray,
    openIdx: Int,
    end: Int,
): Int {
    var i = openIdx + 1
    while (i < end) {
        val code = input[i].code
        if (code == 92) {
            i += 2
            continue
        }
        if (code == 123) {
            val close = braceClose[i]
            if (close != -1 && close < end) {
                i = close + 1
                continue
            }
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

private fun convertMathSlice(
    input: String,
    braceClose: IntArray,
    start: Int,
    end: Int,
    depth: Int,
): String {
    val sb = StringBuilder(end - start)
    var i = start

    while (i < end) {
        val code = input[i].code

        if (code == 92) {
            if (i + 1 >= end) {
                i++
                continue
            }
            val nextCode = input[i + 1].code
            if (isAsciiLetter(nextCode)) {
                var nameEnd = i + 2
                while (nameEnd < end && isAsciiLetter(input[nameEnd].code)) {
                    nameEnd++
                }
                val name = input.substring(i + 1, nameEnd)

                if (name == "frac" && depth < 64) {
                    val arg1Open = skipMathSpaces(input, nameEnd, end)
                    val arg1Close = if (arg1Open < end && input[arg1Open].code == 123) braceClose[arg1Open] else -1
                    if (arg1Close != -1 && arg1Close < end) {
                        val arg2Open = skipMathSpaces(input, arg1Close + 1, end)
                        val arg2Close = if (arg2Open < end && input[arg2Open].code == 123) braceClose[arg2Open] else -1
                        if (arg2Close != -1 && arg2Close < end) {
                            val num = collapseAndTrimAsciiSpace(
                                convertMathSlice(input, braceClose, arg1Open + 1, arg1Close, depth + 1),
                            )
                            val den = collapseAndTrimAsciiSpace(
                                convertMathSlice(input, braceClose, arg2Open + 1, arg2Close, depth + 1),
                            )
                            sb.append('(').append(num).append(")/(").append(den).append(')')
                            i = arg2Close + 1
                            continue
                        }
                    }
                    i = nameEnd
                    continue
                }

                if (name == "sqrt" && depth < 64) {
                    var cursor = skipMathSpaces(input, nameEnd, end)
                    if (cursor < end && input[cursor].code == 91) {
                        val bracketClose = findMatchingBracket(input, braceClose, cursor, end)
                        if (bracketClose != -1) {
                            cursor = skipMathSpaces(input, bracketClose + 1, end)
                        }
                    }
                    val argClose = if (cursor < end && input[cursor].code == 123) braceClose[cursor] else -1
                    if (argClose != -1 && argClose < end) {
                        val radicand = collapseAndTrimAsciiSpace(
                            convertMathSlice(input, braceClose, cursor + 1, argClose, depth + 1),
                        )
                        sb.append("sqrt(").append(radicand).append(')')
                        i = argClose + 1
                        continue
                    }
                    i = nameEnd
                    continue
                }

                val greekLower = GREEK_LOWER[name]
                if (greekLower != null) {
                    sb.append(greekLower)
                    i = nameEnd
                    continue
                }
                val greekUpper = GREEK_UPPER[name]
                if (greekUpper != null) {
                    sb.append(greekUpper)
                    i = nameEnd
                    continue
                }
                val op = MATH_OPERATORS[name]
                if (op != null) {
                    sb.append(op)
                    i = nameEnd
                    continue
                }

                i = nameEnd
                continue
            }

            if (nextCode == 37) {
                sb.append('%')
            }
            i += 2
            continue
        }

        if ((code == 94 || code == 95) && i + 1 < end && input[i + 1].code == 123) {
            val openIdx = i + 1
            val closeIdx = braceClose[openIdx]
            if (closeIdx != -1 && closeIdx < end && depth < 64) {
                val scriptChar = if (code == 94) '^' else '_'
                val inner = collapseAndTrimAsciiSpace(
                    convertMathSlice(input, braceClose, openIdx + 1, closeIdx, depth + 1),
                )
                sb.append(scriptChar).append(inner)
                i = closeIdx + 1
                continue
            }
        }

        if (code == 123 || code == 125) {
            i++
            continue
        }

        if (isSpace(code)) {
            sb.append(' ')
            i++
            continue
        }

        var plainEnd = i + 1
        while (plainEnd < end) {
            val next = input[plainEnd].code
            if (next == 92 || next == 123 || next == 125 || next == 94 || next == 95 || isSpace(next)) {
                break
            }
            plainEnd++
        }
        sb.append(input, i, plainEnd)
        i = plainEnd
    }

    return sb.toString()
}

fun mathText(region: String): String {
    val stripped = stripOuterMathDelimiters(region)
    val braceClose = buildBraceCloseMap(stripped.inner)
    val raw = convertMathSlice(stripped.inner, braceClose, 0, stripped.inner.length, 0)
    return collapseAndTrimAsciiSpace(raw)
}
