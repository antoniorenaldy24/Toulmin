package app.toulmin.l1.schema

import com.google.firebase.ai.annotations.Generable
import com.google.firebase.ai.annotations.Guide
import kotlinx.serialization.Serializable

@Serializable
@Generable(description = "References from the author's library that could support the claim")
data class AltSourcesV1(
    @Guide(description = "Up to 3 numbers of LIBRARY entries that could support the claim") val s1_library_idx: List<Int>,
    @Guide(description = "Up to 2 DOIs of other published sources; empty on device") val s2_dois: List<String>,
) {
    companion object
}
