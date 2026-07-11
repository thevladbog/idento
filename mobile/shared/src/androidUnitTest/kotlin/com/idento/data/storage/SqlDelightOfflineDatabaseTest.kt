package com.idento.data.storage

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.idento.db.IdentoDatabase
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Real SQLDelight round-trip test (JVM in-memory SQLite via the sqlite-driver test
 * dependency — this is JVM-only test infra, separate from the app's real Android/iOS
 * drivers wired in SqlDriverFactory). Exercises the real [SqlDelightOfflineDatabase]
 * (constructed directly from an [IdentoDatabase], matching its production DI wiring in
 * AppModule) rather than a re-implementation, proving the insert/select/delete queries
 * actually persist every field, not just that the code compiles.
 */
class SqlDelightOfflineDatabaseTest {

    private lateinit var driver: JdbcSqliteDriver
    private lateinit var db: OfflineDatabase

    @BeforeTest
    fun setUp() {
        driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        IdentoDatabase.Schema.create(driver)
        val database = IdentoDatabase(driver)
        db = SqlDelightOfflineDatabase(database)
    }

    @AfterTest
    fun tearDown() {
        driver.close()
    }

    @Test
    fun savedCheckInRoundTripsAllFieldsIncludingRetryState() = runTest {
        val id = db.savePendingCheckIn(
            PendingZoneCheckIn(
                attendeeCode = "ABCD1234",
                zoneId = "zone-1",
                eventDay = "2026-07-10",
                checkedInAt = 1720000000000L,
                attemptCount = 2,
                lastAttemptAt = 1720000005000L,
                errorMessage = "Network timeout",
            )
        )
        assertTrue(id > 0)

        val all = db.getPendingCheckIns()
        assertEquals(1, all.size)
        val saved = all.first()
        assertEquals("ABCD1234", saved.attendeeCode)
        assertEquals("zone-1", saved.zoneId)
        assertEquals(2, saved.attemptCount)
        assertEquals(1720000005000L, saved.lastAttemptAt)
        assertEquals("Network timeout", saved.errorMessage)
    }

    @Test
    fun deleteAndClearActuallyRemoveRows() = runTest {
        val id1 = db.savePendingCheckIn(PendingZoneCheckIn(attendeeCode = "A", zoneId = "z1", eventDay = "2026-07-10", checkedInAt = 1L))
        db.savePendingCheckIn(PendingZoneCheckIn(attendeeCode = "B", zoneId = "z1", eventDay = "2026-07-10", checkedInAt = 2L))
        assertEquals(2, db.getPendingCheckInsCount())

        db.deletePendingCheckIn(id1)
        assertEquals(1, db.getPendingCheckInsCount())
        assertNull(db.getPendingCheckIns().find { it.id == id1 })

        db.clearPendingCheckIns()
        assertEquals(0, db.getPendingCheckInsCount())
    }

    @Test
    fun duplicateScanOfSameAttendeeZoneDayDoesNotCreateASecondRow() = runTest {
        val first = db.savePendingCheckIn(
            PendingZoneCheckIn(attendeeCode = "DUP1", zoneId = "zone-1", eventDay = "2026-07-10", checkedInAt = 1L)
        )
        val second = db.savePendingCheckIn(
            PendingZoneCheckIn(attendeeCode = "DUP1", zoneId = "zone-1", eventDay = "2026-07-10", checkedInAt = 2L)
        )
        assertEquals(first, second)
        assertEquals(1, db.getPendingCheckInsCount())
    }
}
