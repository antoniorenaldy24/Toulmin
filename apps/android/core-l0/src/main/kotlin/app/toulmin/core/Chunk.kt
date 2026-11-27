package app.toulmin.core

import kotlin.math.abs

const val NEIGHBOUR_EXTENSION_MAX_WORDS = 12
const val WINDOW_SHAPING_MAX_WORDS = 60
const val PDF_HIDDEN_FONT_HEIGHT_MIN = 2.0
const val PDF_HEADING_MAX_WORDS = 8
const val PDF_REFERENCES_CUT_RATIO = 0.6
const val PDF_COLUMN_GAP_RATIO = 0.15
const val PDF_LINE_BASELINE_TOLERANCE_FACTOR = 0.5
const val PDF_SUBSUP_MAX_HEIGHT_RATIO = 0.8
const val PDF_SUBSUP_MIN_OFFSET_EM = 0.2
const val PDF_SUBSUP_MAX_OFFSET_EM = 0.6
const val PDF_WORD_GAP_FACTOR = 0.15
const val PDF_RUNNING_HF_MIN_PAGES = 3
const val PDF_RUNNING_HF_PAGE_RATIO = 0.5
const val PDF_MIN_LINE_ALPHA_CHARS = 3
const val PDF_HIDDEN_TEXT_MIN_ALPHA_WORDS = 4

data class EvidenceUnit(
    val chunkId: String,
    val sourceKind: EvidenceSourceKind,
    val section: String,
    val text: String,
    val ordinal: Int,
)

data class ShapedWindowResult(
    val text: String,
    val span: TextRange,
    val wordCount: Int,
    val matchCount: Int,
    val startWordIndex: Int,
)

data class ChunkAbstractOptions(
    val applyNeighbourExtension: Boolean = true,
)

data class PdfTextItem(
    val str: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val renderMode: Int? = null,
    val fillColor: String? = null,
)

data class PdfPageInput(
    val pageNumber: Int? = null,
    val width: Double,
    val height: Double,
    val viewBox: List<Double>? = null,
    val backgroundColor: String? = null,
    val items: List<PdfTextItem>,
)

data class ChunkPdfOptions(
    val sourceKind: EvidenceSourceKind = EvidenceSourceKind.FULLTEXT,
    val yDirection: String = "bottom-up",
    val spikeSW5Primary: Boolean = false,
    val applyNeighbourExtension: Boolean = true,
)

data class PdfHiddenItemRecord(
    val pageNumber: Int,
    val text: String,
    val reason: String,
)

data class ChunkPdfResult(
    val units: List<EvidenceUnit>,
    val hiddenTextPages: List<Int>,
    val hiddenItems: List<PdfHiddenItemRecord>,
    val pageTexts: List<String>,
)

sealed class OrderedXmlNode {
    data class Text(val text: String) : OrderedXmlNode()
    data class Element(
        val rawTag: String,
        val localTag: String,
        val children: MutableList<OrderedXmlNode>,
        val attrs: Map<String, String>?,
    ) : OrderedXmlNode()
}

data class ChunkJatsOptions(
    val sourceKind: EvidenceSourceKind = EvidenceSourceKind.FULLTEXT,
    val applyNeighbourExtension: Boolean = true,
)

data class ChunkJatsResult(
    val units: List<EvidenceUnit>,
    val doi: String?,
)

data class SelectRowCellInput(
    val header: String,
    val upperHeader: String? = null,
    val cell: String,
)

private val PDF_HEADING_KEYWORDS = hashSetOf(
    "abstract",
    "introduction",
    "background",
    "methods",
    "method",
    "materials and methods",
    "results",
    "discussion",
    "conclusion",
    "conclusions",
    "limitations",
    "references",
    "acknowledgements",
    "acknowledgments",
)

private val XML_BLOCK_TAGS = hashSetOf(
    "abstract",
    "blockquote",
    "br",
    "caption",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "list-item",
    "p",
    "sec",
    "td",
    "th",
    "title",
    "tr",
)

private val JATS_SKIP_TAGS = hashSetOf(
    "aff",
    "article-categories",
    "article-title",
    "contrib-group",
    "counts",
    "elocation-id",
    "fn-group",
    "fpage",
    "funding-group",
    "history",
    "issn",
    "issue",
    "journal-meta",
    "kwd-group",
    "lpage",
    "permissions",
    "pub-date",
    "publisher",
    "ref-list",
    "title-group",
    "volume",
)

private val NAMED_XML_ENTITIES: Map<String, String> = hashMapOf(
    "amp" to "&",
    "AMP" to "&",
    "lt" to "<",
    "LT" to "<",
    "gt" to ">",
    "GT" to ">",
    "quot" to "\"",
    "QUOT" to "\"",
    "apos" to "'",
    "nbsp" to " ",
    "NBSP" to " ",
    "ensp" to " ",
    "emsp" to " ",
    "thinsp" to "\u2009",
    "ndash" to "\u2013",
    "mdash" to "\u2014",
    "minus" to "\u2212",
    "plusmn" to "\u00B1",
    "times" to "\u00D7",
    "divide" to "\u00F7",
    "le" to "\u2264",
    "ge" to "\u2265",
    "ne" to "\u2260",
    "approx" to "\u2248",
    "asymp" to "\u2248",
    "permil" to "\u2030",
    "micro" to "\u03BC",
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
    "alpha" to "\u03B1",
    "beta" to "\u03B2",
    "gamma" to "\u03B3",
    "delta" to "\u03B4",
    "epsilon" to "\u03B5",
    "zeta" to "\u03B6",
    "eta" to "\u03B7",
    "theta" to "\u03B8",
    "iota" to "\u03B9",
    "kappa" to "\u03BA",
    "lambda" to "\u03BB",
    "mu" to "\u03BC",
    "nu" to "\u03BD",
    "xi" to "\u03BE",
    "omicron" to "\u03BF",
    "pi" to "\u03C0",
    "rho" to "\u03C1",
    "sigmaf" to "\u03C2",
    "sigma" to "\u03C3",
    "tau" to "\u03C4",
    "upsilon" to "\u03C5",
    "phi" to "\u03C6",
    "chi" to "\u03C7",
    "psi" to "\u03C8",
    "omega" to "\u03C9",
    "deg" to "\u00B0",
    "hellip" to "\u2026",
    "lsquo" to "\u2018",
    "rsquo" to "\u2019",
    "ldquo" to "\u201C",
    "rdquo" to "\u201D",
    "middot" to "\u00B7",
    "bull" to "\u2022",
    "copy" to "\u00A9",
    "COPY" to "\u00A9",
    "reg" to "\u00AE",
    "REG" to "\u00AE",
    "trade" to "\u2122",
    "TRADE" to "\u2122",
)

private val WORDLIST_EN_SET: Set<String> by lazy {
    val raw = NormTableData.loadResourceBytes("wordlist_en.txt").decodeToString()
    val set = HashSet<String>(65536)
    var start = 0
    val n = raw.length
    for (i in 0 until n) {
        val ch = raw[i].code
        if (ch == 10 || ch == 13) {
            if (i > start) {
                set.add(raw.substring(start, i))
            }
            start = i + 1
        }
    }
    if (start < n) {
        set.add(raw.substring(start, n))
    }
    set
}

fun getWordlistEnSet(): Set<String> = WORDLIST_EN_SET

fun isInWordlistEn(word: String): Boolean {
    if (word.isEmpty()) return false
    return WORDLIST_EN_SET.contains(normLower(word))
}

private fun isAsciiLetterCodeChunk(cu: Int): Boolean = (cu in 65..90) || (cu in 97..122)

private fun isAsciiTagNameChar(cu: Int): Boolean =
    isAsciiLetterCodeChunk(cu) || (cu in 48..57) || cu == 45 || cu == 95 || cu == 58 || cu == 46

private fun collapseAsciiSpacesAndTrim(text: String): String {
    val n = text.length
    val sb = StringBuilder(n)
    var inSpace = true
    var segStart = -1

    for (i in 0 until n) {
        val cu = text[i].code
        val sp = cu == 32 || cu == 9 || cu == 10 || cu == 13
        if (sp) {
            if (!inSpace) {
                if (segStart != -1) {
                    sb.append(text, segStart, i)
                    segStart = -1
                }
                sb.append(' ')
                inSpace = true
            }
        } else if (inSpace) {
            segStart = i
            inSpace = false
        }
    }
    if (!inSpace && segStart != -1) {
        sb.append(text, segStart, n)
    }
    if (sb.isNotEmpty() && sb[sb.length - 1] == ' ') {
        sb.setLength(sb.length - 1)
    }
    return sb.toString()
}

fun computeChunkId(
    refId: String,
    kind: EvidenceSourceKind,
    section: String,
    ordinal: Int,
    text: String,
): String {
    val contentHash = sha256hex(text).substring(0, 8)
    return sha256hex("$refId|${kind.wireName}|$section|$ordinal|$contentHash").substring(0, 24)
}

fun computeEvidenceVersion(chunkIds: List<String>): String {
    val items = chunkIds.map { id -> id to utf8Encode(id) }.toMutableList()
    items.sortWith { a, b ->
        val aBytes = a.second
        val bBytes = b.second
        val len = minOf(aBytes.size, bBytes.size)
        for (i in 0 until len) {
            val diff = (aBytes[i].toInt() and 0xFF) - (bBytes[i].toInt() and 0xFF)
            if (diff != 0) return@sortWith diff
        }
        aBytes.size - bBytes.size
    }
    return sha256hex(items.joinToString("|") { it.first })
}

private fun codePointToString(cp: Int): String =
    if (cp <= 0xFFFF) {
        cp.toChar().toString()
    } else {
        val v = cp - 0x10000
        val hi = (0xD800 + (v shr 10)).toChar()
        val lo = (0xDC00 + (v and 0x3FF)).toChar()
        charArrayOf(hi, lo).concatToString()
    }

