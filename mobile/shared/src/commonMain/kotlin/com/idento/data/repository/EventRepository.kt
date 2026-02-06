package com.idento.data.repository

import com.idento.data.model.Event
import com.idento.data.network.ApiResult
import com.idento.data.network.EventApiService
import com.idento.data.network.toApiResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Event Repository (Cross-platform)
 * Handles event-related operations
 */
class EventRepository(
    private val eventApiService: EventApiService
) {
    
    /**
     * Get all events
     */
    suspend fun getEvents(): ApiResult<List<Event>> {
        return eventApiService.getEvents().toApiResult()
    }
    
    /**
     * Get events as Flow
     */
    fun getEventsFlow(): Flow<ApiResult<List<Event>>> = flow {
        emit(ApiResult.Loading)
        emit(getEvents())
    }
    
    /**
     * Get event by ID
     */
    suspend fun getEvent(eventId: String): ApiResult<Event> {
        return eventApiService.getEvent(eventId).toApiResult()
    }
    
    /**
     * Get event as Flow
     */
    fun getEventFlow(eventId: String): Flow<ApiResult<Event>> = flow {
        emit(ApiResult.Loading)
        emit(getEvent(eventId))
    }
    
    /**
     * Create new event
     */
    suspend fun createEvent(event: Event): ApiResult<Event> {
        return eventApiService.createEvent(event).toApiResult()
    }
    
    /**
     * Update event
     */
    suspend fun updateEvent(eventId: String, event: Event): ApiResult<Event> {
        return eventApiService.updateEvent(eventId, event).toApiResult()
    }
    
    /**
     * Delete event
     */
    suspend fun deleteEvent(eventId: String): ApiResult<Unit> {
        return eventApiService.deleteEvent(eventId).toApiResult()
    }
    
    /**
     * Get badge template for event
     */
    suspend fun getBadgeTemplate(eventId: String): ApiResult<String?> {
        return when (val result = getEvent(eventId)) {
            is ApiResult.Success -> {
                val template = result.data.badgeTemplate
                ApiResult.Success(template)
            }
            is ApiResult.Error -> result
            is ApiResult.Loading -> ApiResult.Loading
        }
    }
}
