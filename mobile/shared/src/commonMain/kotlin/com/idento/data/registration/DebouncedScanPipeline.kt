package com.idento.data.registration

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlin.time.Clock
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

/**
 * Merges any scan source — `CameraService.startScanning()` today, a future M2 hardware-scanner
 * `Flow<String>` later (this class deliberately takes a plain `Flow<String>` rather than
 * `CameraService` itself, so it stays source-agnostic) — with a PER-CODE debounce: a repeat of
 * the SAME code within [debounceWindow] is suppressed, but a genuinely different code always
 * passes through immediately, even if it arrives 1ms after a different code (e.g. two different
 * attendees scanned back to back at a busy check-in station).
 *
 * This is deliberately NOT Kotlin's built-in `Flow.debounce()` operator: that operator suppresses
 * ALL rapid emissions regardless of value (it only lets a value through once the *upstream* has
 * gone quiet for the window), which would incorrectly hold back a different attendee's code just
 * because it followed closely behind someone else's. Per-code tracking is required instead.
 *
 * Consumed by (future, M1d) the scan screen's ViewModel via
 * `process(cameraService.startScanning())`.
 *
 * ### Clock choice
 * Uses a real wall-clock ([kotlin.time.Clock]), not `kotlinx.coroutines.test`'s virtual
 * `TestCoroutineScheduler` time (which exists only inside `runTest`) — this pipeline runs against
 * a live camera/hardware scan stream in production, where there is no virtual scheduler to
 * advance. `kotlin.time.Clock`/`kotlin.time.Instant` were stabilized in Kotlin 2.3 (no longer
 * require `@OptIn(ExperimentalTime::class)`); the older project convention of routing through
 * `kotlinx.datetime.Clock` instead was to route around a Kotlin/Native crash caused by a
 * kotlinx-datetime/Compose Multiplatform version conflict — since fixed by pinning
 * `kotlinx-datetime` to the `0.7.1-0.6.x-compat` artifact (see `mobile/shared/build.gradle.kts`),
 * which made `kotlinx.datetime.Clock`/`Instant` real (non-typealias) classes again but also
 * deprecated them (`WARNING`-level, "Use kotlin.time.Clock instead") in favor of the now-stable
 * `kotlin.time` versions. This class has no reason to cross an `Instant` through its public API
 * (only `Flow<String>` in, `Flow<String>` out), so there is no interop concern either way — using
 * `kotlin.time.Clock` here avoids the deprecation warning entirely.
 *
 * ### Thread-safety
 * [lastSeenAt] is a plain (non-atomic, non-concurrent) mutable map, not an
 * `kotlinx.atomicfu`-backed structure like `AuthPreferences.cachedToken`. That is a deliberate
 * choice, not an oversight: `AuthPreferences.cachedToken` genuinely is read/written from
 * independent call sites (Ktor's Auth plugin reading synchronously, login/logout writing), so it
 * needs real cross-thread safety. `process()` returns a *cold* `Flow`, and this codebase's one
 * established call-site pattern for `CameraService.startScanning()`
 * (`viewModelScope.launch { cameraService.startScanning().collect { ... } }` in
 * `SetupLoginViewModel` and `SetupPrinterScreen`) always collects it from a single coroutine.
 * `Flow.filter`'s predicate therefore only ever runs sequentially, one emission at a time, on
 * whatever single coroutine is collecting — no concurrent map access is possible in practice. If
 * a future caller ever collects the same `DebouncedScanPipeline` instance from multiple
 * concurrent coroutines, [lastSeenAt] would need to move to an atomicfu-backed (or otherwise
 * synchronized) structure at that point.
 */
class DebouncedScanPipeline(private val debounceWindow: Duration = 3.seconds) {

    /** Last-seen wall-clock timestamp per scanned code. See class doc for thread-safety notes. */
    private val lastSeenAt = mutableMapOf<String, Instant>()

    /**
     * @return a [Flow] emitting every code from [source] except a repeat of the same code seen
     * less than [debounceWindow] ago. A different code always passes through immediately.
     */
    fun process(source: Flow<String>): Flow<String> = source.filter { code -> shouldPass(code) }

    private fun shouldPass(code: String): Boolean {
        val now = Clock.System.now()
        val last = lastSeenAt[code]
        val isNewOrExpired = last == null || (now - last) >= debounceWindow
        if (isNewOrExpired) {
            lastSeenAt[code] = now
        }
        return isNewOrExpired
    }
}
