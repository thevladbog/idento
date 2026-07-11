package com.idento.data.sync

import com.idento.data.registration.FlushResult
import com.idento.data.registration.PendingRegistrationCheckIn
import com.idento.data.registration.PrintRetryResult
import com.idento.data.repository.SyncResult
import com.idento.data.storage.PendingZoneCheckIn
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Fakes the zone check-in queue's sync-relevant surface — no real `ZoneRepository`/`ApiClient`
 * network stack or SQLDelight `OfflineDatabase` needed, matching this codebase's established
 * testability-seam convention (see `RegistrationCheckInServiceTest`'s `BatchCheckinSubmitter`/
 * `RegistrationOfflineQueue` fakes). */
private class FakeCheckInSyncQueue(
    private val pending: List<PendingZoneCheckIn> = emptyList(),
    private val syncResult: SyncResult = SyncResult(totalCount = 0, successCount = 0, failedCount = 0, errors = emptyList()),
) : CheckInSyncQueue {
    var syncAllCallCount = 0
        private set

    override suspend fun getPendingCheckIns(): List<PendingZoneCheckIn> = pending

    override suspend fun syncAll(): SyncResult {
        syncAllCallCount++
        return syncResult
    }
}

/** Fakes Task M1c-6's registration check-in queue — no real SQLDelight
 * `PendingRegistrationCheckInQueries` needed. */
private class FakeRegistrationCheckInSyncQueue(
    private val pending: List<PendingRegistrationCheckIn> = emptyList(),
    private val flushResult: FlushResult = FlushResult(succeeded = 0, failed = 0),
) : RegistrationCheckInSyncQueue {
    var flushCallCount = 0
        private set

    override suspend fun getPending(): List<PendingRegistrationCheckIn> = pending

    override suspend fun flush(): FlushResult {
        flushCallCount++
        return flushResult
    }
}

/** Registration queue fake whose [flush] always throws — used to prove that a failure in one
 * queue's operation does not prevent the other queue's operation from running (the bug this
 * test class's `performSyncStillSyncsZoneQueueWhenRegistrationQueueFlushThrows` guards against). */
private class ThrowingRegistrationCheckInSyncQueue(
    private val pending: List<PendingRegistrationCheckIn>,
) : RegistrationCheckInSyncQueue {
    var flushCallCount = 0
        private set

    override suspend fun getPending(): List<PendingRegistrationCheckIn> = pending

    override suspend fun flush(): FlushResult {
        flushCallCount++
        throw IllegalStateException("boom: simulated flush failure")
    }
}

/** Fakes Task M1c-8's print queue retry surface — no real SQLDelight `PrintJobQueries`/
 * `PrintSender` needed. Defaults to an always-empty queue so existing tests that don't care about
 * print-job retries aren't affected by [SyncService.performSync]'s unconditional drain pass. */
private class FakePrintRetryQueue(
    private val results: MutableList<PrintRetryResult> = mutableListOf(),
) : PrintRetryQueue {
    var retryNextCallCount = 0
        private set

    override suspend fun retryNext(): PrintRetryResult {
        retryNextCallCount++
        return if (results.isEmpty()) PrintRetryResult.NoJobsPending else results.removeAt(0)
    }
}

private class FakeNetworkMonitor(private val online: Boolean = true) : NetworkMonitor {
    override val isOnline = flowOf(online)
    override suspend fun checkConnectivity(): Boolean = online
}

private fun pendingRegistrationCheckIn(id: Long = 1L) = PendingRegistrationCheckIn(
    id = id,
    clientUuid = "uuid-$id",
    eventId = "evt-1",
    attendeeId = "att-1",
    at = "2026-07-11T10:00:00Z",
    deviceNumber = 3,
    pointName = "Главный вход",
    attemptCount = 0,
    lastAttemptAt = null,
    errorMessage = null,
)

private fun pendingZoneCheckIn(id: Long = 1L) = PendingZoneCheckIn(
    id = id,
    attendeeCode = "ABC-123",
    zoneId = "zone-1",
    eventDay = "2026-07-11",
    checkedInAt = 0L,
)

class SyncServiceTest {

    @Test
    fun performSyncFlushesRegistrationQueueWhenOnlyRegistrationItemsArePending() = runTest {
        val registrationQueue = FakeRegistrationCheckInSyncQueue(pending = listOf(pendingRegistrationCheckIn()))
        val offlineCheckIn = FakeCheckInSyncQueue(pending = emptyList())
        val syncService = SyncService(
            offlineCheckInRepository = offlineCheckIn,
            networkMonitor = FakeNetworkMonitor(),
            registrationOfflineQueue = registrationQueue,
            printRetryQueue = FakePrintRetryQueue(),
        )

        syncService.performSync()

        assertEquals(1, registrationQueue.flushCallCount)
        // Zone queue was empty, so `syncAll()` must not have been called for it.
        assertEquals(0, offlineCheckIn.syncAllCallCount)
        assertIs<SyncState.Idle>(syncService.syncState.value)
    }

    @Test
    fun performSyncDoesNotFlushEitherQueueWhenNothingIsPending() = runTest {
        val registrationQueue = FakeRegistrationCheckInSyncQueue(pending = emptyList())
        val offlineCheckIn = FakeCheckInSyncQueue(pending = emptyList())
        val syncService = SyncService(
            offlineCheckInRepository = offlineCheckIn,
            networkMonitor = FakeNetworkMonitor(),
            registrationOfflineQueue = registrationQueue,
            printRetryQueue = FakePrintRetryQueue(),
        )

        syncService.performSync()

        assertEquals(0, registrationQueue.flushCallCount)
        assertEquals(0, offlineCheckIn.syncAllCallCount)
        assertIs<SyncState.Idle>(syncService.syncState.value)
    }

