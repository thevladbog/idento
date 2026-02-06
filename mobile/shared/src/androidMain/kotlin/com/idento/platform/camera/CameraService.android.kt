package com.idento.platform.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Android Camera Service Implementation
 * Uses CameraX for QR code scanning
 */
actual class CameraService(private val context: Context) {
    
    private val _scanResults = MutableSharedFlow<String>(replay = 0)
    private var isCurrentlyScanning = false
    
    actual fun isCameraAvailable(): Boolean {
        return context.packageManager.hasSystemFeature(
            android.content.pm.PackageManager.FEATURE_CAMERA_ANY
        )
    }
    
    actual fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }
    
    actual fun startScanning(): Flow<String> {
        isCurrentlyScanning = true
        // TODO: Initialize CameraX and ML Kit barcode scanning
        // For now, return the flow
        return _scanResults.asSharedFlow()
    }
    
    actual fun stopScanning() {
        isCurrentlyScanning = false
        // TODO: Stop CameraX
    }
    
    actual fun isScanning(): Boolean {
        return isCurrentlyScanning
    }
    
    /**
     * Internal method to emit scan results
     * Called by CameraX analyzer
     */
    suspend fun onCodeScanned(code: String) {
        _scanResults.emit(code)
    }
}
