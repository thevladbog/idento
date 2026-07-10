package com.idento.platform.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.concurrent.Executors

/**
 * Android Camera Service — CameraX (preview-less analysis pipeline) + ML Kit barcode scanning.
 * Binds to the process-level lifecycle (ProcessLifecycleOwner) rather than a specific Activity,
 * since this service is a long-lived Koin singleton constructed before any screen exists —
 * appropriate for a kiosk/registration-station app where the camera runs whenever the app is
 * foregrounded.
 */
actual class CameraService(private val context: Context) {

    private val _scanResults = MutableSharedFlow<String>(replay = 0)
    private var isCurrentlyScanning = false
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private val barcodeScanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39)
            .build()
    )
    private var cameraProvider: ProcessCameraProvider? = null

    actual fun isCameraAvailable(): Boolean {
        return context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }

    actual fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }

    actual fun startScanning(): Flow<String> {
        if (!isCurrentlyScanning && hasCameraPermission()) {
            isCurrentlyScanning = true
            val providerFuture = ProcessCameraProvider.getInstance(context)
            providerFuture.addListener({
                val provider = providerFuture.get()
                if (!isCurrentlyScanning) {
                    // stopScanning() ran while the provider future was still resolving —
                    // don't bind a camera the caller already asked to stop.
                    return@addListener
                }
                cameraProvider = provider

                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { it.setAnalyzer(analysisExecutor, ::analyzeFrame) }

                provider.unbindAll()
                provider.bindToLifecycle(
                    ProcessLifecycleOwner.get(),
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    analysis,
                )
            }, ContextCompat.getMainExecutor(context))
        }
        return _scanResults.asSharedFlow()
    }

    actual fun stopScanning() {
        isCurrentlyScanning = false
        cameraProvider?.unbindAll()
        cameraProvider = null
    }

    actual fun isScanning(): Boolean = isCurrentlyScanning

    @androidx.camera.core.ExperimentalGetImage
    private fun analyzeFrame(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        barcodeScanner.process(inputImage)
            .addOnSuccessListener { barcodes ->
                val value = barcodes.firstOrNull()?.rawValue
                if (value != null) {
                    _scanResults.tryEmit(value)
                }
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }
}
