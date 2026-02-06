package com.idento.data.api

import com.idento.data.model.*
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface IdentoApi {
    
    // Auth (без /api префикса)
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>
    
    @POST("auth/login-qr")
    suspend fun qrLogin(@Body request: QRLoginRequest): Response<LoginResponse>
    
    // Events
    @GET("api/events")
    suspend fun getEvents(): Response<List<Event>>
    
    @GET("api/events/{eventId}")
    suspend fun getEvent(@Path("eventId") eventId: String): Response<Event>
    
    // Attendees
    @GET("api/events/{eventId}/attendees")
    suspend fun getAttendees(@Path("eventId") eventId: String): Response<List<Attendee>>
    
    @GET("api/events/{eventId}/attendees/search")
    suspend fun searchAttendee(
        @Path("eventId") eventId: String,
        @Query("code") code: String
    ): Response<Attendee>
    
    // Check-in
    @PUT("api/attendees/{attendeeId}")
    suspend fun checkinAttendee(
        @Path("attendeeId") attendeeId: String,
        @Body request: UpdateAttendeeRequest
    ): Response<Attendee>
    
    // Fonts
    @GET("api/events/{eventId}/fonts")
    suspend fun getEventFonts(@Path("eventId") eventId: String): Response<List<Font>>
    
    @GET("api/fonts/{fontId}/file")
    @Streaming
    suspend fun getFontFile(@Path("fontId") fontId: String): Response<ResponseBody>
}
