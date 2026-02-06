package com.idento.platform.camera

import kotlinx.coroutines.flow.Flow

/**
 * Cross-platform Camera/QR Scanner Service
 */
expect class CameraService {
    /**
     * Check if camera is available
     */
    fun isCameraAvailable(): Boolean
    
    /**
     * Check if app has camera permissions
     */
    fun hasCameraPermission(): Boolean
    
    /**
     * Start QR code scanning
     * Returns flow of scanned codes
     */
    fun startScanning(): Flow<String>
    
    /**
     * Stop scanning
     */
    fun stopScanning()
    
    /**
     * Check if currently scanning
     */
    fun isScanning(): Boolean
}

/**
 * Camera service result
 */
sealed class CameraResult {
    data class Success(val code: String) : CameraResult()
    data class Error(val message: String) : CameraResult()
    data object PermissionDenied : CameraResult()
}
