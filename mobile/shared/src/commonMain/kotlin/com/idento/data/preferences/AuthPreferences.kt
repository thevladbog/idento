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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

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

        // Pre-SEC-03 builds stored the JWT as plaintext in DataStore under this key.
        private val LEGACY_TOKEN = stringPreferencesKey("auth_token")
    }

    private val dataStore: DataStore<Preferences> =
        dataStoreFactory.createDataStore(DataStoreNames.AUTH)

    // In-memory cache for synchronous access (needed for Ktor Auth)
    // Using atomicfu for thread-safe access in Kotlin/Native
    private val cachedToken = atomic<String?>(null)

    // Long-lived (app-lifetime singleton) scope for the one-shot legacy-token migration.
    private val scope = CoroutineScope(Dispatchers.Default)

    init {
        // Keychain/Keystore reads are synchronous — populate the cache at construction
        // so Ktor's Auth plugin has the token immediately, no async warm-up needed.
        cachedToken.value = secureStore.getString(SecureStoreKeys.AUTH_TOKEN)
        // Best-effort: move any legacy plaintext token out of DataStore into the secure
        // store and purge the plaintext copy (see migrateLegacyPlaintextToken).
        scope.launch { migrateLegacyPlaintextToken() }
    }

    /**
     * One-time upgrade migration. Earlier builds persisted the JWT as plaintext in the
     * DataStore file under "auth_token". Move any such value into the secure store (so the
     * user's session survives the upgrade) and then delete the plaintext copy from disk —
     * eliminating the exact unencrypted-token-at-rest artifact this fix targets.
     * Fail-safe: any error just leaves the user to re-authenticate.
     */
    private suspend fun migrateLegacyPlaintextToken() {
        try {
            val legacy = dataStore.data.first()[LEGACY_TOKEN] ?: return
            if (secureStore.getString(SecureStoreKeys.AUTH_TOKEN) == null &&
                secureStore.putString(SecureStoreKeys.AUTH_TOKEN, legacy)
            ) {
                cachedToken.value = legacy
            }
            // Purge the plaintext key regardless of whether the secure write happened.
            dataStore.edit { it.remove(LEGACY_TOKEN) }
        } catch (e: Exception) {
            // Nothing to migrate, or the store is unavailable — safe to ignore.
        }
    }

    // NOTE: single-emission — emits the current cached token once. Callers today use
    // `.first()` (one-shot). It is NOT a live stream; it will not re-emit on login/logout.
    // If reactive observation is ever needed, back this with a StateFlow.
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
    
    /**
     * Persists the token to the platform secure store. Returns false if the write failed,
     * and in that case does NOT update the in-memory cache — so the caller can fail the
     * login instead of reporting success for a token that was never stored (which would
     * work for the current process only and silently drop the session on next launch).
     */
    suspend fun saveAuthToken(token: String): Boolean {
        val stored = secureStore.putString(SecureStoreKeys.AUTH_TOKEN, token)
        if (stored) {
            cachedToken.value = token
        }
        return stored
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
