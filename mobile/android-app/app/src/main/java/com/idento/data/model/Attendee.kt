package com.idento.data.model

import com.google.gson.annotations.SerializedName

data class Attendee(
    @SerializedName("id")
    val id: String,
    
    @SerializedName("event_id")
    val eventId: String,
    
    @SerializedName("first_name")
    val firstName: String,
    
    @SerializedName("last_name")
    val lastName: String,
    
    @SerializedName("email")
    val email: String,
    
    @SerializedName("code")
    val code: String,
    
    @SerializedName("company")
    val company: String = "",
    
    @SerializedName("position")
    val position: String = "",
    
    @SerializedName("checkin_status")
    val checkinStatus: Boolean = false,
    
    @SerializedName("checked_in_at")
    val checkedInAt: String? = null,
    
    @SerializedName("checked_in_by")
    val checkedInBy: String? = null,
    
    @SerializedName("checked_in_by_email")
    val checkedInByEmail: String? = null,
    
    @SerializedName("printed_count")
    val printedCount: Int = 0,
    
    @SerializedName("blocked")
    val blocked: Boolean = false,
    
    @SerializedName("block_reason")
    val blockReason: String? = null,
    
    @SerializedName("custom_fields")
    val customFields: Map<String, Any>? = null,
    
    @SerializedName("created_at")
    val createdAt: String,
    
    @SerializedName("updated_at")
    val updatedAt: String
)
