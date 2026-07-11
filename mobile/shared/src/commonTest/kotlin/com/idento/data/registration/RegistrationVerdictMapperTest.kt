package com.idento.data.registration

import com.idento.data.model.Attendee
import com.idento.data.network.ApiResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RegistrationVerdictMapperTest {

    private class FakeAttendeeLookup(
        private val result: ApiResult<Attendee>,
    ) : AttendeeLookup {
        override suspend fun getAttendeeByCode(eventId: String, code: String): ApiResult<Attendee> = result
    }

    private fun attendee(
        isBlocked: Boolean = false,
        isCheckedIn: Boolean = false,
        checkedInAt: String? = null,
        checkedInPointName: String? = null,
        checkedInDeviceNumber: Int? = null,
        blockReason: String? = null,
    ) = Attendee(
        id = "att-1", eventId = "evt-1", firstName = "Иван", lastName = "Петров",
        company = "Acme", code = "ABC-123", checkinStatus = isCheckedIn,
        checkedInAt = checkedInAt, checkedInByEmail = null,
        checkedInDeviceNumber = checkedInDeviceNumber, checkedInPointName = checkedInPointName,
        isBlocked = isBlocked, blockReason = blockReason,
    )

    @Test
    fun foundEligibleAttendeeReturnsFound() = runTest {
        val mapper = RegistrationVerdictMapper(FakeAttendeeLookup(ApiResult.Success(attendee())))
        val result = mapper.lookup("evt-1", "ABC-123")
        assertTrue(result is RegistrationVerdictLookup.Found)
    }

    @Test
    fun blockedAttendeeReturnsDeniedWithReason() = runTest {
        val mapper = RegistrationVerdictMapper(FakeAttendeeLookup(ApiResult.Success(attendee(isBlocked = true, blockReason = "VIP list only"))))
        val result = mapper.lookup("evt-1", "ABC-123")
        assertTrue(result is RegistrationVerdictLookup.Denied)
        assertEquals("VIP list only", (result as RegistrationVerdictLookup.Denied).verdict.reason)
    }

    @Test
    fun alreadyCheckedInAttendeeReturnsAlreadyCheckedWithFullDetail() = runTest {
        val mapper = RegistrationVerdictMapper(FakeAttendeeLookup(ApiResult.Success(
            attendee(isCheckedIn = true, checkedInAt = "2026-07-11T10:00:00Z", checkedInPointName = "Главный вход", checkedInDeviceNumber = 3)
        )))
        val result = mapper.lookup("evt-1", "ABC-123")
        assertTrue(result is RegistrationVerdictLookup.AlreadyChecked)
        val verdict = (result as RegistrationVerdictLookup.AlreadyChecked).verdict
        assertEquals("Главный вход", verdict.firstPoint)
        assertEquals(3, verdict.firstDevice)
    }

    @Test
    fun notFoundCodeReturnsLookupFailed() = runTest {
        val mapper = RegistrationVerdictMapper(FakeAttendeeLookup(ApiResult.Error(RuntimeException("not found"), "Not found")))
        val result = mapper.lookup("evt-1", "ZZZ-999")
        assertTrue(result is RegistrationVerdictLookup.LookupFailed)
        assertEquals("Not found", (result as RegistrationVerdictLookup.LookupFailed).message)
    }
}
