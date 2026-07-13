package com.idento.data.network

import com.idento.data.model.DisplayTemplate
import com.idento.data.model.Event
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*

/**
 * Event API Service (Ktor version)
 */
class EventApiService(private val apiClient: ApiClient) {
    
    /**
     * Get all events for current user
     */
    suspend fun getEvents(): Result<List<Event>> = runCatching {
        apiClient.httpClient.get("/api/events").bodyOrApiError()
    }

    /**
     * Get event by ID
     */
    suspend fun getEvent(eventId: String): Result<Event> = runCatching {
        apiClient.httpClient.get("/api/events/$eventId").bodyOrApiError()
    }

    /**
     * Create new event
     */
    suspend fun createEvent(event: Event): Result<Event> = runCatching {
        apiClient.httpClient.post("/api/events") {
            setBody(event)
        }.bodyOrApiError()
    }

    /**
     * Update event
     */
    suspend fun updateEvent(eventId: String, event: Event): Result<Event> = runCatching {
        apiClient.httpClient.put("/api/events/$eventId") {
            setBody(event)
        }.bodyOrApiError()
    }
    
    /**
     * Delete event
     */
    suspend fun deleteEvent(eventId: String): Result<Unit> = runCatching {
        apiClient.httpClient.delete("/api/events/$eventId")
    }
    
    /**
     * Get display template for event
     * Returns default template from server (if configured in admin panel)
     */
    suspend fun getDisplayTemplate(eventId: String): Result<DisplayTemplate?> = runCatching {
        val response = apiClient.httpClient.get("/api/events/$eventId/display-template")
        
        if (response.status == HttpStatusCode.NotFound) {
            null
        } else if (response.status.isSuccess()) {
            response.body<DisplayTemplate>()
        } else {
            null
        }
    }
    
    /**
     * Save display template for event (admin only)
     */
    suspend fun saveDisplayTemplate(eventId: String, template: DisplayTemplate): Result<DisplayTemplate> = runCatching {
        apiClient.httpClient.post("/api/events/$eventId/display-template") {
            contentType(ContentType.Application.Json)
            setBody(template)
        }.bodyOrApiError()
    }

    /** GET /api/events/:event_id/stats?zone= — KPI counters for the mobile status bar. */
    suspend fun getEventStats(eventId: String, zoneId: String? = null): Result<com.idento.data.model.EventStatsResponseDto> = apiRunCatching {
        apiClient.httpClient.get("/api/events/$eventId/stats") {
            if (zoneId != null) {
                parameter("zone", zoneId)
            }
        }.bodyOrApiError()
    }
}
