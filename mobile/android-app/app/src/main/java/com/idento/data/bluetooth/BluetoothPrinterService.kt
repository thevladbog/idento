package com.idento.data.bluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class BluetoothPrinter(
    val name: String,
    val address: String,
    val isPaired: Boolean
)

@Singleton
class BluetoothPrinterService @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val bluetoothManager: BluetoothManager? = 
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    
    // Standard Serial Port Profile UUID for Bluetooth printers
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    
    private var currentSocket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null
    
    /**
     * Проверяет доступность Bluetooth на устройстве
     */
    fun isBluetoothAvailable(): Boolean {
        return bluetoothAdapter != null
    }
    
    /**
     * Проверяет включен ли Bluetooth
     */
    @SuppressLint("MissingPermission")
    fun isBluetoothEnabled(): Boolean {
        return bluetoothAdapter?.isEnabled == true
    }
    
    /**
     * Проверяет наличие необходимых разрешений
     */
    fun hasBluetoothPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_SCAN
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_ADMIN
            ) == PackageManager.PERMISSION_GRANTED
        }
    }
    
    /**
     * Получает список сопряженных Bluetooth устройств
     */
    @SuppressLint("MissingPermission")
    suspend fun getPairedPrinters(): Result<List<BluetoothPrinter>> = withContext(Dispatchers.IO) {
        try {
            if (!isBluetoothAvailable()) {
                return@withContext Result.failure(Exception("Bluetooth not available"))
            }
            
            if (!hasBluetoothPermissions()) {
                return@withContext Result.failure(Exception("Bluetooth permissions not granted"))
            }
            
            val pairedDevices = bluetoothAdapter?.bondedDevices ?: emptySet()
            
            val printers = pairedDevices
                .filter { device ->
                    // Фильтруем только принтеры (обычно содержат "Printer" или "Zebra" в имени)
                    val name = device.name?.uppercase() ?: ""
                    name.contains("PRINTER") || 
                    name.contains("ZEBRA") || 
                    name.contains("ZPL") ||
                    name.contains("STAR") ||
                    name.contains("EPSON") ||
                    // Или показываем все устройства для тестирования
                    true
                }
                .map { device ->
                    BluetoothPrinter(
                        name = device.name ?: "Unknown Device",
                        address = device.address,
                        isPaired = true
                    )
                }
            
            Result.success(printers)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Подключается к принтеру по MAC адресу
     */
    @SuppressLint("MissingPermission")
    suspend fun connectToPrinter(address: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            if (!hasBluetoothPermissions()) {
                return@withContext Result.failure(Exception("Bluetooth permissions not granted"))
            }
            
            // Закрываем предыдущее соединение если есть
            disconnect()
            
            val device: BluetoothDevice = bluetoothAdapter?.getRemoteDevice(address)
                ?: return@withContext Result.failure(Exception("Device not found"))
            
            // Создаем сокет
            currentSocket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            
            // Подключаемся
            currentSocket?.connect()
            
            // Получаем поток вывода
            outputStream = currentSocket?.outputStream
            
            Result.success(Unit)
        } catch (e: IOException) {
            disconnect()
            Result.failure(Exception("Connection failed: ${e.message}"))
        } catch (e: Exception) {
            disconnect()
            Result.failure(e)
        }
    }
    
    /**
     * Отключается от принтера
     */
    fun disconnect() {
        try {
            outputStream?.close()
            currentSocket?.close()
        } catch (e: IOException) {
            // Игнорируем ошибки при закрытии
        } finally {
            outputStream = null
            currentSocket = null
        }
    }
    
    /**
     * Проверяет подключен ли принтер
     */
    fun isConnected(): Boolean {
        return currentSocket?.isConnected == true
    }
    
    /**
     * Печатает данные на принтере
     * @param data ZPL команды в виде строки
     */
    suspend fun print(data: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            if (!isConnected()) {
                return@withContext Result.failure(Exception("Printer not connected"))
            }
            
            val output = outputStream 
                ?: return@withContext Result.failure(Exception("Output stream not available"))
            
            // Отправляем данные на принтер
            output.write(data.toByteArray(Charsets.UTF_8))
            output.flush()
            
            Result.success(Unit)
        } catch (e: IOException) {
            Result.failure(Exception("Print failed: ${e.message}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Печатает с автоматическим подключением
     */
    suspend fun printWithAutoConnect(address: String, data: String): Result<Unit> {
        return connectToPrinter(address)
            .fold(
                onSuccess = {
                    print(data).also {
                        // Отключаемся после печати
                        disconnect()
                    }
                },
                onFailure = { error ->
                    Result.failure(error)
                }
            )
    }
    
    /**
     * Отправляет тестовую печать
     */
    suspend fun printTest(address: String): Result<Unit> {
        val testZpl = """
            ^XA
            ^FO50,50^ADN,36,20^FDTest Print^FS
            ^FO50,100^ADN,36,20^FD${System.currentTimeMillis()}^FS
            ^XZ
        """.trimIndent()
        
        return printWithAutoConnect(address, testZpl)
    }
}
