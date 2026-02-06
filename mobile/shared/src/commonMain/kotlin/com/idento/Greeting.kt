package com.idento

class Greeting {
    private val platform = getPlatform()

    fun greet(): String {
        return "Hello from Kotlin Multiplatform!\nRunning on ${platform.name}"
    }
}
