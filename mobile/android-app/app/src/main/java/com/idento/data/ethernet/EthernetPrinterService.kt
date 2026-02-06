package com.idento.data.ethernet

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import javax.inject.Inject
import javax.inject.Singleton

data class EthernetPrinter(
    val ipAddress: String,
    val port: Int = 9100, // Стандартный порт для Zebra принтеров
    val name: String = "Ethernet Printer"
)

@Singleton
class EthernetPrinterService @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private var currentSocket: Socket? = null
    private var currentOutputStream: OutputStream? = null
    
    /**
     * Проверяет доступность принтера по сети
     */
    suspend fun isPrinterAvailable(ipAddress: String, port: Int = 9100, timeoutMs: Int = 3000): Result<Boolean> {
        return withContext(Dispatchers.IO) {
            try {
                val socket = Socket()
                socket.connect(InetSocketAddress(ipAddress, port), timeoutMs)
                socket.close()
                Result.success(true)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    /**
     * Подключается к Ethernet принтеру
     */
    suspend fun connect(ipAddress: String, port: Int = 9100, timeoutMs: Int = 5000): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                disconnect() // Закрываем предыдущее соединение если есть
                
                val socket = Socket()
                socket.connect(InetSocketAddress(ipAddress, port), timeoutMs)
                socket.soTimeout = 10000 // Timeout для операций чтения/записи
                
                currentSocket = socket
                currentOutputStream = socket.getOutputStream()
                
                Result.success(Unit)
            } catch (e: Exception) {
                disconnect()
                Result.failure(Exception("Failed to connect: ${e.message}", e))
            }
        }
    }
    
    /**
     * Отключается от принтера
     */
    fun disconnect() {
        try {
            currentOutputStream?.close()
            currentSocket?.close()
        } catch (e: Exception) {
            // Игнорируем ошибки при закрытии
        } finally {
            currentOutputStream = null
            currentSocket = null
        }
    }
    
    /**
     * Проверяет активно ли соединение
     */
    fun isConnected(): Boolean {
        return currentSocket?.isConnected == true && !currentSocket!!.isClosed
    }
    
    /**
     * Отправляет ZPL команды на принтер
     */
    suspend fun print(zplCommands: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val outputStream = currentOutputStream
                    ?: return@withContext Result.failure(Exception("Not connected to printer"))
                
                if (!isConnected()) {
                    return@withContext Result.failure(Exception("Connection lost"))
                }
                
                // Отправляем ZPL команды
                outputStream.write(zplCommands.toByteArray(Charsets.UTF_8))
                outputStream.flush()
                
                Result.success(Unit)
            } catch (e: Exception) {
                disconnect()
                Result.failure(Exception("Print failed: ${e.message}", e))
            }
        }
    }
    
    /**
     * Печатает с автоматическим подключением
     */
    suspend fun printWithAutoConnect(
        ipAddress: String,
        port: Int = 9100,
        zplCommands: String
    ): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                // Пытаемся подключиться
                connect(ipAddress, port).getOrElse { error ->
                    return@withContext Result.failure(error)
                }
                
                // Печатаем
                val printResult = print(zplCommands)
                
                // Отключаемся после печати
                disconnect()
                
                printResult
            } catch (e: Exception) {
                disconnect()
                Result.failure(Exception("Print failed: ${e.message}", e))
            }
        }
    }
    
    /**
     * Тестовая печать
     */
    suspend fun printTest(ipAddress: String, port: Int = 9100): Result<Unit> {
        val testZPL = """
            ^XA
            ^FO50,50^A0N,50,50^FDTest Print^FS
            ^FO50,120^A0N,30,30^FDEthernet Printer^FS
            ^FO50,170^A0N,25,25^FD$ipAddress:$port^FS
            ^FO50,210^A0N,20,20^FDConnection OK^FS
            ^XZ
        """.trimIndent()
        
        return printWithAutoConnect(ipAddress, port, testZPL)
    }
    
    /**
     * Получает статус принтера (опционально)
     */
    suspend fun getPrinterStatus(ipAddress: String, port: Int = 9100): Result<String> {
        return withContext(Dispatchers.IO) {
            try {
                connect(ipAddress, port).getOrElse { error ->
                    return@withContext Result.failure(error)
                }
                
                val socket = currentSocket ?: return@withContext Result.failure(Exception("Not connected"))
                
                // Отправляем команду запроса статуса
                val statusCommand = "~HS\n" // Host Status для Zebra
                currentOutputStream?.write(statusCommand.toByteArray())
                currentOutputStream?.flush()
                
                // Читаем ответ
                val inputStream = socket.getInputStream()
                val buffer = ByteArray(1024)
                val bytesRead = inputStream.read(buffer)
                
                disconnect()
                
                if (bytesRead > 0) {
                    val status = String(buffer, 0, bytesRead)
                    Result.success(status)
                } else {
                    Result.success("No status response")
                }
            } catch (e: Exception) {
                disconnect()
                Result.failure(Exception("Failed to get status: ${e.message}", e))
            }
        }
    }
}
