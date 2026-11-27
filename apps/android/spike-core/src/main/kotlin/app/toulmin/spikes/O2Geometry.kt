package app.toulmin.spikes

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

data class OcrPoint(
    val x: Float,
    val y: Float,
)

data class OcrBox(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
) {
    val width: Float get() = max(0f, right - left)
    val height: Float get() = max(0f, bottom - top)
    val centerX: Float get() = (left + right) / 2f
    val centerY: Float get() = (top + bottom) / 2f
}

data class OcrElement(
    val text: String,
    val box: OcrBox,
)

data class OcrLine(
    val text: String,
    val angle: Float?,
    val cornerPoints: List<OcrPoint>,
    val box: OcrBox,
    val elements: List<OcrElement>,
)

data class CaptureGateDecision(
    val accepted: Boolean,
    val qualifyingLineCount: Int,
    val iqrSkipped: Boolean,
    val iqrDeg: Double?,
    val medianAngleDeg: Double,
    val rejectionMessage: String?,
)

data class RowCell(
    val text: String,
    val box: OcrBox,
)

data class VisualRow(
    val lines: List<OcrLine>,
    val elements: List<OcrElement>,
    val box: OcrBox,
)

object O2Geometry {
    const val CAPTURE_GATE_TILT_COPY =
        "The page is tilted. Hold the phone parallel to the page and try again."
    const val DEFAULT_IQR_THRESHOLD_DEG = 3.0
    const val DEFAULT_MEDIAN_ANGLE_LIMIT_DEG = 20.0
    const val MIN_QUALIFYING_ELEMENTS = 3
    const val MIN_LINES_FOR_IQR = 4
    const val ROW_Y_TOLERANCE_FACTOR = 0.6
    const val GAP_RATIO_JUMP_MIN = 1.8

    /**
     * Uses `Text.Line.angle` when populated, otherwise falls back to `cornerPoints` slope
     * between top-left and top-right (`06` §3.8 step 5, `07` §1.4 S-A4).
     */
    fun estimateLineAngle(line: OcrLine): Double {
        line.angle?.let { return it.toDouble() }
        if (line.cornerPoints.size >= 2) {
            val tl = line.cornerPoints[0]
            val tr = line.cornerPoints[1]
            val dx = (tr.x - tl.x).toDouble()
            val dy = (tr.y - tl.y).toDouble()
            if (dx != 0.0 || dy != 0.0) {
                return atan2(dy, dx) * (180.0 / PI)
            }
        }
        return 0.0
    }

    /**
     * Capture quality gate (`06` §3.8 step 4, `07` §1.4 S-A4).
     */
    fun evaluateCaptureQualityGate(
        lines: List<OcrLine>,
        iqrThresholdDeg: Double = DEFAULT_IQR_THRESHOLD_DEG,
        medianAngleLimitDeg: Double = DEFAULT_MEDIAN_ANGLE_LIMIT_DEG,
    ): CaptureGateDecision {
        val qualifying = lines.filter { it.elements.size >= MIN_QUALIFYING_ELEMENTS }
        val angles = qualifying.map { estimateLineAngle(it) }
        val medianTheta = if (angles.isEmpty()) 0.0 else SpikeStats.median(angles)

        if (qualifying.size < MIN_LINES_FOR_IQR) {
            val accepted = abs(medianTheta) <= medianAngleLimitDeg
            return CaptureGateDecision(
                accepted = accepted,
                qualifyingLineCount = qualifying.size,
                iqrSkipped = true,
                iqrDeg = null,
                medianAngleDeg = medianTheta,
                rejectionMessage = if (accepted) null else CAPTURE_GATE_TILT_COPY,
            )
        }

        val iqrDeg = SpikeStats.iqr(angles)
        val accepted = iqrDeg <= iqrThresholdDeg && abs(medianTheta) <= medianAngleLimitDeg
        return CaptureGateDecision(
            accepted = accepted,
            qualifyingLineCount = qualifying.size,
            iqrSkipped = false,
            iqrDeg = iqrDeg,
            medianAngleDeg = medianTheta,
            rejectionMessage = if (accepted) null else CAPTURE_GATE_TILT_COPY,
        )
    }

