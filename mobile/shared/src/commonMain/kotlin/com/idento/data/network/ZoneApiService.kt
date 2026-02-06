package com.idento.data.network

import com.idento.data.model.EventZone
import com.idento.data.model.EventZoneWithStats
import com.idento.data.model.MovementHistoryEntry
import com.idento.data.model.ZoneCheckInRequest
import com.idento.data.model.ZoneCheckInResponse
import com.idento.data.model.ZoneQRData
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*

/**
 * Zone API Service for multi-zone and multi-day event support
 */
class ZoneApiService(private val apiClient: ApiClient) {
    
    /**
     * Get all zones for an event (mobile app - filtered by staff assignment)
     */
    suspend fun getStaffZones(eventId: String): Result<List<EventZoneWithStats>> = runCatching {
        apiClient.httpClient.get("/api/mobile/events/$eventId/zones").body()
    }
    
    /**
     * Get zone by ID
     */
    suspend fun getZone(zoneId: String): Result<EventZone> = runCatching {
        apiClient.httpClient.get("/api/zones/$zoneId").body()
    }
    
    /**
     * Perform zone check-in
     */
    suspend fun performZoneCheckIn(request: ZoneCheckInRequest): Result<ZoneCheckInResponse> = runCatching {
        apiClient.httpClient.post("/api/zones/checkin") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.body()
    }
    
    /**
     * Get attendee movement history (all zone check-ins)
     */
    suspend fun getAttendeeMovementHistory(attendeeId: String): Result<List<MovementHistoryEntry>> = runCatching {
        apiClient.httpClient.get("/api/attendees/$attendeeId/movement-history").body()
    }
    
    /**
     * Parse zone QR code data
     */
    fun parseZoneQR(qrData: String): ZoneQRData? {
        return try {
            kotlinx.serialization.json.Json.decodeFromString(ZoneQRData.serializer(), qrData)
        } catch (e: Exception) {
            null
        }
    }
    
    /**
     * Get event days (generates list of days between start and end date)
     */
    fun getEventDays(startDate: String, endDate: String): List<String> {
        // Parse dates in YYYY-MM-DD format
        val start = startDate.take(10)
        val end = endDate.take(10)
        
        val days = mutableListOf<String>()
        var currentDate = start
        
        // Simple date iteration (assuming dates are valid)
        while (currentDate <= end) {
            days.add(currentDate)
            currentDate = incrementDate(currentDate)
        }
        
        return days
    }
    
    /**
     * Helper to increment date by one day (YYYY-MM-DD format)
     */
    private fun incrementDate(dateString: String): String {
        val parts = dateString.split("-")
        val year = parts[0].toInt()
        val month = parts[1].toInt()
        val day = parts[2].toInt()
        
        val daysInMonth = getDaysInMonth(month, year)
        
        return when {
            day < daysInMonth -> String.format("%04d-%02d-%02d", year, month, day + 1)
            month < 12 -> String.format("%04d-%02d-01", year, month + 1)
            else -> String.format("%04d-01-01", year + 1)
        }
    }
    
    /**
     * Helper to get days in month
     */
    private fun getDaysInMonth(month: Int, year: Int): Int {
        return when (month) {
            1, 3, 5, 7, 8, 10, 12 -> 31
            4, 6, 9, 11 -> 30
            2 -> if (isLeapYear(year)) 29 else 28
            else -> 30
        }
    }
    
    /**
     * Helper to check leap year
     */
    private fun isLeapYear(year: Int): Boolean {
        return (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
    }
}

