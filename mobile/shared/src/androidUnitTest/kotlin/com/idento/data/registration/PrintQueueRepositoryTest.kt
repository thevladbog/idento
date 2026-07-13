package com.idento.data.registration

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.idento.data.model.PrinterConfig
import com.idento.db.IdentoDatabase
import com.idento.db.PrintJobQueries
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.Clock
import kotlin.test.*

class PrintQueueRepositoryTest {

    private lateinit var driver: JdbcSqliteDriver
    private lateinit var queries: PrintJobQueries
    private lateinit var repository: PrintQueueRepository
    private var printAttempts = 0
    private var shouldPrintSucceed = true
    private var lastSentZpl: String? = null

    @BeforeTest
    fun setUp() {
        driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        IdentoDatabase.Schema.create(driver)
        queries = IdentoDatabase(driver).printJobQueries
        repository = PrintQueueRepository(
            queries = queries,
            printSender = { _, _, zpl ->
                printAttempts++
                lastSentZpl = zpl
                if (shouldPrintSucceed) Result.success(Unit) else Result.failure(RuntimeException("printer offline"))
            },
        )
    }

    @AfterTest
    fun tearDown() { driver.close() }

    @Test
    fun enqueueThenRetryNextSucceedsAndMarksDone() = runTest {
        val id = repository.enqueue("^XA^FDTest^FS^XZ", PrinterConfig(name = "Zebra", transport = "bluetooth", address = "00:11:22:33:44:55"))
        repository.retryNext()
        assertEquals(0, repository.getPending().size)
        assertEquals(1, printAttempts)
    }

    @Test
    fun retryNextIncrementsAttemptCountOnFailureAndKeepsJobPending() = runTest {
        shouldPrintSucceed = false
        repository.enqueue("^XA^FDTest^FS^XZ", PrinterConfig(name = "Zebra", transport = "bluetooth", address = "00:11:22:33:44:55"))
        repository.retryNext()
        val pending = repository.getPending()
        assertEquals(1, pending.size)
        assertEquals(1, pending.first().attemptCount)
        assertEquals("printer offline", pending.first().errorMessage)
    }

    @Test
    fun retryNextSkipsJobWithinBackoffWindowInFavorOfEligibleJob() = runTest {
        val printer = PrinterConfig(name = "Zebra", transport = "bluetooth", address = "00:11:22:33:44:55")
        val coolingDownId = repository.enqueue("^XA^FDCoolingDown^FS^XZ", printer)
        // Directly simulate a print job that failed once and is still within its exponential
        // backoff window: attemptCount=1 -> min(1*1, 300) = 1 second, and lastAttemptAt is set to
        // "now" here (immediately before retryNext() runs), so — well under a second later — the
        // window has not elapsed yet.
        queries.updateAttempt(
            attemptCount = 1L,
            lastAttemptAt = Clock.System.now().toEpochMilliseconds(),
            errorMessage = "printer offline",
            id = coolingDownId,
        )
        val eligibleId = repository.enqueue("^XA^FDEligible^FS^XZ", printer)

        val result = repository.retryNext()

        // The still-cooling-down job must be skipped in favor of the newer, immediately-eligible one.
        assertEquals("^XA^FDEligible^FS^XZ", lastSentZpl)
        assertEquals(1, printAttempts)
        assertEquals(PrintRetryResult.Succeeded(eligibleId), result)
        val pendingIds = repository.getPending().map { it.id }
        assertEquals(listOf(coolingDownId), pendingIds)
    }

    @Test
    fun retryNextReturnsWithinBackoffWindowWhenTheOnlyPendingJobIsCoolingDown() = runTest {
        val printer = PrinterConfig(name = "Zebra", transport = "bluetooth", address = "00:11:22:33:44:55")
        val id = repository.enqueue("^XA^FDTest^FS^XZ", printer)
        queries.updateAttempt(
            attemptCount = 1L,
            lastAttemptAt = Clock.System.now().toEpochMilliseconds(),
            errorMessage = "printer offline",
            id = id,
        )

        val result = repository.retryNext()

        assertEquals(PrintRetryResult.WithinBackoffWindow, result)
        assertEquals(0, printAttempts)
        assertNull(lastSentZpl)
    }

    @Test
    fun clearAllRemovesEveryQueuedJob() = runTest {
        val printer = PrinterConfig(name = "Zebra", transport = "bluetooth", address = "00:11:22:33:44:55")
        repository.enqueue("^XA^FDOne^FS^XZ", printer)
        repository.enqueue("^XA^FDTwo^FS^XZ", printer)
        assertEquals(2, repository.getPending().size)

        repository.clearAll()

        assertEquals(0, repository.getPending().size)
    }
}
