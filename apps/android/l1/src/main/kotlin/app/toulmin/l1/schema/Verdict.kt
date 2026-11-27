package app.toulmin.l1.schema

import com.google.firebase.ai.annotations.Generable
import com.google.firebase.ai.annotations.Guide
import kotlinx.serialization.Serializable

@Serializable
enum class VerdictG {
    SUPPORTED,
    CONTRADICTS,
    NEI_SILENT_ESCALATE,
}

@Serializable
@Generable(description = "Evidence-first verdict for one claim against EVIDENCE blocks 0..4")
data class VerdictV1(
    @Guide(description = "Word-for-word quote of at most 25 words from one EVIDENCE block, or empty") val s01_evidence_span: String,
    @Guide(description = "Id of the quoted EVIDENCE block, or -1 if none") val s02_evidence_idx: Int,
    @Guide(description = "One or two sentences, at most 40 words, comparing claim and quote") val s03_micro_reasoning: String,
    @Guide(description = "Final verdict, decided after the fields above") val s04_verdict: VerdictG,
) {
    companion object
}

@Serializable
@Generable(description = "Evidence-first verdict for one claim against EVIDENCE blocks 0..4 (30-word reasoning)")
data class VerdictV1_cap30(
    @Guide(description = "Word-for-word quote of at most 25 words from one EVIDENCE block, or empty") val s01_evidence_span: String,
    @Guide(description = "Id of the quoted EVIDENCE block, or -1 if none") val s02_evidence_idx: Int,
    @Guide(description = "One or two sentences, at most 30 words, comparing claim and quote") val s03_micro_reasoning: String,
    @Guide(description = "Final verdict, decided after the fields above") val s04_verdict: VerdictG,
) {
    companion object
}

@Serializable
@Generable(description = "Evidence-first verdict for one claim against EVIDENCE blocks 0..4 (20-word reasoning)")
data class VerdictV1_cap20(
    @Guide(description = "Word-for-word quote of at most 25 words from one EVIDENCE block, or empty") val s01_evidence_span: String,
    @Guide(description = "Id of the quoted EVIDENCE block, or -1 if none") val s02_evidence_idx: Int,
    @Guide(description = "One sentence, at most 20 words, comparing claim and quote") val s03_micro_reasoning: String,
    @Guide(description = "Final verdict, decided after the fields above") val s04_verdict: VerdictG,
) {
    companion object
}

@Serializable
@Generable(description = "Evidence-first verdict (flat fallback)")
data class VerdictFlatV1(
    @Guide(description = "Word-for-word quote of at most 25 words from one EVIDENCE block, or empty") val s01_evidence_span: String,
    @Guide(description = "Id of the quoted EVIDENCE block, or -1 if none") val s02_evidence_idx: Int,
    @Guide(description = "One or two sentences comparing claim and quote") val s03_micro_reasoning: String,
    @Guide(description = "One of: SUPPORTED|CONTRADICTS|NEI_SILENT_ESCALATE") val s04_verdict: String,
) {
    companion object
}
