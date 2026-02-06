package com.idento

import androidx.compose.ui.window.ComposeUIViewController
import platform.UIKit.UIViewController

/**
 * Main iOS ViewController that wraps Compose UI
 * 
 * Note: CADisableMinimumFrameDurationOnPhone must be set to true in Info.plist
 * for ProMotion displays (120Hz) support
 */
fun MainViewController(): UIViewController {
    return ComposeUIViewController(
        configure = {
            // Enable strict plist validation - requires CADisableMinimumFrameDurationOnPhone in Info.plist
            enforceStrictPlistSanityCheck = true
        }
    ) {
        App()
    }
}
