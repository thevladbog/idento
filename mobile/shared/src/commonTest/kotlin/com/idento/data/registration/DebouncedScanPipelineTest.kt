package com.idento.data.registration

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

class DebouncedScanPipelineTest {

    @Test
    fun sameCodeWithinWindowIsDroppedDifferentCodeAlwaysPasses() = runTest {
        val pipeline = DebouncedScanPipeline(debounceWindow = 3.seconds)
        val source = flow {
            emit("ABC-123")
            emit("ABC-123") // immediate duplicate — dropped
            emit("XYZ-999") // different code — always passes
        }
        val results = pipeline.process(source).toList()
        assertEquals(listOf("ABC-123", "XYZ-999"), results)
    }

    @Test
    fun sameCodeAfterWindowExpiresPassesAgain() = runTest {
        // Proves the pipeline is driven by a REAL elapsed-time check (kotlin.time.Clock), not
        // virtual-scheduler-only timing that would be meaningless outside a test. `runTest`'s
        // TestCoroutineScheduler only fast-forwards `delay()` calls made on the test dispatcher
        // itself — dispatching to the real `Dispatchers.Default` before calling `delay()` escapes
        // that virtual scheduler and performs a genuine wall-clock wait, so the elapsed time
        // observed by `Clock.System.now()` inside the pipeline is real, not simulated. A pipeline
        // that (incorrectly) tracked only flow ordering or virtual time — with no real clock read
        // at all — would still wrongly drop the second "ABC-123" here, since nothing about flow
        // ordering changed between the two emissions; only genuine elapsed wall-clock time did.
        val shortWindow = 40.milliseconds
        val realWaitLongerThanWindow = 120.milliseconds
        val pipeline = DebouncedScanPipeline(debounceWindow = shortWindow)
        val source = flow {
            emit("ABC-123")
            withContext(Dispatchers.Default) { delay(realWaitLongerThanWindow) } // real wall-clock wait
            emit("ABC-123") // same code, but the debounce window has genuinely elapsed
        }
        val results = pipeline.process(source).toList()
        assertEquals(listOf("ABC-123", "ABC-123"), results)
    }
}
