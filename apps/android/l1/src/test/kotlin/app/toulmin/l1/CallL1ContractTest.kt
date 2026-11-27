package app.toulmin.l1

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class CallL1ContractTest {
    @BeforeEach
    fun reset() {
        L1SessionState.resetForTest()
        if (InferenceMutex.isLocked()) {
            InferenceMutex.unlock()
        }
    }

    @Test
    fun `deadline expiry waits for settle and invokes putLate while releasing mutex`() = runBlocking {
        var lateCaptured: String? = null
        val gate = CompletableDeferred<Unit>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val result = CallL1.execute<String>(
                deadlineMs = 40L,
                settleCeilingMs = 500L,
                scope = scope,
                onLateResult = { data, _, _ -> lateCaptured = data },
            ) {
                delay(120L)
                gate.complete(Unit)
                Triple("late_value", "ON_DEVICE", "{}")
            }

            assertEquals("DEADLINE", result.error)
            assertEquals("late_value", lateCaptured)
            assertFalse(InferenceMutex.isLocked())
            assertFalse(L1SessionState.localUnavailable)
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `never-settling call triggers SLOT_LOST and releases mutex`() = runBlocking {
        val blocker = CompletableDeferred<Unit>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val first = CallL1.execute<String>(
                deadlineMs = 30L,
                settleCeilingMs = 50L,
                scope = scope,
            ) {
                blocker.await()
                Triple("never", "ON_DEVICE", "{}")
            }
            assertEquals("SLOT_LOST", first.error)
            assertTrue(L1SessionState.localUnavailable)
            assertFalse(InferenceMutex.isLocked())

            val second = CallL1.execute<String>(deadlineMs = 30L, scope = scope) {
                Triple("ok", "ON_DEVICE", "{}")
            }
            assertEquals("SLOT_LOST", second.error)
        } finally {
            blocker.complete(Unit)
            scope.cancel()
        }
    }

    @Test
    fun `cancellation propagates and releases mutex`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val started = CompletableDeferred<Unit>()
        val blocker = CompletableDeferred<Unit>()
        val job = scope.async {
            CallL1.execute<String>(deadlineMs = 5_000L, scope = scope) {
                started.complete(Unit)
                blocker.await()
                Triple("ok", "ON_DEVICE", "{}")
            }
        }
        started.await()
        assertTrue(InferenceMutex.isLocked())
        job.cancel()
        val caught = runCatching { job.await() }.exceptionOrNull()
        assertTrue(caught is CancellationException)
        assertFalse(InferenceMutex.isLocked())
        blocker.complete(Unit)
        scope.cancel()
    }

    @Test
    fun `cancellation during settle wait propagates and releases mutex`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val settleEntered = CompletableDeferred<Unit>()
        val blocker = CompletableDeferred<Unit>()
        val job = scope.async {
            CallL1.execute<String>(
                deadlineMs = 25L,
                settleCeilingMs = 5_000L,
                scope = scope,
                onDeadline = { settleEntered.complete(Unit) },
            ) {
                blocker.await()
                Triple("late", "ON_DEVICE", "{}")
            }
        }
        settleEntered.await()
        assertTrue(InferenceMutex.isLocked())
        job.cancel()
        val caught = runCatching { job.await() }.exceptionOrNull()
        assertTrue(caught is CancellationException)
        assertFalse(InferenceMutex.isLocked())
        blocker.complete(Unit)
        scope.cancel()
    }

    @Test
    fun `error classification distinguishes BUSY and long-term quota`() {
        assertEquals("BUSY", classifyL1Error(RuntimeException("AICore BUSY error 601")))
        assertEquals("QUOTA_LONG_TERM", classifyL1Error(RuntimeException("Daily quota limit 608")))
        assertEquals("OTHER", classifyL1Error(RuntimeException("Unexpected internal state")))
    }
}
