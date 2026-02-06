package com.idento

/**
 * Platform information interface
 */
interface Platform {
    val name: String
    val osVersion: String
}

expect fun getPlatform(): Platform
