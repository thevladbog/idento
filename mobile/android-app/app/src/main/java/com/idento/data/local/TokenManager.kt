package com.idento.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
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

    val authToken: Flow<String?> = dataStore.data.map { preferences ->
        preferences[TOKEN_KEY]?.let { cryptoManager.decrypt(it) }
    }

    val userEmail: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_EMAIL_KEY]?.let { cryptoManager.decrypt(it) }
    }

    val userName: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_NAME_KEY]?.let { cryptoManager.decrypt(it) }
    }

    suspend fun saveAuthData(token: String, email: String, name: String) {
        // Encrypt all three up front: if any field fails, abort the whole write so we
        // never persist a mismatched (partly-updated) token/email/name triple.
        val encToken = cryptoManager.encrypt(token) ?: return
        val encEmail = cryptoManager.encrypt(email) ?: return
        val encName = cryptoManager.encrypt(name) ?: return
        dataStore.edit { preferences ->
            preferences[TOKEN_KEY] = encToken
            preferences[USER_EMAIL_KEY] = encEmail
            preferences[USER_NAME_KEY] = encName
        }
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
