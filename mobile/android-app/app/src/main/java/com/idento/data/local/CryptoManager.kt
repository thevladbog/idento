package com.idento.data.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Encrypts small secrets (JWT, user identity) with an AES-256/GCM key held in the
 * Android Keystore (hardware-backed where available). The key never leaves the
 * Keystore; only Base64(iv || ciphertext) is persisted to DataStore.
 *
 * All operations fail closed: any exception yields null, and callers treat a null
 * decrypt as "no valid session" (the user re-authenticates). This also handles the
 * upgrade case where an old plaintext value can't be decrypted.
 */
@Singleton
class CryptoManager @Inject constructor() {

    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    @Volatile
    private var cachedKey: SecretKey? = null

    // Synchronized so a first-use race between two coroutines can't both generate
    // (and thus overwrite) the key for the same alias; the resolved key is cached
    // to avoid a Keystore round-trip on every encrypt/decrypt.
    @Synchronized
    private fun getOrCreateKey(): SecretKey {
        cachedKey?.let { return it }
        val existing = (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
        val key = existing ?: run {
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
            generator.init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            generator.generateKey()
        }
        cachedKey = key
        return key
    }

    /** Returns Base64(iv || ciphertext), or null on failure. */
    fun encrypt(plainText: String): String? = try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv // 12 bytes for GCM
        val cipherText = cipher.doFinal(plainText.encodeToByteArray())
        Base64.encodeToString(iv + cipherText, Base64.NO_WRAP)
    } catch (e: Exception) {
        null
    }

    /** Decrypts a Base64(iv || ciphertext) string; returns null on any failure. */
    fun decrypt(encoded: String): String? = try {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
        val cipherText = combined.copyOfRange(GCM_IV_LENGTH, combined.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
        cipher.doFinal(cipherText).decodeToString()
    } catch (e: Exception) {
        null
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "idento_auth_key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_LENGTH = 12
        private const val GCM_TAG_LENGTH_BITS = 128
    }
}
