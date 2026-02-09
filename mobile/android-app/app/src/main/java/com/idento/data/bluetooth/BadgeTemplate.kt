package com.idento.data.bluetooth

import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.google.zxing.common.BitMatrix
import com.idento.data.model.Attendee
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Генератор ZPL команд для печати бейджей на принтерах Zebra
 * 
 * ZPL (Zebra Programming Language) - язык программирования для принтеров Zebra
 * 
 * Базовые команды:
 * ^XA - начало метки
 * ^XZ - конец метки
 * ^FO - field origin (позиция)
 * ^A - шрифт
 * ^FD - field data (данные)
 * ^FS - field separator (конец поля)
 * ^BY - barcode module width
 * ^BC - Code 128 barcode
 * ^BQ - QR code
 */
object BadgeTemplate {
    
    /**
     * Стандартный бейдж 4x6 дюймов (102x152 мм)
     * Разрешение 203 DPI
     * Поддерживает кириллицу через рендеринг текста как изображения
     */
    fun generateStandardBadge(
        attendee: Attendee,
        eventName: String,
        includeQR: Boolean = true,
        customFontFamily: String? = null
    ): String {
        return buildString {
            // Начало метки
            appendLine("^XA")
            
            // Параметры печати
            appendLine("^PW812") // Ширина метки (4 дюйма * 203 DPI)
            appendLine("^LH0,0") // Home position
            appendLine("^CI28") // UTF-8 encoding
            
            // Рамка
            appendLine("^FO20,20^GB772,1180,4^FS")
            
            // Название события (верх бейджа) - с поддержкой кириллицы
            append(ZplImageText.generateSmartText(
                text = eventName,
                x = 50,
                y = 50,
                fontHeight = 50,
                fontWidth = 50,
                customFontFamily = customFontFamily,
                customFontSize = 50f
            ))
            appendLine()
            
            // Горизонтальная линия
            appendLine("^FO50,120^GB712,3,3^FS")
            
            // Имя участника (крупным шрифтом) - с поддержкой кириллицы
            val fullName = "${attendee.firstName} ${attendee.lastName}"
            append(ZplImageText.generateSmartText(
                text = fullName,
                x = 50,
                y = 160,
                fontHeight = 80,
                fontWidth = 80,
                customFontFamily = customFontFamily,
                customFontSize = 80f,
                bold = true
            ))
            appendLine()
            
            // Компания
            if (attendee.company.isNotEmpty()) {
                append(ZplImageText.generateSmartText(
                    text = attendee.company,
                    x = 50,
                    y = 280,
                    fontHeight = 50,
                    fontWidth = 50,
                    customFontFamily = customFontFamily,
                    customFontSize = 50f
                ))
                appendLine()
            }
            
            // Должность
            if (attendee.position.isNotEmpty()) {
                val yPos = if (attendee.company.isNotEmpty()) 350 else 280
                append(ZplImageText.generateSmartText(
                    text = attendee.position,
                    x = 50,
                    y = yPos,
                    fontHeight = 40,
                    fontWidth = 40,
                    customFontFamily = customFontFamily,
                    customFontSize = 40f
                ))
                appendLine()
            }
            
            // QR код внизу (если требуется)
            if (includeQR) {
                // QR код с кодом участника
                appendLine("^FO600,900^BQN,2,6^FDQA,${attendee.code}^FS")
                
                // Текст под QR (код всегда ASCII)
                appendLine("^FO600,1100^A0N,25,25^FD${attendee.code}^FS")
            }
            
            // Статус checked-in (если зарегистрирован)
            if (attendee.checkinStatus) {
                appendLine("^FO50,1100^A0N,30,30^FD[CHECKED IN]^FS")
            }
            
            // Конец метки
            appendLine("^XZ")
        }
    }
    
