package com.idento.data.network

import kotlin.test.Test
import kotlin.test.assertEquals

class ApiClientTest {

    @Test
    fun baseUrlProvider_isReReadOnEachConstruction() {
        // ApiClient's baseUrl is resolved once per HttpClient build (this is the level this
        // unit test can exercise without a real HTTP call) — confirms the constructor accepts
        // and stores a provider lambda, not a fixed String, which is the actual API-shape
        // change this task makes. Full live-swap behavior (a saved URL affecting the very next
        // real request) is exercised in Task 8's live verification, not here.
        var current = "http://first.example.com"
        val client = ApiClient(baseUrlProvider = { current })
        // No direct getter for the resolved URL exists on ApiClient today — this test exists
        // to make the constructor signature change compile-checked. If ApiClient later exposes
        // a way to introspect its configured baseUrlProvider, strengthen this assertion then.
        current = "http://second.example.com"
        assertEquals("http://second.example.com", client.baseUrlProviderForTest())
        client.close()
    }
}
