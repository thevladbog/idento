package com.idento.platform.camera

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import platform.AVFoundation.AVCaptureConnection
import platform.AVFoundation.AVCaptureDevice
import platform.AVFoundation.AVCaptureDeviceInput
import platform.AVFoundation.AVCaptureMetadataOutput
import platform.AVFoundation.AVCaptureMetadataOutputObjectsDelegateProtocol
import platform.AVFoundation.AVCaptureSession
import platform.AVFoundation.AVCaptureSessionPresetHigh
import platform.AVFoundation.AVAuthorizationStatusAuthorized
import platform.AVFoundation.AVMediaTypeVideo
import platform.AVFoundation.AVMetadataMachineReadableCodeObject
import platform.AVFoundation.AVMetadataObjectTypeCode128Code
import platform.AVFoundation.AVMetadataObjectTypeCode39Code
import platform.AVFoundation.AVMetadataObjectTypeQRCode
import platform.AVFoundation.authorizationStatusForMediaType
import platform.AVFoundation.requestAccessForMediaType
import platform.darwin.NSObject
import platform.darwin.dispatch_get_main_queue

/**
 * iOS Camera Service — AVCaptureSession + AVCaptureMetadataOutput (QR + linear barcodes).
 */
@OptIn(ExperimentalForeignApi::class)
actual class CameraService {

    private val _scanResults = MutableSharedFlow<String>(replay = 0)
    private var captureSession: AVCaptureSession? = null
    private var isCurrentlyScanning = false

    private val metadataDelegate = object : NSObject(), AVCaptureMetadataOutputObjectsDelegateProtocol {
        override fun captureOutput(
            output: platform.AVFoundation.AVCaptureOutput,
            didOutputMetadataObjects: List<*>,
            fromConnection: AVCaptureConnection,
        ) {
            val code = didOutputMetadataObjects
                .filterIsInstance<AVMetadataMachineReadableCodeObject>()
                .firstOrNull()
                ?.stringValue
            if (code != null) {
                _scanResults.tryEmit(code)
            }
        }
    }

    actual fun isCameraAvailable(): Boolean {
        return AVCaptureDevice.defaultDeviceWithMediaType(AVMediaTypeVideo) != null
    }

    actual fun hasCameraPermission(): Boolean {
        return AVCaptureDevice.authorizationStatusForMediaType(AVMediaTypeVideo) == AVAuthorizationStatusAuthorized
    }

    actual fun startScanning(): Flow<String> {
        if (!isCurrentlyScanning && hasCameraPermission()) {
            isCurrentlyScanning = true
            val device = AVCaptureDevice.defaultDeviceWithMediaType(AVMediaTypeVideo)
            if (device != null) {
                val session = AVCaptureSession()
                session.sessionPreset = AVCaptureSessionPresetHigh

                val input = AVCaptureDeviceInput.deviceInputWithDevice(device, null)
                if (input != null && session.canAddInput(input)) {
                    session.addInput(input)
                }

                val output = AVCaptureMetadataOutput()
                if (session.canAddOutput(output)) {
                    session.addOutput(output)
                    output.setMetadataObjectsDelegate(metadataDelegate, dispatch_get_main_queue())
                    output.metadataObjectTypes = listOf(
                        AVMetadataObjectTypeQRCode,
                        AVMetadataObjectTypeCode128Code,
                        AVMetadataObjectTypeCode39Code,
                    )
                }

                captureSession = session
                session.startRunning()
            }
        }
        return _scanResults.asSharedFlow()
    }

    actual fun stopScanning() {
        captureSession?.stopRunning()
        captureSession = null
        isCurrentlyScanning = false
    }

    actual fun isScanning(): Boolean = isCurrentlyScanning

    /** Request camera permission (platform-only helper, not part of the `expect` contract). */
    suspend fun requestCameraPermission(): Boolean {
        return kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
            AVCaptureDevice.requestAccessForMediaType(AVMediaTypeVideo) { granted ->
                continuation.resume(granted) {}
            }
        }
    }
}
