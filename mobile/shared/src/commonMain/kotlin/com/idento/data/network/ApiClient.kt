package com.idento.data.network

import io.ktor.client.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.auth.*
import io.ktor.client.plugins.auth.providers.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json

/**
 * Ktor HTTP Client для работы с API
 * Заменяет Retrofit из Android версии
 *
 * [baseUrlProvider] is a lambda, not a resolved `String` — it's re-invoked on every outgoing
 * request (see the `defaultRequest` block below), exactly like [tokenProvider]. That's what
 * lets a server URL saved via the Server URL screen (see `NetworkPreferences`) take effect on
 * the very next request, with no app restart and no need to rebuild this Koin singleton.
 */
class ApiClient(
    private val baseUrlProvider: () -> String = ::getDefaultBaseUrl,
    private val tokenProvider: () -> String? = { null }
) {

    val httpClient = HttpClient {
        // Base URL configuration — re-evaluated on every request (not baked in once at
        // construction), exactly like tokenProvider below. This is what lets the Server URL
        // screen (see NetworkPreferences) take effect immediately after Save, with no app
        // restart and no need to rebuild this Koin singleton.
        defaultRequest {
            url(baseUrlProvider())
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

    /** Test-only accessor confirming the current resolved value of [baseUrlProvider]. */
    fun baseUrlProviderForTest(): String = baseUrlProvider()

    fun close() {
        httpClient.close()
    }
}

/** HEADERS in debug (no bodies, so no password/JWT), NONE in release. Pure → unit-testable. */
fun logLevelFor(isDebug: Boolean): LogLevel = if (isDebug) LogLevel.HEADERS else LogLevel.NONE
