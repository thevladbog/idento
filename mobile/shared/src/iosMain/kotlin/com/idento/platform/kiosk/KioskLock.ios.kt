package com.idento.platform.kiosk

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import platform.UIKit.UIApplication

/**
 * iOS lockdown: keep-screen-on only. Guided Access (the iOS equivalent of Lock Task Mode) cannot
 * be triggered programmatically by an app — it's an OS-level accessibility feature staff must
 * enable manually (triple-click the side/Home button) before handing the device to an attendee.
 * This is a platform limitation, not a missing feature — the same kind of asymmetry M2 documented
 * for BT scanning being Android-only.
 */
@Composable
actual fun KioskLockEffect(enabled: Boolean) {
    DisposableEffect(enabled) {
        UIApplication.sharedApplication().idleTimerDisabled = enabled
        onDispose {
            UIApplication.sharedApplication().idleTimerDisabled = false
        }
    }
}
