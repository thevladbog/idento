package com.idento.data.repository

import com.idento.data.model.LoginResponse
import com.idento.data.model.User
import com.idento.data.network.ApiResult
import com.idento.data.network.AuthApiService
import com.idento.data.network.toApiResult
import com.idento.data.preferences.AuthPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first

/**
 * Authentication Repository (Cross-platform)
 * Handles login, logout, and user session management
 */
class AuthRepository(
    private val authApiService: AuthApiService,
    private val authPreferences: AuthPreferences
) {
    
    /**
     * Login with email and password
     */
    suspend fun login(email: String, password: String): ApiResult<LoginResponse> {
        val result = authApiService.login(email, password).toApiResult()
        
        if (result is ApiResult.Success) {
            // Save token and user info
            try {
                authPreferences.saveAuthToken(result.data.token)
                result.data.user.let { user ->
                    authPreferences.saveUserInfo(
                        userId = user.id,
                        email = user.email,
                        name = user.name,
                        role = user.role
                    )
                }
            } catch (e: Exception) {
                // TODO: Fix DataStore on iOS - for now just skip saving
                println("⚠️ Failed to save auth data: ${e.message}")
            }
        }
        
        return result
    }
    
    /**
     * Login with QR token
     */
    suspend fun loginWithQR(token: String): ApiResult<LoginResponse> {
        val result = authApiService.loginWithQR(token).toApiResult()
        
        if (result is ApiResult.Success) {
            try {
                authPreferences.saveAuthToken(result.data.token)
                result.data.user.let { user ->
                    authPreferences.saveUserInfo(
                        userId = user.id,
                        email = user.email,
                        name = user.name,
                        role = user.role
                    )
                }
            } catch (e: Exception) {
                // TODO: Fix DataStore on iOS - for now just skip saving
                println("⚠️ Failed to save auth data: ${e.message}")
            }
        }
        
        return result
    }
    
    /**
     * Get current user
     */
    suspend fun getCurrentUser(): ApiResult<User> {
        return authApiService.getMe().toApiResult()
    }
    
    /**
     * Logout
     */
    suspend fun logout() {
        try {
            authPreferences.clearAuth()
        } catch (e: Exception) {
            // TODO: Fix DataStore on iOS
            println("⚠️ Failed to clear auth data: ${e.message}")
        }
    }
    
    /**
     * Check if user is logged in
     */
    suspend fun isLoggedIn(): Boolean {
        return try {
            authPreferences.isLoggedIn()
        } catch (e: Exception) {
            println("⚠️ Failed to check login status: ${e.message}")
            false  // Assume not logged in on error
        }
    }
    
    /**
     * Get auth token
     */
    fun getAuthToken(): Flow<String?> {
        return authPreferences.authToken
    }
    
    /**
     * Get current user ID
     */
    suspend fun getUserId(): String? {
        return try {
            authPreferences.userId.first()
        } catch (e: Exception) {
            println("⚠️ Failed to get user ID: ${e.message}")
            null
        }
    }
    
    /**
     * Get current user email
     */
    suspend fun getUserEmail(): String? {
        return try {
            authPreferences.userEmail.first()
        } catch (e: Exception) {
            println("⚠️ Failed to get user email: ${e.message}")
            null
        }
    }
}
