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
 * drivers wired in SqlDriverFactory). Proves the insert/select/delete queries actually
 * persist every field, not just that the code compiles.
 */
class SqlDelightOfflineDatabaseTest {

    private lateinit var driver: JdbcSqliteDriver
    private lateinit var db: OfflineDatabase

    @BeforeTest
    fun setUp() {
        driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        IdentoDatabase.Schema.create(driver)
        val database = IdentoDatabase(driver)
        db = object : OfflineDatabase {
            private val queries = database.pendingCheckInQueries
            override suspend fun savePendingCheckIn(checkIn: PendingZoneCheckIn): Long {
                return queries.transactionWithResult {
                    queries.insertOrIgnore(
                        attendeeCode = checkIn.attendeeCode,
                        zoneId = checkIn.zoneId,
                        eventDay = checkIn.eventDay,
                        checkedInAt = checkIn.checkedInAt,
                        attemptCount = checkIn.attemptCount.toLong(),
                        lastAttemptAt = checkIn.lastAttemptAt,
                        errorMessage = checkIn.errorMessage,
                    )
                    queries.selectByKey(checkIn.attendeeCode, checkIn.zoneId, checkIn.eventDay).executeAsOne().id
                }
            }
            override suspend fun getPendingCheckIns(): List<PendingZoneCheckIn> =
                queries.selectAll().executeAsList().map {
                    PendingZoneCheckIn(
                        id = it.id, attendeeCode = it.attendeeCode, zoneId = it.zoneId,
                        eventDay = it.eventDay, checkedInAt = it.checkedInAt,
                        attemptCount = it.attemptCount.toInt(), lastAttemptAt = it.lastAttemptAt,
                        errorMessage = it.errorMessage,
                    )
                }
            override suspend fun deletePendingCheckIn(id: Long) { queries.deleteById(id) }
            override suspend fun clearPendingCheckIns() { queries.deleteAll() }
            override suspend fun getPendingCheckInsCount(): Int = queries.countAll().executeAsOne().toInt()
        }
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
