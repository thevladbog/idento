package com.idento.data.zonecontrol

import com.idento.data.model.Attendee
import com.idento.data.model.RegistrationInfoDto
import com.idento.data.model.VerdictAttendee
import com.idento.data.model.ZoneScanResponseDto
import com.idento.data.model.ZoneVerdict
import com.idento.data.network.ApiResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ZoneVerdictAdapterTest {

    private fun fakeAttendee(id: String = "att-1") = Attendee(
        id = id,
        eventId = "evt-1",
        firstName = "Иван",
        lastName = "Иванов",
        code = "QR-001",
        checkinStatus = false,
    )

    @Test
    fun allowedVerdictMapsCorrectly() = runTest {
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(
                ZoneScanResponseDto(
                    verdict = "allowed",
                    attendee = fakeAttendee(),
                    registration = RegistrationInfoDto(passed = true, at = "2026-07-11T10:00:00Z", point = "Главный вход"),
                    checkedInAt = "2026-07-11T12:00:00Z",
                    firstEntry = true,
                )
            )
        })
        val result = adapter.lookup("zone-1", "QR-001")
        assertIs<ZoneVerdict.Allowed>(result)
        assertEquals("Главный вход", result.registeredPoint)
        assertEquals(true, result.firstEntry)
    }

    @Test
    fun noAccessVerdictMapsCorrectly() = runTest {
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(
                ZoneScanResponseDto(verdict = "no_access", reason = "Zone is closed", attendee = fakeAttendee())
            )
        })
        val result = adapter.lookup("zone-1", "QR-001")
        assertIs<ZoneVerdict.NoAccess>(result)
        assertEquals("Zone is closed", result.ruleReason)
    }

    @Test
    fun notRegisteredVerdictMapsCorrectly() = runTest {
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(
                ZoneScanResponseDto(verdict = "not_registered", reason = "Attendee has not registered yet", attendee = fakeAttendee())
            )
        })
        val result = adapter.lookup("zone-1", "QR-001")
        assertIs<ZoneVerdict.NotRegistered>(result)
        assertEquals("Attendee has not registered yet", result.registrationPointHint)
    }

    @Test
    fun networkErrorMapsToLookupError() = runTest {
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Error(Exception("404 Not Found"), "404 Not Found")
        })
        val result = adapter.lookup("zone-1", "UNKNOWN-CODE")
        assertIs<ZoneVerdict.LookupError>(result)
        assertEquals("404 Not Found", result.message)
    }

    @Test
    fun missingAttendeeInSuccessResponseMapsToLookupError() = runTest {
        // Defensive: the backend should never return verdict=allowed with no attendee body, but
        // if it did, this must not crash — it should degrade to LookupError like a network error.
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "allowed", attendee = null))
        })
        val result = adapter.lookup("zone-1", "QR-001")
        assertIs<ZoneVerdict.LookupError>(result)
    }
}
