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
 */
class ApiClient(
    private val baseUrl: String = "http://10.0.2.2:8080", // Android emulator localhost
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
        
        // Logging
        install(Logging) {
            logger = Logger.DEFAULT
            level = LogLevel.BODY
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

/**
 * Platform-specific HTTP client engine configuration
 */
expect fun createPlatformHttpClient(config: HttpClientConfig<*>.() -> Unit): HttpClient
