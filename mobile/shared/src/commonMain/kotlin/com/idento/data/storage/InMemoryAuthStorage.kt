package com.idento.data.storage

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * In-memory auth storage for iOS (temporary workaround for DataStore issues)
 * This will be lost on app restart, but prevents crashes
 */
class InMemoryAuthStorage {
    
    private val _authToken = MutableStateFlow<String?>(null)
    val authToken: StateFlow<String?> = _authToken.asStateFlow()
    
    private val _userId = MutableStateFlow<String?>(null)
    val userId: StateFlow<String?> = _userId.asStateFlow()
    
    private val _userEmail = MutableStateFlow<String?>(null)
    val userEmail: StateFlow<String?> = _userEmail.asStateFlow()
    
    private val _userName = MutableStateFlow<String?>(null)
    val userName: StateFlow<String?> = _userName.asStateFlow()
    
    private val _userRole = MutableStateFlow<String?>(null)
    val userRole: StateFlow<String?> = _userRole.asStateFlow()
    
    fun saveAuthToken(token: String) {
        _authToken.value = token
        println("✅ [InMemory] Saved auth token")
    }
    
    fun saveUserInfo(
        userId: String,
        email: String,
        name: String?,
        role: String
    ) {
        _userId.value = userId
        _userEmail.value = email
        _userName.value = name
        _userRole.value = role
        println("✅ [InMemory] Saved user info: $email")
    }
    
    fun clearAuth() {
        _authToken.value = null
        _userId.value = null
        _userEmail.value = null
        _userName.value = null
        _userRole.value = null
        println("✅ [InMemory] Cleared auth data")
    }
    
    fun isLoggedIn(): Boolean {
        return !_authToken.value.isNullOrEmpty()
    }
    
    fun getAuthToken(): String? = _authToken.value
}

