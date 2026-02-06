package com.idento.data.network

import io.ktor.client.*
import io.ktor.client.engine.darwin.*

actual fun createPlatformHttpClient(config: HttpClientConfig<*>.() -> Unit): HttpClient {
    return HttpClient(Darwin) {
        config(this)
        
        engine {
            configureRequest {
                setAllowsCellularAccess(true)
            }
        }
    }
}
