package com.idento

import android.content.Context
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.idento.data.local.CryptoManager
import com.idento.data.preferences.AuthPreferences
import kotlinx.coroutines.flow.first

private val Context.legacyAuthDataStore by preferencesDataStore(name = "idento_preferences")
private val LEGACY_TOKEN_KEY = stringPreferencesKey("auth_token")

/**
 * One-time upgrade path for users who logged in on the pre-M1a Hilt-based Android app. That
 * build encrypted the JWT with [CryptoManager] into a DataStore file named "idento_preferences" —
 * a different file and format than the shared [AuthPreferences] (SecureStore + "auth_preferences").
 * Without this, those users are silently logged out the first time they open a build that boots
 * the shared UI. Only the token is migrated (the old store never held a user id or role); the
 * app's normal post-login profile refresh repopulates the rest. Best-effort and fail-safe: any
 * error just leaves the user to re-authenticate.
 */
suspend fun migrateLegacyAndroidSession(context: Context, authPreferences: AuthPreferences) {
    if (authPreferences.isLoggedIn()) return
    try {
        val legacyToken = context.legacyAuthDataStore.data.first()[LEGACY_TOKEN_KEY] ?: return
        val decrypted = CryptoManager().decrypt(legacyToken) ?: return
        authPreferences.saveAuthToken(decrypted)
    } catch (e: Exception) {
        // Nothing to migrate, or the store is unavailable — safe to ignore.
    }
}
