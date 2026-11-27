package app.toulmin.spikes

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.abs

class O2GeometryTest {
    private fun lineWithAngle(angle: Float?, cornerSlopeDeg: Double = 0.0, elementCount: Int = 3): OcrLine {
        val els = (0 until elementCount).map { idx ->
            OcrElement("w$idx", OcrBox(10f + idx * 80f, 100f, 60f + idx * 80f, 130f))
        }
        val dx = 200f
        val dy = (kotlin.math.tan(Math.toRadians(cornerSlopeDeg)) * dx).toFloat()
        return OcrLine(
            text = els.joinToString(" ") { it.text },
            angle = angle,
            cornerPoints = listOf(OcrPoint(10f, 100f), OcrPoint(10f + dx, 100f + dy)),
            box = OcrBox(10f, 100f, 210f, 130f),
            elements = els,
        )
    }

    @Test
    fun `capture quality gate rejects IQR above 3 deg when 4+ qualifying lines`() {
        val lines = listOf(
            lineWithAngle(0.0f),
            lineWithAngle(5.5f),
            lineWithAngle(0.5f),
            lineWithAngle(6.0f),
        )
        val decision = O2Geometry.evaluateCaptureQualityGate(lines)
        assertFalse(decision.accepted)
        assertFalse(decision.iqrSkipped)
        assertEquals(O2Geometry.CAPTURE_GATE_TILT_COPY, decision.rejectionMessage)
    }

    @Test
    fun `short table with fewer than 4 qualifying lines skips IQR and accepts up to 20 deg`() {
        val lines = listOf(
            lineWithAngle(4.0f),
            lineWithAngle(12.0f),
            lineWithAngle(6.0f),
            lineWithAngle(25.0f, elementCount = 2), // ignored: < 3 elements
        )
        val decision = O2Geometry.evaluateCaptureQualityGate(lines)
        assertTrue(decision.accepted)
        assertTrue(decision.iqrSkipped)
        assertNull(decision.iqrDeg)
        assertEquals(3, decision.qualifyingLineCount)
    }

    @Test
    fun `short table exceeding 20 deg median angle is rejected`() {
        val lines = listOf(
            lineWithAngle(21.0f),
            lineWithAngle(22.0f),
            lineWithAngle(23.0f),
        )
        val decision = O2Geometry.evaluateCaptureQualityGate(lines)
        assertFalse(decision.accepted)
        assertTrue(decision.iqrSkipped)
        assertEquals(O2Geometry.CAPTURE_GATE_TILT_COPY, decision.rejectionMessage)
    }

    @Test
    fun `cornerPoints fallback estimates line angle when Text Line angle is null`() {
        val line = lineWithAngle(angle = null, cornerSlopeDeg = 5.0)
        val est = O2Geometry.estimateLineAngle(line)
        assertTrue(abs(est - 5.0) < 0.05)
    }

    @Test
    fun `splitRowCells detects column split on gap ratio jump above 1_8`() {
        val elements = listOf(
            OcrElement("Mean", OcrBox(10f, 100f, 50f, 120f)),
            OcrElement("age", OcrBox(56f, 100f, 86f, 120f)),   // gap = 6px (intra-cell)
            OcrElement("48", OcrBox(210f, 100f, 230f, 120f)),   // gap = 124px (inter-cell)
            OcrElement("years", OcrBox(236f, 100f, 286f, 120f)), // gap = 6px (intra-cell)
        )
        val cells = O2Geometry.splitRowCells(elements)
        assertEquals(listOf("Mean age", "48 years"), cells.map { it.text })
    }

    @Test
    fun `two-row header merge and Select-row evidence formatting match spec`() {
        val upper = listOf(
            RowCell("Baseline", OcrBox(10f, 40f, 260f, 65f)),
            RowCell("Followup", OcrBox(300f, 40f, 450f, 65f)),
        )
        val lower = listOf(
            RowCell("Group", OcrBox(10f, 75f, 100f, 100f)),
            RowCell("N", OcrBox(150f, 75f, 210f, 100f)),
            RowCell("Outcome", OcrBox(300f, 75f, 420f, 100f)),
        )
        val merged = O2Geometry.mergeTwoRowHeaders(upper, lower)
        val row = listOf(
            RowCell("DrugA", OcrBox(10f, 115f, 95f, 140f)),
            RowCell("48", OcrBox(155f, 115f, 195f, 140f)),
            RowCell("-12%", OcrBox(310f, 115f, 380f, 140f)),
        )
        val evidence = O2Geometry.buildSelectRowEvidence(merged, row)
        assertEquals("Baseline \u00B7 Group: DrugA; Baseline \u00B7 N: 48; Followup \u00B7 Outcome: -12%", evidence)
    }

    @Test
    fun `runSelectRowPipeline clusters fragmented column lines by centerY and detects non-numeric two-row headers`() {
        // Simulate ML Kit splitting wide columns on the same visual row into separate OcrLine fragments
        val fragmentedLines = listOf(
            OcrLine("Baseline", 0f, emptyList(), OcrBox(100f, 40f, 540f, 70f), listOf(OcrElement("Baseline", OcrBox(100f, 40f, 540f, 70f)))),
            OcrLine("Followup", 0f, emptyList(), OcrBox(700f, 42f, 920f, 72f), listOf(OcrElement("Followup", OcrBox(700f, 42f, 920f, 72f)))),
            OcrLine("Group", 0f, emptyList(), OcrBox(100f, 100f, 220f, 130f), listOf(OcrElement("Group", OcrBox(100f, 100f, 220f, 130f)))),
            OcrLine("Count", 0f, emptyList(), OcrBox(380f, 102f, 520f, 132f), listOf(OcrElement("Count", OcrBox(380f, 102f, 520f, 132f)))),
            OcrLine("Outcome", 0f, emptyList(), OcrBox(700f, 101f, 890f, 131f), listOf(OcrElement("Outcome", OcrBox(700f, 101f, 890f, 131f)))),
            OcrLine("DrugA", 0f, emptyList(), OcrBox(100f, 165f, 210f, 195f), listOf(OcrElement("DrugA", OcrBox(100f, 165f, 210f, 195f)))),
            OcrLine("48", 0f, emptyList(), OcrBox(390f, 166f, 450f, 196f), listOf(OcrElement("48", OcrBox(390f, 166f, 450f, 196f)))),
            OcrLine("-12%", 0f, emptyList(), OcrBox(710f, 164f, 820f, 194f), listOf(OcrElement("-12%", OcrBox(710f, 164f, 820f, 194f)))),
        )
        val res = O2Geometry.runSelectRowPipeline(
            OcrRecognitionOutcome(true, fragmentedLines, 1200, 800, true, false, null),
            hasTwoRowHeader = true,
            targetRowIndex = 2,
        )
        assertTrue(res.gate.accepted)
        assertEquals("Baseline \u00B7 Group: DrugA; Baseline \u00B7 Count: 48; Followup \u00B7 Outcome: -12%", res.evidenceString)
    }
}
