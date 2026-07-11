package com.idento.data.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class AttendeeCheckinFieldsTest {

    @Test
    fun decodesCheckedInDeviceNumberAndPointNameWhenPresent() {
        val json = """
            {
                "id": "att-1", "event_id": "evt-1", "first_name": "A", "last_name": "B",
                "code": "ABC-123", "checkin_status": true,
                "checked_in_device_number": 3, "checked_in_point_name": "Главный вход"
            }
        """.trimIndent()
        val attendee = Json { ignoreUnknownKeys = true }.decodeFromString(Attendee.serializer(), json)
        assertEquals(3, attendee.checkedInDeviceNumber)
        assertEquals("Главный вход", attendee.checkedInPointName)
    }

    @Test
    fun decodesNullWhenFieldsAbsent() {
        val json = """{"id": "att-1", "event_id": "evt-1", "first_name": "A", "last_name": "B", "code": "ABC-123"}"""
        val attendee = Json { ignoreUnknownKeys = true }.decodeFromString(Attendee.serializer(), json)
        assertEquals(null, attendee.checkedInDeviceNumber)
        assertEquals(null, attendee.checkedInPointName)
    }

    @Test
    fun batchCheckinItemDtoEncodesPointNameWhenSet() {
        val dto = BatchCheckinItemDto(
            clientUuid = "uuid-1", attendeeId = "att-1", at = "2026-07-11T10:00:00Z",
            deviceNumber = 3, kind = "checkin", pointName = "Главный вход",
        )
        val encoded = Json.encodeToString(BatchCheckinItemDto.serializer(), dto)
        assertEquals(true, encoded.contains("\"point_name\":\"Главный вход\""))
    }
}
