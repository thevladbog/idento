package com.idento.data.registration

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.idento.data.model.PrinterConfig
import com.idento.db.IdentoDatabase
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class PrintQueueRepositoryTest {

    private lateinit var driver: JdbcSqliteDriver
    private lateinit var repository: PrintQueueRepository
    private var printAttempts = 0
    private var shouldPrintSucceed = true

    @BeforeTest
    fun setUp() {
        driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        IdentoDatabase.Schema.create(driver)
        repository = PrintQueueRepository(
            queries = IdentoDatabase(driver).printJobQueries,
            printSender = { _, _, _ -> printAttempts++; if (shouldPrintSucceed) Result.success(Unit) else Result.failure(RuntimeException("printer offline")) },
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
}
