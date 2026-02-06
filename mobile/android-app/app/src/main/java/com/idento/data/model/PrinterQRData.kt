package com.idento.data.model

import kotlinx.serialization.Serializable

/**
 * Модель данных для QR-кода принтера
 * 
 * Формат QR:
 * {
 *   "type": "idento_printer",
 *   "version": "1.0",
 *   "printer_type": "bluetooth|ethernet",
 *   "name": "Zebra ZD410 Office",
 *   "address": "AA:BB:CC:DD:EE:FF",  // для Bluetooth
 *   "ip": "192.168.1.100",           // для Ethernet
 *   "port": 9100,                     // для Ethernet
 *   "model": "ZD410",                 // опционально
 *   "location": "Office Floor 2",     // опционально
 *   "settings": { ... }               // опционально
 * }
 */
@Serializable
data class PrinterQRData(
    val type: String,                    // Должен быть "idento_printer"
    val version: String,                 // Версия формата (например "1.0")
    val printer_type: String,            // "bluetooth" или "ethernet"
    val name: String,                    // Название принтера
    
    // Bluetooth специфичные
    val address: String? = null,         // MAC адрес (AA:BB:CC:DD:EE:FF)
    
    // Ethernet специфичные
    val ip: String? = null,              // IP адрес (192.168.1.100)
    val port: Int? = null,               // Порт (обычно 9100)
    
    // Опциональные поля
    val model: String? = null,           // Модель принтера (ZD410, ZD620, и т.д.)
    val location: String? = null,        // Местоположение (Reception, Office, и т.д.)
    val settings: PrinterSettings? = null // Расширенные настройки
) {
    companion object {
        const val TYPE_IDENTIFIER = "idento_printer"
        const val CURRENT_VERSION = "1.0"
        const val PRINTER_TYPE_BLUETOOTH = "bluetooth"
        const val PRINTER_TYPE_ETHERNET = "ethernet"
    }
    
    /**
     * Валидация данных QR
     */
    fun isValid(): Boolean {
        // Проверяем обязательные поля
        if (type != TYPE_IDENTIFIER) return false
        if (version.isEmpty()) return false
        if (name.isEmpty()) return false
        
        // Проверяем специфичные поля в зависимости от типа
        return when (printer_type) {
            PRINTER_TYPE_BLUETOOTH -> {
                // Для Bluetooth обязателен MAC адрес
                !address.isNullOrEmpty() && isValidMacAddress(address)
            }
            PRINTER_TYPE_ETHERNET -> {
                // Для Ethernet обязателен IP
                !ip.isNullOrEmpty() && isValidIpAddress(ip)
            }
            else -> false
        }
    }
    
    /**
     * Проверка валидности MAC адреса
     */
    private fun isValidMacAddress(mac: String): Boolean {
        val macRegex = Regex("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
        return macRegex.matches(mac)
    }
    
    /**
     * Проверка валидности IP адреса
     */
    private fun isValidIpAddress(ip: String): Boolean {
        val ipRegex = Regex("^((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.?\\b){4}$")
        return ipRegex.matches(ip)
    }
    
    /**
     * Получить порт (с дефолтным значением)
     */
    fun getPort(): Int = port ?: 9100
    
    /**
     * Получить человеко-читаемое описание
     */
    fun getDescription(): String {
        val typeStr = when (printer_type) {
            PRINTER_TYPE_BLUETOOTH -> "Bluetooth"
            PRINTER_TYPE_ETHERNET -> "Ethernet"
            else -> "Unknown"
        }
        
        val locationStr = if (!location.isNullOrEmpty()) " - $location" else ""
        val modelStr = if (!model.isNullOrEmpty()) " ($model)" else ""
        
        return "$name$modelStr - $typeStr$locationStr"
    }
}

/**
 * Расширенные настройки принтера (опционально)
 */
@Serializable
data class PrinterSettings(
    val dpi: Int? = null,                // 203 или 300
    val label_width: Int? = null,        // Ширина этикетки в мм
    val label_height: Int? = null,       // Высота этикетки в мм
    val darkness: Int? = null            // Плотность печати (0-30)
)

/**
 * Результат парсинга QR кода
 */
sealed class PrinterQRResult {
    data class Success(val data: PrinterQRData) : PrinterQRResult()
    data class Error(val message: String) : PrinterQRResult()
    object InvalidFormat : PrinterQRResult()
    object InvalidType : PrinterQRResult()
    object ValidationFailed : PrinterQRResult()
}
