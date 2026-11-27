package app.toulmin.l1.schema

import com.google.firebase.ai.annotations.Generable
import com.google.firebase.ai.annotations.Guide
import kotlinx.serialization.Serializable

@Serializable
enum class B5VerdictG {
    INCONSISTENT,
    CONSISTENT_DIFFERENT_SUBSET,
    DIFFERENT_QUANTITY,
}

@Serializable
@Generable(description = "Do two numbers from the same manuscript describe the same quantity in the same population?")
data class B5CheckV1(
    @Guide(description = "At most 20 words saying what A and B each measure") val s1_what: String,
    @Guide(description = "True if A and B are the same quantity, population, condition and time point") val s2_same_population: Boolean,
    @Guide(description = "Final judgement, decided after the fields above") val s3_verdict: B5VerdictG,
) {
    companion object
}
