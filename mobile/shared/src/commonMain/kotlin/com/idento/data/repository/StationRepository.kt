package com.idento.data.repository

import com.idento.data.model.CreateProvisioningTokenResponseDto
import com.idento.data.model.ProvisionStationResponseDto
import com.idento.data.network.ApiResult
import com.idento.data.network.StationApiService
import com.idento.data.network.toApiResult

class StationRepository(private val stationApiService: StationApiService) {

    suspend fun createProvisioningToken(eventId: String, staffUserId: String): ApiResult<CreateProvisioningTokenResponseDto> {
        return stationApiService.createProvisioningToken(eventId, staffUserId).toApiResult()
    }

    suspend fun provisionStation(token: String, deviceInfo: Map<String, String>? = null): ApiResult<ProvisionStationResponseDto> {
        return stationApiService.provisionStation(token, deviceInfo).toApiResult()
    }
}
