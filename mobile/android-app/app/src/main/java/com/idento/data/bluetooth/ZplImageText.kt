package com.idento.data.bluetooth

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import kotlin.math.ceil

/**
 * Утилита для рендеринга текста как изображений в формате ZPL
 * Это позволяет печатать любые шрифты (включая кириллицу) на принтерах Zebra
 */
object ZplImageText {
    
    /**
     * Проверяет, содержит ли текст кириллические символы
     */
    fun containsCyrillic(text: String): Boolean {
        return text.any { char ->
            val block = Character.UnicodeBlock.of(char)
            block == Character.UnicodeBlock.CYRILLIC ||
            block == Character.UnicodeBlock.CYRILLIC_EXTENDED_A ||
            block == Character.UnicodeBlock.CYRILLIC_EXTENDED_B ||
            block == Character.UnicodeBlock.CYRILLIC_SUPPLEMENTARY
        }
    }
    
    /**
     * Проверяет, нужен ли рендеринг текста как изображения
     * Возвращает true если текст содержит non-ASCII символы
     */
    fun needsImageRendering(text: String): Boolean {
        return text.any { char -> char.code > 127 }
    }
    
    /**
     * Рендерит текст в bitmap с использованием системного или кастомного шрифта
     */
    fun textToBitmap(
        text: String,
        fontFamily: String = "sans-serif",
        fontSize: Float = 24f,
        bold: Boolean = false,
        textColor: Int = Color.BLACK,
        backgroundColor: Int = Color.WHITE
    ): Bitmap {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = textColor
            textSize = fontSize
            typeface = Typeface.create(fontFamily, if (bold) Typeface.BOLD else Typeface.NORMAL)
        }
        
        // Измеряем размер текста
        val textWidth = paint.measureText(text).toInt()
        val fontMetrics = paint.fontMetrics
        val textHeight = ceil(fontMetrics.bottom - fontMetrics.top).toInt()
        
        // Создаем bitmap с padding
        val padding = 4
        val bitmapWidth = textWidth + padding * 2
        val bitmapHeight = textHeight + padding * 2
        
        val bitmap = Bitmap.createBitmap(
            maxOf(1, bitmapWidth),
            maxOf(1, bitmapHeight),
            Bitmap.Config.ARGB_8888
        )
        
        val canvas = Canvas(bitmap)
        canvas.drawColor(backgroundColor)
        
        // Рисуем текст
        val x = padding.toFloat()
        val y = padding - fontMetrics.top
        canvas.drawText(text, x, y, paint)
        
