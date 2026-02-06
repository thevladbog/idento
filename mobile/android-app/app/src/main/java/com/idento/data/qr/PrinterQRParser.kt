package com.idento.data.qr

import com.idento.data.model.PrinterQRData
import com.idento.data.model.PrinterQRResult
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Сервис для парсинга QR-кодов принтеров
 */
@Singleton
class PrinterQRParser @Inject constructor() {
    
    private val json = Json {
        ignoreUnknownKeys = true  // Игнорировать неизвестные поля
        isLenient = true           // Более мягкий парсинг
    }
    
    /**
     * Парсит строку QR кода в PrinterQRData
     */
    fun parse(qrContent: String): PrinterQRResult {
        if (qrContent.isEmpty()) {
            return PrinterQRResult.Error("QR code is empty")
        }
        
        return try {
            // Парсим JSON
            val data = json.decodeFromString<PrinterQRData>(qrContent)
            
            // Проверяем тип QR
            if (data.type != PrinterQRData.TYPE_IDENTIFIER) {
                return PrinterQRResult.InvalidType
            }
            
            // Валидируем данные
            if (!data.isValid()) {
                return PrinterQRResult.ValidationFailed
            }
            
            PrinterQRResult.Success(data)
            
        } catch (e: kotlinx.serialization.SerializationException) {
            PrinterQRResult.InvalidFormat
        } catch (e: Exception) {
            PrinterQRResult.Error(e.message ?: "Unknown error")
        }
    }
    
    /**
     * Проверяет, является ли строка валидным QR принтера
     */
    fun isValidPrinterQR(qrContent: String): Boolean {
        return when (parse(qrContent)) {
            is PrinterQRResult.Success -> true
            else -> false
        }
    }
    
    /**
     * Получить описание ошибки
     */
    fun getErrorMessage(result: PrinterQRResult): String {
        return when (result) {
            is PrinterQRResult.Success -> "Success"
            is PrinterQRResult.Error -> result.message
            is PrinterQRResult.InvalidFormat -> "Invalid QR code format. Expected JSON."
            is PrinterQRResult.InvalidType -> "This is not a printer QR code."
            is PrinterQRResult.ValidationFailed -> "Printer configuration is incomplete or invalid."
        }
    }
}
