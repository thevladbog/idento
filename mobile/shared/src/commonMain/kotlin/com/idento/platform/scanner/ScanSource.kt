package com.idento.platform.scanner

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/** UI-facing indicator for screen 3b's scanner-status pill — Camera is the default/fallback. */
sealed interface ScannerConnectionState {
    data object Camera : ScannerConnectionState
    data class HardwareConnected(val label: String) : ScannerConnectionState
    data object HardwareDisconnected : ScannerConnectionState
}

/**
 * Unified scan-input seam consumed by both RegistrationHomeViewModel and ZoneControlViewModel.
 * Merges the platform camera with any connected hardware/BT scanner into one Flow<String> — the
 * caller doesn't need to know which physical source produced a given code.
 */
interface ScanSource {
    val connectionState: StateFlow<ScannerConnectionState>
    fun startScanning(): Flow<String>
    fun stopScanning()

    /** Forces the camera path for the current scan session even if a hardware scanner is
     * connected — wired to the "Switch to phone camera" fallback button on screen 3b. Resets on
     * the next [stopScanning] → [startScanning] cycle (e.g. leaving and re-entering the scan
     * tab), so leaving the screen and coming back re-detects the hardware scanner normally. */
    fun preferCamera()
}
