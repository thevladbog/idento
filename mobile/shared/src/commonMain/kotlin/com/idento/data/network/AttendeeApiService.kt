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
     * Get attendee by QR code
     */
    suspend fun getAttendeeByCode(eventId: String, code: String): Result<Attendee> = runCatching {
        apiClient.httpClient.get("/api/events/$eventId/attendees") {
            parameter("code", code)
        }.body<List<Attendee>>().firstOrNull() 
            ?: throw Exception("Attendee not found")
    }
}
