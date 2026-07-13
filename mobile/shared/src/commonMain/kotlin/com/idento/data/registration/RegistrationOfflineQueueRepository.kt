package com.idento.data.registration

import app.cash.sqldelight.coroutines.asFlow
import app.cash.sqldelight.coroutines.mapToOne
import com.idento.data.model.BatchCheckinItemDto
import com.idento.data.network.ApiResult
import com.idento.data.sync.RegistrationCheckInSyncQueue
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
) : RegistrationOfflineQueue, RegistrationCheckInSyncQueue {

    override suspend fun enqueue(eventId: String, item: BatchCheckinItemDto) {
        withContext(Dispatchers.Default) {
            try {
                queries.insert(
                    clientUuid = item.clientUuid,
                    eventId = eventId,
                    attendeeId = item.attendeeId,
                    at = item.at,
                    deviceNumber = item.deviceNumber.toLong(),
                    pointName = item.pointName,
                )
            } catch (e: Exception) {
                // Best-effort, matching this codebase's established non-fatal storage-failure
                // pattern (see AuthRepository/AuthPreferences: catch, log, swallow).
                // RegistrationCheckInService.checkIn already unconditionally returns a "Queued"
                // success verdict to the operator after calling enqueue (this interface method
                // returns Unit, so there is no way to signal failure back up regardless) —
                // letting a transient lock-contention exception propagate here would crash the
                // check-in flow, which is strictly worse than losing this one retry-queue write.
                println("⚠️ Failed to persist registration check-in ${item.clientUuid} to offline queue: ${e.message}")
            }
        }
    }

    override suspend fun getPending(): List<PendingRegistrationCheckIn> = withContext(Dispatchers.Default) {
        queries.selectAll().executeAsList().map(::toDomain)
    }

    fun getPendingCountFlow(): Flow<Int> =
        queries.countAll().asFlow().mapToOne(Dispatchers.Default).map { it.toInt() }

    /**
     * Drops every queued registration check-in unconditionally — used when the app is pointed at
     * a different server (see `ServerUrlSaveGateway`'s `clearSession`), since a queued item was
     * addressed to the *previous* server's event/attendee and would otherwise get flushed to the
     * new server on the next successful sync pass.
     */
    suspend fun clearAll() {
        withContext(Dispatchers.Default) {
            queries.deleteAll()
        }
    }

    /**
     * Attempts [BatchCheckinSubmitter.submitBatchCheckins] for every queued item (grouped by
     * `eventId`, since the endpoint is scoped to a single event per call), removing items the
     * backend confirms (`"created"` or `"already_exists"` — both mean the check-in is now
     * authoritatively recorded server-side, so there is nothing left to retry) and recording an
     * attempt/error on every item that couldn't be confirmed, so it stays queued for the next
     * flush rather than being silently dropped.
     */
    override suspend fun flush(): FlushResult = withContext(Dispatchers.Default) {
        var succeeded = 0
        var failed = 0
        val now = Clock.System.now().toEpochMilliseconds()
        val pendingByEvent = queries.selectEligibleForRetry(now).executeAsList().groupBy { it.eventId }

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
                            if (deleteConfirmed(row.id)) succeeded++ else failed++
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

    /**
     * Deletes a server-confirmed (`"created"`/`"already_exists"`) row from the queue. If the
     * delete itself throws (e.g. transient lock contention), the row simply stays queued —
     * [flush] will retry the submission (idempotent per `client_uuid`, so safe to resend) on its
     * next pass rather than crashing the whole flush.
     */
    private fun deleteConfirmed(id: Long): Boolean =
        try {
            queries.deleteById(id)
            true
        } catch (e: Exception) {
            println("⚠️ Failed to remove confirmed registration check-in $id from offline queue: ${e.message}")
            false
        }

    /**
     * Records an attempt/error on a row that couldn't be confirmed this pass, so it stays queued
     * for the next [flush]. If this bookkeeping write itself throws, the row is left untouched
     * (stale attempt count/error message) but still stays queued and gets retried regardless —
     * matching this codebase's established non-fatal storage-failure pattern (see
     * AuthRepository/AuthPreferences: catch, log, swallow).
     */
    private fun recordFailedAttempt(id: Long, currentAttemptCount: Long, error: String) {
        try {
            queries.updateAttempt(
                attemptCount = currentAttemptCount + 1,
                lastAttemptAt = Clock.System.now().toEpochMilliseconds(),
                errorMessage = error,
                id = id,
            )
        } catch (e: Exception) {
            println("⚠️ Failed to record retry attempt for registration check-in $id: ${e.message}")
        }
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
