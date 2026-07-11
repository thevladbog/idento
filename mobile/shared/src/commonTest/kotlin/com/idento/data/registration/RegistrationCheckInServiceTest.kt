package com.idento.data.registration

import com.idento.data.model.*
import com.idento.data.network.ApiResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertIs
import kotlin.test.assertEquals

class RegistrationCheckInServiceTest {

    private val station = StationConfig(
        eventId = "evt-1", eventName = "Технопром-2026", mode = StationMode.REGISTRATION,
        dayDate = "2026-07-11", workPointId = "wp-1", workPointName = "Главный вход",
        printer = null, autoPrint = false, deviceNumber = 3, staffName = "staff@idento.app",
    )

    private val attendee = Attendee(
        id = "att-1", eventId = "evt-1", firstName = "Иван", lastName = "Петров", code = "ABC-123",
    )

    @Test
    fun successfulSubmissionReturnsSuccessVerdict() = runTest {
        val service = RegistrationCheckInService(
            batchSubmitter = { _, items -> ApiResult.Success(listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "created"))) },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.Success>(verdict)
        assertEquals(true, verdict.firstTime)
    }

    @Test
    fun conflictResponseReturnsAlreadyCheckedNotSuccess() = runTest {
        val service = RegistrationCheckInService(
            batchSubmitter = { _, items -> ApiResult.Success(listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "already_exists"))) },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.AlreadyChecked>(verdict)
    }

    @Test
    fun networkFailureDuringSubmissionEnqueuesOfflineAndReturnsQueuedSuccess() = runTest {
        val enqueued = mutableListOf<BatchCheckinItemDto>()
        val service = RegistrationCheckInService(
            batchSubmitter = { _, _ -> ApiResult.Error(RuntimeException("offline"), "offline") },
            offlineQueue = { _, item -> enqueued.add(item) },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.Success>(verdict)
        assertEquals(PrintState.Queued, verdict.printState)
        assertEquals(1, enqueued.size)
        assertEquals(attendee.id, enqueued.first().attendeeId)
    }

    @Test
    fun conflictResponseRefetchesAndUsesWinningDeviceDetailNotOwnSubmission() = runTest {
        // The attendee lost the race — a DIFFERENT device (number 9, "Служебный вход") actually
        // won it. The re-fetch must surface THAT device's detail, not this station's own
        // deviceNumber=3/"Главный вход" submission values.
        val winningDeviceAttendee = attendee.copy(
            checkinStatus = true,
            checkedInAt = "2026-07-11T09:55:00Z",
            checkedInPointName = "Служебный вход",
            checkedInDeviceNumber = 9,
        )
        val service = RegistrationCheckInService(
            batchSubmitter = { _, items -> ApiResult.Success(listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "already_exists"))) },
            attendeeLookup = { _, _ -> ApiResult.Success(winningDeviceAttendee) },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.AlreadyChecked>(verdict)
        assertEquals("Служебный вход", verdict.firstPoint)
        assertEquals(9, verdict.firstDevice)
    }

    @Test
    fun conflictResponseFallsBackToOwnSubmissionWhenRefetchFails() = runTest {
        val service = RegistrationCheckInService(
            batchSubmitter = { _, items -> ApiResult.Success(listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "already_exists"))) },
            attendeeLookup = { _, _ -> ApiResult.Error(RuntimeException("timeout"), "timeout") },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.AlreadyChecked>(verdict)
        assertEquals(station.workPointName, verdict.firstPoint)
        assertEquals(station.deviceNumber, verdict.firstDevice)
    }

    @Test
    fun conflictResponseFallsBackToOwnSubmissionWhenRefetchReturnsNull() = runTest {
        // Extremely unlikely (attendee vanishing from a by-code re-fetch that just reported
        // "already_exists" for it), but must not crash — same fallback as a failed re-fetch.
        val service = RegistrationCheckInService(
            batchSubmitter = { _, items -> ApiResult.Success(listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "already_exists"))) },
            attendeeLookup = { _, _ -> ApiResult.Success(null) },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.AlreadyChecked>(verdict)
        assertEquals(station.workPointName, verdict.firstPoint)
        assertEquals(station.deviceNumber, verdict.firstDevice)
    }
}
