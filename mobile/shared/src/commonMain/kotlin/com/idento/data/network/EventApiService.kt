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
        apiClient.httpClient.get("/api/events").body()
    }
    
    /**
     * Get event by ID
     */
    suspend fun getEvent(eventId: String): Result<Event> = runCatching {
        apiClient.httpClient.get("/api/events/$eventId").body()
    }
    
    /**
     * Create new event
     */
    suspend fun createEvent(event: Event): Result<Event> = runCatching {
        apiClient.httpClient.post("/api/events") {
            setBody(event)
        }.body()
    }
    
    /**
     * Update event
     */
    suspend fun updateEvent(eventId: String, event: Event): Result<Event> = runCatching {
        apiClient.httpClient.put("/api/events/$eventId") {
            setBody(event)
        }.body()
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
        }.body()
    }
}
