package com.idento.data.model

import kotlinx.datetime.Instant

data class VerdictAttendee(
    val id: String,
    val fullName: String,
    val company: String?,
    val category: String,
)

sealed interface PrintState {
    data object Printing : PrintState
    data object Queued : PrintState
    data object Done : PrintState
    data class Failed(val reason: String) : PrintState

    /** No print was attempted because printing wasn't requested/configured for this check-in
     * (autoPrint off, no printer paired, or no badge template available) — distinct from [Done],
     * which means a print genuinely completed successfully. A future status-cell UI must not give
     * this the same "printed OK" treatment as [Done]. */
    data object NotRequested : PrintState
}

/** Registration-mode scan outcome (screen = colored top band + detail table + action buttons). */
sealed interface RegistrationVerdict {
    data class Success(val attendee: VerdictAttendee, val at: Instant, val firstTime: Boolean, val printState: PrintState) : RegistrationVerdict
    data class AlreadyChecked(val attendee: VerdictAttendee, val firstAt: Instant, val firstPoint: String, val firstDevice: Int) : RegistrationVerdict
    data class NotFound(val rawCode: String, val hint: String) : RegistrationVerdict
    data class Denied(val attendee: VerdictAttendee, val reason: String) : RegistrationVerdict
    data class PrintError(val attendee: VerdictAttendee, val at: Instant, val printReason: String) : RegistrationVerdict
}
