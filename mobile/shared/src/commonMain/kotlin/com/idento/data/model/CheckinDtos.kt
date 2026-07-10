package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ZoneScanRequestDto(val code: String)

@Serializable
data class RegistrationInfoDto(
    val passed: Boolean,
    val at: String? = null,
    val point: String? = null,
)

/** attendee is the existing Attendee model (data/model/Attendee.kt) — same JSON shape the backend already returns for attendee objects elsewhere. */
@Serializable
data class ZoneScanResponseDto(
    val verdict: String, // "allowed" | "no_access" | "not_registered"
    val reason: String? = null,
    val attendee: Attendee? = null,
    val registration: RegistrationInfoDto? = null,
    @SerialName("checked_in_at") val checkedInAt: String? = null,
    @SerialName("first_entry") val firstEntry: Boolean = false,
)

@Serializable
data class BatchCheckinItemDto(
    @SerialName("client_uuid") val clientUuid: String,
    @SerialName("attendee_id") val attendeeId: String,
    val at: String,
    @SerialName("device_number") val deviceNumber: Int,
    val kind: String, // "checkin" | "zone_entry"
    @SerialName("zone_id") val zoneId: String? = null,
)

@Serializable
data class BatchCheckinResultDto(
    @SerialName("client_uuid") val clientUuid: String,
    val status: String, // "created" | "already_exists" | "error"
    val error: String? = null,
)

@Serializable
data class CreateCheckinOverrideRequestDto(
    @SerialName("attendee_id") val attendeeId: String,
    val context: String, // "already_checked" | "not_registered" | "no_access"
    @SerialName("zone_id") val zoneId: String? = null,
)

@Serializable
data class CheckinOverrideDto(
    val id: String,
    @SerialName("attendee_id") val attendeeId: String,
    @SerialName("zone_id") val zoneId: String? = null,
    val context: String,
    @SerialName("staff_user_id") val staffUserId: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class ZoneScanStatsDto(
    val allowed: Int = 0,
    @SerialName("no_access") val noAccess: Int = 0,
    @SerialName("not_registered") val notRegistered: Int = 0,
)

@Serializable
data class EventStatsResponseDto(
    @SerialName("total_attendees") val totalAttendees: Int,
    @SerialName("checked_in") val checkedIn: Int,
    @SerialName("zone_stats") val zoneStats: ZoneScanStatsDto? = null,
)
