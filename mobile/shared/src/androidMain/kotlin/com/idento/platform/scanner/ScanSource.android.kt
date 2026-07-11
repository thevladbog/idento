package com.idento.platform.scanner

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.idento.platform.camera.CameraService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException
import java.io.InputStream
import java.util.UUID

private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

/**
 * Android [ScanSource]: merges the camera scan flow with a generic hardware-scanner broadcast
 * receiver and an auto-connecting BT SPP scanner (bonded devices only, no in-app discovery UI —
 * pairing happens via Android system Bluetooth settings). Per-manufacturer intent extraction
 * (Zebra DataWedge, Honeywell, etc — see the legacy mobile/android-app HardwareScannerService)
 * is intentionally NOT ported; only the manufacturer-agnostic broadcast fallback is.
 *
 * Fixes MOBILE-BUG-04: the ported legacy code called `kotlinx.coroutines.runBlocking { emit(...) }`
 * from inside `BroadcastReceiver.onReceive()`, which runs on the main thread — a slow collector
 * could deadlock/ANR the app during a scan. This implementation uses `tryEmit` (non-suspending)
 * on a buffered `MutableSharedFlow` instead; a dropped emit under buffer pressure is an acceptable
 * degradation (the operator rescans), unlike blocking the UI thread.
 */
