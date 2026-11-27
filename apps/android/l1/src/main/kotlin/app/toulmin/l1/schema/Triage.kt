package app.toulmin.l1.schema

import com.google.firebase.ai.annotations.Generable
import com.google.firebase.ai.annotations.Guide
import kotlinx.serialization.Serializable

@Serializable
enum class ClaimTypeG {
    QUANTITATIVE,
    CAUSAL,
    COMPARATIVE,
    EXISTENCE,
    METHODOLOGICAL,
    NON_EMPIRICAL,
}

@Serializable
enum class WorthG {
    HIGH,
    LOW,
}

@Serializable
@Generable(description = "One atomic checkable claim, as a range of word numbers of SENTENCE")
data class AtomV1(
    @Guide(description = "Number of the first word of the claim") val a1_start: Int,
    @Guide(description = "Number of the last word of the claim") val a2_end: Int,
    @Guide(description = "Claim category") val a3_type: ClaimTypeG,
) {
    // An empty companion object is required for KSP to generate the firebaseAISchema() extension.
    companion object
}

@Serializable
@Generable(description = "Stage 1 triage of one manuscript sentence")
data class TriageV1(
    @Guide(description = "One to three atomic claims") val s1_atoms: List<AtomV1>,
    @Guide(description = "HIGH if a reader could confirm or refute the sentence against a published source, else LOW") val s2_worth: WorthG,
    @Guide(description = "True only if an empirical finding is stated without any citation") val s3_uncited: Boolean,
    @Guide(description = "Up to two numbers of CANDIDATE_REFERENCES that could be the source") val s4_bib: List<Int>,
) {
    companion object
}

@Serializable
@Generable(description = "Stage 1 triage, one atom (flat fallback)")
data class TriageFlatV1(
    @Guide(description = "Number of the first word of the claim") val s1_start: Int,
    @Guide(description = "Number of the last word of the claim") val s2_end: Int,
    @Guide(description = "One of: QUANTITATIVE|CAUSAL|COMPARATIVE|EXISTENCE|METHODOLOGICAL|NON_EMPIRICAL") val s3_type: String,
    @Guide(description = "One of: HIGH|LOW") val s4_worth: String,
    @Guide(description = "True only if an empirical finding is stated without any citation") val s5_uncited: Boolean,
) {
    companion object
}
