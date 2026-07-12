package com.idento.platform.kiosk

import androidx.compose.runtime.Composable

/**
 * Enables/disables kiosk device lockdown for the duration this composable stays in composition
 * with [enabled] true. Unlike every other platform service in this codebase (CameraService,
 * ScanSource, PrinterService — all Context-scoped Koin singletons), lockdown is inherently
 * Activity/Window-scoped: Android's Activity.startLockTask() needs an actual Activity reference
 * whose lifetime doesn't fit a Koin singleton. Modeling this as a Composable function (rather
 * than a class registered in AppModule.kt) lets each platform actual reach the current Activity/
 * Window via Compose's own composition locals, and lets leaving the composition (e.g. navigating
 * away from the Kiosk screen) naturally reverse the lockdown via DisposableEffect's onDispose —
 * no separate manual teardown call site to keep in sync.
 */
@Composable
expect fun KioskLockEffect(enabled: Boolean)
