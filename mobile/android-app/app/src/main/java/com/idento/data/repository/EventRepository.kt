package com.idento.data.repository

import com.idento.data.api.IdentoApi
import com.idento.data.model.Attendee
import com.idento.data.model.Event
import com.idento.data.model.UpdateAttendeeRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EventRepository @Inject constructor(
    private val api: IdentoApi
) {
    
    suspend fun getEvents(): Result<List<Event>> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.getEvents()
                if (response.isSuccessful && response.body() != null) {
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("Failed to fetch events: ${response.message()}"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    suspend fun getEvent(eventId: String): Result<Event> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.getEvent(eventId)
                if (response.isSuccessful && response.body() != null) {
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("Failed to fetch event: ${response.message()}"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    suspend fun getAttendees(eventId: String): Result<List<Attendee>> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.getAttendees(eventId)
                if (response.isSuccessful && response.body() != null) {
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("Failed to fetch attendees: ${response.message()}"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    suspend fun searchAttendee(eventId: String, code: String): Result<Attendee> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.searchAttendee(eventId, code)
                if (response.isSuccessful && response.body() != null) {
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("Attendee not found"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    @Suppress("UNUSED_PARAMETER")
    suspend fun checkinAttendee(eventId: String, attendeeId: String): Result<Attendee> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.checkinAttendee(
                    attendeeId,
                    UpdateAttendeeRequest(checkinStatus = true)
                )
                if (response.isSuccessful && response.body() != null) {
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("Check-in failed: ${response.message()}"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
}