    /**
     * Компактный бейдж 3x2 дюйма (76x51 мм)
     * Для быстрой печати имени и QR кода
     */
    fun generateCompactBadge(
        attendee: Attendee,
        includeQR: Boolean = true,
        customFontFamily: String? = null
    ): String {
        return buildString {
            appendLine("^XA")
            appendLine("^PW609") // 3 дюйма * 203 DPI
            appendLine("^CI28") // UTF-8 encoding
            
            // Рамка
            appendLine("^FO10,10^GB589,396,3^FS")
            
            // Имя участника - с поддержкой кириллицы
            val fullName = "${attendee.firstName} ${attendee.lastName}"
            append(ZplImageText.generateSmartText(
                text = fullName,
                x = 20,
                y = 30,
                fontHeight = 50,
                fontWidth = 50,
                customFontFamily = customFontFamily,
                customFontSize = 50f,
                bold = true
            ))
            appendLine()
            
            // Компания (если есть)
            if (attendee.company.isNotEmpty()) {
                append(ZplImageText.generateSmartText(
                    text = attendee.company,
                    x = 20,
                    y = 100,
                    fontHeight = 30,
                    fontWidth = 30,
                    customFontFamily = customFontFamily,
                    customFontSize = 30f
                ))
                appendLine()
            }
            
            // QR код справа
            if (includeQR) {
                appendLine("^FO450,150^BQN,2,5^FDQA,${attendee.code}^FS")
            }
            
            appendLine("^XZ")
        }
    }
    
    /**
     * Бейдж только с QR кодом и кодом участника
     * Для самостоятельной печати участниками
     */
    fun generateQROnlyBadge(attendee: Attendee): String {
        return buildString {
            appendLine("^XA")
            appendLine("^PW406") // 2 дюйма * 203 DPI
            
            // QR код (крупный)
            appendLine("^FO50,50^BQN,2,8^FDQA,${attendee.code}^FS")
            
            // Код участника текстом
            appendLine("^FO50,350^A0N,40,40^FD${attendee.code}^FS")
            
            appendLine("^XZ")
        }
    }
    
    /**
     * VIP бейдж с дополнительным оформлением
     */
    fun generateVIPBadge(
        attendee: Attendee,
        eventName: String
    ): String {
        return buildString {
            appendLine("^XA")
            appendLine("^PW812")
            
            // Двойная рамка
            appendLine("^FO10,10^GB792,1200,8^FS")
            appendLine("^FO20,20^GB772,1180,4^FS")
            
            // VIP метка (жирным шрифтом)
            appendLine("^FO50,40^A0N,60,60^FD*** VIP ***^FS")
            
            // Название события
            appendLine("^FO50,120^A0N,45,45^FD${escapeZPL(eventName)}^FS")
            
            // Горизонтальная линия
            appendLine("^FO50,180^GB712,4,4^FS")
            
            // Имя участника (очень крупным шрифтом)
            val fullName = "${attendee.firstName} ${attendee.lastName}"
            appendLine("^FO50,220^A0N,90,90^FD${escapeZPL(fullName)}^FS")
            
            // Компания
            if (attendee.company.isNotEmpty()) {
                appendLine("^FO50,350^A0N,55,55^FD${escapeZPL(attendee.company)}^FS")
            }
            
            // Должность
            if (attendee.position.isNotEmpty()) {
                val yPos = if (attendee.company.isNotEmpty()) 430 else 350
                appendLine("^FO50,$yPos^A0N,45,45^FD${escapeZPL(attendee.position)}^FS")
            }
            
            // Большой QR код
            appendLine("^FO550,850^BQN,2,8^FDQA,${attendee.code}^FS")
            
            appendLine("^XZ")
        }
    }
    
    /**
     * Кастомный бейдж на основе шаблона (старый формат с плейсхолдерами)
     * Поддерживает плейсхолдеры: {{first_name}}, {{last_name}}, {{company}}, {{position}}, {{email}}, {{code}}
     * 
     * ВАЖНО: Этот метод НЕ поддерживает кириллицу! 
     * Для кириллицы используйте generateFromJsonTemplate()
     */
    fun generateCustomBadge(
        attendee: Attendee,
        template: String
    ): String {
        return template
            .replace("{{first_name}}", escapeZPL(attendee.firstName))
            .replace("{{last_name}}", escapeZPL(attendee.lastName))
            .replace("{{company}}", escapeZPL(attendee.company))
            .replace("{{position}}", escapeZPL(attendee.position))
            .replace("{{email}}", escapeZPL(attendee.email))
            .replace("{{code}}", attendee.code)
            .replace("{{full_name}}", escapeZPL("${attendee.firstName} ${attendee.lastName}"))
    }
    