fun decodeXmlEntities(text: String): String {
    if (!text.contains('&')) return text
    val sb = StringBuilder(text.length)
    val n = text.length
    var i = 0
    var segStart = 0

    while (i < n) {
        val amp = text.indexOf('&', i)
        if (amp == -1) break
        val semiLimit = minOf(n, amp + 18)
        var semi = -1
        for (j in (amp + 1) until semiLimit) {
            val cu = text[j].code
            if (cu == 59 /* ';' */) {
                semi = j
                break
            }
            if (cu == 38 || cu == 60 || isSpace(cu)) break
        }
        if (semi == -1) {
            i = amp + 1
            continue
        }
        val body = text.substring(amp + 1, semi)
        var decoded: String? = null
        if (body.isNotEmpty() && body[0].code == 35 /* '#' */) {
            var cp = -1
            if (body.length > 1 && (body[1].code == 120 || body[1].code == 88)) {
                val hexStr = body.substring(2)
                if (hexStr.isNotEmpty()) {
                    var validHex = true
                    var acc = 0
                    for (k in 0 until hexStr.length) {
                        val c = hexStr[k].code
                        val d = when {
                            c in 48..57 -> c - 48
                            c in 97..102 -> c - 97 + 10
                            c in 65..70 -> c - 65 + 10
                            else -> -1
                        }
                        if (d == -1) {
                            validHex = false
                            break
                        }
                        acc = acc * 16 + d
                    }
                    if (validHex) cp = acc
                }
            } else {
                val decStr = body.substring(1)
                if (decStr.isNotEmpty()) {
                    var validDec = true
                    var acc = 0
                    for (k in 0 until decStr.length) {
                        val c = decStr[k].code
                        if (c < 48 || c > 57) {
                            validDec = false
                            break
                        }
                        acc = acc * 10 + (c - 48)
                    }
                    if (validDec) cp = acc
                }
            }
            if (cp in 0x09..0x10FFFF && (cp < 0xD800 || cp > 0xDFFF)) {
                decoded = codePointToString(cp)
            }
        } else {
            decoded = NAMED_XML_ENTITIES[body]
        }

        if (decoded != null) {
            if (amp > segStart) sb.append(text, segStart, amp)
            sb.append(decoded)
            i = semi + 1
            segStart = i
        } else {
            i = amp + 1
        }
    }

    if (segStart == 0) return text
    if (segStart < n) sb.append(text, segStart, n)
    return sb.toString()
}

private fun stripNamespacePrefix(tagName: String): String {
    val colon = tagName.indexOf(':')
    return if (colon != -1) tagName.substring(colon + 1) else tagName
}

private fun findTagCloseOutsideQuotes(input: String, startAfterLt: Int): Int {
    val n = input.length
    var quote = 0
    for (i in startAfterLt until n) {
        val c = input[i].code
        if (quote != 0) {
            if (c == quote) quote = 0
        } else if (c == 34 || c == 39) {
            quote = c
        } else if (c == 62 /* '>' */) {
            return i
        } else if (c == 60 /* '<' */) {
            return -1
        }
    }
    return -1
}

fun stripJatsAndHtmlTags(raw: String): String {
    if (raw.isEmpty()) return ""
    val n = raw.length
    val sb = StringBuilder(n)
    var cursor = 0
    var i = 0
    var noMoreCommentClose = false
    var noMoreCdataClose = false
    var noMoreBangClose = false
    var noMorePiClose = false

    while (i < n) {
        val lt = raw.indexOf('<', i)
        if (lt == -1 || lt + 1 >= n) break
        val next = raw[lt + 1].code

        if (next == 33 /* '!' */) {
            if (raw.startsWith("<!--", lt)) {
                val closeComment = if (noMoreCommentClose) -1 else raw.indexOf("-->", lt + 4)
                if (closeComment != -1) {
                    if (lt > cursor) sb.append(raw, cursor, lt)
                    cursor = closeComment + 3
                    i = cursor
                    continue
                }
                noMoreCommentClose = true
            } else if (raw.startsWith("<![CDATA[", lt)) {
                val closeCdata = if (noMoreCdataClose) -1 else raw.indexOf("]]>", lt + 9)
                if (closeCdata != -1) {
                    if (lt > cursor) sb.append(raw, cursor, lt)
                    sb.append(raw, lt + 9, closeCdata)
                    cursor = closeCdata + 3
                    i = cursor
                    continue
                }
                noMoreCdataClose = true
            } else {
                val closeBang = if (noMoreBangClose) -1 else raw.indexOf('>', lt + 2)
                if (closeBang != -1) {
                    if (lt > cursor) sb.append(raw, cursor, lt)
                    cursor = closeBang + 1
                    i = cursor
                    continue
                }
                noMoreBangClose = true
            }
            i = lt + 1
            continue
        }

        if (next == 63 /* '?' */) {
            val closePi = if (noMorePiClose) -1 else raw.indexOf("?>", lt + 2)
            if (closePi != -1) {
                if (lt > cursor) sb.append(raw, cursor, lt)
                cursor = closePi + 2
                i = cursor
                continue
            }
            noMorePiClose = true
            i = lt + 1
            continue
        }

        val nameStart = if (next == 47 /* '/' */) lt + 2 else lt + 1
        if (nameStart >= n || !isAsciiLetterCodeChunk(raw[nameStart].code)) {
            i = lt + 1
            continue
        }
        var nameEnd = nameStart + 1
        while (nameEnd < n && isAsciiTagNameChar(raw[nameEnd].code)) {
            nameEnd++
        }
        if (nameEnd >= n ||
            (raw[nameEnd].code != 62 && raw[nameEnd].code != 47 && !isSpace(raw[nameEnd].code))
        ) {
            i = lt + 1
            continue
        }
        val closeTag = findTagCloseOutsideQuotes(raw, nameEnd)
        if (closeTag == -1) {
            i = lt + 1
            continue
        }
        if (lt > cursor) sb.append(raw, cursor, lt)
        val localName = asciiLower(stripNamespacePrefix(raw.substring(nameStart, nameEnd)))
        if (XML_BLOCK_TAGS.contains(localName)) {
            sb.append(' ')
        }
        cursor = closeTag + 1
        i = cursor
    }

    if (cursor < n) sb.append(raw, cursor, n)
    return collapseAsciiSpacesAndTrim(decodeXmlEntities(sb.toString()))
}

private fun createNoMaskPreMaskResult(normedText: String): PreMaskResult = PreMaskResult(
    format = SourceFormat.MD,
    maskedText = normedText,
    regions = emptyList(),
    blockRegions = emptyList(),
    mathRegions = emptyList(),
    proseStreams = emptyList(),
    tables = emptyList(),
    bibItems = emptyList(),
    sectionTransitions = emptyList(),
    listItemStarts = emptyList(),
    userMacros = emptyMap(),
    customCiteMacros = emptySet(),
    frontMatter = FrontMatterMetadata(),
    report = ImportQualityReport(),
)

private fun segmentPlainSectionText(text: String): List<String> {
    val normed = trimSpace(norm(text).text)
    if (normed.isEmpty()) return emptyList()
    val res = segmentDocument(
        normed,
        SourceFormat.MD,
        SegmentOptions(preMaskResult = createNoMaskPreMaskResult(normed)),
    )
    val out = ArrayList<String>(res.sentences.size)
    for (s in res.sentences) {
        val sent = trimSpace(s.rawText)
        if (sent.isNotEmpty()) out.add(sent)
    }
    return out
}

fun applyNeighbourExtension(texts: List<String>): List<String> {
    val len = texts.size
    return List(len) { i ->
        val cur = texts[i]
        if (countWords(cur) <= NEIGHBOUR_EXTENSION_MAX_WORDS) {
            val sb = StringBuilder(cur.length * 3)
            if (i > 0) sb.append(texts[i - 1]).append(' ')
            sb.append(cur)
            if (i + 1 < len) sb.append(' ').append(texts[i + 1])
            sb.toString()
        } else {
            cur
        }
    }
}

private fun isPureAsciiLetters(s: String): Boolean {
    if (s.isEmpty()) return false
    for (i in 0 until s.length) {
        if (!isAsciiLetterCodeChunk(s[i].code)) return false
    }
    return true
}

private data class SurfaceWordSpan(
    val text: String,
    val start: Int,
    val end: Int,
)

private fun extractSurfaceWordSpans(text: String): List<SurfaceWordSpan> {
    val spans = ArrayList<SurfaceWordSpan>()
    val n = text.length
    var inToken = false
    var tokenStart = 0
    var tokenHasAlnum = false
    var i = 0

    while (i < n) {
        val u = codePointAtSafe(text, i)
        val sp = !u.isUnpairedSurrogate && isSpace(u.cp)
        if (sp) {
            if (inToken) {
                if (tokenHasAlnum) {
                    spans.add(SurfaceWordSpan(text.substring(tokenStart, i), tokenStart, i))
                }
                inToken = false
                tokenHasAlnum = false
            }
        } else {
            if (!inToken) {
                inToken = true
                tokenStart = i
            }
            if (!tokenHasAlnum && !u.isUnpairedSurrogate && (isBaseLetter(u.cp) || isDigit(u.cp))) {
                tokenHasAlnum = true
            }
        }
        i += u.len
    }

    if (inToken && tokenHasAlnum) {
        spans.add(SurfaceWordSpan(text.substring(tokenStart, n), tokenStart, n))
    }
    return spans
}

private fun isRangeValueRawForWindow(valueRaw: String): Boolean {
    val lower = normLower(valueRaw)
    if (lower.contains(" to ") || lower.contains(" and ") || lower.contains(", ")) return true
    var braceDepth = 0
    for (i in 0 until lower.length) {
        val ch = lower[i].code
        if (ch == 123 && i > 0 && lower[i - 1].code == 94) {
            braceDepth++
            continue
        }
        if (braceDepth > 0) {
            if (ch == 123) braceDepth++ else if (ch == 125) braceDepth--
            continue
        }
        if (ch == 45 && i > 0) {
            val prev = lower[i - 1].code
            if (prev != 101 && prev != 94) return true
        }
    }
    return false
}

