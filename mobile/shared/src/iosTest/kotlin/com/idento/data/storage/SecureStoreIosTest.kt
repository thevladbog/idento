package com.idento.data.storage

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SecureStoreIosTest {

    @Test
    fun keychainRoundTrip() {
        val store = SecureStore()
        val key = "m4_test_token"
        store.remove(key)
        assertNull(store.getString(key), "should be empty after remove")

        assertTrue(store.putString(key, "jwt.aaa.bbb"), "put should succeed")
        assertEquals("jwt.aaa.bbb", store.getString(key), "get returns stored value")

        assertTrue(store.putString(key, "jwt.ccc.ddd"), "overwrite should succeed")
        assertEquals("jwt.ccc.ddd", store.getString(key), "get returns overwritten value")

        store.remove(key)
        assertNull(store.getString(key), "should be empty after final remove")
    }
}
