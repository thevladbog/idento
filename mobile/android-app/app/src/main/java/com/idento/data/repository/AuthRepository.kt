package com.idento.data.repository

import com.idento.data.api.IdentoApi
import com.idento.data.local.TokenManager
import com.idento.data.model.LoginRequest
import com.idento.data.model.LoginResponse
import com.idento.data.model.QRLoginRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: IdentoApi,
    private val tokenManager: TokenManager
) {
    
    val authToken: Flow<String?> = tokenManager.authToken
    val userEmail: Flow<String?> = tokenManager.userEmail
    val userName: Flow<String?> = tokenManager.userName
    
    suspend fun login(email: String, password: String): Result<LoginResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.login(LoginRequest(email, password))
                if (response.isSuccessful && response.body() != null) {
                    val loginResponse = response.body()!!
                    tokenManager.saveAuthData(
                        token = loginResponse.token,
                        email = loginResponse.user.email,
                        name = loginResponse.user.email // используем email как name
                    )
                    Result.success(loginResponse)
                } else {
                    Result.failure(Exception("Login failed: ${response.message()}"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    suspend fun loginWithQR(qrToken: String): Result<LoginResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.qrLogin(QRLoginRequest(qrToken))
                if (response.isSuccessful && response.body() != null) {
                    val loginResponse = response.body()!!
                    tokenManager.saveAuthData(
                        token = loginResponse.token,
                        email = loginResponse.user.email,
                        name = loginResponse.user.email // используем email как name
                    )
                    Result.success(loginResponse)
                } else {
                    Result.failure(Exception("QR Login failed: ${response.message()}"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    suspend fun logout() {
        withContext(Dispatchers.IO) {
            tokenManager.clearAuthData()
        }
    }
}