private fun emitBm25NumericTokensForWindowTuple(text: String, qt: QuantTuple): List<String> {
    val vNorm = qt.valueNorm ?: return emptyList()
    if (!vNorm.isFinite()) return emptyList()
    val suffix = if (qt.unitCanon == "%") "%" else ""
    fun fmt(v: Double): String = "#${formatCanonicalDecimal(v)}$suffix"
    val lo = qt.valueLo
    val hi = qt.valueHi
    if (lo != null && hi != null && lo.isFinite() && hi.isFinite()) {
        if (isRangeValueRawForWindow(qt.valueRaw)) {
            return listOf(fmt(lo), fmt(hi))
        }
        if (lo != hi) {
            val spanSlice = text.substring(qt.span.start, qt.span.end)
            if (spanSlice.contains("\u00B1") || spanSlice.contains("+/-")) {
                return listOf(fmt(vNorm))
            }
            return listOf(fmt(vNorm), fmt(lo), fmt(hi))
        }
    }
    return listOf(fmt(vNorm))
}

private val EMPTY_INT_MAP = IntArray(0)

private fun matchesQueryWordToken(wordText: String, queryTerms: Set<String>): Boolean {
    val n = wordText.length
    var allAscii = true
    for (i in 0 until n) {
        if (wordText[i].code >= 0x80) {
            allAscii = false
            break
        }
    }

    if (allAscii) {
        var i = 0
        while (i < n) {
            val cu = wordText[i].code
            val isLet = (cu in 65..90) || (cu in 97..122)
            val isDig = cu in 48..57
            if (!isLet && !isDig) {
                i++
                continue
            }
            val runStart = i
            var hasLetter = isLet
            i++
            while (i < n) {
                val c = wordText[i].code
                if ((c in 65..90) || (c in 97..122)) {
                    hasLetter = true
                    i++
                } else if (c in 48..57) {
                    i++
                } else {
                    break
                }
            }
            if (hasLetter) {
                val tokLower = asciiLower(wordText.substring(runStart, i))
                if (!BM25_STOPWORDS.contains(tokLower) && queryTerms.contains(porterStem(tokLower))) {
                    return true
                }
            }
        }
        return false
    }

    val lower = normLower(wordText)
    val ln = lower.length
    var i = 0
    while (i < ln) {
        val unit = codePointAtSafe(lower, i)
        if (unit.isUnpairedSurrogate) {
            i++
            continue
        }
        val startLet = isLetter(unit.cp, false)
        if (!startLet && !isDigit(unit.cp)) {
            i += unit.len
            continue
        }
        val runStart = i
        var hasLetter = startLet
        var prevIsLetter = startLet
        i += unit.len
        while (i < ln) {
            val next = codePointAtSafe(lower, i)
            if (next.isUnpairedSurrogate) break
            val nextLet = isLetter(next.cp, prevIsLetter)
            if (nextLet || isDigit(next.cp)) {
                if (nextLet) hasLetter = true
                prevIsLetter = nextLet
                i += next.len
            } else {
                break
            }
        }
        if (hasLetter) {
            val tok = lower.substring(runStart, i)
            if (!BM25_STOPWORDS.contains(tok) && queryTerms.contains(porterStem(tok))) {
                return true
            }
        }
    }
    return false
}

private fun matchAsciiWordToken(wordText: String, queryTerms: Set<String>): Boolean {
    if (isPureAsciiLetters(wordText)) {
        val lower = asciiLower(wordText)
        return !BM25_STOPWORDS.contains(lower) && queryTerms.contains(porterStem(lower))
    }
    return matchesQueryWordToken(wordText, queryTerms)
}

private fun tryStripSimpleLeadingAsciiNumber(wordText: String): String? {
    val n = wordText.length
    if (n < 2) return null
    val c0 = wordText[0].code
    if (c0 < 48 || c0 > 57) return null
    for (i in 1 until n) {
        if (wordText[i].code >= 0x80) return null
    }
    val num = parseFiniteNumberAt(wordText, wordText, EMPTY_INT_MAP, 0, true, true)
    if (num == null || num.endNorm <= 0 || num.endNorm >= n) return null
    val tailStart = num.endNorm
    val cAfter = wordText[tailStart].code
    val isAlpha = (cAfter in 65..90) || (cAfter in 97..122)
    if (!isAlpha) return null
    if (cAfter == 101 || cAfter == 69 || cAfter == 120 || cAfter == 88) return null
    for (i in tailStart until n) {
        val ch = wordText[i].code
        if ((ch in 48..57) || ch == 36 || ch == 96 || ch == 92 || ch == 37) {
            return null
        }
    }
    if (wordText.contains("<!--") || wordText.contains("---")) return null
    if (num.isYearIntCandidate) {
        val lowerWord = asciiLower(wordText)
        val suf = scanSuffixUnitFast(wordText, lowerWord, tailStart, false, true) ?: return null
        @Suppress("UNUSED_VARIABLE") val _ignore = suf
    }
    return wordText.substring(tailStart)
}

private data class SurfaceTokenClass(
    val hasPotentialLetter: Boolean,
    val needsBm25Fallback: Boolean,
)

private fun classifySurfaceWordToken(wordText: String): SurfaceTokenClass {
    val n = wordText.length
    var hasPotentialLetter = false
    var hasBoundaryNumTrigger = false
    var dollarCount = 0
    var backtickCount = 0
    var hasBackslash = false
    var hasPct = false
    var prevIsAsciiAlnum = false

    var i = 0
    while (i < n) {
        val cu = wordText[i].code
        if (cu < 0x80) {
            if ((cu in 65..90) || (cu in 97..122)) {
                hasPotentialLetter = true
                prevIsAsciiAlnum = true
            } else if (cu in 48..57) {
                if (!prevIsAsciiAlnum) hasBoundaryNumTrigger = true
                prevIsAsciiAlnum = true
            } else {
                prevIsAsciiAlnum = false
                when (cu) {
                    36 -> dollarCount++
                    96 -> backtickCount++
                    92 -> hasBackslash = true
                    37 -> hasPct = true
                }
            }
            i++
            continue
        }

        val u = codePointAtSafe(wordText, i)
        val cp = u.cp
        if (!u.isUnpairedSurrogate) {
            if (isDigit(cp) ||
                cp == 0x00B2 ||
                cp == 0x00B3 ||
                cp == 0x00B9 ||
                (cp in 0x2070..0x2079) ||
                (cp in 0xFF10..0xFF19) ||
                (cp in 0xE000..0xF8FF)
            ) {
                hasBoundaryNumTrigger = true
            }
            if (isBaseLetter(cp) || (cp in 0xE000..0xF8FF) || (cp in 0x24B6..0x24E9)) {
                hasPotentialLetter = true
            }
            if (cp == 0x27E6) {
                return SurfaceTokenClass(true, true)
            }
        }
        prevIsAsciiAlnum = false
        i += u.len
    }

    if (!hasPotentialLetter) return SurfaceTokenClass(false, false)

    val hasMaskTrigger = dollarCount >= 2 ||
        backtickCount >= 2 ||
        hasPct ||
        (hasBackslash &&
            (wordText.contains("\\(") ||
                wordText.contains("\\[") ||
                wordText.contains("\\begin{") ||
                wordText.contains("\\section") ||
                wordText.contains("\\documentclass") ||
                wordText.contains("\\footnote"))) ||
        wordText.contains("<!--") ||
        wordText.contains("---")

    return SurfaceTokenClass(true, hasBoundaryNumTrigger || hasMaskTrigger)
}

fun shapeEvidenceWindow(text: String, queryTermsInput: Set<String>): ShapedWindowResult {
    val wordSpans = extractSurfaceWordSpans(text)
    val wordCount = wordSpans.size
    if (wordCount <= WINDOW_SHAPING_MAX_WORDS) {
        return ShapedWindowResult(
            text = text,
            span = TextRange(0, text.length),
            wordCount = wordCount,
            matchCount = 0,
            startWordIndex = 0,
        )
    }

    val numWindows = wordCount - WINDOW_SHAPING_MAX_WORDS + 1
    val windowDeltas = IntArray(numWindows + 1)

    fun addWindowMatchSpan(wStart: Int, wEnd: Int, weight: Int) {
        if (weight <= 0 || wStart > wEnd) return
        if (wEnd - wStart >= WINDOW_SHAPING_MAX_WORDS) return
        val enterL = maxOf(0, wEnd - WINDOW_SHAPING_MAX_WORDS + 1)
        val exitL = wStart + 1
        if (enterL < numWindows) {
            windowDeltas[enterL] += weight
            if (exitL < numWindows) {
                windowDeltas[exitL] -= weight
            }
        }
    }

    if (queryTermsInput.isNotEmpty()) {
        var hasNumericQueryTerm = false
        for (term in queryTermsInput) {
            if (term.isNotEmpty() && term[0].code == 35 /* '#' */) {
                hasNumericQueryTerm = true
                break
            }
        }

        val numericWordCovered = ByteArray(wordCount)

        if (hasNumericQueryTerm) {
            val quants = extractQuantities(
                text,
                ExtractQuantitiesOptions(applyLatex = false, citationSpans = emptyList()),
            )
            var wCursor = 0
            for (q in quants.indices) {
                val qt = quants[q]
                val numTokens = emitBm25NumericTokensForWindowTuple(text, qt)
                if (numTokens.isEmpty()) continue
                var matchedUniqueTokens = 0
                val seenQtTokens = HashSet<String>()
                for (t in numTokens.indices) {
                    val tok = numTokens[t]
                    if (queryTermsInput.contains(tok) && seenQtTokens.add(tok)) {
                        matchedUniqueTokens++
                    }
                }
                if (matchedUniqueTokens == 0) continue

                var valueStart = qt.span.start
                var valueEnd = qt.span.end
                if (qt.unitCanon != "%" && qt.valueRaw.isNotEmpty()) {
                    val rawPos = text.indexOf(qt.valueRaw, qt.span.start)
                    if (rawPos != -1 && rawPos + qt.valueRaw.length <= qt.span.end) {
                        valueStart = rawPos
                        valueEnd = rawPos + qt.valueRaw.length
                    }
                }

                while (wCursor > 0 && wordSpans[wCursor - 1].end > valueStart) {
                    wCursor--
                }
                while (wCursor < wordCount && wordSpans[wCursor].end <= valueStart) {
                    wCursor++
                }
                val wStart = wCursor
                var k = wStart
                while (k < wordCount && wordSpans[k].start < valueEnd) {
                    k++
                }
                val wEnd = k - 1
                if (wEnd < wStart) continue

                var alreadyCovered = false
                for (idx in wStart..wEnd) {
                    if (numericWordCovered[idx].toInt() == 1) {
                        alreadyCovered = true
                        break
                    }
                }
                if (alreadyCovered) continue

                for (idx in wStart..wEnd) {
                    numericWordCovered[idx] = 1
                }
                addWindowMatchSpan(wStart, wEnd, 1)
            }
        }

        val bm25FallbackCache = HashMap<String, Boolean>()
        for (i in 0 until wordCount) {
            if (numericWordCovered[i].toInt() == 1) continue
            val ws = wordSpans[i]
            var wordHit = false
            if (isPureAsciiLetters(ws.text)) {
                val lower = asciiLower(ws.text)
                if (!BM25_STOPWORDS.contains(lower) && queryTermsInput.contains(porterStem(lower))) {
                    wordHit = true
                }
            } else {
                val cls = classifySurfaceWordToken(ws.text)
                if (cls.hasPotentialLetter) {
                    if (cls.needsBm25Fallback) {
                        val strippedTail = tryStripSimpleLeadingAsciiNumber(ws.text)
                        if (strippedTail != null) {
                            wordHit = matchAsciiWordToken(strippedTail, queryTermsInput)
                        } else {
                            val cached = bm25FallbackCache[ws.text]
                            if (cached != null) {
                                wordHit = cached
                            } else {
                                val toks = tokBM25(ws.text, TokBM25Options(deleteCitations = false, applyLatex = false))
                                for (t in toks.indices) {
                                    if (queryTermsInput.contains(toks[t])) {
                                        wordHit = true
                                        break
                                    }
                                }
                                bm25FallbackCache[ws.text] = wordHit
                            }
                        }
                    } else {
                        wordHit = matchesQueryWordToken(ws.text, queryTermsInput)
                    }
                }
            }
            if (wordHit) addWindowMatchSpan(i, i, 1)
        }
    }

    var runningSum = 0
    var bestSum = -1
    var bestStart = 0

    for (startIdx in 0 until numWindows) {
        runningSum += windowDeltas[startIdx]
        if (runningSum > bestSum) {
            bestSum = runningSum
            bestStart = startIdx
        }
    }

    val finalBestSum = maxOf(0, bestSum)
    val startOffset = wordSpans[bestStart].start
    val endOffset = wordSpans[bestStart + WINDOW_SHAPING_MAX_WORDS - 1].end
    return ShapedWindowResult(
        text = text.substring(startOffset, endOffset),
        span = TextRange(startOffset, endOffset),
        wordCount = WINDOW_SHAPING_MAX_WORDS,
        matchCount = finalBestSum,
        startWordIndex = bestStart,
    )
}