    fun deskewBox(box: OcrBox, thetaDeg: Double, centerX: Float, centerY: Float): OcrBox {
        if (thetaDeg == 0.0) return box
        val rad = -thetaDeg * (PI / 180.0)
        val c = cos(rad)
        val s = sin(rad)
        val corners = listOf(
            box.left to box.top,
            box.right to box.top,
            box.right to box.bottom,
            box.left to box.bottom,
        )
        var minX = Float.POSITIVE_INFINITY
        var minY = Float.POSITIVE_INFINITY
        var maxX = Float.NEGATIVE_INFINITY
        var maxY = Float.NEGATIVE_INFINITY
        for ((px, py) in corners) {
            val dx = (px - centerX).toDouble()
            val dy = (py - centerY).toDouble()
            val rx = (centerX + dx * c - dy * s).toFloat()
            val ry = (centerY + dx * s + dy * c).toFloat()
            minX = min(minX, rx)
            minY = min(minY, ry)
            maxX = max(maxX, rx)
            maxY = max(maxY, ry)
        }
        return OcrBox(minX, minY, maxX, maxY)
    }

    fun deskewLines(lines: List<OcrLine>, thetaDeg: Double, centerX: Float, centerY: Float): List<OcrLine> =
        lines.map { line ->
            line.copy(
                box = deskewBox(line.box, thetaDeg, centerX, centerY),
                elements = line.elements.map { el ->
                    el.copy(box = deskewBox(el.box, thetaDeg, centerX, centerY))
                },
            )
        }

    fun selectRowElements(deskewedLines: List<OcrLine>, tappedLineIndex: Int): List<OcrElement> {
        if (deskewedLines.isEmpty() || tappedLineIndex !in deskewedLines.indices) return emptyList()
        val medianHeight = SpikeStats.median(deskewedLines.map { it.box.height.toDouble() })
        val tolerance = ROW_Y_TOLERANCE_FACTOR * medianHeight
        val targetCenterY = deskewedLines[tappedLineIndex].box.centerY.toDouble()
        return deskewedLines
            .filter { abs(it.box.centerY.toDouble() - targetCenterY) <= tolerance }
            .flatMap { it.elements }
            .sortedBy { it.box.left }
    }

    /**
     * Groups deskewed OCR lines into visual rows whose center-Y lies within
     * `0.6 * medianLineHeight` (`06` §3.8 step 6).
     */
    fun clusterVisualRows(deskewedLines: List<OcrLine>): List<VisualRow> {
        if (deskewedLines.isEmpty()) return emptyList()
        val sorted = deskewedLines.sortedBy { it.box.centerY }
        val medianHeight = max(1.0, SpikeStats.median(sorted.map { it.box.height.toDouble() }))
        val tolerance = ROW_Y_TOLERANCE_FACTOR * medianHeight

        val rows = ArrayList<VisualRow>()
        var seedY = sorted[0].box.centerY.toDouble()
        var currentLines = mutableListOf(sorted[0])

        fun flush() {
            val els = currentLines.flatMap { it.elements }.sortedBy { it.box.left }
            val boxes = currentLines.map { it.box }
            val combined = OcrBox(
                left = boxes.minOf { it.left },
                top = boxes.minOf { it.top },
                right = boxes.maxOf { it.right },
                bottom = boxes.maxOf { it.bottom },
            )
            rows.add(VisualRow(currentLines.toList(), els, combined))
        }

        for (i in 1 until sorted.size) {
            val line = sorted[i]
            if (abs(line.box.centerY.toDouble() - seedY) <= tolerance) {
                currentLines.add(line)
            } else {
                flush()
                seedY = line.box.centerY.toDouble()
                currentLines = mutableListOf(line)
            }
        }
        flush()
        return rows
    }

