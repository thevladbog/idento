package com.idento.platform.printer

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

/**
 * Android Bluetooth Printer Service Implementation
 */
actual class BluetoothPrinterService(private val context: Context) {
    
    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private var bluetoothSocket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null
    
    private val SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    
    actual fun isBluetoothEnabled(): Boolean {
        return bluetoothAdapter?.isEnabled == true
    }
    
    actual fun hasBluetoothPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED
        }
    }
    
    actual suspend fun getPairedPrinters(): Result<List<BluetoothPrinterDevice>> = withContext(Dispatchers.IO) {
        runCatching {
            if (!hasBluetoothPermissions()) {
                throw SecurityException("Bluetooth permission not granted")
            }
            
            val pairedDevices = bluetoothAdapter?.bondedDevices ?: emptySet()
            pairedDevices.map { device ->
                BluetoothPrinterDevice(
                    address = device.address,
                    name = device.name ?: "Unknown",
                    isPaired = true
                )
            }
        }
    }
    
    actual suspend fun connect(address: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            if (!hasBluetoothPermissions()) {
                throw SecurityException("Bluetooth permission not granted")
            }
            
            disconnect()
            
            val device = bluetoothAdapter?.getRemoteDevice(address)
                ?: throw Exception("Bluetooth device not found")
            
            bluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            bluetoothSocket?.connect()
            outputStream = bluetoothSocket?.outputStream
        }
    }
    
    actual suspend fun disconnect() {
        withContext(Dispatchers.IO) {
            try {
                outputStream?.close()
                bluetoothSocket?.close()
            } catch (e: Exception) {
                // Ignore close errors
            } finally {
                outputStream = null
                bluetoothSocket = null
            }
        }
    }
    
    actual fun isConnected(): Boolean {
        return bluetoothSocket?.isConnected == true
    }
    
    actual suspend fun print(zpl: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val stream = outputStream ?: throw Exception("Not connected to printer")
            stream.write(zpl.toByteArray())
            stream.flush()
        }
    }
    
    actual suspend fun printWithAutoConnect(address: String, zpl: String): Result<Unit> {
        return connect(address).mapCatching {
            print(zpl).getOrThrow()
        }
    }
    
    actual suspend fun printTest(address: String): Result<Unit> {
        val testZPL = """
            ^XA
            ^FO50,50^A0N,50,50^FDTest Print^FS
            ^FO50,120^A0N,30,30^FDIdento System^FS
            ^XZ
        """.trimIndent()
        
        return printWithAutoConnect(address, testZPL)
    }
}

/**
 * Android Ethernet Printer Service Implementation
 */
actual class EthernetPrinterService {
    
    private var socket: Socket? = null
    private var outputStream: OutputStream? = null
    
    actual suspend fun isPrinterAvailable(ip: String, port: Int): Result<Boolean> = withContext(Dispatchers.IO) {
        runCatching {
            val testSocket = Socket()
            testSocket.connect(InetSocketAddress(ip, port), 5000)
            val available = testSocket.isConnected
            testSocket.close()
            available
        }
    }
    
    actual suspend fun connect(ip: String, port: Int): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            disconnect()
            
            socket = Socket()
            socket?.connect(InetSocketAddress(ip, port), 5000)
            outputStream = socket?.getOutputStream()
        }
    }
    
    actual suspend fun disconnect() {
        withContext(Dispatchers.IO) {
            try {
                outputStream?.close()
                socket?.close()
            } catch (e: Exception) {
                // Ignore close errors
            } finally {
                outputStream = null
                socket = null
            }
        }
    }
    
    actual fun isConnected(): Boolean {
        return socket?.isConnected == true
    }
    
    actual suspend fun print(zpl: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val stream = outputStream ?: throw Exception("Not connected to printer")
            stream.write(zpl.toByteArray())
            stream.flush()
        }
    }
    
    actual suspend fun printWithAutoConnect(ip: String, port: Int, zpl: String): Result<Unit> {
        return connect(ip, port).mapCatching {
            print(zpl).getOrThrow()
        }
    }
    
    actual suspend fun printTest(ip: String, port: Int): Result<Unit> {
        val testZPL = """
            ^XA
            ^FO50,50^A0N,50,50^FDTest Print^FS
            ^FO50,120^A0N,30,30^FDEthernet Printer^FS
            ^XZ
        """.trimIndent()
        
        return printWithAutoConnect(ip, port, testZPL)
    }
}
