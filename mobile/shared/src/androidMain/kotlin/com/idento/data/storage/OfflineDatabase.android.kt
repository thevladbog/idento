package com.idento.data.storage

/**
 * Android implementation of OfflineDatabase using SQLite
 * TODO: Implement using Room or SQLDelight
 */
actual class OfflineDatabaseImpl : OfflineDatabase {
    
    // In-memory storage for now (placeholder)
    private val pendingCheckIns = mutableListOf<PendingZoneCheckIn>()
    private var nextId = 1L
    
    override suspend fun savePendingCheckIn(checkIn: PendingZoneCheckIn): Long {
        val id = nextId++
        val withId = checkIn.copy(id = id)
        pendingCheckIns.add(withId)
        return id
    }
    
    override suspend fun getPendingCheckIns(): List<PendingZoneCheckIn> {
        return pendingCheckIns.toList()
    }
    
    override suspend fun deletePendingCheckIn(id: Long) {
        pendingCheckIns.removeAll { it.id == id }
    }
    
    override suspend fun clearPendingCheckIns() {
        pendingCheckIns.clear()
    }
    
    override suspend fun getPendingCheckInsCount(): Int {
        return pendingCheckIns.size
    }
}

