package com.idento.data.model

/**
 * Cross-platform Bluetooth Device representation
 */
data class BluetoothDevice(
    val address: String,
    val name: String,
    val isPaired: Boolean = false
)

/**
 * Scan result from any scanner (hardware or Bluetooth)
 */
data class ScanResult(
    val data: String,
    val timestamp: Long = currentTimeMillis(),
    val source: ScanSource = ScanSource.UNKNOWN
)

enum class ScanSource {
    HARDWARE,       // Built-in ТСД scanner
    BLUETOOTH,      // External Bluetooth scanner
    CAMERA,         // Camera QR scanner
    UNKNOWN
}

/**
 * Cross-platform function to get current time in millis
 */
expect fun currentTimeMillis(): Long
