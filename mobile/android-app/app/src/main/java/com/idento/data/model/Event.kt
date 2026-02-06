package com.idento.data.model

import com.google.gson.annotations.SerializedName

data class Event(
    @SerializedName("id")
    val id: String,
    
    @SerializedName("tenant_id")
    val tenantId: String,
    
    @SerializedName("name")
    val name: String,
    
    @SerializedName("start_date")
    val startDate: String,
    
    @SerializedName("end_date")
    val endDate: String? = null,
    
    @SerializedName("location")
    val location: String? = null,
    
    @SerializedName("description")
    val description: String? = null,
    
    @SerializedName("field_schema")
    val fieldSchema: List<String>? = null,
    
    @SerializedName("custom_fields")
    val customFields: Map<String, Any>? = null,
    
    @SerializedName("created_at")
    val createdAt: String,
    
    @SerializedName("updated_at")
    val updatedAt: String
) {
    /**
     * Получает шаблон success screen из customFields
     */
    fun getSuccessScreenTemplate(): String? {
        return customFields?.get("success_screen_template") as? String
    }
    
    /**
     * Получает шаблон бейджа из customFields
     */
    fun getBadgeTemplate(): String? {
        return customFields?.get("badge_template") as? String
    }
}
