package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class User(
    @SerialName("id") val id: String,
    @SerialName("email") val email: String,
    @SerialName("name") val name: String? = null,  // Optional - may be missing from API
    @SerialName("role") val role: String,
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
data class LoginRequest(
    @SerialName("email") val email: String,
    @SerialName("password") val password: String
)

@Serializable
data class LoginResponse(
    @SerialName("token") val token: String,
    @SerialName("user") val user: User
)

@Serializable
data class LoginQRRequest(
    @SerialName("token") val token: String
)