class AndroidScanSource(
    private val cameraService: CameraService,
    private val context: Context,
) : ScanSource {

    private val _connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
    override val connectionState: StateFlow<ScannerConnectionState> = _connectionState.asStateFlow()

    private val _hardwareScanResults = MutableSharedFlow<String>(replay = 0, extraBufferCapacity = 8)

    private var broadcastReceiver: BroadcastReceiver? = null
    private var isReceiverRegistered = false
    private var preferCameraOverride = false

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var bluetoothSocket: BluetoothSocket? = null
    private var listenJob: Job? = null

    override fun startScanning(): Flow<String> {
        if (!preferCameraOverride) {
            registerHardwareReceiver()
            connectBondedBluetoothScanner()
        }
        return merge(cameraService.startScanning(), _hardwareScanResults)
    }

    override fun stopScanning() {
        preferCameraOverride = false
        cameraService.stopScanning()
        unregisterHardwareReceiver()
        disconnectBluetooth()
    }

    override fun preferCamera() {
        preferCameraOverride = true
        unregisterHardwareReceiver()
        disconnectBluetooth()
        _connectionState.value = ScannerConnectionState.Camera
    }

    // ── Generic broadcast hardware scanner (manufacturer-agnostic) ──────────────────────────────

    private fun registerHardwareReceiver() {
        if (isReceiverRegistered) return
        val filter = IntentFilter().apply {
            addAction("com.idento.SCAN")
            addAction("android.intent.action.BARCODE_SCAN")
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) {
                if (intent == null) return
                val data = extractGenericData(intent) ?: return
                // MOBILE-BUG-04 fix: tryEmit (non-suspending), not runBlocking { emit(...) } —
                // onReceive runs on the main thread; a suspending emit could deadlock/ANR.
                _hardwareScanResults.tryEmit(data)
                _connectionState.value = ScannerConnectionState.HardwareConnected("Scanner")
            }
        }
        broadcastReceiver = receiver
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        isReceiverRegistered = true
    }

    private fun unregisterHardwareReceiver() {
        val receiver = broadcastReceiver ?: return
        if (isReceiverRegistered) {
            try {
                context.unregisterReceiver(receiver)
            } catch (e: IllegalArgumentException) {
                // Already unregistered — ignore.
            }
            isReceiverRegistered = false
        }
        broadcastReceiver = null
    }

    private fun extractGenericData(intent: Intent): String? {
        val keys = listOf("data", "barcode", "scan", "code", "SCAN_BARCODE", "barcode_string", "Barcode")
        return keys.firstNotNullOfOrNull { key -> intent.getStringExtra(key) }
    }

    // ── BT SPP — auto-connect to an already-bonded device only, no discovery UI ─────────────────

    private fun hasBluetoothConnectPermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Manifest.permission.BLUETOOTH_CONNECT
        } else {
            Manifest.permission.BLUETOOTH
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission")
    private fun connectBondedBluetoothScanner() {
        // Re-entrancy guard (mirrors isReceiverRegistered above): without this, calling
        // startScanning() twice without an intervening stopScanning() would launch a second
        // connect coroutine, overwrite bluetoothSocket/listenJob, and orphan the first socket
        // plus its listenToBluetoothInput coroutine (permanently blocked on inputStream.read()).
        if (bluetoothSocket?.isConnected == true) return
        val adapter = bluetoothAdapter ?: return
        if (!adapter.isEnabled || !hasBluetoothConnectPermission()) return
        val device = adapter.bondedDevices?.firstOrNull() ?: return
        serviceScope.launch {
            try {
                val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                socket.connect()
                bluetoothSocket = socket
                _connectionState.value = ScannerConnectionState.HardwareConnected(device.name ?: "Scanner")
                listenToBluetoothInput(socket.inputStream)
            } catch (e: IOException) {
                _connectionState.value = ScannerConnectionState.HardwareDisconnected
            }
        }
    }

    private fun listenToBluetoothInput(inputStream: InputStream) {
        listenJob = serviceScope.launch {
            val buffer = ByteArray(1024)
            val builder = StringBuilder()
            try {
                while (isActive && bluetoothSocket?.isConnected == true) {
                    val bytes = inputStream.read(buffer)
                    if (bytes > 0) {
                        builder.append(String(buffer, 0, bytes))
                        val lines = builder.toString().split("\n", "\r")
                        for (i in 0 until lines.size - 1) {
                            val line = lines[i].trim()
                            if (line.isNotEmpty()) {
                                // Runs on Dispatchers.IO inside serviceScope, never on the main
                                // thread — a suspending emit here cannot deadlock the UI, unlike
                                // the broadcast receiver path above (which is why that path uses
                                // tryEmit and this one can safely use suspending emit).
                                _hardwareScanResults.emit(line)
                            }
                        }
                        builder.clear()
                        if (lines.isNotEmpty()) builder.append(lines.last())
                    }
                }
            } catch (e: IOException) {
                // inputStream.read() is a plain blocking Java call, not a suspend function, so
                // kotlinx.coroutines' cooperative cancellation cannot interrupt it or turn this
                // IOException into a CancellationException — closing the socket during an
                // intentional disconnect (disconnectBluetooth()/preferCamera()) always makes this
                // catch block run. What distinguishes "intentional disconnect" from "real hardware
                // error" is isActive: disconnectBluetooth() calls listenJob?.cancel() BEFORE
                // closing the socket, and Job cancellation flips isActive to false synchronously
                // at cancel()-time — independent of suspension points — so by the time the closed
                // socket causes read() to throw here, isActive already reflects the cancellation.
                // Only report a hardware disconnect when this coroutine was NOT the target of an
                // intentional cancel, so we don't clobber the Camera state that
                // disconnectBluetooth() sets right after closing the socket.
                if (isActive) {
                    _connectionState.value = ScannerConnectionState.HardwareDisconnected
                }
            }
        }
    }

    private fun disconnectBluetooth() {
        // Cancel BEFORE closing the socket so isActive is already false by the time the close()
        // below causes listenToBluetoothInput's blocked read() to throw — see the comment in that
        // catch block for why this ordering (not a manual "intentional disconnect" flag) is what
        // makes the isActive check correct.
        listenJob?.cancel()
        listenJob = null
        try {
            bluetoothSocket?.close()
        } catch (e: IOException) {
            // Ignore close errors.
        }
        bluetoothSocket = null
        if (_connectionState.value is ScannerConnectionState.HardwareConnected) {
            _connectionState.value = ScannerConnectionState.Camera
        }
    }
}
