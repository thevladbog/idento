package com.idento.data.storage

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Pure Kotlin data-shape coverage for [PendingZoneCheckIn] — the row model that
 * [SqlDelightOfflineDatabase] maps to/from SQLDelight-generated rows and that
 * [com.idento.data.repository.OfflineCheckInRepository] already relies on. The SQLDelight driver
 * itself (Android/iOS) can't be exercised in a commonTest — see Task 7's report for that gap.
 */
class PendingZoneCheckInTest {

    @Test
    fun defaultsMatchNewlyCreatedCheckIn() {
        val pending = PendingZoneCheckIn(
            attendeeCode = "ATT-1",
            zoneId = "zone-1",
            eventDay = "2026-07-10",
            checkedInAt = 1_000L,
        )

        assertNull(pending.id)
        assertEquals(0, pending.attemptCount)
        assertNull(pending.lastAttemptAt)
        assertNull(pending.errorMessage)
    }

    @Test
    fun copyWithGeneratedIdRoundTripsAllFields() {
        val pending = PendingZoneCheckIn(
            attendeeCode = "ATT-2",
            zoneId = "zone-2",
            eventDay = "2026-07-10",
            checkedInAt = 2_000L,
            attemptCount = 1,
            lastAttemptAt = 2_500L,
            errorMessage = "network timeout",
        )

        // Mirrors what SqlDelightOfflineDatabase does after an insert: the row comes back
        // with a database-assigned id, all other fields unchanged.
        val persisted = pending.copy(id = 42L)

        assertEquals(42L, persisted.id)
        assertEquals(pending.attendeeCode, persisted.attendeeCode)
        assertEquals(pending.zoneId, persisted.zoneId)
        assertEquals(pending.eventDay, persisted.eventDay)
        assertEquals(pending.checkedInAt, persisted.checkedInAt)
        assertEquals(pending.attemptCount, persisted.attemptCount)
        assertEquals(pending.lastAttemptAt, persisted.lastAttemptAt)
        assertEquals(pending.errorMessage, persisted.errorMessage)
    }
}