        return bitmap
    }
    
    /**
     * Конвертирует bitmap в монохромный (черно-белый)
     */
    fun convertToMonochrome(bitmap: Bitmap, threshold: Int = 128): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val monoBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        
        for (y in 0 until height) {
            for (x in 0 until width) {
                val pixel = bitmap.getPixel(x, y)
                val r = Color.red(pixel)
                val g = Color.green(pixel)
                val b = Color.blue(pixel)
                
                // Вычисляем яркость
                val luminance = (0.299 * r + 0.587 * g + 0.114 * b).toInt()
                
                // Бинаризация
                val newColor = if (luminance < threshold) Color.BLACK else Color.WHITE
                monoBitmap.setPixel(x, y, newColor)
            }
        }
        
        return monoBitmap
    }
    
    /**
     * Конвертирует монохромный bitmap в ZPL hex данные
     */
    fun bitmapToZplHex(bitmap: Bitmap): String {
        val width = bitmap.width
        val height = bitmap.height
        
        // Ширина в байтах (8 пикселей на байт)
        val bytesPerRow = (width + 7) / 8
        
        val hexBuilder = StringBuilder()
        
        for (y in 0 until height) {
            var byte = 0
            var bitCount = 0
            
            for (x in 0 until width) {
                val pixel = bitmap.getPixel(x, y)
                val isBlack = Color.red(pixel) < 128
                
                // Сдвигаем бит влево и добавляем 1 если черный
                byte = byte shl 1
                if (isBlack) {
                    byte = byte or 1
                }
                bitCount++
                
                if (bitCount == 8) {
                    hexBuilder.append(String.format("%02X", byte))
                    byte = 0
                    bitCount = 0
                }
            }
            
            // Если остались биты в неполном байте, дополняем нулями
            if (bitCount > 0) {
                byte = byte shl (8 - bitCount)
                hexBuilder.append(String.format("%02X", byte))
            }
        }
        
        return hexBuilder.toString()
    }
    
    /**
     * Генерирует полную ZPL команду для изображения текста
     * 
     * @param text Текст для рендеринга
     * @param x X координата в dots
     * @param y Y координата в dots
     * @param fontFamily Семейство шрифта (например "sans-serif", "serif", "monospace")
     * @param fontSize Размер шрифта в пикселях
     * @param bold Жирный текст
     * @return ZPL команда ^GFA с изображением
     */
    fun generateZplImageText(
        text: String,
        x: Int,
        y: Int,
        fontFamily: String = "sans-serif",
        fontSize: Float = 24f,
        bold: Boolean = false
    ): String {
        // Рендерим текст в bitmap
        val bitmap = textToBitmap(text, fontFamily, fontSize, bold)
        
        // Конвертируем в монохромный
        val monoBitmap = convertToMonochrome(bitmap)
        
        // Конвертируем в ZPL hex
        val hexData = bitmapToZplHex(monoBitmap)
        
        val width = monoBitmap.width
        val height = monoBitmap.height
        val bytesPerRow = (width + 7) / 8
        val totalBytes = bytesPerRow * height
        
        // Очищаем bitmaps
        bitmap.recycle()
        monoBitmap.recycle()
        
        // Формируем ZPL команду
        // ^GFA,<total bytes>,<total bytes>,<bytes per row>,<data>
        return "^FO$x,$y^GFA,$totalBytes,$totalBytes,$bytesPerRow,$hexData^FS"
    }
    
    /**
     * Генерирует ZPL для текста с автоматическим определением метода
     * Если текст содержит non-ASCII символы — рендерит как изображение
     * Иначе — использует стандартные ZPL команды
     * 
     * @param text Текст
     * @param x X координата
     * @param y Y координата
     * @param font ZPL шрифт (A, B, D, E, F, G, H, 0)
     * @param fontHeight Высота шрифта для ZPL
     * @param fontWidth Ширина шрифта для ZPL
     * @param customFontFamily Кастомный шрифт для image rendering
     * @param customFontSize Размер для image rendering
     * @param bold Жирный текст
     * @param forceImageRendering Если true, всегда рендерить текст как изображение (один шрифт для латиницы и кириллицы)
     * @return ZPL команда
     */
    fun generateSmartText(
        text: String,
        x: Int,
        y: Int,
        font: String = "0",
        fontHeight: Int = 30,
        fontWidth: Int = 30,
        customFontFamily: String? = null,
        customFontSize: Float? = null,
        bold: Boolean = false,
        forceImageRendering: Boolean = false
    ): String {
        return if (needsImageRendering(text) || forceImageRendering) {
            // Рендерим как изображение для поддержки кириллицы и других символов
            val family = customFontFamily ?: "sans-serif"
            val size = customFontSize ?: fontHeight.toFloat()
            generateZplImageText(text, x, y, family, size, bold)
        } else {
            // Используем стандартный ZPL текст
            val escapedText = escapeZpl(text)
            "^FO$x,$y^A${font}N,$fontHeight,$fontWidth^FD$escapedText^FS"
        }
    }
    
    /**
     * Экранирует специальные символы ZPL
     */
    private fun escapeZpl(text: String): String {
        return text
            .replace("^", "")
            .replace("~", "")
            .take(100)
    }
}