    /**
     * Генерирует бейдж из JSON-шаблона (формат веб-редактора)
     * Полная поддержка кириллицы через рендеринг текста как изображений
     * 
     * @param attendee Данные участника
     * @param jsonTemplate JSON строка с шаблоном (см. формат ниже)
     * @param customFields Дополнительные поля участника
     * @param customFontFamily Семейство шрифта для кириллицы
     * @return ZPL код для печати
     * 
     * Формат JSON шаблона:
     * {
     *   "widthMM": 80,
     *   "heightMM": 50,
     *   "dpi": 203,
     *   "elements": [
     *     {
     *       "type": "text",
     *       "x": 5, "y": 5,
     *       "source": "first_name",
     *       "fontSize": 24,
     *       "bold": true,
     *       "customFont": "Arial"
     *     },
     *     {
     *       "type": "qrcode",
     *       "x": 60, "y": 5,
     *       "source": "code",
     *       "width": 15
     *     }
     *   ]
     * }
     */
    fun generateFromJsonTemplate(
        attendee: Attendee,
        jsonTemplate: String,
        customFields: Map<String, Any>? = null,
        defaultFontFamily: String? = null
    ): String {
        return try {
            val json = org.json.JSONObject(jsonTemplate)
            val widthMM = json.optInt("widthMM", 80)
            val heightMM = json.optInt("heightMM", 50)
            val dpi = json.optInt("dpi", 203)
            val elements = json.optJSONArray("elements") ?: return generateStandardBadge(attendee, "Event")
            
            // Конвертируем мм в dots
            val dotsPerMm = dpi / 25.4
            val widthDots = (widthMM * dotsPerMm).toInt()
            
            buildString {
                appendLine("^XA")
                appendLine("^PW$widthDots")
                appendLine("^CI28") // UTF-8 encoding
                appendLine("^LH0,0")
                
                for (i in 0 until elements.length()) {
                    val element = elements.getJSONObject(i)
                    val type = element.optString("type", "text")
                    val xMM = element.optDouble("x", 0.0)
                    val yMM = element.optDouble("y", 0.0)
                    val x = (xMM * dotsPerMm).toInt()
                    val y = (yMM * dotsPerMm).toInt()
                    
                    when (type) {
                        "text" -> {
                            val source = element.optString("source", "")
                            val fontSize = element.optInt("fontSize", 24)
                            val bold = element.optBoolean("bold", false)
                            val customFont = element.optString("customFont", "")
                            
                            // Получаем значение поля
                            val text = getFieldValue(attendee, source, customFields)
                            
                            if (text.isNotEmpty()) {
                                val fontFamily = customFont.takeIf { it.isNotBlank() } ?: (defaultFontFamily ?: "sans-serif")
                                append(ZplImageText.generateSmartText(
                                    text = text,
                                    x = x,
                                    y = y,
                                    fontHeight = fontSize,
                                    fontWidth = fontSize,
                                    customFontFamily = fontFamily,
                                    customFontSize = fontSize.toFloat(),
                                    bold = bold,
                                    forceImageRendering = customFont.isNotBlank()
                                ))
                                appendLine()
                            }
                        }
                        "qrcode" -> {
                            val source = element.optString("source", "code")
                            val widthQRMM = element.optDouble("width", 15.0)
                            val qrSize = (widthQRMM / 3).toInt().coerceIn(2, 10) // Масштаб QR кода
                            
                            val content = getFieldValue(attendee, source, customFields)
                            if (content.isNotEmpty()) {
                                appendLine("^FO$x,$y^BQN,2,$qrSize^FDQA,$content^FS")
                            }
                        }
                        "line" -> {
                            val lengthMM = element.optDouble("length", 50.0)
                            val thickness = element.optInt("thickness", 2)
                            val orientation = element.optString("orientation", "horizontal")
                            
                            val lengthDots = (lengthMM * dotsPerMm).toInt()
                            
                            if (orientation == "horizontal") {
                                appendLine("^FO$x,$y^GB$lengthDots,$thickness,$thickness^FS")
                            } else {
                                appendLine("^FO$x,$y^GB$thickness,$lengthDots,$thickness^FS")
                            }
                        }
                        "box" -> {
                            val boxWidthMM = element.optDouble("width", 20.0)
                            val boxHeightMM = element.optDouble("height", 10.0)
                            val thickness = element.optInt("thickness", 2)
                            
                            val boxWidthDots = (boxWidthMM * dotsPerMm).toInt()
                            val boxHeightDots = (boxHeightMM * dotsPerMm).toInt()
                            
                            appendLine("^FO$x,$y^GB$boxWidthDots,$boxHeightDots,$thickness^FS")
                        }
                    }
                }
                
                appendLine("^XZ")
            }
        } catch (e: Exception) {
            // Fallback to standard badge on error
            generateStandardBadge(attendee, "Event", customFontFamily = defaultFontFamily)
        }
    }
    
