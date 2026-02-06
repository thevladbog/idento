package com.idento.data.model

import com.google.gson.annotations.SerializedName

data class LoginRequest(
    @SerializedName("email")
    val email: String,
    
    @SerializedName("password")
    val password: String
)

data class LoginResponse(
    @SerializedName("token")
    val token: String,
    
    @SerializedName("user")
    val user: User
)

data class QRLoginRequest(
    @SerializedName("token")
    val token: String
)