    private fun isNonNumericToken(token: String): Boolean {
        val trimmed = token.trim()
        if (trimmed.isEmpty()) return false
        var hasDigit = false
        var hasLetter = false
        for (ch in trimmed) {
            if (ch.isDigit()) hasDigit = true
            else if (ch.isLetter()) hasLetter = true
        }
        return hasLetter || !hasDigit
    }

    fun isHeaderCandidateRow(row: VisualRow): Boolean {
        if (row.elements.isEmpty()) return false
        val nonNumericCount = row.elements.count { isNonNumericToken(it.text) }
        return nonNumericCount * 2 >= row.elements.size
    }

    /**
     * Splits a row's elements into cells using the largest gap-ratio jump (`06` §3.8 step 8).
     */
    fun splitRowCells(elements: List<OcrElement>): List<RowCell> {
        if (elements.isEmpty()) return emptyList()
        val sorted = elements.sortedBy { it.box.left }
        if (sorted.size == 1) {
            return listOf(RowCell(sorted[0].text, sorted[0].box))
        }

        val charWidths = sorted.map { el ->
            val len = max(1, el.text.length)
            el.box.width.toDouble() / len.toDouble()
        }
        val medianCharWidth = max(1.0, SpikeStats.median(charWidths))

        val gaps = ArrayList<Double>(sorted.size - 1)
        for (i in 0 until sorted.size - 1) {
            val rawGap = (sorted[i + 1].box.left - sorted[i].box.right).toDouble()
            gaps.add(max(1.0, rawGap))
        }

        val sortedGaps = gaps.sorted()
        var bestJumpRatio = 0.0
        var bestThreshold = 1.5 * medianCharWidth
        for (i in 0 until sortedGaps.size - 1) {
            val g0 = sortedGaps[i]
            val g1 = sortedGaps[i + 1]
            val ratio = g1 / g0
            if (ratio > bestJumpRatio) {
                bestJumpRatio = ratio
                bestThreshold = (g0 + g1) / 2.0
            }
        }

        val gapThreshold = if (bestJumpRatio > GAP_RATIO_JUMP_MIN) {
            max(1.0 * medianCharWidth, bestThreshold)
        } else {
            1.5 * medianCharWidth
        }

        val cells = ArrayList<RowCell>()
        var currentElements = mutableListOf(sorted[0])
        for (i in 0 until sorted.size - 1) {
            if (gaps[i] > gapThreshold) {
                cells.add(mergeCellElements(currentElements))
                currentElements = mutableListOf(sorted[i + 1])
            } else {
                currentElements.add(sorted[i + 1])
            }
        }
        cells.add(mergeCellElements(currentElements))
        return cells
    }

    private fun mergeCellElements(elements: List<OcrElement>): RowCell {
        val text = elements.joinToString(" ") { it.text.trim() }.trim()
        var left = Float.POSITIVE_INFINITY
        var top = Float.POSITIVE_INFINITY
        var right = Float.NEGATIVE_INFINITY
        var bottom = Float.NEGATIVE_INFINITY
        for (el in elements) {
            left = min(left, el.box.left)
            top = min(top, el.box.top)
            right = max(right, el.box.right)
            bottom = max(bottom, el.box.bottom)
        }
        return RowCell(text, OcrBox(left, top, right, bottom))
    }

    private fun horizontalOverlap(a: OcrBox, b: OcrBox): Float =
        max(0f, min(a.right, b.right) - max(a.left, b.left))

    /**
     * Merges a two-row header (`06` §3.8 step 7): `"{upper} · {lower}"`.
     */
    fun mergeTwoRowHeaders(upperCells: List<RowCell>, lowerCells: List<RowCell>): List<RowCell> {
        if (upperCells.isEmpty()) return lowerCells
        return lowerCells.map { lower ->
            val bestUpper = upperCells.maxByOrNull { upper ->
                val ov = horizontalOverlap(upper.box, lower.box)
                if (ov > 0f) ov.toDouble() else -abs(upper.box.centerX - lower.box.centerX).toDouble()
            }
            if (bestUpper == null || bestUpper.text.isBlank()) {
                lower
            } else {
                lower.copy(text = "${bestUpper.text} \u00B7 ${lower.text}")
            }
        }
    }

