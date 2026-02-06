package com.idento.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TokenManager @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {
    companion object {
        private val TOKEN_KEY = stringPreferencesKey("auth_token")
        private val USER_EMAIL_KEY = stringPreferencesKey("user_email")
        private val USER_NAME_KEY = stringPreferencesKey("user_name")
    }
    
    val authToken: Flow<String?> = dataStore.data.map { preferences ->
        preferences[TOKEN_KEY]
    }
    
    val userEmail: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_EMAIL_KEY]
    }
    
    val userName: Flow<String?> = dataStore.data.map { preferences ->
        preferences[USER_NAME_KEY]
    }
    
    suspend fun saveAuthData(token: String, email: String, name: String) {
        dataStore.edit { preferences ->
            preferences[TOKEN_KEY] = token
            preferences[USER_EMAIL_KEY] = email
            preferences[USER_NAME_KEY] = name
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
        var token: String? = null
        dataStore.data.collect { preferences ->
            token = preferences[TOKEN_KEY]
        }
        return token
    }
}
