package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CreateProvisioningTokenRequestDto(
    @SerialName("staff_user_id") val staffUserId: String,
)

@Serializable
data class CreateProvisioningTokenResponseDto(
    val token: String,
    @SerialName("expires_at") val expiresAt: String,
)

@Serializable
data class ProvisionStationRequestDto(
    val token: String,
    @SerialName("device_info") val deviceInfo: Map<String, String>? = null,
)

@Serializable
data class ProvisionedStationConfigDto(
    @SerialName("event_id") val eventId: String,
    @SerialName("event_name") val eventName: String,
    @SerialName("staff_name") val staffName: String,
)

@Serializable
data class ProvisionStationResponseDto(
    @SerialName("station_config") val stationConfig: ProvisionedStationConfigDto,
    @SerialName("staff_jwt") val staffJwt: String,
    @SerialName("device_number") val deviceNumber: Int,
)
