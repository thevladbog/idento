package com.idento.data.registration

import com.idento.data.model.Attendee
import com.idento.data.model.BadgeTemplate
import com.idento.data.model.BatchCheckinItemDto
import com.idento.data.model.BatchCheckinResultDto
import com.idento.data.model.PrinterConfig
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

/** Seam matching `PrintQueueRepository.enqueue(zpl, printer)` exactly (Task M1c-8's persistent
 * print queue) — see the class-level doc on [AttendeeLookup] for why a plain method reference,
 * rather than an interface implemented by the repository, is this codebase's established seam
 * pattern. The real implementation lets storage exceptions propagate (see that method's own doc);
 * [RegistrationCheckInService.checkIn] catches them rather than losing an otherwise-successful
 * check-in verdict. */
fun interface PrintJobEnqueuer {
    suspend fun enqueue(zpl: String, printer: PrinterConfig): Long
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
    private val printJobEnqueuer: PrintJobEnqueuer = PrintJobEnqueuer { _, _ ->
        throw IllegalStateException("No PrintJobEnqueuer configured")
    },
) {
    /**
     * @param badgeTemplate The event's printable badge template, if one is known to the caller.
     * Nullable and explicit rather than fetched internally: as of this task, there is no
     * per-event/station `BadgeTemplate` source wired into the M1c registration engine (the only
     * existing mechanism, `EventRepository.getBadgeTemplate`, is used solely by the separate,
     * older single-attendee `CheckinViewModel` flow — not by this batch check-in service). Sourcing
     * it end-to-end (fetch + cache per event/station) is left to whichever future task wires this
     * service into the DI graph.
     */
    @OptIn(ExperimentalUuidApi::class)
    suspend fun checkIn(
        eventId: String,
        station: StationConfig,
        attendee: Attendee,
        badgeTemplate: BadgeTemplate? = null,
    ): RegistrationVerdict {
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
                        printState = maybeEnqueuePrint(station, attendee, badgeTemplate),
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
     * Enqueues a print job for a *newly-created* check-in (never for the `"already_exists"`
     * conflict path — see [checkIn], a conflict means another device already checked this
     * attendee in, so no fresh badge print is warranted from this device) when the station is
     * actually set up to auto-print: `station.autoPrint` is on, a `station.printer` is paired, and
     * a [badgeTemplate] is available. Generates ZPL via [BadgeTemplate.generateZPL] (already
     * escapes ZPL special characters — see that function's doc) and hands it to
     * [printJobEnqueuer], the real implementation being `PrintQueueRepository.enqueue`.
     *
     * Returns [PrintState.Done] when no print was attempted at all (autoPrint off, no printer
     * paired, or no badge template available): there is no pending print job to track in that
     * case, so "done" (nothing outstanding) is a more accurate resting state than `Queued`, which
     * would incorrectly imply a job is in flight. [PrintState] has no distinct "not applicable"
     * case, so this is a deliberate reuse of `Done`.
     *
     * If the enqueue call itself throws — `PrintQueueRepository.enqueue` deliberately lets storage
     * exceptions propagate rather than swallowing them (see that method's doc) — the check-in
     * itself already succeeded server-side; only the local print queueing failed, so that failure
     * is reported via [PrintState.Failed] instead of throwing out of [checkIn] and losing the
     * check-in verdict entirely.
     */
    private suspend fun maybeEnqueuePrint(
        station: StationConfig,
        attendee: Attendee,
        badgeTemplate: BadgeTemplate?,
    ): PrintState {
        val printer = station.printer
        if (!station.autoPrint || printer == null || badgeTemplate == null) {
            return PrintState.Done
        }
        return try {
            val zpl = badgeTemplate.generateZPL(attendee)
            printJobEnqueuer.enqueue(zpl, printer)
            PrintState.Queued
        } catch (e: Exception) {
            PrintState.Failed(e.message ?: "Failed to enqueue print job")
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
