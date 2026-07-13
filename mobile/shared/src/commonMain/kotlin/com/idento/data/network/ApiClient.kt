package com.idento.data.network

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.auth.*
import io.ktor.client.plugins.auth.providers.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Thrown by [bodyOrApiError] for a non-2xx API response, carrying the backend's own `error`
 * message (e.g. "This organization is suspended. Contact support.") instead of a raw
 * deserialization exception. The backend's error shape is `{"error": "...", "code"?: "..."}`
 * (see the backend handler package's `map[string]string{"error": ...}` convention) — this is
 * not the shape of a success payload (e.g. a `List<Event>` array), so calling plain `.body()` on
 * it throws a confusing "Expected start of the array..." exception instead of the actual,
 * human-readable server message.
 */
class ApiErrorException(message: String, val code: String? = null) : Exception(message)

/**
 * Parses a non-2xx response body of shape `{"error": "...", "code"?: "..."}` into
 * (message, code). Falls back to null for either field (or both) when [bodyText] isn't valid
 * JSON or doesn't have that shape — [bodyOrApiError] supplies its own default message in that
 * case. Pulled out of [bodyOrApiError] so this parsing logic is unit-testable without an HTTP
 * client (see [io.ktor.client.statement.HttpResponse]'s doc — this codebase's established
 * precedent is to test pure parsing logic directly and leave real request/response behavior to
 * live verification).
 */
fun parseApiErrorBody(bodyText: String): Pair<String?, String?> {
    val element = runCatching { Json.parseToJsonElement(bodyText).jsonObject }.getOrNull()
    val message = element?.get("error")?.jsonPrimitive?.contentOrNull
    val code = element?.get("code")?.jsonPrimitive?.contentOrNull
    return message to code
}

/**
 * Like [io.ktor.client.call.body], but on a non-2xx response throws [ApiErrorException] with
 * the backend's own error message instead of failing JSON deserialization against a
 * success-shaped type. Use this instead of bare `.body()` for any endpoint whose caller
 * doesn't already check `response.status` itself (see [ApiErrorException]'s doc for why).
 */
suspend inline fun <reified T> HttpResponse.bodyOrApiError(): T {
    if (!status.isSuccess()) {
        val (message, code) = parseApiErrorBody(bodyAsText())
        throw ApiErrorException(message ?: "Request failed (${status.value})", code)
    }
    return body()
}

/**
 * Ktor HTTP Client для работы с API
 * Заменяет Retrofit из Android версии
 */
class ApiClient(
    private val baseUrl: String = getDefaultBaseUrl(),
    private val tokenProvider: () -> String? = { null }
) {
    
    val httpClient = HttpClient {
        // Base URL configuration
        defaultRequest {
            url(baseUrl)
            contentType(ContentType.Application.Json)
        }
        
        // JSON Serialization
        install(ContentNegotiation) {
            json(Json {
                prettyPrint = true
                isLenient = true
                ignoreUnknownKeys = true
            })
        }
        
        // Logging — HEADERS only (never bodies: the login body carries the plaintext
        // password and responses carry the JWT), gated to debug, with the bearer token
        // and any session cookie redacted from the header dump (parity with Android).
        install(Logging) {
            logger = Logger.DEFAULT
            level = logLevelFor(isDebugBuild())
            sanitizeHeader { header ->
                header.equals(HttpHeaders.Authorization, ignoreCase = true) ||
                    header.equals(HttpHeaders.Cookie, ignoreCase = true)
            }
        }
        
        // Authentication
        install(Auth) {
            bearer {
                loadTokens {
                    tokenProvider()?.let { token ->
                        BearerTokens(accessToken = token, refreshToken = "")
                    }
                }
                
                refreshTokens {
                    // TODO: Implement token refresh logic if needed
                    tokenProvider()?.let { token ->
                        BearerTokens(accessToken = token, refreshToken = "")
                    }
                }
            }
        }
        
        // Timeout configuration
        install(HttpTimeout) {
            requestTimeoutMillis = 30000
            connectTimeoutMillis = 30000
            socketTimeoutMillis = 30000
        }
    }
    
    /**
     * Update base URL (для переключения между dev/prod серверами)
     */
    fun updateBaseUrl(newBaseUrl: String): ApiClient {
        return ApiClient(newBaseUrl, tokenProvider)
    }
    
    fun close() {
        httpClient.close()
    }
}

/** HEADERS in debug (no bodies, so no password/JWT), NONE in release. Pure → unit-testable. */
fun logLevelFor(isDebug: Boolean): LogLevel = if (isDebug) LogLevel.HEADERS else LogLevel.NONE
