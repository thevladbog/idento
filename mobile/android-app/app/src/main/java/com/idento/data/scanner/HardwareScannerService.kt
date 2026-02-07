package com.idento.data.scanner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Модели и производители поддерживаемых ТСД
 */
enum class ScannerManufacturer {
    ZEBRA,      // TC21, TC52, TC72, MC3300 (DataWedge)
    HONEYWELL,  // CT40, CT60, EDA50K, EDA52
    DATALOGIC,  // Memor, Skorpio, Joya Touch (Intent Wedge)
    CHAINWAY,   // C61, C66, C72
    UROVO,      // DT40, DT50, i6300
    NEWLAND,    // NLS-MT65, NLS-MT90
    POINT_MOBILE, // PM80, PM90
    BLUEBIRD,   // EF500, EF550
    GENERIC,    // Общий Intent-based подход
    UNKNOWN
}

/**
 * Результат сканирования
 */
data class ScanResult(
    val data: String,
    val type: String? = null, // Тип штрих-кода (EAN13, CODE128, QR_CODE и т.д.)
    val manufacturer: ScannerManufacturer = ScannerManufacturer.UNKNOWN
)

/**
 * Универсальный сервис для работы с встроенными сканерами ТСД
 * 
 * Поддерживает:
 * - Zebra (Symbol) - DataWedge Intent API
 * - Honeywell - Data Intent API
 * - Datalogic - Intent Wedge
 * - Chainway, Urovo, Newland, Point Mobile, Bluebird
 * - Generic Intent-based сканеры
 */
