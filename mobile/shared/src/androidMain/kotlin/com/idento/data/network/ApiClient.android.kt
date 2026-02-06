package com.idento.data.network

import io.ktor.client.*
import io.ktor.client.engine.okhttp.*

actual fun createPlatformHttpClient(config: HttpClientConfig<*>.() -> Unit): HttpClient {
    return HttpClient(OkHttp) {
        config(this)
        
        engine {
            config {
                followRedirects(true)
            }
        }
    }
}
