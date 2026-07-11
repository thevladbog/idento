package com.idento.data.storage

import com.idento.db.IdentoDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Real, persistent OfflineDatabase backed by SQLDelight (replaces the previous non-persistent
 * in-memory placeholder). Single common implementation — SqlDriverFactory is the only
 * per-platform piece.
 *
 * Takes an already-constructed [IdentoDatabase] rather than building its own from a
 * [SqlDriverFactory]: the same physical "idento.db" file also backs
 * [com.idento.data.registration.RegistrationOfflineQueueRepository]'s queue, and both must share
 * one [IdentoDatabase]/[app.cash.sqldelight.db.SqlDriver] connection rather than each opening a
 * separate connection to the same file (see AppModule's DI wiring).
 */
class SqlDelightOfflineDatabase(database: IdentoDatabase) : OfflineDatabase {

    private val queries = database.pendingCheckInQueries

    override suspend fun savePendingCheckIn(checkIn: PendingZoneCheckIn): Long = withContext(Dispatchers.Default) {
        queries.transactionWithResult {
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

    override suspend fun getPendingCheckIns(): List<PendingZoneCheckIn> = withContext(Dispatchers.Default) {
        queries.selectAll().executeAsList().map {
            PendingZoneCheckIn(
                id = it.id,
                attendeeCode = it.attendeeCode,
                zoneId = it.zoneId,
                eventDay = it.eventDay,
                checkedInAt = it.checkedInAt,
                attemptCount = it.attemptCount.toInt(),
                lastAttemptAt = it.lastAttemptAt,
                errorMessage = it.errorMessage,
            )
        }
    }

    override suspend fun deletePendingCheckIn(id: Long) {
        withContext(Dispatchers.Default) {
            queries.deleteById(id)
        }
    }

    override suspend fun clearPendingCheckIns() {
        withContext(Dispatchers.Default) {
            queries.deleteAll()
        }
    }

    override suspend fun getPendingCheckInsCount(): Int = withContext(Dispatchers.Default) {
        queries.countAll().executeAsOne().toInt()
    }
}
