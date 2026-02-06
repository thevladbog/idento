package com.idento.data.network

import com.idento.data.model.LoginRequest
import com.idento.data.model.LoginResponse
import com.idento.data.model.LoginQRRequest
import com.idento.data.model.User
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Error response from API
 */
@Serializable
data class ApiErrorResponse(
    val error: String? = null,
    val message: String? = null
)

/**
 * Auth API Service (Ktor version)
 * Replaces Retrofit AuthApiService
 */
class AuthApiService(private val apiClient: ApiClient) {
    
    private val json = Json { ignoreUnknownKeys = true }
    
    /**
     * Login with email and password
     */
    suspend fun login(email: String, password: String): Result<LoginResponse> {
        return try {
            val response = apiClient.httpClient.post("/auth/login") {
                setBody(LoginRequest(email = email, password = password))
            }
            
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                val errorBody = response.bodyAsText()
                val errorMessage = parseErrorMessage(errorBody, response.status)
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(Exception(parseExceptionMessage(e)))
        }
    }
    
    /**
     * Login with QR token
     */
    suspend fun loginWithQR(token: String): Result<LoginResponse> {
        return try {
            val response = apiClient.httpClient.post("/auth/login-qr") {
                setBody(LoginQRRequest(token = token))
            }
            
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                val errorBody = response.bodyAsText()
                val errorMessage = parseErrorMessage(errorBody, response.status)
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(Exception(parseExceptionMessage(e)))
        }
    }
    
    /**
     * Get current user profile
     */
    suspend fun getMe(): Result<User> {
        return try {
            val response = apiClient.httpClient.get("/api/me")
            
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                val errorBody = response.bodyAsText()
                val errorMessage = parseErrorMessage(errorBody, response.status)
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(Exception(parseExceptionMessage(e)))
        }
    }
    
    /**
     * Logout (optional - может быть только client-side)
     */
    suspend fun logout(): Result<Unit> = runCatching {
        // Очищаем токен на клиенте
        // Backend endpoint может не требоваться
    }
    
    /**
     * Parse error message from API response
     */
    private fun parseErrorMessage(errorBody: String, status: HttpStatusCode): String {
        return try {
            val apiError = json.decodeFromString<ApiErrorResponse>(errorBody)
            apiError.error ?: apiError.message ?: getDefaultErrorMessage(status)
        } catch (e: Exception) {
            // If can't parse JSON, use status-based message
            getDefaultErrorMessage(status)
        }
    }
    
    /**
     * Get user-friendly error message based on HTTP status
     */
    private fun getDefaultErrorMessage(status: HttpStatusCode): String {
        return when (status) {
            HttpStatusCode.Unauthorized -> "Invalid email or password"
            HttpStatusCode.Forbidden -> "Access denied"
            HttpStatusCode.NotFound -> "Service not found"
            HttpStatusCode.InternalServerError -> "Server error. Please try again later"
            HttpStatusCode.BadRequest -> "Invalid request"
            else -> "Error: ${status.description}"
        }
    }
    
    /**
     * Parse exception to user-friendly message
     */
    private fun parseExceptionMessage(e: Exception): String {
        val message = e.message ?: "Unknown error"
        return when {
            message.contains("UnresolvedAddressException") -> "No internet connection"
            message.contains("ConnectException") -> "Cannot connect to server"
            message.contains("SocketTimeoutException") -> "Connection timeout"
            message.contains("timeout", ignoreCase = true) -> "Request timeout"
            else -> message
        }
    }
}
