package com.idento.data.sync

import com.idento.data.repository.OfflineCheckInRepository
import com.idento.data.repository.SyncResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sync Service for offline check-ins
 * Automatically syncs pending check-ins when online
 */
class SyncService(
    private val offlineCheckInRepository: OfflineCheckInRepository,
    private val networkMonitor: NetworkMonitor
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
                    if (pendingCount > 0) {
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
     * Manually trigger sync
     */
    suspend fun performSync() {
        if (_syncState.value is SyncState.Syncing) {
            return // Already syncing
        }
        
        try {
            val pendingCount = offlineCheckInRepository.getPendingCheckIns().size
            
            if (pendingCount == 0) {
                _syncState.value = SyncState.Idle
                return
            }
            
            _syncState.value = SyncState.Syncing(0, pendingCount)
            
            val result = offlineCheckInRepository.syncAll()
            
            _syncState.value = when {
                result.isSuccess -> SyncState.Success(result)
                result.hasPartialSuccess -> SyncState.PartialSuccess(result)
                else -> SyncState.Failed(result.errors.firstOrNull() ?: "Sync failed")
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
     * Get pending check-ins count
     */
    suspend fun getPendingCount(): Int {
        return offlineCheckInRepository.getPendingCheckIns().size
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
expect class NetworkMonitorImpl() : NetworkMonitor

