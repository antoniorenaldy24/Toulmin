package app.toulmin.spikes

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

object SpikeStats {
    /**
     * Matches `apps/web/src/spikes/stats.ts` `median()`.
     */
    fun median(values: List<Double>): Double {
        if (values.isEmpty()) return 0.0
        val sorted = values.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 1) {
            sorted[mid]
        } else {
            (sorted[mid - 1] + sorted[mid]) / 2.0
        }
    }

    /**
     * Matches `apps/web/src/spikes/stats.ts` `percentile()` (nearest-rank `ceil(q * n) - 1`).
     */
    fun percentile(values: List<Double>, q: Double): Double {
        if (values.isEmpty()) return 0.0
        val clamped = q.coerceIn(0.0, 1.0)
        val sorted = values.sorted()
        val idx = (ceil(clamped * sorted.size).toInt() - 1).coerceIn(0, sorted.lastIndex)
        return sorted[idx]
    }

    /**
     * Interquartile range Q3 - Q1 for O2 capture quality gate (`06` §3.8, `07` §1.4 S-A4).
     */
    fun iqr(values: List<Double>): Double {
        if (values.size < 2) return 0.0
        val sorted = values.sorted()
        val mid = sorted.size / 2
        val lower = sorted.subList(0, mid)
        val upper = if (sorted.size % 2 == 0) sorted.subList(mid, sorted.size) else sorted.subList(mid + 1, sorted.size)
        return median(upper) - median(lower)
    }

    /**
     * Android character-based token estimate (`04` §1.4 rule 1): `ceil(chars / 3.2) * 1.25`.
     */
    fun estimateAndroidTokens(chars: Int): Int {
        if (chars <= 0) return 0
        return ceil(ceil(chars / 3.2) * 1.25).toInt()
    }

    /**
     * Android output cap (`04` §1.4 rule 2): `min(256, ceil(1.35 * p95OutputTokens))`.
     */
    fun computeAndroidOutputCap(p95OutputTokens: Double): Int {
        if (p95OutputTokens <= 0.0) return 64
        return min(256, ceil(1.35 * p95OutputTokens).toInt())
    }

    /**
     * Android L1 deadline (`04` §1.3, `07` §1.4 S-A3, D-28): `max(30_000, ceil(2 * p99))`.
     */
    fun computeAndroidDeadlineMs(p99LatencyMs: Double): Long {
        if (p99LatencyMs <= 0.0) return 30_000L
        return max(30_000L, ceil(2.0 * p99LatencyMs).toLong())
    }

    fun round2(value: Double): Double = (value * 100.0).roundToLong() / 100.0

    /**
     * Deterministic string-aware top-level JSON key extractor (`04` §2.1 item 5).
     * Never uses regular expressions (consistent with `00` §7.3).
     */
    fun extractTopLevelJsonKeys(rawJson: String): List<String>? {
        val keys = ArrayList<String>()
        val n = rawJson.length
        var i = 0
        while (i < n && rawJson[i].isWhitespace()) i++
        if (i >= n || rawJson[i] != '{') return null

        var depth = 0
        var inString = false
        var expectingKeyAtDepth1 = false
        val stringBuf = StringBuilder()

        while (i < n) {
            val ch = rawJson[i]
            if (inString) {
                if (ch == '\\') {
                    if (i + 1 >= n) return null
                    val esc = rawJson[i + 1]
                    if (expectingKeyAtDepth1) {
                        when (esc) {
                            '"', '\\', '/' -> stringBuf.append(esc)
                            'b' -> stringBuf.append('\b')
                            'f' -> stringBuf.append('\u000C')
                            'n' -> stringBuf.append('\n')
                            'r' -> stringBuf.append('\r')
                            't' -> stringBuf.append('\t')
                            'u' -> {
                                if (i + 5 >= n) return null
                                val hex = rawJson.substring(i + 2, i + 6)
                                val code = hex.toIntOrNull(16) ?: return null
                                stringBuf.append(code.toChar())
                                i += 4
                            }
                            else -> stringBuf.append(esc)
                        }
                    }
                    i += 2
                    continue
                }
                if (ch == '"') {
                    inString = false
                    if (expectingKeyAtDepth1 && depth == 1) {
                        // Look ahead past whitespace for ':'
                        var j = i + 1
                        while (j < n && rawJson[j].isWhitespace()) j++
                        if (j < n && rawJson[j] == ':') {
                            keys.add(stringBuf.toString())
                            expectingKeyAtDepth1 = false
                        }
                    }
                    stringBuf.setLength(0)
                    i++
                    continue
                }
                if (expectingKeyAtDepth1) {
                    stringBuf.append(ch)
                }
                i++
                continue
            }

            when (ch) {
                '"' -> {
                    inString = true
                    stringBuf.setLength(0)
                }
                '{' -> {
                    depth++
                    if (depth == 1) {
                        expectingKeyAtDepth1 = true
                    }
                }
                '}' -> {
                    depth--
                    if (depth == 0) {
                        return keys
                    }
                    if (depth < 0) return null
                }
                ',' -> {
                    if (depth == 1) {
                        expectingKeyAtDepth1 = true
                    }
                }
            }
            i++
        }
        return null
    }

    fun hasExpectedKeyOrder(rawJson: String, expectedKeys: List<String>): Boolean {
        val actual = extractTopLevelJsonKeys(rawJson) ?: return false
        return actual == expectedKeys
    }
}
