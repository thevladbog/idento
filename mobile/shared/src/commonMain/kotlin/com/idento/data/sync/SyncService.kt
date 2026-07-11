package com.idento.data.sync

import com.idento.data.registration.FlushResult
import com.idento.data.registration.PendingRegistrationCheckIn
import com.idento.data.repository.SyncResult
import com.idento.data.storage.PendingZoneCheckIn
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Seam over [com.idento.data.repository.OfflineCheckInRepository]'s sync-relevant surface —
 * matching this codebase's established "consumer defines the minimal interface it needs"
 * pattern (see `BatchCheckinSubmitter`/`RegistrationOfflineQueue` in `RegistrationCheckInService.kt`),
 * so `SyncServiceTest` can fake the zone check-in queue without constructing a real
 * `ZoneRepository`/`ApiClient` network stack. `OfflineCheckInRepository` already exposes both
 * methods with this exact signature and implements this interface with no other changes.
 */
interface CheckInSyncQueue {
    suspend fun getPendingCheckIns(): List<PendingZoneCheckIn>
    suspend fun syncAll(): SyncResult
}

/**
 * Seam over [com.idento.data.registration.RegistrationOfflineQueueRepository]'s sync-relevant
 * surface (Task M1c-6) — distinct from `RegistrationOfflineQueue` (which only covers `enqueue`,
 * called from `RegistrationCheckInService`) because `SyncService` instead needs to check the
 * pending count and trigger a flush. Lets `SyncServiceTest` fake this without constructing a
 * real SQLDelight `PendingRegistrationCheckInQueries`.
 */
interface RegistrationCheckInSyncQueue {
    suspend fun getPending(): List<PendingRegistrationCheckIn>
    suspend fun flush(): FlushResult
}

/**
 * Sync Service for offline check-ins
 * Automatically syncs pending check-ins when online
 */
