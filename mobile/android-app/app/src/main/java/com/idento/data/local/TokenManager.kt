package com.idento.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TokenManager @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    private val cryptoManager: CryptoManager
) {
    companion object {
        private val TOKEN_KEY = stringPreferencesKey("auth_token")
        private val USER_EMAIL_KEY = stringPreferencesKey("user_email")
        private val USER_NAME_KEY = stringPreferencesKey("user_name")
    }

    // Long-lived (app-lifetime singleton) scope for the one-shot legacy-token migration.
    private val scope = CoroutineScope(Dispatchers.IO)

    init {
        // Upgrade migration: pre-SEC-03 builds wrote these values as plaintext. Re-encrypt
        // them in place on first run so upgrading users stay logged in AND the plaintext
        // JWT is overwritten with ciphertext on disk (instead of lingering until next login).
        scope.launch { migrateLegacyPlaintext() }
    }

    /**
     * Re-encrypts any value that isn't already our AES/GCM ciphertext. A legacy plaintext
     * value fails [CryptoManager.decrypt] (returns null), which is our signal to encrypt it;
     * a value that already decrypts is left untouched. Best-effort and fail-safe.
     */
    private suspend fun migrateLegacyPlaintext() {
        try {
            dataStore.edit { preferences ->
                for (key in listOf(TOKEN_KEY, USER_EMAIL_KEY, USER_NAME_KEY)) {
                    val stored = preferences[key] ?: continue
                    if (cryptoManager.decrypt(stored) == null) {
                        cryptoManager.encrypt(stored)?.let { preferences[key] = it }
                    }
                }
            }
        } catch (e: Exception) {
            // Nothing to migrate, or store unavailable — safe to ignore.
        }
    }

    val authToken: Flow<String?> = dataStore.data.map { preferences ->
        preferences[TOKEN_KEY]?.let { cryptoManager.decrypt(it) }
    }

    val userEmail: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_EMAIL_KEY]?.let { cryptoManager.decrypt(it) }
    }

    val userName: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_NAME_KEY]?.let { cryptoManager.decrypt(it) }
    }

    /**
     * Persists the auth credentials encrypted. Returns false (persisting nothing) if any
     * field fails to encrypt, so the caller can fail the login rather than report success
     * with no token stored (which would leave the next launch unauthenticated).
     */
    suspend fun saveAuthData(token: String, email: String, name: String): Boolean {
        // Encrypt all three up front: if any field fails, abort the whole write so we
        // never persist a mismatched (partly-updated) token/email/name triple.
        val encToken = cryptoManager.encrypt(token) ?: return false
        val encEmail = cryptoManager.encrypt(email) ?: return false
        val encName = cryptoManager.encrypt(name) ?: return false
        dataStore.edit { preferences ->
            preferences[TOKEN_KEY] = encToken
            preferences[USER_EMAIL_KEY] = encEmail
            preferences[USER_NAME_KEY] = encName
        }
        return true
    }

    suspend fun clearAuthData() {
        dataStore.edit { preferences ->
            preferences.remove(TOKEN_KEY)
            preferences.remove(USER_EMAIL_KEY)
            preferences.remove(USER_NAME_KEY)
        }
    }

    suspend fun getToken(): String? {
        val preferences = dataStore.data.first()
        return preferences[TOKEN_KEY]?.let { cryptoManager.decrypt(it) }
    }
}
