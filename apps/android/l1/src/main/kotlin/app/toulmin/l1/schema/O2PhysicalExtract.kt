package app.toulmin.l1.schema

import com.google.firebase.ai.annotations.Generable
import com.google.firebase.ai.annotations.Guide
import kotlinx.serialization.Serializable

@Serializable
enum class PhysicalKindG {
    TABLE_ROW,
    TEXT,
    LAB_NOTE,
}

@Serializable
@Generable(description = "One value from ROW that is relevant to the target claim")
data class PhysicalFactV1(
    @Guide(description = "Exact quote of at most 12 words copied from ROW") val f1_quote: String,
    @Guide(description = "Column header the value belongs to, copied from HEADER, or empty") val f2_column: String,
    @Guide(description = "The value exactly as written in ROW") val f3_value: String,
) {
    companion object
}

@Serializable
@Generable(description = "Values read from a photographed printed table row, text, or lab note")
data class O2PhysicalExtractV1(
    @Guide(description = "Kind of source") val s1_kind: PhysicalKindG,
    @Guide(description = "Up to 3 relevant values") val s2_facts: List<PhysicalFactV1>,
    @Guide(description = "A DOI printed in the text, copied exactly, or empty") val s3_doi: String,
) {
    companion object
}

@Serializable
@Generable(description = "One value (flat fallback)")
data class O2PhysicalExtractFlatV1(
    @Guide(description = "One of: TABLE_ROW|TEXT|LAB_NOTE") val s1_kind: String,
    @Guide(description = "Exact quote of at most 12 words copied from ROW") val s2_quote: String,
    @Guide(description = "Column header the value belongs to, copied from HEADER, or empty") val s3_column: String,
    @Guide(description = "The value exactly as written in ROW") val s4_value: String,
    @Guide(description = "A DOI printed in the text, copied exactly, or empty") val s5_doi: String,
) {
    companion object
}
