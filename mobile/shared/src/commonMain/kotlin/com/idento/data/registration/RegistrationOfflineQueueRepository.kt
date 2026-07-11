package com.idento.data.registration

import app.cash.sqldelight.coroutines.asFlow
import app.cash.sqldelight.coroutines.mapToOne
import com.idento.data.model.BatchCheckinItemDto
import com.idento.data.network.ApiResult
import com.idento.db.PendingRegistrationCheckInQueries
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.datetime.Clock

/**
 * Domain representation of a queued registration check-in awaiting submission — deliberately a
 * hand-rolled type (not the raw SQLDelight-generated row), matching this codebase's established
 * `PendingZoneCheckIn`/`PendingCheckIn` convention (see `OfflineDatabase.kt`): numeric columns
 * come back from SQLDelight as `Long`, but callers work with `Int` (matching `BatchCheckinItemDto`
 * and `StationConfig.deviceNumber`).
 */
data class PendingRegistrationCheckIn(
    val id: Long,
    val clientUuid: String,
    val eventId: String,
    val attendeeId: String,
    val at: String,
    val deviceNumber: Int,
    val pointName: String?,
    val attemptCount: Int,
    val lastAttemptAt: Long?,
    val errorMessage: String?,
)

/** Outcome of a single [RegistrationOfflineQueueRepository.flush] pass. */
data class FlushResult(val succeeded: Int, val failed: Int)

/**
 * SQLDelight-backed implementation of [RegistrationOfflineQueue]: persists registration
 * check-ins that couldn't be confirmed against the backend (transport failure, or an
 * unconfirmed/ambiguous per-item result) so they can be retried later by [flush], rather than
 * being lost when [RegistrationCheckInService.checkIn] returns a queued verdict to the operator.
 *
 * Follows the same `withContext(Dispatchers.Default)` pattern as [SqlDelightOfflineDatabase][
 * com.idento.data.storage.SqlDelightOfflineDatabase] for every suspend method touching the
 * SQLDelight queries object.
 */
class RegistrationOfflineQueueRepository(
    private val queries: PendingRegistrationCheckInQueries,
    private val submitter: BatchCheckinSubmitter,
) : RegistrationOfflineQueue {

    override suspend fun enqueue(eventId: String, item: BatchCheckinItemDto) {
        withContext(Dispatchers.Default) {
            queries.insert(
                clientUuid = item.clientUuid,
                eventId = eventId,
                attendeeId = item.attendeeId,
                at = item.at,
                deviceNumber = item.deviceNumber.toLong(),
                pointName = item.pointName,
            )
        }
    }

    suspend fun getPending(): List<PendingRegistrationCheckIn> = withContext(Dispatchers.Default) {
        queries.selectAll().executeAsList().map(::toDomain)
    }

    fun getPendingCountFlow(): Flow<Int> =
        queries.countAll().asFlow().mapToOne(Dispatchers.Default).map { it.toInt() }

    /**
     * Attempts [BatchCheckinSubmitter.submitBatchCheckins] for every queued item (grouped by
     * `eventId`, since the endpoint is scoped to a single event per call), removing items the
     * backend confirms (`"created"` or `"already_exists"` — both mean the check-in is now
     * authoritatively recorded server-side, so there is nothing left to retry) and recording an
     * attempt/error on every item that couldn't be confirmed, so it stays queued for the next
     * flush rather than being silently dropped.
     */
    suspend fun flush(): FlushResult = withContext(Dispatchers.Default) {
        var succeeded = 0
        var failed = 0
        val pendingByEvent = queries.selectAll().executeAsList().groupBy { it.eventId }

        for ((eventId, rows) in pendingByEvent) {
            val items = rows.map { row ->
                BatchCheckinItemDto(
                    clientUuid = row.clientUuid,
                    attendeeId = row.attendeeId,
                    at = row.at,
                    deviceNumber = row.deviceNumber.toInt(),
                    kind = "checkin",
                    pointName = row.pointName,
                )
            }

            when (val result = submitter.submitBatchCheckins(eventId, items)) {
                is ApiResult.Success -> {
                    val resultsByClientUuid = result.data.associateBy { it.clientUuid }
                    for (row in rows) {
                        val itemResult = resultsByClientUuid[row.clientUuid]
                        if (itemResult != null && (itemResult.status == "created" || itemResult.status == "already_exists")) {
                            queries.deleteById(row.id)
                            succeeded++
                        } else {
                            recordFailedAttempt(row.id, row.attemptCount, itemResult?.error ?: "No result returned for clientUuid")
                            failed++
                        }
                    }
                }
                is ApiResult.Error -> {
                    val message = result.message ?: result.exception.message ?: "Unknown error"
                    for (row in rows) {
                        recordFailedAttempt(row.id, row.attemptCount, message)
                        failed++
                    }
                }
                is ApiResult.Loading -> {
                    // A suspend submitter should never actually return Loading; treat
                    // defensively as an unconfirmed attempt rather than crashing or dropping data.
                    for (row in rows) {
                        recordFailedAttempt(row.id, row.attemptCount, "Submission still loading")
                        failed++
                    }
                }
            }
        }

        FlushResult(succeeded, failed)
    }

    private fun recordFailedAttempt(id: Long, currentAttemptCount: Long, error: String) {
        queries.updateAttempt(
            attemptCount = currentAttemptCount + 1,
            lastAttemptAt = Clock.System.now().toEpochMilliseconds(),
            errorMessage = error,
            id = id,
        )
    }

    private fun toDomain(row: com.idento.db.PendingRegistrationCheckIn): PendingRegistrationCheckIn =
        PendingRegistrationCheckIn(
            id = row.id,
            clientUuid = row.clientUuid,
            eventId = row.eventId,
            attendeeId = row.attendeeId,
            at = row.at,
            deviceNumber = row.deviceNumber.toInt(),
            pointName = row.pointName,
            attemptCount = row.attemptCount.toInt(),
            lastAttemptAt = row.lastAttemptAt,
            errorMessage = row.errorMessage,
        )
}