fun shapeEvidenceWindow(text: String, query: Bm25Query): ShapedWindowResult =
    shapeEvidenceWindow(text, HashSet(query.terms))

fun shapeEvidenceWindow(text: String, queryTerms: List<String>): ShapedWindowResult =
    shapeEvidenceWindow(text, HashSet(queryTerms))

fun shapeEvidenceWindow(text: String, query: String): ShapedWindowResult =
    shapeEvidenceWindow(text, HashSet(tokBM25(query)))

private fun buildEvidenceUnits(
    refId: String,
    sourceKind: EvidenceSourceKind,
    section: String,
    rawSentences: List<String>,
    startOrdinal: Int,
    enableNeighbourExtension: Boolean,
): List<EvidenceUnit> {
    if (rawSentences.isEmpty()) return emptyList()
    val shaped = if (enableNeighbourExtension) applyNeighbourExtension(rawSentences) else rawSentences
    return List(shaped.size) { i ->
        val ordinal = startOrdinal + i
        val text = shaped[i]
        EvidenceUnit(
            chunkId = computeChunkId(refId, sourceKind, section, ordinal, text),
            sourceKind = sourceKind,
            section = section,
            text = text,
            ordinal = ordinal,
        )
    }
}

fun chunkAbstract(
    refId: String,
    rawAbstract: String,
    options: ChunkAbstractOptions? = null,
): List<EvidenceUnit> {
    val stripped = stripJatsAndHtmlTags(rawAbstract)
    if (stripped.isEmpty()) return emptyList()
    val sentences = segmentPlainSectionText(stripped)
    return buildEvidenceUnits(
        refId = refId,
        sourceKind = EvidenceSourceKind.ABSTRACT,
        section = "abstract",
        rawSentences = sentences,
        startOrdinal = 0,
        enableNeighbourExtension = options?.applyNeighbourExtension != false,
    )
}

// ───────────────────────── PDF Line Reconstruction & Chunking ─────────────────────────

private fun normalizeColorString(raw: String): String {
    val trimmed = asciiLower(trimSpace(raw))
    if (trimmed == "white") return "#ffffff"
    if (trimmed == "black") return "#000000"
    if (trimmed.length == 4 && trimmed[0].code == 35 /* '#' */) {
        val r = trimmed[1]
        val g = trimmed[2]
        val b = trimmed[3]
        return "#$r$r$g$g$b$b"
    }
    if (trimmed.startsWith("rgb(") && trimmed.endsWith(")")) {
        val inner = trimmed.substring(4, trimmed.length - 1)
        val comps = inner.split(',')
        if (comps.size == 3) {
            val sb = StringBuilder(7).append('#')
            for (i in 0 until 3) {
                val valInt = trimSpace(comps[i]).toIntOrNull()
                if (valInt == null || valInt < 0 || valInt > 255) return trimmed
                val h = valInt.toString(16)
                if (h.length == 1) sb.append('0')
                sb.append(h)
            }
            return sb.toString()
        }
    }
    return trimmed
}

private fun isDisjointFromViewBox(item: PdfTextItem, viewBox: List<Double>): Boolean {
    val minX = viewBox[0]
    val minY = viewBox[1]
    val maxX = viewBox[2]
    val maxY = viewBox[3]
    val itemMaxX = item.x + maxOf(0.0, item.width)
    val itemMaxY = item.y + maxOf(0.0, item.height)
    if (item.width <= 0.0) {
        if (item.x < minX || item.x > maxX) return true
    } else if (itemMaxX <= minX || item.x >= maxX) {
        return true
    }
    if (item.height <= 0.0) {
        if (item.y < minY || item.y > maxY) return true
    } else if (itemMaxY <= minY || item.y >= maxY) {
        return true
    }
    return false
}

private fun countAlphabeticChars(text: String): Int {
    var count = 0
    var i = 0
    while (i < text.length) {
        val u = codePointAtSafe(text, i)
        if (!u.isUnpairedSurrogate && isBaseLetter(u.cp)) count++
        i += u.len
    }
    return count
}

private fun countAlphabeticWords(text: String): Int {
    val spans = extractWordSpans(text)
    var count = 0
    for (i in spans.indices) {
        if (countAlphabeticChars(spans[i].text) > 0) count++
    }
    return count
}

private fun medianOfSortedNumbers(sorted: List<Double>): Double {
    if (sorted.isEmpty()) return 0.0
    val mid = sorted.size shr 1
    return if ((sorted.size and 1) == 1) {
        sorted[mid]
    } else {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    }
}

private fun medianOfNumbers(values: List<Double>): Double {
    if (values.isEmpty()) return 0.0
    return medianOfSortedNumbers(values.sorted())
}

private data class PdfPreparedLine(
    val text: String,
    val fontHeight: Double,
    val y: Double,
)

private data class PdfLineItemPiece(
    val item: PdfTextItem,
    val prefix: String,
)

private class PdfLineCluster(
    val baseItems: MutableList<PdfTextItem>,
    val subSupItems: MutableList<PdfLineItemPiece>,
    var baselineY: Double,
    var anchorHeight: Double,
    var medianFontHeight: Double,
)

private fun renderPdfLineCluster(cluster: PdfLineCluster): PdfPreparedLine {
    val combined = ArrayList<PdfLineItemPiece>(cluster.baseItems.size + cluster.subSupItems.size)
    for (b in cluster.baseItems) {
        combined.add(PdfLineItemPiece(b, ""))
    }
    combined.addAll(cluster.subSupItems)
    combined.sortWith { a, b ->
        when {
            a.item.x != b.item.x -> a.item.x.compareTo(b.item.x)
            else -> a.item.y.compareTo(b.item.y)
        }
    }

    val em = if (cluster.medianFontHeight > 0.0) cluster.medianFontHeight else cluster.anchorHeight
    val sb = StringBuilder()
    var prevEnd = 0.0
    var prevFontHeight = em
    var prevHadTrailingSpace = false
    var hasContent = false

    for (piece in combined) {
        val rawStr = piece.item.str
        val rawTrimmed = trimSpace(rawStr)
        if (rawTrimmed.isEmpty()) {
            if (hasContent && rawStr.isNotEmpty()) prevHadTrailingSpace = true
            continue
        }
        val hadLeadingSpace = isSpace(codePointAtSafe(rawStr, 0).cp)
        val tailIdx = if (rawStr.length >= 2 && rawStr[rawStr.length - 1].code in 0xDC00..0xDFFF) {
            rawStr.length - 2
        } else {
            rawStr.length - 1
        }
        val tailCp = codePointAtSafe(rawStr, tailIdx)
        val hadTrailingSpace = !tailCp.isUnpairedSurrogate && isSpace(tailCp.cp)
        val tokenText = if (piece.prefix.isNotEmpty()) piece.prefix + rawTrimmed else rawTrimmed
        if (hasContent) {
            val gap = piece.item.x - prevEnd
            val refHeight = if (piece.prefix.isNotEmpty()) em else maxOf(prevFontHeight, piece.item.height)
            val explicitBoundarySpace = piece.prefix.isEmpty() && (prevHadTrailingSpace || hadLeadingSpace)
            if (explicitBoundarySpace || gap > PDF_WORD_GAP_FACTOR * refHeight) {
                sb.append(' ')
            }
        }
        sb.append(tokenText)
        prevEnd = piece.item.x + maxOf(0.0, piece.item.width)
        prevFontHeight = if (piece.prefix.isNotEmpty()) em else piece.item.height
        prevHadTrailingSpace = hadTrailingSpace
        hasContent = true
    }

    return PdfPreparedLine(
        text = collapseAsciiSpacesAndTrim(sb.toString()),
        fontHeight = em,
        y = cluster.baselineY,
    )
}

