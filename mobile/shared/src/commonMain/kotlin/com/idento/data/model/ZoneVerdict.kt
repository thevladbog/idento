package com.idento.data.model

import kotlinx.datetime.Instant

/** Zone-control-mode scan outcome, matching the backend's POST /api/zones/:zone_id/scan verdict field. */
sealed interface ZoneVerdict {
    data class Allowed(val attendee: VerdictAttendee, val registeredAt: Instant, val registeredPoint: String, val firstEntry: Boolean) : ZoneVerdict
    data class NoAccess(val attendee: VerdictAttendee, val ruleReason: String, val registeredAt: Instant?) : ZoneVerdict
    data class NotRegistered(val attendee: VerdictAttendee, val registrationPointHint: String) : ZoneVerdict
}
