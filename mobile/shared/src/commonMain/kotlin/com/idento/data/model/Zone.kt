package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class EventZone(
    @SerialName("id") val id: String,
    @SerialName("event_id") val eventId: String,
    @SerialName("name") val name: String,
    @SerialName("zone_type") val zoneType: String, // registration, general, vip, workshop
    @SerialName("order_index") val orderIndex: Int,
    @SerialName("open_time") val openTime: String? = null, // HH:MM format
    @SerialName("close_time") val closeTime: String? = null,
    @SerialName("is_registration_zone") val isRegistrationZone: Boolean = false,
    @SerialName("requires_registration") val requiresRegistration: Boolean = true,
    @SerialName("is_active") val isActive: Boolean = true,
    @SerialName("settings") val settings: Map<String, String>? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class EventZoneWithStats(
    @SerialName("id") val id: String,
    @SerialName("event_id") val eventId: String,
    @SerialName("name") val name: String,
    @SerialName("zone_type") val zoneType: String,
    @SerialName("order_index") val orderIndex: Int,
    @SerialName("open_time") val openTime: String? = null,
    @SerialName("close_time") val closeTime: String? = null,
    @SerialName("is_registration_zone") val isRegistrationZone: Boolean = false,
    @SerialName("requires_registration") val requiresRegistration: Boolean = true,
    @SerialName("is_active") val isActive: Boolean = true,
    @SerialName("settings") val settings: Map<String, String>? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("total_checkins") val totalCheckins: Int = 0,
    @SerialName("unique_attendees") val uniqueAttendees: Int = 0,
    @SerialName("today_checkins") val todayCheckins: Int = 0
)

@Serializable
data class ZoneCheckInRequest(
    @SerialName("attendee_code") val attendeeCode: String,
    @SerialName("zone_id") val zoneId: String,
    @SerialName("event_day") val eventDay: String // YYYY-MM-DD format
)

@Serializable
data class ZoneCheckInResponse(
    @SerialName("success") val isSuccess: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("attendee") val attendee: Attendee? = null,
    @SerialName("zone") val zone: EventZone? = null,
    @SerialName("checked_in_at") val checkedInAt: String? = null,
    @SerialName("packet_delivered") val isPacketDelivered: Boolean = false,
    @SerialName("message") val message: String? = null
)

@Serializable
data class ZoneQRData(
    @SerialName("type") val type: String = "zone", // Always "zone"
    @SerialName("zone_id") val zoneId: String,
    @SerialName("zone_name") val zoneName: String,
    @SerialName("event_id") val eventId: String
)

@Serializable
data class MovementHistoryEntry(
    @SerialName("zone_id") val zoneId: String,
    @SerialName("zone_name") val zoneName: String,
    @SerialName("checked_in_at") val checkedInAt: String,
    @SerialName("event_day") val eventDay: String,
    @SerialName("checked_in_by") val checkedInBy: String? = null
)

