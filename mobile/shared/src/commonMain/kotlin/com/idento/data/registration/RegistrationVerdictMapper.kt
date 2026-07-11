package com.idento.data.registration

import com.idento.data.model.Attendee
import com.idento.data.model.RegistrationVerdict
import com.idento.data.model.VerdictAttendee
import com.idento.data.network.ApiResult
import kotlinx.datetime.Instant

/** Seam: AttendeeRepository is a plain non-open class wrapping a live Ktor HttpClient with no
 * mock-engine seam (established M1b pattern) — this interface is adapted from the real
 * repository via a method reference in Koin. */
fun interface AttendeeLookup {
    suspend fun getAttendeeByCode(eventId: String, code: String): ApiResult<Attendee>
}

sealed interface RegistrationVerdictLookup {
    data class Found(val attendee: Attendee) : RegistrationVerdictLookup
    data class AlreadyChecked(val verdict: RegistrationVerdict.AlreadyChecked) : RegistrationVerdictLookup
    data class Denied(val verdict: RegistrationVerdict.Denied) : RegistrationVerdictLookup
    data class NotFound(val verdict: RegistrationVerdict.NotFound) : RegistrationVerdictLookup
    data class LookupFailed(val message: String) : RegistrationVerdictLookup
}

/**
 * First real producer of [RegistrationVerdict] (aside from its shipped model file). Read-only:
 * classifies an attendee's current state from a code lookup into a [RegistrationVerdictLookup].
 * Does not perform any check-in write — [RegistrationVerdictLookup.Found] is eligible to proceed,
 * but only Task M1c-5's submission step produces an actual [RegistrationVerdict.Success].
 */
class RegistrationVerdictMapper(private val attendeeLookup: AttendeeLookup) {

    suspend fun lookup(eventId: String, code: String): RegistrationVerdictLookup {
        return when (val result = attendeeLookup.getAttendeeByCode(eventId, code)) {
            is ApiResult.Success -> classify(result.data)
            is ApiResult.Error -> RegistrationVerdictLookup.NotFound(
                RegistrationVerdict.NotFound(rawCode = code, hint = "Check the code and try again")
            )
            is ApiResult.Loading -> RegistrationVerdictLookup.LookupFailed("Still loading")
        }
    }

    private fun classify(attendee: Attendee): RegistrationVerdictLookup {
        val verdictAttendee = toVerdictAttendee(attendee)
        return when {
            attendee.isBlocked -> RegistrationVerdictLookup.Denied(
                RegistrationVerdict.Denied(attendee = verdictAttendee, reason = attendee.blockReason ?: "Access denied")
            )
            attendee.isCheckedIn -> RegistrationVerdictLookup.AlreadyChecked(
                RegistrationVerdict.AlreadyChecked(
                    attendee = verdictAttendee,
                    firstAt = attendee.checkedInAt?.let { Instant.parse(it) } ?: Instant.DISTANT_PAST,
                    firstPoint = attendee.checkedInPointName ?: "Unknown",
                    firstDevice = attendee.checkedInDeviceNumber ?: 0,
                )
            )
            else -> RegistrationVerdictLookup.Found(attendee)
        }
    }
}

fun toVerdictAttendee(attendee: Attendee): VerdictAttendee = VerdictAttendee(
    id = attendee.id,
    fullName = attendee.fullName,
    company = attendee.company,
    category = attendee.position ?: "",
)