@Singleton
class HardwareScannerService @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val _scanResults = MutableSharedFlow<ScanResult>(replay = 0)
    val scanResults: SharedFlow<ScanResult> = _scanResults.asSharedFlow()
    
    private var scannerReceiver: BroadcastReceiver? = null
    private var isReceiverRegistered = false
    
    // Определяем производителя устройства
    private val detectedManufacturer: ScannerManufacturer by lazy {
        detectManufacturer()
    }
    
    /**
     * Определяет производителя устройства по Build информации
     */
    private fun detectManufacturer(): ScannerManufacturer {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val model = Build.MODEL.lowercase()
        val brand = Build.BRAND.lowercase()
        
        return when {
            manufacturer.contains("zebra") || manufacturer.contains("symbol") || 
            brand.contains("zebra") -> ScannerManufacturer.ZEBRA
            
            manufacturer.contains("honeywell") || manufacturer.contains("intermec") ||
            brand.contains("honeywell") -> ScannerManufacturer.HONEYWELL
            
            manufacturer.contains("datalogic") || brand.contains("datalogic") -> 
                ScannerManufacturer.DATALOGIC
            
            manufacturer.contains("chainway") || brand.contains("chainway") -> 
                ScannerManufacturer.CHAINWAY
            
            manufacturer.contains("urovo") || brand.contains("urovo") -> 
                ScannerManufacturer.UROVO
            
            manufacturer.contains("newland") || brand.contains("newland") ||
            model.contains("nls-") -> ScannerManufacturer.NEWLAND
            
            manufacturer.contains("pointmobile") || brand.contains("pointmobile") -> 
                ScannerManufacturer.POINT_MOBILE
            
            manufacturer.contains("bluebird") || brand.contains("bluebird") -> 
                ScannerManufacturer.BLUEBIRD
            
            // Проверяем наличие специфичных для ТСД характеристик
            hasDataCollectionFeatures() -> ScannerManufacturer.GENERIC
            
            else -> ScannerManufacturer.UNKNOWN
        }
    }
    
    /**
     * Проверяет наличие характеристик терминала сбора данных
     */
    private fun hasDataCollectionFeatures(): Boolean {
        // Проверяем наличие пакетов, типичных для ТСД
        val packageManager = context.packageManager
        val possiblePackages = listOf(
            "com.symbol.datawedge",
            "com.honeywell.decode",
            "com.datalogic.decode",
            "com.android.scanner",
            "com.scanner.service"
        )
        
        return possiblePackages.any { pkg ->
            try {
                packageManager.getPackageInfo(pkg, 0)
                true
            } catch (e: Exception) {
                false
            }
        }
    }
    
    /**
     * Регистрирует BroadcastReceiver для получения данных сканирования
     */
    fun registerReceiver() {
        if (isReceiverRegistered) {
            return
        }
        
        val intentFilter = IntentFilter().apply {
            // Добавляем Actions для всех поддерживаемых производителей
            when (detectedManufacturer) {
                ScannerManufacturer.ZEBRA -> {
                    // DataWedge default action (можно настроить в DataWedge профиле)
                    addAction("com.idento.SCAN")
                    addAction("com.symbol.datawedge.api.RESULT_ACTION")
                }
                ScannerManufacturer.HONEYWELL -> {
                    addAction("com.idento.SCAN")
                    addAction("com.honeywell.decode.intent.action.SCAN")
                }
                ScannerManufacturer.DATALOGIC -> {
                    addAction("com.idento.SCAN")
                    addAction("com.datalogic.decode.intent.action.SCAN")
                }
                ScannerManufacturer.NEWLAND -> {
                    addAction("nlscan.action.SCANNER_RESULT")
                }
                ScannerManufacturer.CHAINWAY -> {
                    addAction("com.scanner.broadcast")
                }
                ScannerManufacturer.UROVO -> {
                    addAction("android.intent.ACTION_DECODE_DATA")
                }
                ScannerManufacturer.POINT_MOBILE -> {
                    addAction("kr.co.pointmobile.ACTION_BARCODE")
                }
                ScannerManufacturer.BLUEBIRD -> {
                    addAction("kr.co.bluebird.action.BARCODE_CALLBACK_DECODING_DATA")
                }
                else -> {
                    // Generic fallback
                    addAction("com.idento.SCAN")
                    addAction("android.intent.action.BARCODE_SCAN")
                }
            }
        }
        
        scannerReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent != null) {
                    handleScanIntent(intent)
                }
            }
        }
        
        // Используем ContextCompat для совместимости с Android U (14+)
        ContextCompat.registerReceiver(
            context,
            scannerReceiver,
            intentFilter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        
        isReceiverRegistered = true
    }
    
    /**
     * Отменяет регистрацию BroadcastReceiver
     */
    fun unregisterReceiver() {
        if (isReceiverRegistered && scannerReceiver != null) {
            try {
                context.unregisterReceiver(scannerReceiver)
            } catch (e: Exception) {
                // Ignore if already unregistered
            }
            isReceiverRegistered = false
        }
    }
    
    /**
     * Обрабатывает Intent с данными сканирования
     */
    private fun handleScanIntent(intent: Intent) {
        val scanResult = when (detectedManufacturer) {
            ScannerManufacturer.ZEBRA -> extractZebraData(intent)
            ScannerManufacturer.HONEYWELL -> extractHoneywellData(intent)
            ScannerManufacturer.DATALOGIC -> extractDatalogicData(intent)
            ScannerManufacturer.NEWLAND -> extractNewlandData(intent)
            ScannerManufacturer.CHAINWAY -> extractChainwayData(intent)
            ScannerManufacturer.UROVO -> extractUrovoData(intent)
            ScannerManufacturer.POINT_MOBILE -> extractPointMobileData(intent)
            ScannerManufacturer.BLUEBIRD -> extractBluebirdData(intent)
            else -> extractGenericData(intent)
        }
        
        scanResult?.let {
            kotlinx.coroutines.runBlocking {
                _scanResults.emit(it)
            }
        }
    }
    
    // Извлечение данных для Zebra (DataWedge)
    private fun extractZebraData(intent: Intent): ScanResult? {
        val data = intent.getStringExtra("com.symbol.datawedge.data_string") 
            ?: intent.getStringExtra("SCAN_BARCODE")
            ?: return null
        val type = intent.getStringExtra("com.symbol.datawedge.label_type")
        return ScanResult(data, type, ScannerManufacturer.ZEBRA)
    }
    
    // Извлечение данных для Honeywell
    private fun extractHoneywellData(intent: Intent): ScanResult? {
        val data = intent.getStringExtra("data") 
            ?: intent.getStringExtra("Scan_data")
            ?: return null
        val type = intent.getStringExtra("codeId")
        return ScanResult(data, type, ScannerManufacturer.HONEYWELL)
    }
    
    // Извлечение данных для Datalogic
    private fun extractDatalogicData(intent: Intent): ScanResult? {
        val data = intent.getStringExtra("com.datalogic.decode.intentwedge.barcode_string")
            ?: intent.getStringExtra("data")
            ?: return null
        val type = intent.getStringExtra("com.datalogic.decode.intentwedge.label_type")
        return ScanResult(data, type, ScannerManufacturer.DATALOGIC)
    }
    
    // Извлечение данных для Newland
    private fun extractNewlandData(intent: Intent): ScanResult? {
        val data = intent.getStringExtra("SCAN_BARCODE1") 
            ?: intent.getStringExtra("barcode")
            ?: return null
        val type = intent.getStringExtra("SCAN_BARCODE_TYPE")
        return ScanResult(data, type, ScannerManufacturer.NEWLAND)
    }
    
    // Извлечение данных для Chainway
    private fun extractChainwayData(intent: Intent): ScanResult? {
        val data = intent.getStringExtra("data") 
            ?: intent.getStringExtra("barcode")
            ?: return null
        val type = intent.getStringExtra("type")
        return ScanResult(data, type, ScannerManufacturer.CHAINWAY)
    }
    
    // Извлечение данных для Urovo
    private fun extractUrovoData(intent: Intent): ScanResult? {
        val data = intent.getStringExtra("barcode_string")
            ?: intent.getStringExtra("barcodeStr")
            ?: return null
        val type = intent.getStringExtra("barcodeType")
        return ScanResult(data, type, ScannerManufacturer.UROVO)
    }
    
    // Извлечение данных для Point Mobile
    private fun extractPointMobileData(intent: Intent): ScanResult? {
        val data = intent.getStringExtra("Barcode")
            ?: intent.getStringExtra("data")
            ?: return null
        val type = intent.getStringExtra("BarcodeType")
        return ScanResult(data, type, ScannerManufacturer.POINT_MOBILE)
    }
    
    // Извлечение данных для Bluebird
    private fun extractBluebirdData(intent: Intent): ScanResult? {
        val data = intent.getStringExtra("EXTRA_BARCODE_DECODING_DATA")
            ?: intent.getStringExtra("data")
            ?: return null
        val type = intent.getStringExtra("EXTRA_BARCODE_DECODING_TYPE")
        return ScanResult(data, type, ScannerManufacturer.BLUEBIRD)
    }
    
    // Извлечение данных для Generic/Unknown сканеров
    private fun extractGenericData(intent: Intent): ScanResult? {
        // Пробуем общие имена для extras
        val possibleKeys = listOf(
            "data", "barcode", "scan", "code", 
            "SCAN_BARCODE", "barcode_string", "Barcode"
        )
        
        val data = possibleKeys.firstNotNullOfOrNull { key ->
            intent.getStringExtra(key)
        } ?: return null
        
        val type = intent.getStringExtra("type") 
            ?: intent.getStringExtra("barcode_type")
        
        return ScanResult(data, type, ScannerManufacturer.GENERIC)
    }
    
    /**
     * Программное управление сканером (триггер)
     */
    fun triggerScan() {
        val intent = when (detectedManufacturer) {
            ScannerManufacturer.ZEBRA -> {
                Intent("com.symbol.datawedge.api.ACTION_SOFTSCANTRIGGER").apply {
                    putExtra("com.symbol.datawedge.api.EXTRA_PARAMETER", "START_SCANNING")
                }
            }
            ScannerManufacturer.HONEYWELL -> {
                Intent("com.honeywell.aidc.action.ACTION_CONTROL_SCANNER").apply {
                    putExtra("com.honeywell.aidc.extra.EXTRA_SCAN", true)
                }
            }
            ScannerManufacturer.DATALOGIC -> {
                Intent("com.datalogic.decode.intent.action.START_DECODE")
            }
            ScannerManufacturer.NEWLAND -> {
                Intent("nlscan.action.SCANNER_TRIG").apply {
                    putExtra("SCAN_TIMEOUT", 5)
                }
            }
            ScannerManufacturer.CHAINWAY -> {
                Intent("ACTION_BAR_SCANCMD").apply {
                    putExtra("EXTRA_SCAN_MODE", 0) // 0 = trigger once
                }
            }
            ScannerManufacturer.UROVO -> {
                Intent("android.intent.action.SCANNER_ON")
            }
            else -> {
                // Generic trigger attempt
                Intent("android.intent.action.START_SCAN")
            }
        }
        
        context.sendBroadcast(intent)
    }
    
    /**
     * Остановка сканирования
     */
    fun stopScan() {
        val intent = when (detectedManufacturer) {
            ScannerManufacturer.ZEBRA -> {
                Intent("com.symbol.datawedge.api.ACTION_SOFTSCANTRIGGER").apply {
                    putExtra("com.symbol.datawedge.api.EXTRA_PARAMETER", "STOP_SCANNING")
                }
            }
            ScannerManufacturer.HONEYWELL -> {
                Intent("com.honeywell.aidc.action.ACTION_CONTROL_SCANNER").apply {
                    putExtra("com.honeywell.aidc.extra.EXTRA_SCAN", false)
                }
            }
            ScannerManufacturer.DATALOGIC -> {
                Intent("com.datalogic.decode.intent.action.STOP_DECODE")
            }
            ScannerManufacturer.UROVO -> {
                Intent("android.intent.action.SCANNER_OFF")
            }
            else -> null
        }
        
        intent?.let { context.sendBroadcast(it) }
    }
    
    /**
     * Проверяет, является ли устройство терминалом сбора данных
     */
    fun isDataCollectionTerminal(): Boolean {
        return detectedManufacturer != ScannerManufacturer.UNKNOWN
    }
    
    /**
     * Возвращает информацию о терминале
     */
    fun getDeviceInfo(): String {
        return """
            Manufacturer: ${Build.MANUFACTURER}
            Model: ${Build.MODEL}
            Brand: ${Build.BRAND}
            Detected Scanner: $detectedManufacturer
        """.trimIndent()
    }
    
    /**
     * Получает название производителя сканера
     */
    fun getScannerManufacturerName(): String {
        return when (detectedManufacturer) {
            ScannerManufacturer.ZEBRA -> "Zebra (Symbol)"
            ScannerManufacturer.HONEYWELL -> "Honeywell"
            ScannerManufacturer.DATALOGIC -> "Datalogic"
            ScannerManufacturer.CHAINWAY -> "Chainway"
            ScannerManufacturer.UROVO -> "Urovo"
            ScannerManufacturer.NEWLAND -> "Newland"
            ScannerManufacturer.POINT_MOBILE -> "Point Mobile"
            ScannerManufacturer.BLUEBIRD -> "Bluebird"
            ScannerManufacturer.GENERIC -> "Generic Scanner"
            ScannerManufacturer.UNKNOWN -> "Unknown"
        }
    }
}
