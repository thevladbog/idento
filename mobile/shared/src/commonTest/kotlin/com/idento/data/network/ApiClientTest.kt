package com.idento.data.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ApiClientTest {

    @Test
    fun parsesMessageAndCodeFromErrorBody() {
        val (message, code) = parseApiErrorBody(
            """{"code":"tenant_suspended","error":"This organization is suspended. Contact support."}"""
        )
        assertEquals("This organization is suspended. Contact support.", message)
        assertEquals("tenant_suspended", code)
    }

    @Test
    fun parsesMessageWithNoCode() {
        // Most backend error responses are just {"error": "..."} with no "code" field.
        val (message, code) = parseApiErrorBody("""{"error":"Invalid event ID"}""")
        assertEquals("Invalid event ID", message)
        assertNull(code)
    }

    @Test
    fun returnsNullsForNonObjectBody() {
        // The exact shape that broke the "Choose an event" screen before this fix: a success
        // response deserializer expects an array, so a real client saw this body only when the
        // *request* itself succeeded — but for a non-2xx body that isn't a JSON object at all
        // (malformed, empty, or an unrelated shape), parsing must degrade to nulls rather than
        // throw, so bodyOrApiError's fallback message still fires.
        val (message, code) = parseApiErrorBody("not json at all")
        assertNull(message)
        assertNull(code)
    }

    @Test
    fun returnsNullsForEmptyBody() {
        val (message, code) = parseApiErrorBody("")
        assertNull(message)
        assertNull(code)
    }
}