private fun reconstructLinesInPartition(
    items: List<PdfTextItem>,
    yDirection: String,
    pageMedianFontHeight: Double,
): List<PdfPreparedLine> {
    if (items.isEmpty()) return emptyList()

    val baseCandidates = ArrayList<PdfTextItem>()
    val smallCandidates = ArrayList<PdfTextItem>()
    val smallThresh = pageMedianFontHeight * PDF_SUBSUP_MAX_HEIGHT_RATIO

    for (it in items) {
        if (trimSpace(it.str).isEmpty()) continue
        if (pageMedianFontHeight > 0.0 && it.height <= smallThresh) {
            smallCandidates.add(it)
        } else {
            baseCandidates.add(it)
        }
    }

    val compareY = Comparator<PdfTextItem> { a, b ->
        if (a.y != b.y) {
            if (yDirection == "bottom-up") b.y.compareTo(a.y) else a.y.compareTo(b.y)
        } else {
            a.x.compareTo(b.x)
        }
    }

    val primaryPool = if (baseCandidates.isNotEmpty()) baseCandidates else smallCandidates
    val sortedPrimary = primaryPool.sortedWith(compareY)
    val clusters = ArrayList<PdfLineCluster>()

    for (it in sortedPrimary) {
        var bestIdx = -1
        var bestDist = Double.POSITIVE_INFINITY
        for (c in clusters.indices) {
            val cl = clusters[c]
            val refHeight = if (it.height > 0.0 && cl.anchorHeight > 0.0) {
                minOf(it.height, cl.anchorHeight)
            } else {
                maxOf(it.height, cl.anchorHeight)
            }
            val tol = PDF_LINE_BASELINE_TOLERANCE_FACTOR * refHeight
            val dist = abs(it.y - cl.baselineY)
            if (dist <= tol && dist < bestDist) {
                bestDist = dist
                bestIdx = c
            }
        }
        if (bestIdx == -1) {
            clusters.add(PdfLineCluster(mutableListOf(it), mutableListOf(), it.y, it.height, it.height))
        } else {
            val cl = clusters[bestIdx]
            cl.baseItems.add(it)
            cl.baselineY = medianOfNumbers(cl.baseItems.map { b -> b.y })
            cl.medianFontHeight = medianOfNumbers(cl.baseItems.map { b -> b.height })
            cl.anchorHeight = cl.medianFontHeight
        }
    }

    if (baseCandidates.isNotEmpty() && smallCandidates.isNotEmpty()) {
        val leftoverSmall = ArrayList<PdfTextItem>()
        for (it in smallCandidates) {
            var bestClusterIdx = -1
            var bestDist = Double.POSITIVE_INFINITY
            var bestKind = ""

            for (c in clusters.indices) {
                val cl = clusters[c]
                val em = cl.medianFontHeight
                if (em <= 0.0 || it.height > em * PDF_SUBSUP_MAX_HEIGHT_RATIO) continue
                val rawOffset = it.y - cl.baselineY
                val absOffset = abs(rawOffset)
                val minOff = PDF_SUBSUP_MIN_OFFSET_EM * em
                val maxOff = PDF_SUBSUP_MAX_OFFSET_EM * em
                if (absOffset in minOff..maxOff) {
                    val isSuper = if (yDirection == "bottom-up") rawOffset > 0.0 else rawOffset < 0.0
                    val kind = if (isSuper) "^" else "_"
                    if (absOffset < bestDist) {
                        bestDist = absOffset
                        bestClusterIdx = c
                        bestKind = kind
                    }
                }
            }

            if (bestClusterIdx != -1 && bestKind.isNotEmpty()) {
                clusters[bestClusterIdx].subSupItems.add(PdfLineItemPiece(it, bestKind))
            } else {
                leftoverSmall.add(it)
            }
        }

        if (leftoverSmall.isNotEmpty()) {
            leftoverSmall.sortWith(compareY)
            for (it in leftoverSmall) {
                var placed = false
                for (cl in clusters) {
                    val tol = PDF_LINE_BASELINE_TOLERANCE_FACTOR * it.height
                    if (abs(it.y - cl.baselineY) <= tol) {
                        cl.baseItems.add(it)
                        placed = true
                        break
                    }
                }
                if (!placed) {
                    clusters.add(PdfLineCluster(mutableListOf(it), mutableListOf(), it.y, it.height, it.height))
                }
            }
        }
    }

    clusters.sortWith { a, b ->
        if (yDirection == "bottom-up") b.baselineY.compareTo(a.baselineY) else a.baselineY.compareTo(b.baselineY)
    }

    val lines = ArrayList<PdfPreparedLine>(clusters.size)
    for (cl in clusters) {
        val rendered = renderPdfLineCluster(cl)
        if (rendered.text.isNotEmpty()) lines.add(rendered)
    }
    return lines
}

private fun detectBimodalColumnSplitX(items: List<PdfTextItem>, pageWidth: Double): Double? {
    if (pageWidth <= 0.0 || items.size < 4) return null
    val centers = ArrayList<Double>()
    for (it in items) {
        if (trimSpace(it.str).isEmpty()) continue
        if (it.width <= 0.6 * pageWidth) {
            centers.add(it.x + it.width / 2.0)
        }
    }
    if (centers.size < 4) return null
    centers.sort()

    var maxGap = 0.0
    var splitIdx = -1
    for (i in 0 until centers.size - 1) {
        val gap = centers[i + 1] - centers[i]
        if (gap > maxGap) {
            maxGap = gap
            splitIdx = i
        }
    }

    if (splitIdx == -1 || maxGap <= PDF_COLUMN_GAP_RATIO * pageWidth) return null
    val leftCount = splitIdx + 1
    val rightCount = centers.size - leftCount
    val minCluster = maxOf(2, (centers.size * 0.15).toInt())
    if (leftCount < minCluster || rightCount < minCluster) return null

    return (centers[splitIdx] + centers[splitIdx + 1]) / 2.0
}

private fun reconstructPageLines(
    items: List<PdfTextItem>,
    pageWidth: Double,
    yDirection: String,
    pageMedianFontHeight: Double,
): List<PdfPreparedLine> {
    val splitX = detectBimodalColumnSplitX(items, pageWidth)
        ?: return reconstructLinesInPartition(items, yDirection, pageMedianFontHeight)

    val leftItems = ArrayList<PdfTextItem>()
    val rightItems = ArrayList<PdfTextItem>()
    val spanningItems = ArrayList<PdfTextItem>()
    val spanMinWidth = 0.35 * pageWidth

    for (it in items) {
        if (it.width > spanMinWidth && it.x < splitX && it.x + it.width > splitX) {
            spanningItems.add(it)
            continue
        }
        val center = it.x + it.width / 2.0
        if (center < splitX) leftItems.add(it) else rightItems.add(it)
    }

    val leftLines = reconstructLinesInPartition(leftItems, yDirection, pageMedianFontHeight)
    val rightLines = reconstructLinesInPartition(rightItems, yDirection, pageMedianFontHeight)
    if (spanningItems.isEmpty()) return leftLines + rightLines

    val spanningLines = reconstructLinesInPartition(spanningItems, yDirection, pageMedianFontHeight)
    var colBoundaryY: Double? = null
    for (l in leftLines) {
        colBoundaryY = if (colBoundaryY == null) l.y else if (yDirection == "bottom-up") maxOf(colBoundaryY, l.y) else minOf(colBoundaryY, l.y)
    }
    for (l in rightLines) {
        colBoundaryY = if (colBoundaryY == null) l.y else if (yDirection == "bottom-up") maxOf(colBoundaryY, l.y) else minOf(colBoundaryY, l.y)
    }

    val topSpanning = ArrayList<PdfPreparedLine>()
    val bottomSpanning = ArrayList<PdfPreparedLine>()
    for (sl in spanningLines) {
        val isTop = colBoundaryY == null || (if (yDirection == "bottom-up") sl.y > colBoundaryY else sl.y < colBoundaryY)
        if (isTop) topSpanning.add(sl) else bottomSpanning.add(sl)
    }
    return topSpanning + leftLines + rightLines + bottomSpanning
}

private data class HyphenPrefix(val prefixStart: Int, val leftWord: String)

private fun extractTrailingHyphenPrefix(line: String): HyphenPrefix? {
    if (!line.endsWith("-") || line.length < 2) return null
    var pos = line.length - 1
    while (pos > 0) {
        val cu = line[pos - 1].code
        if (cu < 0x80) {
            if (isAsciiLetterCodeChunk(cu)) pos-- else break
        } else {
            var prevStart = pos - 1
            if (cu in 0xDC00..0xDFFF && prevStart > 0) prevStart--
            val u = codePointAtSafe(line, prevStart)
            if (!u.isUnpairedSurrogate && isBaseLetter(u.cp)) pos = prevStart else break
        }
    }
    if (pos >= line.length - 1) return null
    return HyphenPrefix(pos, line.substring(pos, line.length - 1))
}

private data class LeadingLowerWord(val rightWord: String, val rightEnd: Int)

private fun extractLeadingLowercaseWord(line: String): LeadingLowerWord? {
    if (line.isEmpty()) return null
    val first = codePointAtSafe(line, 0)
    if (first.isUnpairedSurrogate || !isLower(first.cp)) return null
    var end = first.len
    while (end < line.length) {
        val u = codePointAtSafe(line, end)
        if (!u.isUnpairedSurrogate && isBaseLetter(u.cp)) end += u.len else break
    }
    return LeadingLowerWord(line.substring(0, end), end)
}

fun dehyphenatePdfLines(lines: List<String>): String {
    val cleaned = ArrayList<String>(lines.size)
    for (line in lines) {
        val t = trimSpace(line)
        if (t.isNotEmpty()) cleaned.add(t)
    }
    if (cleaned.isEmpty()) return ""

    val acc = StringBuilder(cleaned[0])
    for (i in 1 until cleaned.size) {
        val nextLine = cleaned[i]
        val tailCheckLen = minOf(acc.length, 64)
        val tailSlice = acc.substring(acc.length - tailCheckLen)
        val leftInfo = extractTrailingHyphenPrefix(tailSlice)
        val rightInfo = if (leftInfo != null) extractLeadingLowercaseWord(nextLine) else null
        if (leftInfo != null && rightInfo != null) {
            val joined = leftInfo.leftWord + rightInfo.rightWord
            val hyphenated = "${leftInfo.leftWord}-${rightInfo.rightWord}"
            if (isInWordlistEn(joined) && !isInWordlistEn(hyphenated)) {
                acc.setLength(acc.length - 1)
                acc.append(nextLine)
            } else {
                acc.append(nextLine)
            }
        } else {
            acc.append(' ').append(nextLine)
        }
    }
    return collapseAsciiSpacesAndTrim(acc.toString())
}

