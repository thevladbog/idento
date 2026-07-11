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
                    val pendingCount = offlineCheckInRepository.getPendingCheckIns().size
                    val registrationPendingCount = registrationOfflineQueue.getPending().size
                    if (pendingCount > 0 || registrationPendingCount > 0) {
                        delay(2000) // Wait 2 seconds before syncing
                        performSync()
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
     * The two are independent (different tables, different endpoints), so a failure/absence in
     * one does not block the other. [SyncState] continues to reflect only the zone check-in
     * queue's outcome (its shape is tied to `OfflineCheckInRepository`'s `SyncResult`), while the
     * registration queue's flush runs alongside it best-effort so queued registration check-ins
     * actually get drained once the device is back online.
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

            if (registrationPendingCount > 0) {
                registrationOfflineQueue.flush()
            }

            if (pendingCount > 0) {
                val result = offlineCheckInRepository.syncAll()

                _syncState.value = when {
                    result.isSuccess -> SyncState.Success(result)
                    result.hasPartialSuccess -> SyncState.PartialSuccess(result)
                    else -> SyncState.Failed(result.errors.firstOrNull() ?: "Sync failed")
                }
            } else {
                _syncState.value = SyncState.Idle
            }

            // Auto-clear state after 5 seconds
            delay(5000)
            if (_syncState.value !is SyncState.Syncing) {
                _syncState.value = SyncState.Idle
            }
        } catch (e: Exception) {
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

