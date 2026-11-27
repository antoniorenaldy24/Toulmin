package app.toulmin.l1

import app.toulmin.spikes.BaseModelProbeResult
import com.google.mlkit.genai.prompt.Generation

object AiCoreTelemetry {
    suspend fun readBaseModelName(): BaseModelProbeResult {
        val client = runCatching { Generation.getClient() }.getOrElse { err ->
            return BaseModelProbeResult(
                available = false,
                baseModelName = null,
                errorClass = err.javaClass.name,
                errorMessage = err.message,
            )
        }
        return try {
            val name = client.getBaseModelName()
            BaseModelProbeResult(
                available = !name.isNullOrBlank(),
                baseModelName = name,
                errorClass = null,
                errorMessage = null,
            )
        } catch (t: Throwable) {
            BaseModelProbeResult(
                available = false,
                baseModelName = null,
                errorClass = t.javaClass.name,
                errorMessage = t.message,
            )
        } finally {
            runCatching { client.close() }
        }
    }
}