private data class PdfHeadingClass(
    val isHeading: Boolean,
    val level: Int,
    val isNumberedSub: Boolean,
)

private fun classifyPdfHeading(
    line: PdfPreparedLine,
    pageMedianHeight: Double,
    isFirstHeading: Boolean,
): PdfHeadingClass {
    val words = countWords(line.text)
    if (words == 0 || words > PDF_HEADING_MAX_WORDS) {
        return PdfHeadingClass(false, 3, false)
    }
    val lowered = trimSpace(normLower(line.text))
    val stripped = trimSpace(stripLeadingSectionNumbering(lowered))
    val hasKeywordMatch = PDF_HEADING_KEYWORDS.contains(stripped)
    val isLargerFont = pageMedianHeight > 0.0 && line.fontHeight >= pageMedianHeight + 1.0

    if (!hasKeywordMatch && !isLargerFont) {
        return PdfHeadingClass(false, 3, false)
    }

    var isNumberedSub = false
    if (stripped.length < lowered.length) {
        val prefixPart = trimSpace(lowered.substring(0, lowered.length - stripped.length))
        val dotPos = prefixPart.indexOf('.')
        if (dotPos > 0 && dotPos + 1 < prefixPart.length && isDigit(prefixPart[dotPos + 1].code)) {
            isNumberedSub = true
        }
    }

    val matchesSectionRule = matchCanonicalSectionLabel(line.text, isFirstHeading) != null
    val level = if (isNumberedSub && !matchesSectionRule) 4 else 3
    return PdfHeadingClass(true, level, isNumberedSub)
}

fun chunkPdfPages(
    refId: String,
    pages: List<PdfPageInput>,
    options: ChunkPdfOptions? = null,
): ChunkPdfResult {
    val sourceKind = options?.sourceKind ?: EvidenceSourceKind.FULLTEXT
    val yDirection = options?.yDirection ?: "bottom-up"
    val enableSW5 = options?.spikeSW5Primary == true
    val enableNeighbourExtension = options?.applyNeighbourExtension != false

    val hiddenItems = ArrayList<PdfHiddenItemRecord>()
    val hiddenTextPages = ArrayList<Int>()

    data class PageLineBundle(
        val pageNumber: Int,
        val medianFontHeight: Double,
        val lines: List<PdfPreparedLine>,
    )

    val perPage = ArrayList<PageLineBundle>(pages.size)

    for (p in pages.indices) {
        val page = pages[p]
        val pageNum = page.pageNumber ?: (p + 1)
        val viewBox = page.viewBox ?: listOf(0.0, 0.0, page.width, page.height)
        val bgNorm = normalizeColorString(page.backgroundColor ?: "#ffffff")

        val visibleItems = ArrayList<PdfTextItem>(page.items.size)
        val droppedTexts = ArrayList<String>()

        for (item in page.items) {
            var dropReason: String? = null
            if (item.height < PDF_HIDDEN_FONT_HEIGHT_MIN) {
                dropReason = "FONT_TOO_SMALL"
            } else if (isDisjointFromViewBox(item, viewBox)) {
                dropReason = "OUT_OF_VIEW_BOX"
            } else if (enableSW5) {
                if (item.renderMode == 3) {
                    dropReason = "RENDER_MODE_INVISIBLE"
                } else if (item.fillColor != null && normalizeColorString(item.fillColor) == bgNorm) {
                    dropReason = "BACKGROUND_FILL"
                }
            }

            if (dropReason != null) {
                hiddenItems.add(PdfHiddenItemRecord(pageNum, item.str, dropReason))
                droppedTexts.add(item.str)
            } else if (trimSpace(item.str).isNotEmpty()) {
                visibleItems.add(item)
            }
        }

        if (droppedTexts.isNotEmpty() &&
            countAlphabeticWords(droppedTexts.joinToString(" ")) >= PDF_HIDDEN_TEXT_MIN_ALPHA_WORDS
        ) {
            hiddenTextPages.add(pageNum)
        }

        val pageHeights = visibleItems.map { it.height }.sorted()
        val medianHeight = medianOfSortedNumbers(pageHeights)
        val lines = reconstructPageLines(visibleItems, page.width, yDirection, medianHeight)
        perPage.add(PageLineBundle(pageNum, medianHeight, lines))
    }

    val linePageCounts = HashMap<String, Int>()
    if (perPage.size >= PDF_RUNNING_HF_MIN_PAGES) {
        for (bundle in perPage) {
            val seenOnPage = HashSet<String>(bundle.lines.size * 2)
            for (line in bundle.lines) {
                if (seenOnPage.add(line.text)) {
                    linePageCounts[line.text] = (linePageCounts[line.text] ?: 0) + 1
                }
            }
        }
    }

    val runningThreshold = perPage.size * PDF_RUNNING_HF_PAGE_RATIO

    data class FilteredPdfLine(
        val text: String,
        val fontHeight: Double,
        val y: Double,
        val pageMedianFontHeight: Double,
    )

    val filteredLines = ArrayList<FilteredPdfLine>()
    val pageTexts = ArrayList<String>(perPage.size)

    for (bundle in perPage) {
        val keptForPage = ArrayList<String>(bundle.lines.size)
        for (line in bundle.lines) {
            if (countAlphabeticChars(norm(line.text).text) < PDF_MIN_LINE_ALPHA_CHARS) continue
            if (perPage.size >= PDF_RUNNING_HF_MIN_PAGES &&
                (linePageCounts[line.text] ?: 0) >= runningThreshold
            ) {
                continue
            }
            filteredLines.add(FilteredPdfLine(line.text, line.fontHeight, line.y, bundle.medianFontHeight))
            keptForPage.add(line.text)
        }
        pageTexts.add(dehyphenatePdfLines(keptForPage))
    }

    var totalChars = 0
    for (i in filteredLines.indices) {
        totalChars += filteredLines[i].text.length + (if (i > 0) 1 else 0)
    }

    val tracker = SectionTracker()
    var seenHeading = false
    var charOffset = 0
    var inReferences = false

    data class SectionLineBucket(
        val section: CanonicalSectionLabel,
        val lines: MutableList<String>,
    )

    val buckets = ArrayList<SectionLineBucket>()

    fun appendSectionLine(section: CanonicalSectionLabel, text: String) {
        val last = buckets.lastOrNull()
        if (last != null && last.section == section) {
            last.lines.add(text)
        } else {
            buckets.add(SectionLineBucket(section, mutableListOf(text)))
        }
    }

    for (line in filteredLines) {
        val cls = classifyPdfHeading(
            PdfPreparedLine(line.text, line.fontHeight, line.y),
            line.pageMedianFontHeight,
            !seenHeading,
        )
        if (cls.isHeading) {
            seenHeading = true
            val state = tracker.pushHeading(cls.level, line.text)
            if (state.label == CanonicalSectionLabel.REFERENCES) {
                if (totalChars > 0 && charOffset >= PDF_REFERENCES_CUT_RATIO * totalChars) {
                    break
                }
                inReferences = true
                charOffset += line.text.length + 1
                continue
            }
            inReferences = false
            charOffset += line.text.length + 1
            continue
        }
        if (!inReferences) {
            appendSectionLine(tracker.current.label, line.text)
        }
        charOffset += line.text.length + 1
    }

    val units = ArrayList<EvidenceUnit>()
    val ordinalBySection = HashMap<String, Int>()

    for (bucket in buckets) {
        val prose = dehyphenatePdfLines(bucket.lines)
        if (prose.isEmpty()) continue
        val sentences = segmentPlainSectionText(prose)
        if (sentences.isEmpty()) continue
        val secWire = bucket.section.wireName
        val startOrd = ordinalBySection[secWire] ?: 0
        val sectionUnits = buildEvidenceUnits(
            refId = refId,
            sourceKind = sourceKind,
            section = secWire,
            rawSentences = sentences,
            startOrdinal = startOrd,
            enableNeighbourExtension = enableNeighbourExtension,
        )
        ordinalBySection[secWire] = startOrd + sectionUnits.size
        units.addAll(sectionUnits)
    }

    return ChunkPdfResult(
        units = units,
        hiddenTextPages = hiddenTextPages,
        hiddenItems = hiddenItems,
        pageTexts = pageTexts,
    )
}

// ───────────────────────── JATS XML Ordered Parsing & Chunking ─────────────────────────

private fun parseXmlAttributes(rawAttrPart: String): Map<String, String>? {
    val attrs = HashMap<String, String>()
    var i = 0
    val n = rawAttrPart.length
    while (i < n) {
        while (i < n && isSpace(rawAttrPart[i].code)) i++
        if (i >= n) break
        val nameStart = i
        while (i < n && isAsciiTagNameChar(rawAttrPart[i].code)) i++
        if (i == nameStart) {
            i++
            continue
        }
        val attrName = rawAttrPart.substring(nameStart, i)
        while (i < n && isSpace(rawAttrPart[i].code)) i++
        if (i < n && rawAttrPart[i].code == 61 /* '=' */) {
            i++
            while (i < n && isSpace(rawAttrPart[i].code)) i++
            val valStr: String
            if (i < n && (rawAttrPart[i].code == 34 || rawAttrPart[i].code == 39)) {
                val q = rawAttrPart[i].code
                i++
                val vStart = i
                while (i < n && rawAttrPart[i].code != q) i++
                valStr = decodeXmlEntities(rawAttrPart.substring(vStart, i))
                if (i < n) i++
            } else {
                val vStart = i
                while (i < n && !isSpace(rawAttrPart[i].code)) i++
                valStr = decodeXmlEntities(rawAttrPart.substring(vStart, i))
            }
            attrs["@_$attrName"] = valStr
        } else {
            attrs["@_$attrName"] = "true"
        }
    }
    return if (attrs.isEmpty()) null else attrs
}

