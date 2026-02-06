package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class BadgeTemplate(
    @SerialName("id") val id: String? = null,
    @SerialName("event_id") val eventId: String? = null,
    @SerialName("name") val name: String = "Default Badge",
    @SerialName("width") val width: Int = 54, // mm
    @SerialName("height") val height: Int = 86, // mm
    @SerialName("dpi") val dpi: Int = 203,
    @SerialName("zpl_template") val zplTemplate: String,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
) {
    /**
     * Generate ZPL code for printing with attendee data
     */
    fun generateZPL(attendee: Attendee): String {
        var zpl = zplTemplate
        
        // Replace placeholders with attendee data
        zpl = zpl.replace("{firstName}", attendee.firstName)
        zpl = zpl.replace("{lastName}", attendee.lastName)
        zpl = zpl.replace("{fullName}", attendee.fullName)
        zpl = zpl.replace("{email}", attendee.email ?: "")
        zpl = zpl.replace("{company}", attendee.company ?: "")
        zpl = zpl.replace("{position}", attendee.position ?: "")
        zpl = zpl.replace("{code}", attendee.code)
        
        // Replace custom fields
        attendee.customFields.forEach { (key, value) ->
            zpl = zpl.replace("{$key}", value)
        }
        
        return zpl
    }
}