    /**
     * Получает значение поля участника по имени
     */
    private fun getFieldValue(
        attendee: Attendee,
        fieldName: String,
        customFields: Map<String, Any>?
    ): String {
        return when (fieldName) {
            "first_name" -> attendee.firstName
            "last_name" -> attendee.lastName
            "full_name" -> "${attendee.firstName} ${attendee.lastName}"
            "company" -> attendee.company
            "position" -> attendee.position
            "email" -> attendee.email
            "code" -> attendee.code
            else -> {
                // Ищем в custom fields
                customFields?.get(fieldName)?.toString() 
                    ?: attendee.customFields?.get(fieldName)?.toString() 
                    ?: ""
            }
        }
    }
    
    /**
     * Тестовая печать для проверки принтера
     */
    fun generateTestBadge(): String {
        return buildString {
            appendLine("^XA")
            appendLine("^PW812")
            
            // Рамка
            appendLine("^FO20,20^GB772,400,4^FS")
            
            // Заголовок
            appendLine("^FO50,50^A0N,60,60^FDTest Print^FS")
            
            // Информация
            appendLine("^FO50,140^A0N,40,40^FDPrinter: Zebra ZPL^FS")
            appendLine("^FO50,200^A0N,40,40^FDResolution: 203 DPI^FS")
            appendLine("^FO50,260^A0N,40,40^FDDate: ${java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(java.util.Date())}^FS")
            
            // Тестовый QR код
            appendLine("^FO600,50^BQN,2,6^FDQA,TEST123^FS")
            
            appendLine("^XZ")
        }
    }
    
    /**
     * Экранирует специальные символы для ZPL
     */
    private fun escapeZPL(text: String): String {
        return text
            .replace("^", "")  // Удаляем ^ (служебный символ ZPL)
            .replace("~", "")  // Удаляем ~ (служебный символ ZPL)
            .take(50) // Ограничиваем длину для предотвращения переполнения
    }
    
    /**
     * Генерирует QR код как изображение (для продвинутых шаблонов)
     */
    fun generateQRBitmap(content: String, size: Int = 200): Bitmap? {
        return try {
            val bitMatrix: BitMatrix = MultiFormatWriter().encode(
                content,
                BarcodeFormat.QR_CODE,
                size,
                size
            )
            
            val width = bitMatrix.width
            val height = bitMatrix.height
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
            
            for (x in 0 until width) {
                for (y in 0 until height) {
                    bitmap.setPixel(
                        x, 
                        y, 
                        if (bitMatrix[x, y]) android.graphics.Color.BLACK 
                        else android.graphics.Color.WHITE
                    )
                }
            }
            
            bitmap
        } catch (e: Exception) {
            null
        }
    }
    
    /**
     * Конвертирует Bitmap в GRF команды ZPL (для сложных изображений)
     */
    fun bitmapToZPL(bitmap: Bitmap, x: Int, y: Int): String {
        // Упрощенная реализация - для полной поддержки нужна библиотека
        // Это базовый пример для черно-белых изображений
        val width = bitmap.width
        val height = bitmap.height
        
        return buildString {
            appendLine("^FO$x,$y")
            appendLine("^GFA,${width * height},$width,$width,")
            
            // Здесь должна быть конвертация bitmap в hex строку
            // Для production использовать готовую библиотеку
            
            appendLine("^FS")
        }
    }
}
