package com.idento.platform.kiosk

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Android lockdown: simplified screen pinning (Activity.startLockTask() without Device Owner
 * provisioning — works on any device, triggers Android's standard one-time "Screen pinning"
 * consent dialog on first use, exits via the OS's own back+overview-hold gesture or a device
 * PIN if one is set) + keep-screen-on + hidden system bars. Full Device Owner/COSU lockdown
 * would need out-of-app enterprise/MDM provisioning infrastructure — explicitly out of scope.
 */
@Composable
actual fun KioskLockEffect(enabled: Boolean) {
    val context = LocalContext.current
    DisposableEffect(enabled) {
        val activity = context as? ComponentActivity
        if (activity == null || !enabled) {
            return@DisposableEffect onDispose {}
        }

        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val insetsController =
            WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController.hide(WindowInsetsCompat.Type.systemBars())

        try {
            activity.startLockTask()
        } catch (e: SecurityException) {
            // Screen pinning blocked by device policy — degrade gracefully: keep-screen-on and
            // hidden system bars still apply even without Lock Task Mode.
        } catch (e: IllegalArgumentException) {
            // Activity/task doesn't support lock task on this device — same graceful degradation.
        }

        onDispose {
            try {
                activity.stopLockTask()
            } catch (e: IllegalArgumentException) {
                // Wasn't actually pinned (e.g. startLockTask() above failed) — ignore.
            }
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            insetsController.show(WindowInsetsCompat.Type.systemBars())
        }
    }
}
