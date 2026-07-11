package com.idento.data.registration

import com.idento.data.model.Attendee
import com.idento.data.model.BatchCheckinItemDto
import com.idento.data.model.BatchCheckinResultDto
import com.idento.data.model.PrintState
import com.idento.data.model.RegistrationVerdict
import com.idento.data.model.StationConfig
import com.idento.data.network.ApiResult
import kotlinx.datetime.Clock
import kotlinx.datetime.Instant
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Seam matching `AttendeeRepository.submitBatchCheckins(eventId, items)` exactly — see the
 * class-level doc on [AttendeeLookup] for why a plain method reference, rather than an
 * interface implemented by the repository, is this codebase's established seam pattern. */
fun interface BatchCheckinSubmitter {
    suspend fun submitBatchCheckins(eventId: String, items: List<BatchCheckinItemDto>): ApiResult<List<BatchCheckinResultDto>>
}

/** Seam for Task M1c-6's offline queue (`pending_checkins`): a network failure during
 * [RegistrationCheckInService.checkIn] hands the item off here instead of surfacing an error. */
fun interface RegistrationOfflineQueue {
    suspend fun enqueue(eventId: String, item: BatchCheckinItemDto)
}

/**
 * Second (write) half of the registration check-in flow: performs the actual idempotent
 * batch-checkin submission for an attendee already classified as [RegistrationVerdictLookup.Found]
 * by [RegistrationVerdictMapper], and turns the result into a fully-formed [RegistrationVerdict].
 *
 * Race handling: between the read that produced `Found` and this submission landing, another
 * device could check the same attendee in first. The batch endpoint's own idempotent dedup is by
 * `client_uuid`, so it does not catch this (two different client_uuids for the same attendee).
 * Instead, the backend's `ApplyBatchCheckin` (backend/internal/store/pg_store_batch.go, confirmed
 * current as of this task) already guards the underlying write itself: it only flips
 * `checkin_status` when it is still `false`, and reports `BatchCheckinAlreadyCheckedIn` — mapped
 * to `"already_exists"` in the API response — instead of silently overwriting when a different
 * client_uuid/device already won the race. So a genuine cross-device race is always a safe no-op
 * server-side, never a lost update; this service's job is just to report the *authoritative*
 * winning detail to the operator, which requires a re-fetch since this device's own submission
 * payload only knows its own attempted values, not who actually won.
 */
class RegistrationCheckInService(
    private val batchSubmitter: BatchCheckinSubmitter,
    private val attendeeLookup: AttendeeLookup = AttendeeLookup { _, _ ->
        ApiResult.Error(IllegalStateException("No AttendeeLookup configured"), "No AttendeeLookup configured")
    },
    private val offlineQueue: RegistrationOfflineQueue = RegistrationOfflineQueue { _, _ -> },
) {
    @OptIn(ExperimentalUuidApi::class)
    suspend fun checkIn(eventId: String, station: StationConfig, attendee: Attendee): RegistrationVerdict {
        val clientUuid = Uuid.random().toString()
        val now = Clock.System.now()
        val item = BatchCheckinItemDto(
            clientUuid = clientUuid,
            attendeeId = attendee.id,
            at = now.toString(),
            deviceNumber = station.deviceNumber,
            kind = "checkin",
            pointName = station.workPointName,
        )

        return when (val result = batchSubmitter.submitBatchCheckins(eventId, listOf(item))) {
            is ApiResult.Success -> {
                val itemResult = result.data.firstOrNull { it.clientUuid == clientUuid }
                when (itemResult?.status) {
                    "created" -> RegistrationVerdict.Success(
                        attendee = toVerdictAttendee(attendee),
                        at = now,
                        firstTime = true,
                        printState = PrintState.Queued,
                    )
                    "already_exists" -> alreadyCheckedVerdict(eventId, station, attendee, now)
                    else -> {
                        // Missing result for our clientUuid, or a per-item "error" status: the
                        // server-side outcome is unknown/unconfirmed, so — per the same
                        // "don't block the operator" rule as a transport failure — treat it as
                        // queued for offline retry rather than surfacing an error verdict.
                        offlineQueue.enqueue(eventId, item)
                        RegistrationVerdict.Success(toVerdictAttendee(attendee), now, firstTime = true, printState = PrintState.Queued)
                    }
                }
            }
            is ApiResult.Error -> {
                offlineQueue.enqueue(eventId, item)
                RegistrationVerdict.Success(toVerdictAttendee(attendee), now, firstTime = true, printState = PrintState.Queued)
            }
            is ApiResult.Loading -> RegistrationVerdict.Success(toVerdictAttendee(attendee), now, firstTime = true, printState = PrintState.Queued)
        }
    }

    /**
     * Builds the [RegistrationVerdict.AlreadyChecked] verdict for an `"already_exists"` submission
     * result. Re-fetches the attendee to get the authoritative checked-in detail (which device
     * actually won the race), falling back to this device's own submission values whenever the
     * re-fetch can't produce authoritative data — a transport error, or (extremely unlikely, but
     * must not crash) the attendee somehow not coming back on the re-fetch itself. Either way, a
     * locally-consistent guess beats an error screen for a check-in the operator can see plainly
     * worked.
     */
    private suspend fun alreadyCheckedVerdict(
        eventId: String,
        station: StationConfig,
        attendee: Attendee,
        submittedAt: Instant,
    ): RegistrationVerdict.AlreadyChecked {
        val fallback = RegistrationVerdict.AlreadyChecked(
            attendee = toVerdictAttendee(attendee),
            firstAt = submittedAt,
            firstPoint = station.workPointName,
            firstDevice = station.deviceNumber,
        )
        return when (val refetched = attendeeLookup.getAttendeeByCode(eventId, attendee.code)) {
            is ApiResult.Success -> {
                val authoritative = refetched.data
                if (authoritative != null && authoritative.isCheckedIn) {
                    RegistrationVerdict.AlreadyChecked(
                        attendee = toVerdictAttendee(authoritative),
                        firstAt = authoritative.checkedInAt?.let { Instant.parse(it) } ?: submittedAt,
                        firstPoint = authoritative.checkedInPointName ?: station.workPointName,
                        firstDevice = authoritative.checkedInDeviceNumber ?: station.deviceNumber,
                    )
                } else {
                    // authoritative == null (attendee vanished from the re-fetch) or, oddly,
                    // no longer checked in — neither carries authoritative detail, so fall back.
                    fallback
                }
            }
            is ApiResult.Error, is ApiResult.Loading -> fallback
        }
    }
}
