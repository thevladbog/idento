package com.idento.data.repository

import com.idento.data.model.EventZone
import com.idento.data.model.EventZoneWithStats
import com.idento.data.model.MovementHistoryEntry
import com.idento.data.model.ZoneCheckInRequest
import com.idento.data.model.ZoneCheckInResponse
import com.idento.data.network.ApiResult
import com.idento.data.network.ZoneApiService
import com.idento.data.network.toApiResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Zone Repository (Cross-platform)
 * Handles zone-related operations for multi-zone and multi-day events
 */
class ZoneRepository(
    private val zoneApiService: ZoneApiService
) {
    
    /**
     * Get all zones assigned to current staff user for an event
     */
    suspend fun getStaffZones(eventId: String): ApiResult<List<EventZoneWithStats>> {
        return zoneApiService.getStaffZones(eventId).toApiResult()
    }
    
    /**
     * Get staff zones as Flow
     */
    fun getStaffZonesFlow(eventId: String): Flow<ApiResult<List<EventZoneWithStats>>> = flow {
        emit(ApiResult.Loading)
        emit(getStaffZones(eventId))
    }
    
    /**
     * Get zone by ID
     */
    suspend fun getZone(zoneId: String): ApiResult<EventZone> {
        return zoneApiService.getZone(zoneId).toApiResult()
    }
    
    /**
     * Perform zone check-in
     */
    suspend fun performZoneCheckIn(request: ZoneCheckInRequest): ApiResult<ZoneCheckInResponse> {
        return zoneApiService.performZoneCheckIn(request).toApiResult()
    }
    
    /**
     * Get attendee movement history
     */
    suspend fun getAttendeeMovementHistory(attendeeId: String): ApiResult<List<MovementHistoryEntry>> {
        return zoneApiService.getAttendeeMovementHistory(attendeeId).toApiResult()
    }
    
    /**
     * Get attendee movement history as Flow
     */
    fun getAttendeeMovementHistoryFlow(attendeeId: String): Flow<ApiResult<List<MovementHistoryEntry>>> = flow {
        emit(ApiResult.Loading)
        emit(getAttendeeMovementHistory(attendeeId))
    }
    
    /**
     * Get event days (list of dates between start and end)
     */
    fun getEventDays(startDate: String, endDate: String): List<String> {
        return zoneApiService.getEventDays(startDate, endDate)
    }
}

