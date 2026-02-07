package com.idento.data.repository

import com.idento.data.model.ZoneCheckInRequest
import com.idento.data.network.ApiResult
import com.idento.data.storage.OfflineDatabase
import com.idento.data.storage.PendingZoneCheckIn
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.datetime.Clock

/**
 * Repository for offline check-in management
 * Handles storing check-ins locally when offline and syncing when online
 */
class OfflineCheckInRepository(
    private val offlineDatabase: OfflineDatabase,
    private val zoneRepository: ZoneRepository
) {
    
    /**
     * Perform zone check-in with offline support
     * If online - performs immediately
     * If offline - saves to local database for later sync
     */
    suspend fun performCheckIn(
        request: ZoneCheckInRequest,
        isOnline: Boolean
    ): ApiResult<Unit> {
        return if (isOnline) {
            // Try online check-in
            when (val result = zoneRepository.performZoneCheckIn(request)) {
                is ApiResult.Success -> ApiResult.Success(Unit)
                is ApiResult.Error -> {
                    // If failed, save offline
                    saveOfflineCheckIn(request)
                    val errorMessage = "Saved offline: ${result.message}"
                    ApiResult.Error(Exception(errorMessage), message = errorMessage)
                }
                is ApiResult.Loading -> ApiResult.Loading
            }
        } else {
            // Save offline immediately
            saveOfflineCheckIn(request)
            ApiResult.Success(Unit)
        }
    }
    
    /**
     * Save check-in to offline storage
     */
    private suspend fun saveOfflineCheckIn(request: ZoneCheckInRequest): Long {
        val pending = PendingZoneCheckIn(
            attendeeCode = request.attendeeCode,
            zoneId = request.zoneId,
            eventDay = request.eventDay,
            checkedInAt = Clock.System.now().toEpochMilliseconds()
        )
        return offlineDatabase.savePendingCheckIn(pending)
    }
    
    /**
     * Get all pending check-ins
     */
    suspend fun getPendingCheckIns(): List<PendingZoneCheckIn> {
        return offlineDatabase.getPendingCheckIns()
    }
    
    /**
     * Get pending check-ins count as Flow
     */
    fun getPendingCheckInsCountFlow(): Flow<Int> = flow {
        emit(offlineDatabase.getPendingCheckInsCount())
    }
    
    /**
     * Sync a single pending check-in
     */
    suspend fun syncCheckIn(pending: PendingZoneCheckIn): ApiResult<Unit> {
        val request = ZoneCheckInRequest(
            attendeeCode = pending.attendeeCode,
            zoneId = pending.zoneId,
            eventDay = pending.eventDay
        )
        
        return when (val result = zoneRepository.performZoneCheckIn(request)) {
            is ApiResult.Success -> {
                // Delete from offline storage on success
                pending.id?.let { offlineDatabase.deletePendingCheckIn(it) }
                ApiResult.Success(Unit)
            }
            is ApiResult.Error -> {
                // Update attempt count
                val errorMessage = result.message ?: "Sync failed"
                ApiResult.Error(Exception(errorMessage), message = errorMessage)
            }
            is ApiResult.Loading -> ApiResult.Loading
        }
    }
    
    /**
     * Sync all pending check-ins
     */
    suspend fun syncAll(): SyncResult {
        val pending = offlineDatabase.getPendingCheckIns()
        var successCount = 0
        var failedCount = 0
        val errors = mutableListOf<String>()
        
        pending.forEach { checkIn ->
            when (syncCheckIn(checkIn)) {
                is ApiResult.Success -> successCount++
                is ApiResult.Error -> {
                    failedCount++
                    errors.add("Check-in ${checkIn.id}: failed")
                }
                is ApiResult.Loading -> {}
            }
        }
        
        return SyncResult(
            totalCount = pending.size,
            successCount = successCount,
            failedCount = failedCount,
            errors = errors
        )
    }
    
    /**
     * Clear all pending check-ins (use with caution)
     */
    suspend fun clearAll() {
        offlineDatabase.clearPendingCheckIns()
    }
}

/**
 * Result of synchronization attempt
 */
data class SyncResult(
    val totalCount: Int,
    val successCount: Int,
    val failedCount: Int,
    val errors: List<String>
) {
    val isSuccess: Boolean get() = failedCount == 0 && totalCount > 0
    val hasPartialSuccess: Boolean get() = successCount > 0 && failedCount > 0
    val isComplete: Boolean get() = totalCount == 0 || failedCount == 0
}