class SyncService(
    private val offlineCheckInRepository: CheckInSyncQueue,
    private val networkMonitor: NetworkMonitor,
    private val registrationOfflineQueue: RegistrationCheckInSyncQueue,
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _syncState = MutableStateFlow<SyncState>(SyncState.Idle)
    val syncState: StateFlow<SyncState> = _syncState.asStateFlow()

    private var syncJob: Job? = null

    /**
     * Start monitoring and auto-sync
     */
    fun startAutoSync() {
        syncJob?.cancel()
        syncJob = scope.launch {
            networkMonitor.isOnline.collect { isOnline ->
                if (isOnline) {
                    try {
                        val pendingCount = offlineCheckInRepository.getPendingCheckIns().size
                        val registrationPendingCount = registrationOfflineQueue.getPending().size
                        if (pendingCount > 0 || registrationPendingCount > 0) {
                            delay(2000) // Wait 2 seconds before syncing
                            performSync()
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        // This collector is the only thing driving auto-sync for the app
                        // session — there's no separate restart path if it dies, so a failed
                        // pending-count read (or an unexpected failure from performSync()) must
                        // not kill it. Matches the `apiRunCatching`-style CancellationException
                        // rethrow used elsewhere in this codebase (see ApiResult.kt) so
                        // `stopAutoSync()`'s cancellation of this job still works correctly.
                        println("⚠️ Auto-sync pass failed: ${e.message}")
                    }
                }
            }
        }
    }

    /**
     * Stop auto-sync
     */
    fun stopAutoSync() {
        syncJob?.cancel()
        syncJob = null
    }

    /**
     * Manually trigger sync — drains both the zone check-in queue (`OfflineCheckInRepository`)
     * and the registration check-in queue (`RegistrationOfflineQueueRepository`, Task M1c-6).
     * The two are genuinely independent (different tables, different endpoints): each queue's
     * flush/sync call is wrapped in its own try/catch below, so an exception thrown by one (e.g.
     * `RegistrationOfflineQueueRepository.flush()`'s unguarded initial `queries.selectAll()`
     * read) is caught and folded into this pass's result instead of propagating up and skipping
     * the other queue's sync entirely.
     *
     * [SyncState] reflects the combined outcome across both queues for this pass:
     * [SyncState.Success] when every pending item across both queues was handled,
     * [SyncState.PartialSuccess] when some succeeded and some failed — this also covers the
     * mixed case where one queue's operation threw outright while the other completed normally
     * — and [SyncState.Failed] when nothing succeeded.
     */
    suspend fun performSync() {
        if (_syncState.value is SyncState.Syncing) {
            return // Already syncing
        }

        try {
            val pendingCount = offlineCheckInRepository.getPendingCheckIns().size
            val registrationPendingCount = registrationOfflineQueue.getPending().size

            if (pendingCount == 0 && registrationPendingCount == 0) {
                _syncState.value = SyncState.Idle
                return
            }

            _syncState.value = SyncState.Syncing(0, pendingCount + registrationPendingCount)

            val errors = mutableListOf<String>()

            var registrationSucceeded = 0
            var registrationFailed = 0
            if (registrationPendingCount > 0) {
                try {
                    val flushResult = registrationOfflineQueue.flush()
                    registrationSucceeded = flushResult.succeeded
                    registrationFailed = flushResult.failed
                } catch (e: Exception) {
                    // The whole flush attempt failed before it could process anything (e.g. its
                    // initial read threw) — every pending registration check-in stays queued/
                    // unconfirmed for the next pass. Caught locally (rather than by the outer
                    // catch below) specifically so this does NOT skip the zone queue's sync.
                    registrationFailed = registrationPendingCount
                    errors += "Registration queue sync failed: ${e.message ?: "Unknown error"}"
                }
            }

            var zoneSucceeded = 0
            var zoneFailed = 0
            if (pendingCount > 0) {
                try {
                    val result = offlineCheckInRepository.syncAll()
                    zoneSucceeded = result.successCount
                    zoneFailed = result.failedCount
                    errors += result.errors
                } catch (e: Exception) {
                    // Mirrors the registration queue's guard above — caught locally so a
                    // failure here can't retroactively undo the registration flush above.
                    zoneFailed = pendingCount
                    errors += "Zone check-in queue sync failed: ${e.message ?: "Unknown error"}"
                }
            }

            val combined = SyncResult(
                totalCount = pendingCount + registrationPendingCount,
                successCount = zoneSucceeded + registrationSucceeded,
                failedCount = zoneFailed + registrationFailed,
                errors = errors,
            )

            _syncState.value = when {
                combined.isSuccess -> SyncState.Success(combined)
                combined.hasPartialSuccess -> SyncState.PartialSuccess(combined)
                else -> SyncState.Failed(combined.errors.firstOrNull() ?: "Sync failed")
            }

            // Auto-clear state after 5 seconds
            delay(5000)
            if (_syncState.value !is SyncState.Syncing) {
                _syncState.value = SyncState.Idle
            }
        } catch (e: Exception) {
            // Guards against failures outside the per-queue try/catches above (e.g. reading the
            // initial pending counts).
            _syncState.value = SyncState.Failed(e.message ?: "Unknown error")
            delay(5000)
            _syncState.value = SyncState.Idle
        }
    }

    /**
     * Get pending check-ins count across both offline queues (zone check-ins + registration
     * check-ins) — read by the M1d offline banner.
     */
    suspend fun getPendingCount(): Int {
        return offlineCheckInRepository.getPendingCheckIns().size + registrationOfflineQueue.getPending().size
    }

    /**
     * Clear sync state
     */
    fun clearState() {
        _syncState.value = SyncState.Idle
    }
}

/**
 * Sync state
 */
sealed class SyncState {
    data object Idle : SyncState()
    data class Syncing(val current: Int, val total: Int) : SyncState()
    data class Success(val result: SyncResult) : SyncState()
    data class PartialSuccess(val result: SyncResult) : SyncState()
    data class Failed(val message: String) : SyncState()
}

/**
 * Network monitor interface
 * Platform-specific implementation
 */
interface NetworkMonitor {
    val isOnline: kotlinx.coroutines.flow.Flow<Boolean>
    suspend fun checkConnectivity(): Boolean
}

/**
 * Platform-specific network monitor implementation
 */
expect class NetworkMonitorImpl() : NetworkMonitor {
    override val isOnline: kotlinx.coroutines.flow.Flow<Boolean>
    override suspend fun checkConnectivity(): Boolean
}

