package com.idento.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.DataStoreNames
import com.idento.data.storage.SecureStore
import com.idento.data.storage.SecureStoreKeys
import kotlinx.atomicfu.atomic
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map

/**
 * Authentication preferences (token, user info)
 *
 * Note: Token is cached in-memory for synchronous access by Ktor Auth.
 * The cache is populated when saveAuthToken() is called after successful login.
 * The token itself is persisted in [SecureStore] (iOS Keychain / Android Keystore),
 * not in DataStore — only user info (id/email/name/role) lives in DataStore.
 */
class AuthPreferences(dataStoreFactory: DataStoreFactory, private val secureStore: SecureStore) {

    companion object {
        private val USER_ID = stringPreferencesKey("user_id")
        private val USER_EMAIL = stringPreferencesKey("user_email")
        private val USER_NAME = stringPreferencesKey("user_name")
        private val USER_ROLE = stringPreferencesKey("user_role")
    }

    private val dataStore: DataStore<Preferences> =
        dataStoreFactory.createDataStore(DataStoreNames.AUTH)

    // In-memory cache for synchronous access (needed for Ktor Auth)
    // Using atomicfu for thread-safe access in Kotlin/Native
    private val cachedToken = atomic<String?>(null)

    init {
        // Keychain/Keystore reads are synchronous — populate the cache at construction
        // so Ktor's Auth plugin has the token immediately, no async warm-up needed.
        cachedToken.value = secureStore.getString(SecureStoreKeys.AUTH_TOKEN)
    }

    val authToken: Flow<String?> = flow { emit(cachedToken.value) }

    /**
     * Get token synchronously from in-memory cache
     * This is used by Ktor Auth plugin which needs synchronous access
     */
    fun getTokenSync(): String? = cachedToken.value
    
    /**
     * Load token from DataStore into cache (call once at app start if needed)
     */
    suspend fun loadTokenIntoCache() {
        try {
            val token = authToken.first()
            cachedToken.value = token
        } catch (e: Exception) {
            // DataStore not ready or empty - that's OK
            println("⚠️ Could not load token into cache: ${e.message}")
        }
    }
    
    val userId: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_ID]
    }
    
    val userEmail: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_EMAIL]
    }
    
    val userName: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_NAME]
    }
    
    val userRole: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_ROLE]
    }
    
    suspend fun saveAuthToken(token: String) {
        // Update in-memory cache immediately
        cachedToken.value = token
        // Persist to the platform secure store (iOS Keychain / Android Keystore)
        secureStore.putString(SecureStoreKeys.AUTH_TOKEN, token)
    }
    
    suspend fun saveUserInfo(
        userId: String,
        email: String,
        name: String?,  // Optional - may be null from API
        role: String
    ) {
        dataStore.edit { preferences ->
            preferences[USER_ID] = userId
            preferences[USER_EMAIL] = email
            if (name != null) {
                preferences[USER_NAME] = name
            }
            preferences[USER_ROLE] = role
        }
    }
    
    suspend fun clearAuth() {
        // Clear in-memory cache immediately
        cachedToken.value = null
        // Remove token from the secure store
        secureStore.remove(SecureStoreKeys.AUTH_TOKEN)
        // Clear DataStore (user info)
        dataStore.edit { preferences ->
            preferences.clear()
        }
    }
    
    suspend fun isLoggedIn(): Boolean {
        // First check in-memory cache for quick response
        val token = cachedToken.value
        if (!token.isNullOrEmpty()) return true
        
        // Fallback to DataStore check using first() instead of collect()
        return try {
            val storedToken = authToken.first()
            // Also update cache if we found a token
            if (!storedToken.isNullOrEmpty()) {
                cachedToken.value = storedToken
            }
            !storedToken.isNullOrEmpty()
        } catch (e: Exception) {
            println("⚠️ Could not check login status: ${e.message}")
            false
        }
    }
}
