package com.idento.platform.scanner

import com.idento.platform.camera.CameraService
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * iOS [ScanSource]: camera-only. BT-SPP hardware scanning is explicitly out of v1 scope for iOS
 * (design spec: "BT-SPP печать/сканер на iOS — только Android").
 */
class IosScanSource(private val cameraService: CameraService) : ScanSource {

    private val _connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
    override val connectionState: StateFlow<ScannerConnectionState> = _connectionState.asStateFlow()

    override fun startScanning(): Flow<String> = cameraService.startScanning()
    override fun stopScanning() = cameraService.stopScanning()
    override fun preferCamera() { /* no-op: iOS is already camera-only */ }
    override fun setExcludedBluetoothAddress(address: String?) { /* no-op: iOS has no BT scanning */ }
}
