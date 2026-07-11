package com.idento.data.network

import com.idento.data.model.Attendee
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlinx.serialization.Serializable

/**
 * Check-in request body
 */
@Serializable
data class CheckinRequest(
    val checkin_status: Boolean = true
)

/**
 * Attendee API Service (Ktor version)
 */
class AttendeeApiService(private val apiClient: ApiClient) {
    
    /**
     * Get all attendees for event
     */
    suspend fun getAttendees(eventId: String): Result<List<Attendee>> = runCatching {
        apiClient.httpClient.get("/api/events/$eventId/attendees").body()
    }
    
    /**
     * Get attendee by ID
     */
    suspend fun getAttendee(attendeeId: String): Result<Attendee> = runCatching {
        apiClient.httpClient.get("/api/attendees/$attendeeId").body()
    }
    
    /**
     * Create new attendee
     */
    suspend fun createAttendee(eventId: String, attendee: Attendee): Result<Attendee> = runCatching {
        apiClient.httpClient.post("/api/events/$eventId/attendees") {
            setBody(attendee)
        }.body()
    }
    
    /**
     * Update attendee (full update)
     */
    suspend fun updateAttendee(attendeeId: String, attendee: Attendee): Result<Attendee> = runCatching {
        apiClient.httpClient.patch("/api/attendees/$attendeeId") {
            setBody(attendee)
        }.body()
    }
    
    /**
     * Check-in attendee
     * Sends PUT with JSON body: {"checkin_status": true}
     */
    suspend fun checkinAttendee(attendeeId: String): Result<Attendee> {
        return try {
            println("📤 Checkin request: PUT /api/attendees/$attendeeId")
            println("📤 Body: {\"checkin_status\": true}")
            
            // Use raw JSON string to ensure correct serialization
            val jsonBody = """{"checkin_status": true}"""
            
            val response = apiClient.httpClient.put("/api/attendees/$attendeeId") {
                contentType(ContentType.Application.Json)
                setBody(jsonBody)
            }
            
            println("📥 Response status: ${response.status}")
            
            if (response.status.isSuccess()) {
                val attendee: Attendee = response.body()
                println("📥 Response body: checkinStatus=${attendee.checkinStatus}, checkedInAt=${attendee.checkedInAt}")
                Result.success(attendee)
            } else {
                val errorBody = response.bodyAsText()
                println("❌ Error response: $errorBody")
                Result.failure(Exception("Check-in failed: ${response.status.description} - $errorBody"))
            }
        } catch (e: Exception) {
            println("❌ Exception: ${e.message}")
            e.printStackTrace()
            Result.failure(e)
        }
    }
    
    /**
     * Block attendee
     */
    suspend fun blockAttendee(attendeeId: String, reason: String): Result<Attendee> = runCatching {
        apiClient.httpClient.post("/api/attendees/$attendeeId/block") {
            setBody(mapOf("reason" to reason))
        }.body()
    }
    
    /**
     * Unblock attendee
     */
    suspend fun unblockAttendee(attendeeId: String): Result<Attendee> = runCatching {
        apiClient.httpClient.post("/api/attendees/$attendeeId/unblock").body()
    }
    
    /**
     * Delete attendee
     */
    suspend fun deleteAttendee(attendeeId: String): Result<Unit> = runCatching {
        apiClient.httpClient.delete("/api/attendees/$attendeeId")
    }
    
    /**
     * Search attendees by query
     */
    suspend fun searchAttendees(eventId: String, query: String): Result<List<Attendee>> = runCatching {
        apiClient.httpClient.get("/api/events/$eventId/attendees") {
            parameter("search", query)
        }.body()
    }
    
    /**
     * Get attendee by QR code.
     *
     * Returns `null` (inside [Result.success]) when the backend genuinely finds no attendee
     * matching [code] for [eventId] — the endpoint filters server-side and correctly responds
     * 200 OK with an empty list for an unregistered/invalid code. A real network/HTTP failure
     * still throws and is captured by [apiRunCatching] as [Result.failure], so callers can tell
     * "no match" apart from "we couldn't complete the lookup".
     */
    suspend fun getAttendeeByCode(eventId: String, code: String): Result<Attendee?> = apiRunCatching {
        apiClient.httpClient.get("/api/events/$eventId/attendees") {
            parameter("code", code)
        }.body<List<Attendee>>().firstOrNull()
    }

    /** POST /api/events/:event_id/checkins/batch — idempotent offline-sync flush. */
    suspend fun submitBatchCheckins(eventId: String, items: List<com.idento.data.model.BatchCheckinItemDto>): Result<List<com.idento.data.model.BatchCheckinResultDto>> = apiRunCatching {
        apiClient.httpClient.post("/api/events/$eventId/checkins/batch") {
            contentType(ContentType.Application.Json)
            setBody(items)
        }.body()
    }

    /** POST /api/events/:event_id/checkins/override — staff "proceed anyway" audit log. */
    suspend fun submitOverride(eventId: String, request: com.idento.data.model.CreateCheckinOverrideRequestDto): Result<com.idento.data.model.CheckinOverrideDto> = apiRunCatching {
        apiClient.httpClient.post("/api/events/$eventId/checkins/override") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.body()
    }
}
