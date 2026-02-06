package com.idento.platform.printer

/**
 * Cross-platform Printer Service Interface
 * Uses expect/actual for platform-specific implementations
 */
expect class BluetoothPrinterService {
    /**
     * Check if Bluetooth is available and enabled
     */
    fun isBluetoothEnabled(): Boolean
    
    /**
     * Check if app has required Bluetooth permissions
     */
    fun hasBluetoothPermissions(): Boolean
    
    /**
     * Get list of paired Bluetooth printers
     */
    suspend fun getPairedPrinters(): Result<List<BluetoothPrinterDevice>>
    
    /**
     * Connect to printer by address
     */
    suspend fun connect(address: String): Result<Unit>
    
    /**
     * Disconnect from current printer
     */
    suspend fun disconnect()
    
    /**
     * Check if currently connected to a printer
     */
    fun isConnected(): Boolean
    
    /**
     * Print ZPL data
     */
    suspend fun print(zpl: String): Result<Unit>
    
    /**
     * Print with auto-connect
     */
    suspend fun printWithAutoConnect(address: String, zpl: String): Result<Unit>
    
    /**
     * Send test print
     */
    suspend fun printTest(address: String): Result<Unit>
}

/**
 * Ethernet Printer Service (Cross-platform)
 */
expect class EthernetPrinterService {
    /**
     * Check if printer is reachable
     */
    suspend fun isPrinterAvailable(ip: String, port: Int): Result<Boolean>
    
    /**
     * Connect to Ethernet printer
     */
    suspend fun connect(ip: String, port: Int): Result<Unit>
    
    /**
     * Disconnect from printer
     */
    suspend fun disconnect()
    
    /**
     * Check connection status
     */
    fun isConnected(): Boolean
    
    /**
     * Print ZPL data
     */
    suspend fun print(zpl: String): Result<Unit>
    
    /**
     * Print with auto-connect
     */
    suspend fun printWithAutoConnect(ip: String, port: Int, zpl: String): Result<Unit>
    
    /**
     * Send test print
     */
    suspend fun printTest(ip: String, port: Int): Result<Unit>
}

/**
 * Cross-platform Bluetooth Printer Device model
 */
data class BluetoothPrinterDevice(
    val address: String,
    val name: String,
    val isPaired: Boolean = false
)
