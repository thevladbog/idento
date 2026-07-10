package com.idento.data.storage

/**
 * Platform-backed secure key/value store for small secrets (the auth JWT).
 * iOS: Keychain (kSecClassGenericPassword, AfterFirstUnlockThisDeviceOnly).
 * Android: AES-256/GCM via Android Keystore, ciphertext in SharedPreferences.
 *
 * Fail-closed: reads return null and writes return false on any error, so callers
 * degrade to "no session / re-login" rather than crashing.
 */
expect class SecureStore {
    fun putString(key: String, value: String): Boolean
    fun getString(key: String): String?
    fun remove(key: String)
}

/** Keys used with [SecureStore]. */
object SecureStoreKeys {
    const val AUTH_TOKEN = "auth_token"
}