fun parseXmlOrdered(xml: String): List<OrderedXmlNode> {
    val root = ArrayList<OrderedXmlNode>()
    data class XmlFrame(val tagName: String, val children: MutableList<OrderedXmlNode>)
    val stack = ArrayList<XmlFrame>()
    stack.add(XmlFrame("__root__", root))
    val openTagCounts = HashMap<String, Int>()

    val n = xml.length
    var i = 0
    var noMoreCommentClose = false
    var noMoreCdataClose = false
    var noMoreBangClose = false
    var noMorePiClose = false

    fun pushText(rawSlice: String) {
        if (rawSlice.isEmpty()) return
        val decoded = decodeXmlEntities(rawSlice)
        if (decoded.isEmpty()) return
        stack[stack.size - 1].children.add(OrderedXmlNode.Text(decoded))
    }

    while (i < n) {
        val lt = xml.indexOf('<', i)
        if (lt == -1) {
            pushText(xml.substring(i))
            break
        }
        if (lt > i) pushText(xml.substring(i, lt))
        if (lt + 1 >= n) {
            pushText("<")
            break
        }

        val next = xml[lt + 1].code
        if (next == 33 /* '!' */) {
            if (xml.startsWith("<!--", lt)) {
                val endComment = if (noMoreCommentClose) -1 else xml.indexOf("-->", lt + 4)
                if (endComment != -1) {
                    i = endComment + 3
                    continue
                }
                noMoreCommentClose = true
            } else if (xml.startsWith("<![CDATA[", lt)) {
                val endCdata = if (noMoreCdataClose) -1 else xml.indexOf("]]>", lt + 9)
                if (endCdata != -1) {
                    val cdataContent = xml.substring(lt + 9, endCdata)
                    if (cdataContent.isNotEmpty()) {
                        stack[stack.size - 1].children.add(OrderedXmlNode.Text(cdataContent))
                    }
                    i = endCdata + 3
                    continue
                }
                noMoreCdataClose = true
            } else {
                val endBang = if (noMoreBangClose) -1 else xml.indexOf('>', lt + 2)
                if (endBang != -1) {
                    i = endBang + 1
                    continue
                }
                noMoreBangClose = true
            }
            pushText("<")
            i = lt + 1
            continue
        }

        if (next == 63 /* '?' */) {
            val endPi = if (noMorePiClose) -1 else xml.indexOf("?>", lt + 2)
            if (endPi != -1) {
                i = endPi + 2
                continue
            }
            noMorePiClose = true
            pushText("<")
            i = lt + 1
            continue
        }

        val isClose = next == 47 /* '/' */
        val nameStart = if (isClose) lt + 2 else lt + 1
        if (nameStart >= n || !isAsciiLetterCodeChunk(xml[nameStart].code)) {
            pushText("<")
            i = lt + 1
            continue
        }
        var nameEnd = nameStart + 1
        while (nameEnd < n && isAsciiTagNameChar(xml[nameEnd].code)) nameEnd++
        val closeBracket = findTagCloseOutsideQuotes(xml, nameEnd)
        if (closeBracket == -1) {
            pushText("<")
            i = lt + 1
            continue
        }
        val tagName = xml.substring(nameStart, nameEnd)

        if (isClose) {
            if ((openTagCounts[tagName] ?: 0) > 0) {
                for (s in (stack.size - 1) downTo 1) {
                    val frame = stack[s]
                    val c = openTagCounts[frame.tagName] ?: 0
                    if (c > 1) openTagCounts[frame.tagName] = c - 1 else openTagCounts.remove(frame.tagName)
                    if (frame.tagName == tagName) {
                        stack.subList(s, stack.size).clear()
                        break
                    }
                }
            }
            i = closeBracket + 1
            continue
        }

        var attrEnd = closeBracket
        var isSelfClosing = false
        var checkBack = closeBracket - 1
        while (checkBack >= nameEnd && isSpace(xml[checkBack].code)) checkBack--
        if (checkBack >= nameEnd && xml[checkBack].code == 47 /* '/' */) {
            isSelfClosing = true
            attrEnd = checkBack
        }

        val attrs = if (attrEnd > nameEnd) parseXmlAttributes(xml.substring(nameEnd, attrEnd)) else null
        val childList = ArrayList<OrderedXmlNode>()
        val elemNode = OrderedXmlNode.Element(
            rawTag = tagName,
            localTag = asciiLower(stripNamespacePrefix(tagName)),
            children = childList,
            attrs = attrs,
        )
        stack[stack.size - 1].children.add(elemNode)

        if (!isSelfClosing) {
            stack.add(XmlFrame(tagName, childList))
            openTagCounts[tagName] = (openTagCounts[tagName] ?: 0) + 1
        }
        i = closeBracket + 1
    }

    return root
}

private class IndexedXmlListFrame(
    val list: List<OrderedXmlNode>,
    var idx: Int = 0,
)

private fun flattenInlineXmlNodes(nodes: List<OrderedXmlNode>): String {
    if (nodes.isEmpty()) return ""
    val sb = StringBuilder()
    val stack = ArrayList<IndexedXmlListFrame>()
    stack.add(IndexedXmlListFrame(nodes))
    while (stack.isNotEmpty()) {
        val frame = stack[stack.size - 1]
        if (frame.idx >= frame.list.size) {
            stack.removeAt(stack.size - 1)
            continue
        }
        when (val node = frame.list[frame.idx++]) {
            is OrderedXmlNode.Text -> sb.append(node.text)
            is OrderedXmlNode.Element -> {
                if (node.localTag == "break" || node.localTag == "br") {
                    sb.append(' ')
                } else if (node.localTag != "table-wrap" && node.localTag != "ref-list" && node.children.isNotEmpty()) {
                    stack.add(IndexedXmlListFrame(node.children))
                }
            }
        }
    }
    return collapseAsciiSpacesAndTrim(sb.toString())
}

private data class JatsTableCell(
    val text: String,
    val colspan: Int,
    val rowspan: Int,
)

private data class JatsTableRowData(
    val cells: List<JatsTableCell>,
    val hasTh: Boolean,
    val hasTd: Boolean,
)

private fun extractJatsTableRowCells(trChildren: List<OrderedXmlNode>): JatsTableRowData {
    val cells = ArrayList<JatsTableCell>()
    var hasTh = false
    var hasTd = false
    for (child in trChildren) {
        val elem = child as? OrderedXmlNode.Element ?: continue
        if (elem.localTag != "th" && elem.localTag != "td") continue
        if (elem.localTag == "th") hasTh = true else hasTd = true
        val csRaw = elem.attrs?.get("@_colspan")
        val rsRaw = elem.attrs?.get("@_rowspan")
        val colspan = if (csRaw != null) maxOf(1, csRaw.toIntOrNull() ?: 1) else 1
        val rowspan = if (rsRaw != null) maxOf(1, rsRaw.toIntOrNull() ?: 1) else 1
        cells.add(JatsTableCell(flattenInlineXmlNodes(elem.children), colspan, rowspan))
    }
    return JatsTableRowData(cells, hasTh, hasTd)
}

private fun expandHeaderMatrix(headerRows: List<List<JatsTableCell>>): List<String> {
    if (headerRows.isEmpty()) return emptyList()
    val grid = Array(headerRows.size) { HashMap<Int, String>() }
    var numCols = 0

    for (r in headerRows.indices) {
        val row = headerRows[r]
        var col = 0
        for (cell in row) {
            while (grid[r].containsKey(col)) col++
            for (dr in 0 until cell.rowspan) {
                if (r + dr >= headerRows.size) break
                for (dc in 0 until cell.colspan) {
                    grid[r + dr][col + dc] = cell.text
                }
            }
            col += cell.colspan
            if (col > numCols) numCols = col
        }
    }

    return List(numCols) { c ->
        val labels = ArrayList<String>()
        for (r in grid.indices) {
            val v = trimSpace(grid[r][c] ?: "")
            if (v.isNotEmpty() && (labels.isEmpty() || labels.last() != v)) {
                labels.add(v)
            }
        }
        if (labels.isNotEmpty()) labels.joinToString(" \u00B7 ") else "Column ${c + 1}"
    }
}

private fun extractJatsTableRows(tableChildren: List<OrderedXmlNode>): List<String> {
    val theadRows = ArrayList<List<JatsTableCell>>()
    val bodyRows = ArrayList<JatsTableRowData>()

    fun collectTrs(nodes: List<OrderedXmlNode>, pushRow: (JatsTableRowData) -> Unit) {
        if (nodes.isEmpty()) return
        val stack = ArrayList<IndexedXmlListFrame>()
        stack.add(IndexedXmlListFrame(nodes))
        while (stack.isNotEmpty()) {
            val frame = stack[stack.size - 1]
            if (frame.idx >= frame.list.size) {
                stack.removeAt(stack.size - 1)
                continue
            }
            val elem = frame.list[frame.idx++] as? OrderedXmlNode.Element ?: continue
            if (elem.localTag == "tr") {
                pushRow(extractJatsTableRowCells(elem.children))
            } else if (elem.children.isNotEmpty()) {
                stack.add(IndexedXmlListFrame(elem.children))
            }
        }
    }

    for (node in tableChildren) {
        val elem = node as? OrderedXmlNode.Element ?: continue
        when (elem.localTag) {
            "thead" -> collectTrs(elem.children) { row -> theadRows.add(row.cells) }
            "tbody" -> collectTrs(elem.children) { row -> bodyRows.add(row) }
            "tr" -> bodyRows.add(extractJatsTableRowCells(elem.children))
        }
    }

    if (theadRows.isEmpty()) {
        while (bodyRows.isNotEmpty() && bodyRows[0].hasTh && !bodyRows[0].hasTd) {
            theadRows.add(bodyRows.removeAt(0).cells)
        }
    }

    val headers = expandHeaderMatrix(theadRows)
    val formattedRows = ArrayList<String>()

    for (row in bodyRows) {
        val rowCells = row.cells
        if (rowCells.isEmpty()) continue
        val expandedCells = ArrayList<String>()
        for (cell in rowCells) {
            repeat(cell.colspan) { expandedCells.add(cell.text) }
        }
        val pairs = ArrayList<String>(expandedCells.size)
        for (c in expandedCells.indices) {
            val hdr = if (c < headers.size) headers[c] else "Column ${c + 1}"
            pairs.add("$hdr: ${expandedCells[c]}")
        }
        val rowText = collapseAsciiSpacesAndTrim(pairs.joinToString("; "))
        if (rowText.isNotEmpty()) formattedRows.add(rowText)
    }
    return formattedRows
}

