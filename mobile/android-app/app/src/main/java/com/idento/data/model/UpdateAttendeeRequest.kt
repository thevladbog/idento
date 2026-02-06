package com.idento.data.model

import com.google.gson.annotations.SerializedName

data class UpdateAttendeeRequest(
    @SerializedName("checkin_status")
    val checkinStatus: Boolean
)
