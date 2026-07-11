package com.idento.data.zonecontrol

import com.idento.data.model.ZoneScanResponseDto
import com.idento.data.model.ZoneVerdict
import com.idento.data.network.ApiResult
import com.idento.data.registration.parseCheckedInAt
import com.idento.data.registration.toVerdictAttendee
import kotlinx.datetime.Instant

/** Seam: ZoneRepository is a plain non-open class wrapping a live Ktor HttpClient with no
 * mock-engine seam (established M1c/M1d pattern) — adapted from the real repository via a
 * method reference in Koin (see ViewModelModule.kt, Task 9). */
fun interface ZoneScanSource {
    suspend fun scan(zoneId: String, code: String): ApiResult<ZoneScanResponseDto>
}

/**
 * Unlike RegistrationVerdictMapper (which classifies verdicts from raw attendee data on the
 * client), POST /api/zones/:zone_id/scan already returns a fully classified verdict — this
 * adapter only maps DTO -> domain type and handles the error case. See this plan's Global
 * Constraints for why a 404 (code matches no attendee) correctly lands in LookupError here,
 * same as any other network failure.
 */
class ZoneVerdictAdapter(private val scanSource: ZoneScanSource) {

    suspend fun lookup(zoneId: String, code: String): ZoneVerdict {
        return when (val result = scanSource.scan(zoneId, code)) {
            is ApiResult.Success -> result.data.toZoneVerdict()
            is ApiResult.Error -> ZoneVerdict.LookupError(result.message ?: "Lookup failed")
            is ApiResult.Loading -> ZoneVerdict.LookupError("Still loading")
        }
    }
}

private fun ZoneScanResponseDto.toZoneVerdict(): ZoneVerdict {
    val verdictAttendee = attendee?.let { toVerdictAttendee(it) }
        ?: return ZoneVerdict.LookupError("Zone scan response missing attendee")
    return when (verdict) {
        "allowed" -> ZoneVerdict.Allowed(
            attendee = verdictAttendee,
            registeredAt = parseCheckedInAt(checkedInAt, Instant.DISTANT_PAST),
            registeredPoint = registration?.point ?: "",
            firstEntry = firstEntry,
        )
        "no_access" -> ZoneVerdict.NoAccess(
            attendee = verdictAttendee,
            ruleReason = reason ?: "Access denied",
            registeredAt = registration?.at?.let { parseCheckedInAt(it, Instant.DISTANT_PAST) },
        )
        "not_registered" -> ZoneVerdict.NotRegistered(
            attendee = verdictAttendee,
            registrationPointHint = reason ?: "",
        )
        else -> ZoneVerdict.LookupError("Unknown zone verdict: $verdict")
    }
}