fun chunkJatsOrderedNodes(
    refId: String,
    orderedNodes: List<OrderedXmlNode>,
    options: ChunkJatsOptions? = null,
): ChunkJatsResult {
    val sourceKind = options?.sourceKind ?: EvidenceSourceKind.FULLTEXT
    val enableNeighbourExtension = options?.applyNeighbourExtension != false

    var doi: String? = null
    var seenHeading = false
    val secStack = ArrayList<Pair<Int, CanonicalSectionLabel>>()
    fun currentSectionLabel(): CanonicalSectionLabel =
        if (secStack.isNotEmpty()) secStack.last().second else CanonicalSectionLabel.UNLABELED

    data class JatsProseBucket(
        val isProse: Boolean,
        val section: String,
        val items: MutableList<String>,
    )

    val buckets = ArrayList<JatsProseBucket>()

    fun pushProseSentence(section: String, sentence: String) {
        val last = buckets.lastOrNull()
        if (last != null && last.isProse && last.section == section) {
            last.items.add(sentence)
        } else {
            buckets.add(JatsProseBucket(true, section, mutableListOf(sentence)))
        }
    }

    fun pushTableRow(rowText: String) {
        val last = buckets.lastOrNull()
        if (last != null && !last.isProse && last.section == "table") {
            last.items.add(rowText)
        } else {
            buckets.add(JatsProseBucket(false, "table", mutableListOf(rowText)))
        }
    }

    fun emitParagraphProse(paragraphNodes: List<OrderedXmlNode>, section: String) {
        val text = flattenInlineXmlNodes(paragraphNodes)
        if (text.isEmpty()) return
        for (s in segmentPlainSectionText(text)) {
            pushProseSentence(section, s)
        }
    }

    fun walkTableWrap(wrapChildren: List<OrderedXmlNode>, enclosingSection: String) {
        for (child in wrapChildren) {
            val elem = child as? OrderedXmlNode.Element ?: continue
            if (elem.localTag == "caption") {
                for (capNode in elem.children) {
                    val capChild = capNode as? OrderedXmlNode.Element
                    if (capChild != null && (capChild.localTag == "p" || capChild.localTag == "title")) {
                        emitParagraphProse(capChild.children, enclosingSection)
                    } else if (capNode is OrderedXmlNode.Text) {
                        emitParagraphProse(listOf(capNode), enclosingSection)
                    }
                }
            } else if (elem.localTag == "table") {
                for (r in extractJatsTableRows(elem.children)) {
                    pushTableRow(r)
                }
            }
        }
    }

    class JatsWalkFrame(
        val nodes: List<OrderedXmlNode>,
        val secDepth: Int,
        val popSecOnExit: Boolean = false,
        val isParagraph: Boolean = false,
        val pSection: String = "",
        val buffered: ArrayList<OrderedXmlNode>? = null,
        var idx: Int = 0,
    )

    val walkStack = ArrayList<JatsWalkFrame>()
    walkStack.add(JatsWalkFrame(orderedNodes, secDepth = 0))

    while (walkStack.isNotEmpty()) {
        val frame = walkStack[walkStack.size - 1]
        if (frame.isParagraph) {
            val buf = frame.buffered!!
            if (frame.idx >= frame.nodes.size) {
                if (buf.isNotEmpty()) {
                    emitParagraphProse(buf, frame.pSection)
                    buf.clear()
                }
                walkStack.removeAt(walkStack.size - 1)
                continue
            }
            val child = frame.nodes[frame.idx++]
            val elem = child as? OrderedXmlNode.Element
            if (elem != null && elem.localTag == "table-wrap") {
                if (buf.isNotEmpty()) {
                    emitParagraphProse(buf, frame.pSection)
                    buf.clear()
                }
                walkTableWrap(elem.children, frame.pSection)
            } else if (elem != null && elem.localTag == "sec") {
                if (buf.isNotEmpty()) {
                    emitParagraphProse(buf, frame.pSection)
                    buf.clear()
                }
                walkStack.add(JatsWalkFrame(listOf(child), secDepth = frame.secDepth))
            } else {
                buf.add(child)
            }
            continue
        }

        if (frame.idx >= frame.nodes.size) {
            walkStack.removeAt(walkStack.size - 1)
            if (frame.popSecOnExit) {
                secStack.removeAt(secStack.size - 1)
            }
            continue
        }

        val elem = frame.nodes[frame.idx++] as? OrderedXmlNode.Element ?: continue
        if (JATS_SKIP_TAGS.contains(elem.localTag)) continue

        if (elem.localTag == "article-id") {
            if (doi == null && elem.attrs?.get("@_pub-id-type") == "doi") {
                val candidate = trimSpace(flattenInlineXmlNodes(elem.children))
                if (candidate.isNotEmpty()) doi = candidate
            }
            continue
        }

        if (elem.localTag == "abstract") {
            secStack.add((3 + frame.secDepth) to CanonicalSectionLabel.ABSTRACT)
            walkStack.add(JatsWalkFrame(elem.children, secDepth = frame.secDepth + 1, popSecOnExit = true))
            continue
        }

        if (elem.localTag == "sec" || elem.localTag == "ack" || elem.localTag == "app") {
            val nextLevel = 3 + frame.secDepth
            var titleText = ""
            for (c in elem.children) {
                val ce = c as? OrderedXmlNode.Element
                if (ce != null && ce.localTag == "title") {
                    titleText = flattenInlineXmlNodes(ce.children)
                    break
                }
            }
            if (titleText.isEmpty()) {
                titleText = elem.attrs?.get("@_sec-type") ?: if (elem.localTag == "app") "appendix" else ""
            }
            var pushed = false
            if (titleText.isNotEmpty()) {
                val isFirst = !seenHeading
                seenHeading = true
                val matched = matchCanonicalSectionLabel(titleText, isFirst)
                val nextLabel = matched ?: currentSectionLabel()
                secStack.add(nextLevel to nextLabel)
                pushed = true
            }
            walkStack.add(JatsWalkFrame(elem.children, secDepth = frame.secDepth + 1, popSecOnExit = pushed))
            continue
        }

        if (elem.localTag == "title") continue

        if (elem.localTag == "table-wrap") {
            walkTableWrap(elem.children, currentSectionLabel().wireName)
            continue
        }

        if (elem.localTag == "table") {
            for (r in extractJatsTableRows(elem.children)) {
                pushTableRow(r)
            }
            continue
        }

        if (elem.localTag == "p") {
            walkStack.add(
                JatsWalkFrame(
                    nodes = elem.children,
                    secDepth = frame.secDepth,
                    isParagraph = true,
                    pSection = currentSectionLabel().wireName,
                    buffered = ArrayList(),
                ),
            )
            continue
        }

        if (elem.children.isNotEmpty()) {
            walkStack.add(JatsWalkFrame(elem.children, secDepth = frame.secDepth))
        }
    }

    val units = ArrayList<EvidenceUnit>()
    val ordinalBySection = HashMap<String, Int>()
    for (bucket in buckets) {
        val startOrd = ordinalBySection[bucket.section] ?: 0
        val built = buildEvidenceUnits(
            refId = refId,
            sourceKind = sourceKind,
            section = bucket.section,
            rawSentences = bucket.items,
            startOrdinal = startOrd,
            enableNeighbourExtension = bucket.isProse && enableNeighbourExtension,
        )
        ordinalBySection[bucket.section] = startOrd + built.size
        units.addAll(built)
    }

    return ChunkJatsResult(units, doi)
}

fun chunkJatsXml(
    refId: String,
    xml: String,
    options: ChunkJatsOptions? = null,
): ChunkJatsResult = chunkJatsOrderedNodes(refId, parseXmlOrdered(xml), options)

// ───────────────────────── Physical Select-Row & Printed Text Units ─────────────────────────

fun formatSelectRowText(pairs: List<SelectRowCellInput>): String {
    val parts = ArrayList<String>(pairs.size)
    for (pair in pairs) {
        val lower = trimSpace(norm(pair.header).text)
        val upper = if (pair.upperHeader != null) trimSpace(norm(pair.upperHeader).text) else ""
        val header = when {
            upper.isNotEmpty() && lower.isNotEmpty() -> "$upper \u00B7 $lower"
            upper.isNotEmpty() -> upper
            else -> lower
        }
        val cell = trimSpace(norm(pair.cell).text)
        parts.add("$header: $cell")
    }
    return collapseAsciiSpacesAndTrim(parts.joinToString("; "))
}

fun chunkPhysicalTableRow(
    refId: String,
    photoSha256: String,
    pairs: List<SelectRowCellInput>,
    ordinal: Int = 0,
): EvidenceUnit {
    val prefix = if (photoSha256.length <= 12) photoSha256 else photoSha256.substring(0, 12)
    val section = "print:$prefix"
    val text = formatSelectRowText(pairs)
    return EvidenceUnit(
        chunkId = computeChunkId(refId, EvidenceSourceKind.PHYSICAL_TABLE, section, ordinal, text),
        sourceKind = EvidenceSourceKind.PHYSICAL_TABLE,
        section = section,
        text = text,
        ordinal = ordinal,
    )
}

fun chunkPhysicalText(
    refId: String,
    photoSha256: String,
    ocrText: String,
    ordinal: Int = 0,
): EvidenceUnit {
    val prefix = if (photoSha256.length <= 12) photoSha256 else photoSha256.substring(0, 12)
    val section = "print:$prefix"
    val text = collapseAsciiSpacesAndTrim(norm(ocrText).text)
    return EvidenceUnit(
        chunkId = computeChunkId(refId, EvidenceSourceKind.PHYSICAL_TEXT, section, ordinal, text),
        sourceKind = EvidenceSourceKind.PHYSICAL_TEXT,
        section = section,
        text = text,
        ordinal = ordinal,
    )
}
