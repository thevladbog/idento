package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

@Serializable
data class Attendee(
    @SerialName("id") val id: String,
    @SerialName("event_id") val eventId: String,
    @SerialName("code") val code: String,
    @SerialName("first_name") val firstName: String,
    @SerialName("last_name") val lastName: String,
    @SerialName("email") val email: String? = null,
    @SerialName("phone") val phone: String? = null,
    @SerialName("company") val company: String? = null,
    @SerialName("position") val position: String? = null,
    @SerialName("checkin_status") val checkinStatus: Boolean = false,
    @SerialName("checked_in_at") val checkedInAt: String? = null,
    @SerialName("checked_in_by") val checkedInBy: String? = null,
    @SerialName("checked_in_by_email") val checkedInByEmail: String? = null,
    @SerialName("checked_in_device_number") val checkedInDeviceNumber: Int? = null,
    @SerialName("checked_in_point_name") val checkedInPointName: String? = null,
    @SerialName("custom_fields") val customFields: Map<String, JsonElement> = emptyMap(),
    @SerialName("blocked") val isBlocked: Boolean = false,
    @SerialName("block_reason") val blockReason: String? = null,
    @SerialName("printed_count") val printedCount: Int = 0,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
) {
    val fullName: String
        get() = "$firstName $lastName".trim()

    val isCheckedIn: Boolean
        get() = checkinStatus || checkedInAt != null
}

/** Best-effort plain-text rendering of a custom-field value for badge/template placeholders. */
fun Attendee.customFieldsText(): Map<String, String> = customFields.mapValues { (_, value) ->
    when (value) {
        is JsonNull -> ""
        is JsonPrimitive -> value.content
        else -> value.toString()
    }
}
