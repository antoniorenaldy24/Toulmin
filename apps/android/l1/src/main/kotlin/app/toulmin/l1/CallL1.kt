package app.toulmin.l1

import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.type.PublicPreviewAPI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

object InferenceMutex {
    private val mutex = Mutex()

    suspend fun lock() = mutex.lock()
    fun unlock() = mutex.unlock()
    fun isLocked(): Boolean = mutex.isLocked
    suspend fun <T> withLock(block: suspend () -> T): T = mutex.withLock { block() }
}

object L1SessionState {
    @Volatile
    var localUnavailable: Boolean = false
        private set

    fun markLocalUnavailable() {
        localUnavailable = true
    }

    fun resetForTest() {
        localUnavailable = false
    }
}

data class L1CallResult<T>(
    val data: T?,
    val rawText: String?,
    val inferenceSource: String,
    val ms: Long,
    val error: String?,
    val errorClass: String? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
)

@OptIn(PublicPreviewAPI::class)
fun mapInferenceSource(source: InferenceSource?): String = when (source) {
    InferenceSource.ON_DEVICE -> "ON_DEVICE"
    InferenceSource.IN_CLOUD -> "IN_CLOUD"
    else -> "NONE"
}

fun classifyL1Error(t: Throwable): String {
    val msg = (t.message ?: "").uppercase()
    val cls = t.javaClass.simpleName.uppercase()
    return when {
        msg.contains("BUSY") || msg.contains("IN_PROGRESS") || msg.contains("601") -> "BUSY"
        msg.contains("QUOTA") || msg.contains("LIMIT") || msg.contains("608") || msg.contains("609") -> "QUOTA_LONG_TERM"
        msg.contains("TRUNCATED") || msg.contains("UNEXPECTED END") -> "TRUNCATED"
        msg.contains("NETWORK") || cls.contains("IOEXCEPTION") -> "NETWORK"
        else -> "OTHER"
    }
}

object CallL1 {
    private val defaultScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    suspend fun <T : Any> execute(
        deadlineMs: Long,
        settleCeilingMs: Long = 120_000L,
        scope: CoroutineScope = defaultScope,
        clockMs: () -> Long = { System.nanoTime() / 1_000_000L },
        onDeadline: () -> Unit = {},
        onLateResult: (T, String, String?) -> Unit = { _, _, _ -> },
        block: suspend () -> Triple<T, String, String?>,
    ): L1CallResult<T> {
        if (L1SessionState.localUnavailable) {
            return L1CallResult(null, null, "NONE", 0L, "SLOT_LOST")
        }
        InferenceMutex.lock()
        try {
            val t0 = clockMs()
            val call = scope.async {
                try {
                    Result.success(block())
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    Result.failure(e)
                }
            }
            val done = withTimeoutOrNull(deadlineMs) { call.await() }
            if (done == null) {
                onDeadline()
                val settled = withTimeoutOrNull(settleCeilingMs) {
                    call.join()
                    true
                }
                if (settled == null) {
                    L1SessionState.markLocalUnavailable()
                    return L1CallResult(null, null, "NONE", deadlineMs, "SLOT_LOST")
                }
                val lateOutcome = call.await().getOrNull()
                if (lateOutcome != null) {
                    onLateResult(lateOutcome.first, lateOutcome.second, lateOutcome.third)
                }
                return L1CallResult(null, null, "NONE", deadlineMs, "DEADLINE")
            }
            val elapsed = maxOf(0L, clockMs() - t0)
            return done.fold(
                onSuccess = { (data, src, rawText) ->
                    L1CallResult(data, rawText, src, elapsed, null)
                },
                onFailure = { e ->
                    L1CallResult(
                        data = null,
                        rawText = null,
                        inferenceSource = "NONE",
                        ms = elapsed,
                        error = classifyL1Error(e),
                        errorClass = e.javaClass.name,
                        errorCode = extractNumericCode(e.message),
                        errorMessage = e.message,
                    )
                },
            )
        } finally {
            if (InferenceMutex.isLocked()) {
                InferenceMutex.unlock()
            }
        }
    }

    private fun extractNumericCode(message: String?): String? {
        if (message.isNullOrBlank()) return null
        val lower = message.lowercase()
        val markers = listOf("code=", "code:", "code ", "status=", "status:", "status ", "error ", "error:", "#")
        for (m in markers) {
            val idx = lower.indexOf(m)
            if (idx >= 0) {
                var pos = idx + m.length
                while (pos < message.length && message[pos] == ' ') pos++
                val digits = message.substring(pos).takeWhile { it in '0'..'9' }
                if (digits.length in 3..5) return digits
            }
        }
        // Fallback: standalone 3..4 digit integer token bounded by non-alphanumeric boundaries
        var i = 0
        while (i < message.length) {
            if (message[i] in '0'..'9') {
                val start = i
                while (i < message.length && message[i] in '0'..'9') i++
                val prevOk = start == 0 || !message[start - 1].isLetterOrDigit()
                val nextOk = i == message.length || !message[i].isLetterOrDigit()
                val len = i - start
                if (prevOk && nextOk && len in 3..4) {
                    return message.substring(start, i)
                }
            } else {
                i++
            }
        }
        return null
    }
}
