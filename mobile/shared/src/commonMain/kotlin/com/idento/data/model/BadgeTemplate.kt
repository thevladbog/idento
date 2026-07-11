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
        zpl = zpl.replace("{firstName}", escapeZpl(attendee.firstName))
        zpl = zpl.replace("{lastName}", escapeZpl(attendee.lastName))
        zpl = zpl.replace("{fullName}", escapeZpl(attendee.fullName))
        zpl = zpl.replace("{email}", escapeZpl(attendee.email ?: ""))
        zpl = zpl.replace("{company}", escapeZpl(attendee.company ?: ""))
        zpl = zpl.replace("{position}", escapeZpl(attendee.position ?: ""))
        zpl = zpl.replace("{code}", escapeZpl(attendee.code))

        // Replace custom fields
        attendee.customFieldsText().forEach { (key, value) ->
            zpl = zpl.replace("{$key}", escapeZpl(value))
        }

        return zpl
    }

    companion object {
        /**
         * Escape ZPL special characters within field-data (`^FD...^FS`) substitution values.
         *
         * Mirrors the WEB-SEC-02 fix (`escapeZplData` in web/src/utils/zpl.ts): ZPL treats `^`
         * (format command prefix) and `~` (control command prefix) as special even inside field
         * data, and `\` as its own escape character. Prefixing `^`/`~` with `\` renders them as
         * literal characters without relying on printer-side "change caret/tilde" state, which
         * would not be portable across a shared multi-printer print queue. The backslash itself
         * must be escaped first so a literal `^`/`~` is never double-escaped.
         */
        private fun escapeZpl(value: String): String =
            value.replace("\\", "\\\\").replace("^", "\\^").replace("~", "\\~")
    }
}