    /**
     * Assigns each row cell to the header cell with largest horizontal overlap (or nearest centre),
     * producing `"{header1}: {cell1}; {header2}: {cell2}"` (`06` §3.8 step 8).
     */
    fun buildSelectRowEvidence(headerCells: List<RowCell>, rowCells: List<RowCell>): String {
        if (headerCells.isEmpty() || rowCells.isEmpty()) return ""
        val pairs = rowCells.map { cell ->
            val bestOverlap = headerCells.maxByOrNull { header -> horizontalOverlap(header.box, cell.box) }
            val matchedHeader = if (bestOverlap != null && horizontalOverlap(bestOverlap.box, cell.box) > 0f) {
                bestOverlap
            } else {
                headerCells.minByOrNull { header -> abs(header.box.centerX - cell.box.centerX) }!!
            }
            "${matchedHeader.text}: ${cell.text}"
        }
        return pairs.joinToString("; ")
    }

    /**
     * End-to-end Select-row evaluation over recognized lines (`06` §3.8 steps 4–8).
     */
    fun runSelectRowPipeline(
        recognition: OcrRecognitionOutcome,
        hasTwoRowHeader: Boolean,
        targetRowIndex: Int,
        iqrThresholdDeg: Double = DEFAULT_IQR_THRESHOLD_DEG,
    ): SelectRowResult {
        val gate = evaluateCaptureQualityGate(recognition.lines, iqrThresholdDeg)
        if (!gate.accepted) {
            return SelectRowResult(
                gate = gate,
                evidenceString = "",
                headerCells = emptyList(),
                rowCells = emptyList(),
            )
        }
        val deskewed = deskewLines(
            recognition.lines,
            gate.medianAngleDeg,
            recognition.imageWidth / 2f,
            recognition.imageHeight / 2f,
        )
        val visualRows = clusterVisualRows(deskewed)
        if (visualRows.isEmpty()) {
            return SelectRowResult(
                gate = gate,
                evidenceString = "",
                headerCells = emptyList(),
                rowCells = emptyList(),
            )
        }

        val boundedRowIndex = targetRowIndex.coerceIn(0, visualRows.lastIndex)
        val targetRow = visualRows[boundedRowIndex]
        val rowCells = splitRowCells(targetRow.elements)

        // Find nearest visual row above targetRow with >= 50% non-numeric tokens (`06` §3.8 step 7)
        val candidateRowsAbove = visualRows.subList(0, boundedRowIndex)
        val lowerHeaderIndex = candidateRowsAbove.indexOfLast { isHeaderCandidateRow(it) }
        val headerCells = if (lowerHeaderIndex >= 0) {
            val lowerCells = splitRowCells(visualRows[lowerHeaderIndex].elements)
            if (hasTwoRowHeader && lowerHeaderIndex > 0 && isHeaderCandidateRow(visualRows[lowerHeaderIndex - 1])) {
                val upperCells = splitRowCells(visualRows[lowerHeaderIndex - 1].elements)
                mergeTwoRowHeaders(upperCells, lowerCells)
            } else {
                lowerCells
            }
        } else {
            emptyList()
        }

        val evidenceString = buildSelectRowEvidence(headerCells, rowCells)
        return SelectRowResult(
            gate = gate,
            evidenceString = evidenceString,
            headerCells = headerCells,
            rowCells = rowCells,
        )
    }
}

data class SelectRowResult(
    val gate: CaptureGateDecision,
    val evidenceString: String,
    val headerCells: List<RowCell>,
    val rowCells: List<RowCell>,
)
