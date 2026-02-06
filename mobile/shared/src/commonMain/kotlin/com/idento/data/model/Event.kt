package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Event(
    @SerialName("id") val id: String,
    @SerialName("name") val name: String,
    @SerialName("description") val description: String? = null,
    @SerialName("start_date") val startDate: String,
    @SerialName("end_date") val endDate: String,
    @SerialName("location") val location: String? = null,
    @SerialName("badge_template") val badgeTemplate: String? = null,
    @SerialName("settings") val settings: EventSettings? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class EventSettings(
    @SerialName("allow_self_checkin") val allowSelfCheckin: Boolean = false,
    @SerialName("require_qr_code") val requireQrCode: Boolean = true,
    @SerialName("auto_print_badge") val autoPrintBadge: Boolean = false,
    @SerialName("custom_fields") val customFields: List<String> = emptyList()
)
