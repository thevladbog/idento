package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Display Template for attendee check-in screen
 * Uses Markdown format with placeholders for attendee fields
 * 
 * Available placeholders:
 * - {{first_name}} - First name
 * - {{last_name}} - Last name
 * - {{full_name}} - Full name (first + last)
 * - {{email}} - Email
 * - {{company}} - Company
 * - {{position}} - Position/Title
 * - {{phone}} - Phone number
 * - {{code}} - Attendee code (QR)
 * - {{custom.field_name}} - Custom field value
 * 
 * Example template:
 * ```
 * # {{full_name}}
 * 
 * **Company:** {{company}}
 * **Position:** {{position}}
 * 
 * 📧 {{email}}
 * 📱 {{phone}}
 * ```
 */
@Serializable
data class DisplayTemplate(
    @SerialName("id") val id: String? = null,
    @SerialName("event_id") val eventId: String,
    @SerialName("template") val template: String,
    @SerialName("name") val name: String = "Default",
    @SerialName("is_default") val isDefault: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
) {
    companion object {
        /**
         * Default template for attendee display
         */
        fun default(eventId: String) = DisplayTemplate(
            eventId = eventId,
            name = "Default",
            isDefault = true,
            template = """
# {{full_name}}

{{#if company}}**Company:** {{company}}{{/if}}
{{#if position}}**Position:** {{position}}{{/if}}

{{#if email}}📧 {{email}}{{/if}}
{{#if phone}}📱 {{phone}}{{/if}}

---
*Code: {{code}}*
            """.trimIndent()
        )
        
        /**
         * List of available standard placeholders
         */
        val standardPlaceholders = listOf(
            PlaceholderInfo("first_name", "First Name", "{{first_name}}"),
            PlaceholderInfo("last_name", "Last Name", "{{last_name}}"),
            PlaceholderInfo("full_name", "Full Name", "{{full_name}}"),
            PlaceholderInfo("email", "Email", "{{email}}"),
            PlaceholderInfo("company", "Company", "{{company}}"),
            PlaceholderInfo("position", "Position", "{{position}}"),
            PlaceholderInfo("phone", "Phone", "{{phone}}"),
            PlaceholderInfo("code", "QR Code", "{{code}}")
        )
    }
    
    /**
     * Render template with attendee data
     */
    fun render(attendee: Attendee): String {
        var result = template
        
        // Replace standard placeholders
        result = result.replace("{{first_name}}", attendee.firstName)
        result = result.replace("{{last_name}}", attendee.lastName)
        result = result.replace("{{full_name}}", attendee.fullName)
        result = result.replace("{{email}}", attendee.email ?: "")
        result = result.replace("{{company}}", attendee.company ?: "")
        result = result.replace("{{position}}", attendee.position ?: "")
        result = result.replace("{{phone}}", attendee.phone ?: "")
        result = result.replace("{{code}}", attendee.code)
        
        // Replace custom field placeholders
        attendee.customFields.forEach { (key, value) ->
            result = result.replace("{{custom.$key}}", value)
        }
        
        // Handle conditional blocks {{#if field}}...{{/if}}
        result = processConditionals(result, attendee)
        
        // Clean up empty lines
        result = result.lines()
            .filter { it.isNotBlank() || it.isEmpty() }
            .joinToString("\n")
        
        return result.trim()
    }
    
    /**
     * Process conditional blocks
     */
    private fun processConditionals(text: String, attendee: Attendee): String {
        var result = text
        val conditionalRegex = Regex("""\{\{#if\s+(\w+)\}\}(.*?)\{\{/if\}\}""", RegexOption.DOT_MATCHES_ALL)
        
        result = conditionalRegex.replace(result) { match ->
            val field = match.groupValues[1]
            val content = match.groupValues[2]
            
            val hasValue = when (field) {
                "first_name" -> attendee.firstName.isNotBlank()
                "last_name" -> attendee.lastName.isNotBlank()
                "full_name" -> attendee.fullName.isNotBlank()
                "email" -> !attendee.email.isNullOrBlank()
                "company" -> !attendee.company.isNullOrBlank()
                "position" -> !attendee.position.isNullOrBlank()
                "phone" -> !attendee.phone.isNullOrBlank()
                "code" -> attendee.code.isNotBlank()
                else -> attendee.customFields[field]?.isNotBlank() == true
            }
            
            if (hasValue) content else ""
        }
        
        return result
    }
}

/**
 * Placeholder info for UI
 */
@Serializable
data class PlaceholderInfo(
    val key: String,
    val label: String,
    val placeholder: String
)
