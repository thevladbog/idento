package com.idento.data.scanner

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.InputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Bluetooth сканер штрих-кодов
 */
data class BluetoothScanner(
    val device: BluetoothDevice,
    val name: String,
    val address: String,
    val isPaired: Boolean = false
)

/**
 * Сервис для работы с внешними Bluetooth сканерами штрих-кодов
 * 
 * Поддерживает:
 * - Классические Bluetooth сканеры (SPP - Serial Port Profile)
 * - HID режим (эмуляция клавиатуры)
 * - Автоматическое переподключение
 */
@Singleton
class BluetoothScannerService @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager.adapter
    
    // SPP UUID для классических Bluetooth сканеров
    private val SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    
    // CoroutineScope для фоновых операций
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    private var currentSocket: BluetoothSocket? = null
    private var currentDevice: BluetoothDevice? = null
    private var isConnected = false
    
    private val _scanResults = MutableSharedFlow<ScanResult>(replay = 0)
    val scanResults: SharedFlow<ScanResult> = _scanResults.asSharedFlow()
    
    private val _discoveredScanners = MutableSharedFlow<List<BluetoothScanner>>(replay = 1)
    val discoveredScanners: SharedFlow<List<BluetoothScanner>> = _discoveredScanners.asSharedFlow()
    
    private val discoveredDevices = mutableListOf<BluetoothScanner>()
    
    private var discoveryReceiver: BroadcastReceiver? = null
    
    /**
     * Проверяет доступность Bluetooth
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
     * Получает список спаренных Bluetooth устройств (потенциальных сканеров)
     */
    @SuppressLint("MissingPermission")
    suspend fun getPairedScanners(): Result<List<BluetoothScanner>> {
        return withContext(Dispatchers.IO) {
            try {
                if (!hasBluetoothPermissions()) {
                    return@withContext Result.failure(SecurityException("Bluetooth permissions not granted"))
                }
                
                val pairedDevices = bluetoothAdapter?.bondedDevices ?: emptySet()
                val scanners = pairedDevices.map { device ->
                    BluetoothScanner(
                        device = device,
                        name = device.name ?: "Unknown Device",
                        address = device.address,
                        isPaired = true
                    )
                }
                
                Result.success(scanners)
            } catch (e: SecurityException) {
                Result.failure(e)
            } catch (e: Exception) {
                Result.failure(Exception("Failed to get paired devices: ${e.message}", e))
            }
        }
    }
    
    /**
     * Начинает поиск Bluetooth устройств
     */
    @SuppressLint("MissingPermission")
    fun startDiscovery(): Result<Unit> {
        return try {
            if (!hasBluetoothPermissions()) {
                return Result.failure(SecurityException("Bluetooth permissions not granted"))
            }
            
            if (!isBluetoothEnabled()) {
                return Result.failure(IllegalStateException("Bluetooth is not enabled"))
            }
            
            // Очищаем список найденных устройств
            discoveredDevices.clear()
            
            // Регистрируем receiver для обнаружения
            discoveryReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    when (intent?.action) {
                        BluetoothDevice.ACTION_FOUND -> {
                            val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                intent.getParcelableExtra(
                                    BluetoothDevice.EXTRA_DEVICE,
                                    BluetoothDevice::class.java
                                )
                            } else {
                                @Suppress("DEPRECATION")
                                intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                            }
                            
                            device?.let {
                                val scanner = BluetoothScanner(
                                    device = it,
                                    name = it.name ?: "Unknown Device",
                                    address = it.address,
                                    isPaired = it.bondState == BluetoothDevice.BOND_BONDED
                                )
                                
                                // Добавляем если еще нет в списке
                                if (discoveredDevices.none { s -> s.address == scanner.address }) {
                                    discoveredDevices.add(scanner)
                                    kotlinx.coroutines.runBlocking {
                                        _discoveredScanners.emit(discoveredDevices.toList())
                                    }
                                }
                            }
                        }
                        
                        BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                            stopDiscovery()
                        }
                    }
                }
            }
            
            val filter = IntentFilter().apply {
                addAction(BluetoothDevice.ACTION_FOUND)
                addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
            }
            
            context.registerReceiver(discoveryReceiver, filter)
            
            // Начинаем поиск
            bluetoothAdapter?.startDiscovery()
            
            Result.success(Unit)
        } catch (e: SecurityException) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(Exception("Failed to start discovery: ${e.message}", e))
        }
    }
    
    /**
     * Останавливает поиск устройств
     */
    @SuppressLint("MissingPermission")
    fun stopDiscovery() {
        try {
            bluetoothAdapter?.cancelDiscovery()
            
            discoveryReceiver?.let {
                try {
                    context.unregisterReceiver(it)
                } catch (e: Exception) {
                    // Already unregistered
                }
            }
            discoveryReceiver = null
        } catch (e: Exception) {
            // Ignore
        }
    }
    
    /**
     * Подключается к Bluetooth сканеру
     */
    @SuppressLint("MissingPermission")
    suspend fun connect(scanner: BluetoothScanner): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                if (!hasBluetoothPermissions()) {
                    return@withContext Result.failure(SecurityException("Bluetooth permissions not granted"))
                }
                
                // Отключаемся от текущего устройства
                disconnect()
                
                // Останавливаем discovery если идет
                bluetoothAdapter?.cancelDiscovery()
                
                // Создаем сокет
                val socket = scanner.device.createRfcommSocketToServiceRecord(SPP_UUID)
                
                // Подключаемся
                socket.connect()
                
                currentSocket = socket
                currentDevice = scanner.device
                isConnected = true
                
                // Начинаем слушать данные
                startListening(socket.inputStream)
                
                Result.success(Unit)
            } catch (e: SecurityException) {
                isConnected = false
                Result.failure(e)
            } catch (e: IOException) {
                isConnected = false
                Result.failure(Exception("Connection failed: ${e.message}", e))
            } catch (e: Exception) {
                isConnected = false
                Result.failure(Exception("Failed to connect: ${e.message}", e))
            }
        }
    }
    
    /**
     * Отключается от сканера
     */
    fun disconnect() {
        try {
            currentSocket?.close()
        } catch (e: Exception) {
            // Ignore
        } finally {
            currentSocket = null
            currentDevice = null
            isConnected = false
        }
    }
    
    /**
     * Проверяет подключен ли сканер
     */
    fun isConnected(): Boolean {
        return isConnected && currentSocket?.isConnected == true
    }
    
    /**
     * Получает информацию о подключенном сканере
     */
    @SuppressLint("MissingPermission")
    fun getConnectedScanner(): BluetoothScanner? {
        return currentDevice?.let { device ->
            BluetoothScanner(
                device = device,
                name = device.name ?: "Unknown Device",
                address = device.address,
                isPaired = device.bondState == BluetoothDevice.BOND_BONDED
            )
        }
    }
    
    /**
     * Начинает прослушивание данных от сканера
     */
    private fun startListening(inputStream: InputStream) {
        serviceScope.launch {
            val buffer = ByteArray(1024)
            val stringBuilder = StringBuilder()
            
            try {
                while (isConnected) {
                    val bytes = inputStream.read(buffer)
                    if (bytes > 0) {
                        val data = String(buffer, 0, bytes)
                        stringBuilder.append(data)
                        
                        // Проверяем на наличие разделителей (Enter, newline)
                        val lines = stringBuilder.toString().split("\n", "\r")
                        
                        // Обрабатываем все завершенные строки
                        for (i in 0 until lines.size - 1) {
                            val line = lines[i].trim()
                            if (line.isNotEmpty()) {
                                // Эмитим результат сканирования
                                _scanResults.emit(
                                    ScanResult(
                                        data = line,
                                        type = "BARCODE", // Generic barcode
                                        manufacturer = ScannerManufacturer.GENERIC
                                    )
                                )
                            }
                        }
                        
                        // Оставляем последнюю незавершенную строку в буфере
                        stringBuilder.clear()
                        if (lines.isNotEmpty()) {
                            stringBuilder.append(lines.last())
                        }
                    }
                }
            } catch (e: IOException) {
                // Connection lost
                isConnected = false
            } catch (e: Exception) {
                // Error reading
                isConnected = false
            }
        }
    }
    
    /**
     * Очищает ресурсы
     */
    fun cleanup() {
        stopDiscovery()
        disconnect()
    }
}
