package com.idento.data.network

import io.ktor.client.plugins.logging.LogLevel
import kotlin.test.Test
import kotlin.test.assertEquals

class NetworkConfigTest {

    @Test
    fun debugBuildUsesDevUrl() {
        assertEquals(
            NetworkConstants.DEV_BASE_URL,
            resolveBaseUrl(isDebug = true, devUrl = NetworkConstants.DEV_BASE_URL, prodUrl = NetworkConstants.PROD_BASE_URL)
        )
    }

    @Test
    fun releaseBuildUsesProdUrl() {
        assertEquals(
            NetworkConstants.PROD_BASE_URL,
            resolveBaseUrl(isDebug = false, devUrl = NetworkConstants.DEV_BASE_URL, prodUrl = NetworkConstants.PROD_BASE_URL)
        )
        // Prod must be HTTPS.
        assertEquals(true, NetworkConstants.PROD_BASE_URL.startsWith("https://"))
    }

    @Test
    fun debugLogsHeadersOnly_releaseLogsNothing() {
        // HEADERS never logs bodies (password/JWT live in bodies); NONE logs nothing.
        assertEquals(LogLevel.HEADERS, logLevelFor(isDebug = true))
        assertEquals(LogLevel.NONE, logLevelFor(isDebug = false))
        assertEquals(false, LogLevel.HEADERS.body) // body logging is off even in debug
    }
}
