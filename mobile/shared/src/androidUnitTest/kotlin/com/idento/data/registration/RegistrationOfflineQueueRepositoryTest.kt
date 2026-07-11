package com.idento.data.registration

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.idento.data.model.BatchCheckinItemDto
import com.idento.data.model.BatchCheckinResultDto
import com.idento.data.network.ApiResult
import com.idento.db.IdentoDatabase
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.Clock
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

class RegistrationOfflineQueueRepositoryTest {

    private lateinit var driver: JdbcSqliteDriver
    private lateinit var repository: RegistrationOfflineQueueRepository

    @BeforeTest
    fun setUp() {
        driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        IdentoDatabase.Schema.create(driver)
        val database = IdentoDatabase(driver)
        repository = RegistrationOfflineQueueRepository(database.pendingRegistrationCheckInQueries, FakeBatchCheckinSubmitter())
    }

    @AfterTest
    fun tearDown() { driver.close() }

    @Test
    fun enqueueThenFlushSubmitsAndRemovesOnSuccess() = runTest {
        repository.enqueue("evt-1", BatchCheckinItemDto(clientUuid = "u1", attendeeId = "att-1", at = "2026-07-11T10:00:00Z", deviceNumber = 3, kind = "checkin", pointName = "Главный вход"))
        assertEquals(1, repository.getPending().size)

        repository.flush()

        assertEquals(0, repository.getPending().size)
    }

    @Test
    fun flushKeepsItemAndRecordsErrorOnFailure() = runTest {
        val failingRepo = RegistrationOfflineQueueRepository(
            IdentoDatabase(driver).pendingRegistrationCheckInQueries,
            { _, _ -> ApiResult.Error(RuntimeException("offline"), "offline") },
        )
        failingRepo.enqueue("evt-1", BatchCheckinItemDto(clientUuid = "u2", attendeeId = "att-2", at = "2026-07-11T10:00:00Z", deviceNumber = 3, kind = "checkin"))

        failingRepo.flush()

        val pending = failingRepo.getPending()
        assertEquals(1, pending.size)
        assertEquals(1, pending.first().attemptCount)
    }

    @Test
    fun flushSkipsItemStillWithinBackoffWindowButSubmitsAnEligibleOne() = runTest {
        val submittedClientUuids = mutableListOf<String>()
        val trackingRepo = RegistrationOfflineQueueRepository(
            IdentoDatabase(driver).pendingRegistrationCheckInQueries,
            { _, items ->
                submittedClientUuids.addAll(items.map { it.clientUuid })
                ApiResult.Success(items.map { BatchCheckinResultDto(clientUuid = it.clientUuid, status = "created") })
            },
        )
        trackingRepo.enqueue("evt-1", BatchCheckinItemDto(clientUuid = "cooling-down", attendeeId = "att-1", at = "2026-07-11T10:00:00Z", deviceNumber = 3, kind = "checkin"))
        val queries = IdentoDatabase(driver).pendingRegistrationCheckInQueries
        val coolingDownId = trackingRepo.getPending().single().id
        // Simulate 1 prior failed attempt just now: min(1*1, 300) = 1s backoff window, still active.
        queries.updateAttempt(attemptCount = 1, lastAttemptAt = Clock.System.now().toEpochMilliseconds(), errorMessage = "offline", id = coolingDownId)
        trackingRepo.enqueue("evt-1", BatchCheckinItemDto(clientUuid = "eligible", attendeeId = "att-2", at = "2026-07-11T10:00:00Z", deviceNumber = 3, kind = "checkin"))

        trackingRepo.flush()

        assertEquals(listOf("eligible"), submittedClientUuids)
        val stillPending = trackingRepo.getPending()
        assertEquals(1, stillPending.size)
        assertEquals("cooling-down", stillPending.first().clientUuid)
    }
}

private class FakeBatchCheckinSubmitter : com.idento.data.registration.BatchCheckinSubmitter {
    override suspend fun submitBatchCheckins(eventId: String, items: List<BatchCheckinItemDto>) =
        ApiResult.Success(items.map { com.idento.data.model.BatchCheckinResultDto(clientUuid = it.clientUuid, status = "created") })
}
