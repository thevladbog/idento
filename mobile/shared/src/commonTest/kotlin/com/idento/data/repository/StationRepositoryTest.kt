package com.idento.data.repository

import com.idento.data.model.ProvisionStationResponseDto
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class StationRepositoryTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun provisionStationResponseDecodesBackendJsonShape() {
        // Exact shape returned by backend/internal/handler/stations.go's ProvisionStation.
        val raw = """
            {
              "station_config": {"event_id": "evt-1", "event_name": "Технопром-2026", "staff_name": "staff@idento.app"},
              "staff_jwt": "eyJhbGciOiJIUzI1NiJ9.example.sig",
              "device_number": 3
            }
        """.trimIndent()
        val decoded = json.decodeFromString(ProvisionStationResponseDto.serializer(), raw)
        assertEquals("evt-1", decoded.stationConfig.eventId)
        assertEquals("Технопром-2026", decoded.stationConfig.eventName)
        assertEquals(3, decoded.deviceNumber)
        assertEquals("eyJhbGciOiJIUzI1NiJ9.example.sig", decoded.staffJwt)
    }

    @Test
    fun zoneScanResponseDecodesAllowedVerdictShape() {
        val raw = """
            {
              "verdict": "allowed",
              "reason": "Access granted by category",
              "attendee": null,
              "registration": {"passed": true, "at": "2026-07-10T09:18:00Z", "point": "Главный вход"},
              "checked_in_at": "2026-07-10T14:32:00Z",
              "first_entry": true
            }
        """.trimIndent()
        val decoded = json.decodeFromString(com.idento.data.model.ZoneScanResponseDto.serializer(), raw)
        assertEquals("allowed", decoded.verdict)
        assertEquals(true, decoded.firstEntry)
        assertEquals("Главный вход", decoded.registration?.point)
    }
}
