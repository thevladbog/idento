package com.idento.data.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse

class ServerUrlValidationTest {

    @Test
    fun isPrivateOrLocalHost_acceptsRfc1918Ranges() {
        assertTrue(isPrivateOrLocalHost("10.0.0.1"))
        assertTrue(isPrivateOrLocalHost("10.255.255.255"))
        assertTrue(isPrivateOrLocalHost("172.16.0.1"))
        assertTrue(isPrivateOrLocalHost("172.31.255.255"))
        assertTrue(isPrivateOrLocalHost("192.168.1.10"))
        assertTrue(isPrivateOrLocalHost("192.168.0.1"))
    }

    @Test
    fun isPrivateOrLocalHost_acceptsLoopbackAndLinkLocal() {
        assertTrue(isPrivateOrLocalHost("127.0.0.1"))
        assertTrue(isPrivateOrLocalHost("127.53.0.9"))
        assertTrue(isPrivateOrLocalHost("169.254.1.1"))
    }

    @Test
    fun isPrivateOrLocalHost_acceptsLocalhostAndDotLocal() {
        assertTrue(isPrivateOrLocalHost("localhost"))
        assertTrue(isPrivateOrLocalHost("LOCALHOST"))
        assertTrue(isPrivateOrLocalHost("checkin.local"))
        assertTrue(isPrivateOrLocalHost("my-server.LOCAL"))
    }

    @Test
    fun isPrivateOrLocalHost_rejectsPublicHosts() {
        assertFalse(isPrivateOrLocalHost("api.idento.app"))
        assertFalse(isPrivateOrLocalHost("8.8.8.8"))
        assertFalse(isPrivateOrLocalHost("172.32.0.1")) // just outside 172.16-31
        assertFalse(isPrivateOrLocalHost("172.15.255.255")) // just below range
        assertFalse(isPrivateOrLocalHost("example.com"))
    }

    @Test
    fun validateServerUrl_acceptsHttpsToAnyHost() {
        assertEquals(ServerUrlValidation.Valid, validateServerUrl("https://api.idento.app"))
        assertEquals(ServerUrlValidation.Valid, validateServerUrl("https://192.168.1.10:8008"))
    }

    @Test
    fun validateServerUrl_acceptsHttpToPrivateHost() {
        assertEquals(ServerUrlValidation.Valid, validateServerUrl("http://192.168.1.10:8008"))
        assertEquals(ServerUrlValidation.Valid, validateServerUrl("http://localhost:8080"))
    }

    @Test
    fun validateServerUrl_rejectsHttpToPublicHost() {
        val result = validateServerUrl("http://api.idento.app")
        assertEquals(
            ServerUrlValidation.Invalid(ServerUrlInvalidReason.HTTP_REQUIRES_PRIVATE_HOST),
            result,
        )
    }

    @Test
    fun validateServerUrl_rejectsMalformedInput() {
        assertEquals(
            ServerUrlValidation.Invalid(ServerUrlInvalidReason.MALFORMED),
            validateServerUrl("not a url"),
        )
        assertEquals(
            ServerUrlValidation.Invalid(ServerUrlInvalidReason.MALFORMED),
            validateServerUrl(""),
        )
    }

    @Test
    fun validateServerUrl_rejectsNonHttpScheme() {
        assertEquals(
            ServerUrlValidation.Invalid(ServerUrlInvalidReason.MALFORMED),
            validateServerUrl("ftp://192.168.1.10"),
        )
    }
}
