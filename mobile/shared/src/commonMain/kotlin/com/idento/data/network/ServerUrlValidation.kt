package com.idento.data.network

import io.ktor.http.Url

/**
 * RFC1918 private ranges (10/8, 172.16/12, 192.168/16) + loopback (127/8) + link-local
 * (169.254/16), matched as plain strings — Kotlin/Native's stdlib has no portable IP-parsing
 * API across Android/iOS, and `io.ktor.http.Url` doesn't classify address ranges either.
 */
private val PRIVATE_IPV4_PATTERN = Regex(
    "^(" +
        "10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}" +
        "|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}" +
        "|192\\.168\\.\\d{1,3}\\.\\d{1,3}" +
        "|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}" +
        "|169\\.254\\.\\d{1,3}\\.\\d{1,3}" +
        ")$"
)

/**
 * IPv6 loopback (`::1`), link-local (`fe80::/10`), and unique-local (`fc00::/7`) — the IPv6
 * analogues of [PRIVATE_IPV4_PATTERN]'s ranges. `fe80::/10`'s second byte range 0x80-0xbf is
 * `[89ab]` as the first hex digit of that byte; `fc00::/7`'s first-byte range 0xfc-0xfd is
 * `f[cd]`. Tolerant of an optional enclosing `[...]` (the bracket form a URL authority uses for
 * IPv6 hosts) since `io.ktor.http.Url.host` is a raw string with no documented guarantee of
 * bracket-stripping.
 */
private val PRIVATE_IPV6_PATTERN = Regex(
    "^\\[?(" +
        "::1" +
        "|fe[89ab][0-9a-f]:.*" +
        "|f[cd][0-9a-f]{2}:.*" +
        ")\\]?$",
    RegexOption.IGNORE_CASE,
)

/**
 * True for a private/loopback/link-local IPv4 or IPv6 literal, `localhost`, or any `.local`
 * mDNS hostname — the set of hosts this app permits reaching over plain HTTP (see
 * [validateServerUrl]). Deliberately conservative: a bare hostname that happens to resolve to
 * a private IP at DNS time (but isn't itself `.local`) is NOT accepted here, since this is a
 * string-only check with no network access — only literal IPs and the two well-known local
 * naming conventions are recognized.
 */
fun isPrivateOrLocalHost(host: String): Boolean {
    val normalized = host.lowercase()
    if (normalized == "localhost" || normalized.endsWith(".local")) return true
    return PRIVATE_IPV4_PATTERN.matches(normalized) || PRIVATE_IPV6_PATTERN.matches(normalized)
}

/** Result of [validateServerUrl]. */
sealed class ServerUrlValidation {
    data object Valid : ServerUrlValidation()
    data class Invalid(val reason: ServerUrlInvalidReason) : ServerUrlValidation()
}

enum class ServerUrlInvalidReason {
    /** Not a parseable absolute http(s) URL. */
    MALFORMED,
    /** A plain-HTTP URL whose host isn't private/local — see [isPrivateOrLocalHost]. */
    HTTP_REQUIRES_PRIVATE_HOST,
}

/**
 * Enforces this app's "HTTP only for private/local networks" policy at the point the user
 * saves a server URL — the actual restriction point, since Android's network security config
 * (see `mobile/androidApp/src/main/res/xml/network_security_config.xml`) permits cleartext
 * broadly at the OS level and can't itself express a CIDR-range restriction. iOS's
 * `NSAllowsLocalNetworking` (Info.plist) enforces the equivalent restriction natively, but this
 * check still runs on both platforms so the save-time error message is identical everywhere.
 */
fun validateServerUrl(input: String): ServerUrlValidation {
    if (input.isBlank()) {
        return ServerUrlValidation.Invalid(ServerUrlInvalidReason.MALFORMED)
    }

    // Require explicit http(s) scheme
    val trimmed = input.trim()
    val isHttps = trimmed.startsWith("https://", ignoreCase = true)
    val isHttp = trimmed.startsWith("http://", ignoreCase = true)

    if (!isHttp && !isHttps) {
        return ServerUrlValidation.Invalid(ServerUrlInvalidReason.MALFORMED)
    }

    val url = try {
        Url(trimmed)
    } catch (e: Exception) {
        return ServerUrlValidation.Invalid(ServerUrlInvalidReason.MALFORMED)
    }

    // Double-check protocol and host are valid
    if (url.host.isBlank()) {
        return ServerUrlValidation.Invalid(ServerUrlInvalidReason.MALFORMED)
    }

    if (isHttp && !isPrivateOrLocalHost(url.host)) {
        return ServerUrlValidation.Invalid(ServerUrlInvalidReason.HTTP_REQUIRES_PRIVATE_HOST)
    }

    return ServerUrlValidation.Valid
}
