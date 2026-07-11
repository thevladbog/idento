package com.idento.data.sync

import com.idento.data.registration.FlushResult
import com.idento.data.registration.PendingRegistrationCheckIn
import com.idento.data.repository.SyncResult
import com.idento.data.storage.PendingZoneCheckIn
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

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
        )

        syncService.performSync()

        assertEquals(1, registrationQueue.flushCallCount)
        assertEquals(1, offlineCheckIn.syncAllCallCount)
        // Final state settles back to Idle (matching this method's established "auto-clear after
        // 5s" behavior, unchanged by this task) once both queues have been drained.
        assertIs<SyncState.Idle>(syncService.syncState.value)
    }

    @Test
    fun getPendingCountSumsBothQueues() = runTest {
        val syncService = SyncService(
            offlineCheckInRepository = FakeCheckInSyncQueue(pending = listOf(pendingZoneCheckIn())),
            networkMonitor = FakeNetworkMonitor(),
            registrationOfflineQueue = FakeRegistrationCheckInSyncQueue(
                pending = listOf(pendingRegistrationCheckIn(1), pendingRegistrationCheckIn(2)),
            ),
        )

        assertEquals(3, syncService.getPendingCount())
    }
}
