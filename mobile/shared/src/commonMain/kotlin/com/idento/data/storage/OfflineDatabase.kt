package com.idento.data.storage

/**
 * Offline Database interface for SQLite storage
 * Stores zone check-ins locally when offline
 */
interface OfflineDatabase {
    
    /**
     * Save a pending zone check-in for later synchronization
     */
    suspend fun savePendingCheckIn(checkIn: PendingZoneCheckIn): Long
    
    /**
     * Get all pending check-ins that need to be synchronized
     */
    suspend fun getPendingCheckIns(): List<PendingZoneCheckIn>
    
    /**
     * Delete a pending check-in after successful synchronization
     */
    suspend fun deletePendingCheckIn(id: Long)
    
    /**
     * Clear all pending check-ins (use with caution)
     */
    suspend fun clearPendingCheckIns()
    
    /**
     * Get count of pending check-ins
     */
    suspend fun getPendingCheckInsCount(): Int
}

/**
 * Represents a zone check-in stored offline
 */
data class PendingZoneCheckIn(
    val id: Long? = null,
    val attendeeCode: String,
    val zoneId: String,
    val eventDay: String,
    val checkedInAt: Long, // Timestamp in milliseconds
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
    val errorMessage: String? = null
)

/**
 * Platform-specific database implementation
 */
expect class OfflineDatabaseImpl() : OfflineDatabase

