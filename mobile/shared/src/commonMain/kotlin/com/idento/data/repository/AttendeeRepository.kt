package com.idento.data.repository

import com.idento.data.model.Attendee
import com.idento.data.network.ApiResult
import com.idento.data.network.AttendeeApiService
import com.idento.data.network.toApiResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Attendee Repository (Cross-platform)
 * Handles attendee-related operations
 */
class AttendeeRepository(
    private val attendeeApiService: AttendeeApiService
) {
    
    /**
     * Get all attendees for event
     */
    suspend fun getAttendees(eventId: String): ApiResult<List<Attendee>> {
        return attendeeApiService.getAttendees(eventId).toApiResult()
    }
    
    /**
     * Get attendees as Flow
     */
    fun getAttendeesFlow(eventId: String): Flow<ApiResult<List<Attendee>>> = flow {
        emit(ApiResult.Loading)
        emit(getAttendees(eventId))
    }
    
    /**
     * Get attendee by ID
     */
    suspend fun getAttendee(attendeeId: String): ApiResult<Attendee> {
        return attendeeApiService.getAttendee(attendeeId).toApiResult()
    }
    
    /**
     * Create new attendee
     */
    suspend fun createAttendee(eventId: String, attendee: Attendee): ApiResult<Attendee> {
        return attendeeApiService.createAttendee(eventId, attendee).toApiResult()
    }
    
    /**
     * Update attendee
     */
    suspend fun updateAttendee(attendeeId: String, attendee: Attendee): ApiResult<Attendee> {
        return attendeeApiService.updateAttendee(attendeeId, attendee).toApiResult()
    }
    
    /**
     * Check-in attendee
     */
    suspend fun checkinAttendee(attendeeId: String): ApiResult<Attendee> {
        return attendeeApiService.checkinAttendee(attendeeId).toApiResult()
    }
    
    /**
     * Block attendee
     */
    suspend fun blockAttendee(attendeeId: String, reason: String): ApiResult<Attendee> {
        return attendeeApiService.blockAttendee(attendeeId, reason).toApiResult()
    }
    
    /**
     * Unblock attendee
     */
    suspend fun unblockAttendee(attendeeId: String): ApiResult<Attendee> {
        return attendeeApiService.unblockAttendee(attendeeId).toApiResult()
    }
    
    /**
     * Delete attendee
     */
    suspend fun deleteAttendee(attendeeId: String): ApiResult<Unit> {
        return attendeeApiService.deleteAttendee(attendeeId).toApiResult()
    }
    
    /**
     * Search attendees
     */
    suspend fun searchAttendees(eventId: String, query: String): ApiResult<List<Attendee>> {
        return if (query.isBlank()) {
            getAttendees(eventId)
        } else {
            attendeeApiService.searchAttendees(eventId, query).toApiResult()
        }
    }
    
    /**
     * Get attendee by QR code
     */
    suspend fun getAttendeeByCode(eventId: String, code: String): ApiResult<Attendee> {
        return attendeeApiService.getAttendeeByCode(eventId, code).toApiResult()
    }
    
    /**
     * Get checked-in attendees
     */
    suspend fun getCheckedInAttendees(eventId: String): ApiResult<List<Attendee>> {
        return when (val result = getAttendees(eventId)) {
            is ApiResult.Success -> {
                val checkedIn = result.data.filter { it.isCheckedIn }
                ApiResult.Success(checkedIn)
            }
            is ApiResult.Error -> result
            is ApiResult.Loading -> ApiResult.Loading
        }
    }
    
    /**
     * Get checked-in count
     */
    suspend fun getCheckedInCount(eventId: String): ApiResult<Int> {
        return when (val result = getCheckedInAttendees(eventId)) {
            is ApiResult.Success -> ApiResult.Success(result.data.size)
            is ApiResult.Error -> result
            is ApiResult.Loading -> ApiResult.Loading
        }
    }
}
