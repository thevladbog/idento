package com.idento.data.model

import com.google.gson.annotations.SerializedName

data class CheckinRequest(
    @SerializedName("checkedInBy")
    val checkedInBy: String
)

data class CheckinResponse(
    @SerializedName("message")
    val message: String,
    
    @SerializedName("attendee")
    val attendee: Attendee
)
