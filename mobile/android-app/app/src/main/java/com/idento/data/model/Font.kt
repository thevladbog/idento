package com.idento.data.model

import com.google.gson.annotations.SerializedName

/**
 * Представляет кастомный шрифт, загруженный для мероприятия
 */
data class Font(
    @SerializedName("id")
    val id: String,
    
    @SerializedName("name")
    val name: String,
    
    @SerializedName("family")
    val family: String,
    
    @SerializedName("weight")
    val weight: String,
    
    @SerializedName("style")
    val style: String,
    
    @SerializedName("format")
    val format: String,
    
    @SerializedName("size")
    val size: Long,
    
    @SerializedName("created_at")
    val createdAt: String
)
