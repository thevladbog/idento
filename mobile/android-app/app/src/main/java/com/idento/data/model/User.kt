package com.idento.data.model

import com.google.gson.annotations.SerializedName

data class User(
    @SerializedName("id")
    val id: String,
    
    @SerializedName("tenant_id")
    val tenantId: String,
    
    @SerializedName("email")
    val email: String,
    
    @SerializedName("role")
    val role: String,
    
    @SerializedName("created_at")
    val createdAt: String,
    
    @SerializedName("updated_at")
    val updatedAt: String
)
