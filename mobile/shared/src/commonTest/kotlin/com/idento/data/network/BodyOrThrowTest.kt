package com.idento.data.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

@Serializable
private data class FakeSuccessDto(val token: String, val expiresAt: String)

private fun clientRespondingWith(status: HttpStatusCode, body: String): HttpClient {
    val engine = MockEngine { request ->
        respond(
            content = body,
            status = status,
            headers = headersOf(HttpHeaders.ContentType, "application/json")
        )
    }
    return HttpClient(engine) {
        install(ContentNegotiation) { json() }
    }
}

/**
 * Regression coverage for the on-prem live-verification finding: a non-2xx response whose body
 * doesn't match the success DTO must surface the backend's own error message via [ApiException],
 * not a confusing [kotlinx.serialization.SerializationException] about missing fields.
 */
class BodyOrThrowTest {

    @Test
    fun successResponse_deserializesNormally() = runTest {
        val client = clientRespondingWith(
            HttpStatusCode.OK,
            """{"token":"abc","expiresAt":"2026-01-01T00:00:00Z"}"""
        )
        val dto: FakeSuccessDto = client.get("/whatever").bodyOrThrow()
        assertEquals("abc", dto.token)
    }

    @Test
    fun errorResponse_surfacesBackendMessage_insteadOfSerializationCrash() = runTest {
        // Exactly the 400 body the backend returns for CreateStationProvisioningToken when the
        // target user's role is "admin" (backend/internal/handler/stations.go).
        val client = clientRespondingWith(
            HttpStatusCode.BadRequest,
            """{"error":"Staff user must have a staff or manager role"}"""
        )
        val error = assertFailsWith<ApiException> {
            client.get("/whatever").bodyOrThrow<FakeSuccessDto>()
        }
        assertEquals(HttpStatusCode.BadRequest, error.status)
        assertEquals("Staff user must have a staff or manager role", error.message)
    }

    @Test
    fun errorResponse_fallsBackToMessageField() = runTest {
        val client = clientRespondingWith(HttpStatusCode.Forbidden, """{"message":"Not allowed"}""")
        val error = assertFailsWith<ApiException> {
            client.get("/whatever").bodyOrThrow<FakeSuccessDto>()
        }
        assertEquals("Not allowed", error.message)
    }

    @Test
    fun errorResponse_withNonJsonBody_fallsBackToRawText() = runTest {
        val client = clientRespondingWith(HttpStatusCode.InternalServerError, "gateway timeout")
        val error = assertFailsWith<ApiException> {
            client.get("/whatever").bodyOrThrow<FakeSuccessDto>()
        }
        assertEquals("gateway timeout", error.message)
    }
}
