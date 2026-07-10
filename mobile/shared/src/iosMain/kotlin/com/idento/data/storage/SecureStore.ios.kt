package com.idento.data.storage

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryAddValue
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFTypeRef
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFAllocatorDefault
import platform.CoreFoundation.kCFBooleanTrue
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData
import platform.darwin.OSStatus

/**
 * Retain-and-bridge a Kotlin [String] into a `CFStringRef` (toll-free bridged to `NSString`).
 * Caller owns the returned reference and must [CFRelease] it (directly or via the dictionary
 * that takes ownership when the value is added with the "retain" value callbacks).
 */
@OptIn(ExperimentalForeignApi::class)
private fun CFString(value: String): CFTypeRef? = CFBridgingRetain(value as NSString)

/**
 * Retain-and-bridge an [NSData] into a `CFDataRef`. See [CFString] for ownership notes.
 */
@OptIn(ExperimentalForeignApi::class)
private fun CFData(data: NSData): CFTypeRef? = CFBridgingRetain(data)

/**
 * Consume (transfer ownership of) a `CFTypeRef` obtained from `SecItemCopyMatching` and bridge
 * it back to an [NSData], releasing our ownership of the underlying object in the process.
 */
@OptIn(ExperimentalForeignApi::class)
private fun CFBridgingReleaseToNSData(ref: CFTypeRef?): NSData? = CFBridgingRelease(ref) as? NSData

@OptIn(ExperimentalForeignApi::class)
actual class SecureStore {

    actual fun putString(key: String, value: String): Boolean = try {
        // SecItemAdd fails on a duplicate, so clear any existing item first.
        remove(key)
        val data = (value as NSString).dataUsingEncoding(NSUTF8StringEncoding) ?: return false
        val serviceRef = CFString(SERVICE)
        val accountRef = CFString(key)
        val dataRef = CFData(data)
        try {
            val query = CFDictionaryCreateMutable(
                kCFAllocatorDefault, 0,
                kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr
            )
            try {
                CFDictionaryAddValue(query, kSecClass, kSecClassGenericPassword)
                CFDictionaryAddValue(query, kSecAttrService, serviceRef)
                CFDictionaryAddValue(query, kSecAttrAccount, accountRef)
                CFDictionaryAddValue(query, kSecValueData, dataRef)
                CFDictionaryAddValue(query, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
                val status: OSStatus = SecItemAdd(query, null)
                status == errSecSuccess
            } finally {
                CFRelease(query)
            }
        } finally {
            serviceRef?.let { CFRelease(it) }
            accountRef?.let { CFRelease(it) }
            dataRef?.let { CFRelease(it) }
        }
    } catch (e: Exception) {
        false
    }

    actual fun getString(key: String): String? = try {
        memScoped {
            val serviceRef = CFString(SERVICE)
            val accountRef = CFString(key)
            try {
                val query = CFDictionaryCreateMutable(
                    kCFAllocatorDefault, 0,
                    kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr
                )
                try {
                    CFDictionaryAddValue(query, kSecClass, kSecClassGenericPassword)
                    CFDictionaryAddValue(query, kSecAttrService, serviceRef)
                    CFDictionaryAddValue(query, kSecAttrAccount, accountRef)
                    CFDictionaryAddValue(query, kSecReturnData, kCFBooleanTrue)
                    CFDictionaryAddValue(query, kSecMatchLimit, kSecMatchLimitOne)
                    val result = alloc<CFTypeRefVar>()
                    val status = SecItemCopyMatching(query, result.ptr)
                    if (status != errSecSuccess) return@memScoped null
                    val nsData = CFBridgingReleaseToNSData(result.value) ?: return@memScoped null
                    NSString.create(nsData, NSUTF8StringEncoding) as String?
                } finally {
                    CFRelease(query)
                }
            } finally {
                serviceRef?.let { CFRelease(it) }
                accountRef?.let { CFRelease(it) }
            }
        }
    } catch (e: Exception) {
        null
    }

    actual fun remove(key: String) {
        try {
            val serviceRef = CFString(SERVICE)
            val accountRef = CFString(key)
            try {
                val query = CFDictionaryCreateMutable(
                    kCFAllocatorDefault, 0,
                    kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr
                )
                try {
                    CFDictionaryAddValue(query, kSecClass, kSecClassGenericPassword)
                    CFDictionaryAddValue(query, kSecAttrService, serviceRef)
                    CFDictionaryAddValue(query, kSecAttrAccount, accountRef)
                    SecItemDelete(query)
                } finally {
                    CFRelease(query)
                }
            } finally {
                serviceRef?.let { CFRelease(it) }
                accountRef?.let { CFRelease(it) }
            }
        } catch (e: Exception) {
            // Fail-closed: nothing to clean up if the query itself couldn't be built.
        }
    }

    private companion object {
        const val SERVICE = "com.idento.shared.auth"
    }
}