    @Test
    fun performSyncFlushesBothQueuesWhenBothHavePendingItems() = runTest {
        val offlineCheckIn = FakeCheckInSyncQueue(
            pending = listOf(pendingZoneCheckIn()),
            syncResult = SyncResult(totalCount = 1, successCount = 1, failedCount = 0, errors = emptyList()),
        )
        val registrationQueue = FakeRegistrationCheckInSyncQueue(pending = listOf(pendingRegistrationCheckIn()))
        val syncService = SyncService(
            offlineCheckInRepository = offlineCheckIn,
            networkMonitor = FakeNetworkMonitor(),
            registrationOfflineQueue = registrationQueue,
            printRetryQueue = FakePrintRetryQueue(),
        )

        syncService.performSync()

        assertEquals(1, registrationQueue.flushCallCount)
        assertEquals(1, offlineCheckIn.syncAllCallCount)
        // Final state settles back to Idle (matching this method's established "auto-clear after
        // 5s" behavior, unchanged by this task) once both queues have been drained.
        assertIs<SyncState.Idle>(syncService.syncState.value)
    }

    @Test
    fun performSyncStillSyncsZoneQueueWhenRegistrationQueueFlushThrows() = runTest {
        val offlineCheckIn = FakeCheckInSyncQueue(
            pending = listOf(pendingZoneCheckIn()),
            syncResult = SyncResult(totalCount = 1, successCount = 1, failedCount = 0, errors = emptyList()),
        )
        val registrationQueue = ThrowingRegistrationCheckInSyncQueue(pending = listOf(pendingRegistrationCheckIn()))
        val syncService = SyncService(
            offlineCheckInRepository = offlineCheckIn,
            networkMonitor = FakeNetworkMonitor(),
            registrationOfflineQueue = registrationQueue,
            printRetryQueue = FakePrintRetryQueue(),
        )

        // Collect every state the service passes through, since the 5s auto-clear-to-Idle at
        // the end of performSync() would otherwise hide the intermediate outcome once `runTest`
        // fast-forwards through the delay.
        val observedStates = mutableListOf<SyncState>()
        val collectJob = launch { syncService.syncState.collect { observedStates += it } }

        syncService.performSync()
        collectJob.cancel()

        assertEquals(1, registrationQueue.flushCallCount)
        // The key assertion: the registration queue's flush() throwing must NOT prevent the
        // zone queue's syncAll() from running — the two queues are genuinely independent.
        assertEquals(1, offlineCheckIn.syncAllCallCount)
        // Mixed outcome (registration queue failed outright, zone queue fully succeeded) maps to
        // the existing PartialSuccess state rather than Failed, since only one of the two queues
        // actually failed.
        assertTrue(observedStates.any { it is SyncState.PartialSuccess })
        assertIs<SyncState.Idle>(syncService.syncState.value)
    }

    @Test
    fun performSyncDrainsEveryEligiblePrintJobEvenWithNoCheckInsPending() = runTest {
        // Real bug this guards against: SyncService.startAutoSync() ran, but nothing ever called
        // PrintQueueRepository.retryNext() -- queued print jobs stayed pending forever. Proves
        // performSync() drains the print queue unconditionally, even when neither check-in queue
        // has anything pending (the case that used to skip performSync() entirely).
        val printRetryQueue = FakePrintRetryQueue(
            mutableListOf(
                PrintRetryResult.Succeeded(1L),
                PrintRetryResult.Succeeded(2L),
                PrintRetryResult.NoJobsPending,
            ),
        )
        val syncService = SyncService(
            offlineCheckInRepository = FakeCheckInSyncQueue(pending = emptyList()),
            networkMonitor = FakeNetworkMonitor(),
            registrationOfflineQueue = FakeRegistrationCheckInSyncQueue(pending = emptyList()),
            printRetryQueue = printRetryQueue,
        )

        syncService.performSync()

        // Called until NoJobsPending: 2 successful retries + the terminating NoJobsPending call.
        assertEquals(3, printRetryQueue.retryNextCallCount)
        assertIs<SyncState.Idle>(syncService.syncState.value)
    }

    @Test
    fun performSyncStopsDrainingPrintQueueOnWithinBackoffWindow() = runTest {
        val printRetryQueue = FakePrintRetryQueue(mutableListOf(PrintRetryResult.WithinBackoffWindow))
        val syncService = SyncService(
            offlineCheckInRepository = FakeCheckInSyncQueue(pending = emptyList()),
            networkMonitor = FakeNetworkMonitor(),
            registrationOfflineQueue = FakeRegistrationCheckInSyncQueue(pending = emptyList()),
            printRetryQueue = printRetryQueue,
        )

        syncService.performSync()

        // Must stop after the single WithinBackoffWindow result, not loop forever.
        assertEquals(1, printRetryQueue.retryNextCallCount)
    }

    @Test
    fun getPendingCountSumsBothQueues() = runTest {
        val syncService = SyncService(
            offlineCheckInRepository = FakeCheckInSyncQueue(pending = listOf(pendingZoneCheckIn())),
            networkMonitor = FakeNetworkMonitor(),
            registrationOfflineQueue = FakeRegistrationCheckInSyncQueue(
                pending = listOf(pendingRegistrationCheckIn(1), pendingRegistrationCheckIn(2)),
            ),
            printRetryQueue = FakePrintRetryQueue(),
        )

        assertEquals(3, syncService.getPendingCount())
    }
}
