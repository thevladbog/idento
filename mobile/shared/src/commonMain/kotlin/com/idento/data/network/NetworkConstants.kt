package com.idento.data.network

/**
 * Network-related constants
 */
object NetworkConstants {
    // Default URLs
    const val DEV_BASE_URL = "http://10.0.2.2:8080"  // Android emulator
    const val IOS_DEV_BASE_URL = "http://localhost:8080"  // iOS simulator
    const val PROD_BASE_URL = "https://api.idento.app"  // Production
    
    // Timeouts
    const val REQUEST_TIMEOUT = 30_000L  // 30 seconds
    const val CONNECT_TIMEOUT = 30_000L
    const val SOCKET_TIMEOUT = 30_000L
    
    // Headers
    const val HEADER_AUTHORIZATION = "Authorization"
    const val HEADER_CONTENT_TYPE = "Content-Type"
    const val HEADER_ACCEPT = "Accept"
    
    // Content Types
    const val CONTENT_TYPE_JSON = "application/json"
    
    // API Versions
    const val API_VERSION = "v1"
}

/**
 * Get platform-specific base URL
 */
expect fun getDefaultBaseUrl(): String
