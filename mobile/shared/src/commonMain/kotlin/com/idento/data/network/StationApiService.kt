package com.idento.data.network

import com.idento.data.model.CreateProvisioningTokenRequestDto
import com.idento.data.model.CreateProvisioningTokenResponseDto
import com.idento.data.model.ProvisionStationRequestDto
import com.idento.data.model.ProvisionStationResponseDto
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.http.*

/** Station provisioning: manager mints a token (authenticated); device redeems it (public). */
class StationApiService(private val apiClient: ApiClient) {

    suspend fun createProvisioningToken(eventId: String, staffUserId: String): Result<CreateProvisioningTokenResponseDto> = apiRunCatching {
        apiClient.httpClient.post("/api/events/$eventId/stations/provisioning-token") {
            contentType(ContentType.Application.Json)
            setBody(CreateProvisioningTokenRequestDto(staffUserId = staffUserId))
        }.bodyOrApiError()
    }

    suspend fun provisionStation(token: String, deviceInfo: Map<String, String>? = null): Result<ProvisionStationResponseDto> = apiRunCatching {
        apiClient.httpClient.post("/api/stations/provision") {
            contentType(ContentType.Application.Json)
            setBody(ProvisionStationRequestDto(token = token, deviceInfo = deviceInfo))
        }.bodyOrApiError()
    }
}
