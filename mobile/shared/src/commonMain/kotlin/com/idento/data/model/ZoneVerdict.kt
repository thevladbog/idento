package com.idento.data.model

import kotlinx.datetime.Instant

/** Zone-control-mode scan outcome, matching the backend's POST /api/zones/:zone_id/scan verdict field. */
sealed interface ZoneVerdict {
    data class Allowed(val attendee: VerdictAttendee, val registeredAt: Instant, val registeredPoint: String, val firstEntry: Boolean) : ZoneVerdict
    data class NoAccess(val attendee: VerdictAttendee, val ruleReason: String, val registeredAt: Instant?) : ZoneVerdict
    data class NotRegistered(val attendee: VerdictAttendee, val registrationPointHint: String) : ZoneVerdict

    /** Transient lookup failure (network error, or the scanned code matched no attendee at all —
     * backend returns HTTP 404 for that case, see zone_scan.go:62-64) — distinct from the three
     * business verdicts above so a network blip never displays as "NOT REGISTERED" or similar.
     * Mirrors RegistrationVerdict.LookupError's identical rationale. */
    data class LookupError(val message: String) : ZoneVerdict
}
