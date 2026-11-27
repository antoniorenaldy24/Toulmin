package app.toulmin.l1

import android.content.res.AssetManager
import app.toulmin.core.sha256hexBytes
import app.toulmin.spikes.PromptAndSchemaSot
import app.toulmin.spikes.PromptHashMismatchException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class PromptManifest(
    val promptVersion: String,
    val files: Map<String, String>,
)

class PromptLoader(private val assets: AssetManager) {
    private val json = Json { ignoreUnknownKeys = true }
    private val cache = HashMap<String, String>()

    fun verifyAllPrompts(): Map<String, String> {
        val manifestBytes = assets.open("prompts/${PromptAndSchemaSot.PROMPT_VERSION}/manifest.json").use {
            it.readBytes()
        }
        val manifest = json.decodeFromString<PromptManifest>(manifestBytes.decodeToString())
        if (manifest.promptVersion != PromptAndSchemaSot.PROMPT_VERSION) {
            throw PromptHashMismatchException(
                "PROMPT_HASH_MISMATCH: expected ${PromptAndSchemaSot.PROMPT_VERSION}, got ${manifest.promptVersion}",
            )
        }
        val verified = LinkedHashMap<String, String>()
        for (fileName in PromptAndSchemaSot.PROMPT_FILES) {
            val expectedHash = manifest.files[fileName]
                ?: throw PromptHashMismatchException("PROMPT_HASH_MISMATCH: missing $fileName in manifest")
            val bytes = assets.open("prompts/${PromptAndSchemaSot.PROMPT_VERSION}/$fileName").use {
                it.readBytes()
            }
            PromptAndSchemaSot.verifyPromptHash(fileName, bytes, expectedHash)
            val actual = sha256hexBytes(bytes)
            verified[fileName] = actual
            cache[fileName] = bytes.decodeToString()
        }
        return verified
    }

    fun loadVerified(fileName: String): String {
        cache[fileName]?.let { return it }
        verifyAllPrompts()
        return cache[fileName]
            ?: throw PromptHashMismatchException("PROMPT_HASH_MISMATCH: $fileName not loaded")
    }
}
