package com.idento.presentation.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.bluetooth.BluetoothPrinter
import com.idento.data.bluetooth.BluetoothPrinterService
import com.idento.data.ethernet.EthernetPrinterService
import com.idento.data.preferences.AppPreferences
import com.idento.data.preferences.PrinterPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class PrinterType {
    BLUETOOTH,
    ETHERNET
}

data class SettingsUiState(
    val printerType: PrinterType = PrinterType.BLUETOOTH,
    val isLoading: Boolean = false,
    
    // Bluetooth
    val availableBluetoothPrinters: List<BluetoothPrinter> = emptyList(),
    val isBluetoothEnabled: Boolean = false,
    val hasBluetoothPermission: Boolean = false,
    
    // Ethernet
    val ethernetIpAddress: String = "",
    val ethernetPort: String = "9100",
    val ethernetName: String = "Ethernet Printer",
    
    // QR Scanner
    val showQRScanner: Boolean = false,
    val qrScannerMessage: String? = null,
    
    // Common
    val selectedPrinterType: String? = null, // "bluetooth" or "ethernet"
    val selectedPrinterAddress: String? = null,
    val selectedPrinterName: String? = null,
    val selectedPrinterPort: String? = null,
    
    val errorMessage: String? = null,
    val successMessage: String? = null,
    val isTestingPrinter: Boolean = false,
    
    // App settings
    val themeMode: String = AppPreferences.THEME_SYSTEM,
    val language: String = AppPreferences.LANG_SYSTEM
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val bluetoothService: BluetoothPrinterService,
    private val ethernetService: EthernetPrinterService,
    private val printerPreferences: PrinterPreferences,
    private val appPreferences: AppPreferences
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()
    
    init {
        loadSettings()
        checkBluetoothStatus()
        loadAppSettings()
    }
    
    private fun loadSettings() {
        viewModelScope.launch {
            val type = printerPreferences.printerType.first()
            val address = printerPreferences.printerAddress.first()
            val name = printerPreferences.printerName.first()
            val port = printerPreferences.printerPort.first()
            
            _uiState.value = _uiState.value.copy(
                selectedPrinterType = type,
                selectedPrinterAddress = address,
                selectedPrinterName = name,
                selectedPrinterPort = port,
                printerType = if (type == "ethernet") PrinterType.ETHERNET else PrinterType.BLUETOOTH
            )
        }
    }
    
    fun switchPrinterType(type: PrinterType) {
        _uiState.value = _uiState.value.copy(
            printerType = type,
            errorMessage = null,
            successMessage = null
        )
        
        if (type == PrinterType.BLUETOOTH) {
            checkBluetoothStatus()
        }
    }
    
    private fun checkBluetoothStatus() {
        _uiState.value = _uiState.value.copy(
            isBluetoothEnabled = bluetoothService.isBluetoothEnabled(),
            hasBluetoothPermission = bluetoothService.hasBluetoothPermissions()
        )
    }
    
    fun refreshBluetoothPrinters() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                errorMessage = null
            )
            
            checkBluetoothStatus()
            
            bluetoothService.getPairedPrinters()
                .onSuccess { printers ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        availableBluetoothPrinters = printers,
                        errorMessage = if (printers.isEmpty()) "No paired printers found" else null
                    )
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.message ?: "Failed to load printers"
                    )
                }
        }
    }
    
    fun selectBluetoothPrinter(printer: BluetoothPrinter) {
        viewModelScope.launch {
            printerPreferences.saveBluetoothPrinter(printer.address, printer.name)
            
            _uiState.value = _uiState.value.copy(
                selectedPrinterType = "bluetooth",
                selectedPrinterAddress = printer.address,
                selectedPrinterName = printer.name,
                selectedPrinterPort = null,
                successMessage = "Bluetooth printer selected: ${printer.name}"
            )
            
            kotlinx.coroutines.delay(3000)
            clearMessages()
        }
    }
    
    fun onEthernetIpChanged(ip: String) {
        _uiState.value = _uiState.value.copy(ethernetIpAddress = ip)
    }
    
    fun onEthernetPortChanged(port: String) {
        _uiState.value = _uiState.value.copy(ethernetPort = port)
    }
    
    fun onEthernetNameChanged(name: String) {
        _uiState.value = _uiState.value.copy(ethernetName = name)
    }
    
    fun saveEthernetPrinter() {
        val ip = _uiState.value.ethernetIpAddress
        val portStr = _uiState.value.ethernetPort
        val name = _uiState.value.ethernetName
        
        if (ip.isBlank()) {
            _uiState.value = _uiState.value.copy(errorMessage = "IP address is required")
            return
        }
        
        val port = portStr.toIntOrNull() ?: 9100
        
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            
            // Проверяем доступность принтера
            ethernetService.isPrinterAvailable(ip, port)
                .onSuccess {
                    printerPreferences.saveEthernetPrinter(ip, port, name)
                    
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        selectedPrinterType = "ethernet",
                        selectedPrinterAddress = ip,
                        selectedPrinterPort = port.toString(),
                        selectedPrinterName = name,
                        successMessage = "Ethernet printer saved: $ip:$port"
                    )
                    
                    kotlinx.coroutines.delay(3000)
                    clearMessages()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = "Cannot connect to printer: ${error.message}"
                    )
                }
        }
    }
    
    fun clearPrinter() {
        viewModelScope.launch {
            printerPreferences.clearPrinter()
            
            _uiState.value = _uiState.value.copy(
                selectedPrinterType = null,
                selectedPrinterAddress = null,
                selectedPrinterName = null,
                selectedPrinterPort = null,
                successMessage = "Printer cleared"
            )
            
            kotlinx.coroutines.delay(3000)
            clearMessages()
        }
    }
    
    fun testPrint() {
        val type = _uiState.value.selectedPrinterType
        val address = _uiState.value.selectedPrinterAddress
        
        if (type == null || address == null) {
            _uiState.value = _uiState.value.copy(errorMessage = "No printer configured")
            return
        }
        
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isTestingPrinter = true,
                errorMessage = null,
                successMessage = null
            )
            
            val result = when (type) {
                "bluetooth" -> {
                    bluetoothService.printTest(address)
                }
                "ethernet" -> {
                    val port = _uiState.value.selectedPrinterPort?.toIntOrNull() ?: 9100
                    ethernetService.printTest(address, port)
                }
                else -> Result.failure(Exception("Unknown printer type"))
            }
            
            result
                .onSuccess {
                    _uiState.value = _uiState.value.copy(
                        isTestingPrinter = false,
                        successMessage = "Test print sent successfully"
                    )
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isTestingPrinter = false,
                        errorMessage = "Test print failed: ${error.message}"
                    )
                }
            
            kotlinx.coroutines.delay(3000)
            clearMessages()
        }
    }
    
    fun clearMessages() {
        _uiState.value = _uiState.value.copy(
            errorMessage = null,
            successMessage = null
        )
    }
    
    /**
     * Показать QR Scanner
     */
    fun showQRScanner() {
        _uiState.value = _uiState.value.copy(
            showQRScanner = true,
            errorMessage = null,
            successMessage = null,
            qrScannerMessage = "Scan printer QR code"
        )
    }
    
    /**
     * Скрыть QR Scanner
     */
    fun hideQRScanner() {
        _uiState.value = _uiState.value.copy(
            showQRScanner = false,
            qrScannerMessage = null
        )
    }
    
    /**
     * Обработка отсканированного QR кода
     */
    fun onQRScanned(qrContent: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            
            // TODO: Parse QR with PrinterQRParser
            // Временно простая обработка
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                showQRScanner = false,
                successMessage = "QR scanned: $qrContent (parsing not implemented yet)"
            )
        }
    }
    
    // App Settings
    private fun loadAppSettings() {
        viewModelScope.launch {
            appPreferences.themeMode.collect { theme ->
                _uiState.value = _uiState.value.copy(themeMode = theme)
            }
        }
        viewModelScope.launch {
            appPreferences.language.collect { lang ->
                _uiState.value = _uiState.value.copy(language = lang)
            }
        }
    }
    
    fun setThemeMode(mode: String) {
        viewModelScope.launch {
            appPreferences.setThemeMode(mode)
            _uiState.value = _uiState.value.copy(
                themeMode = mode,
                successMessage = "Тема изменена"
            )
            kotlinx.coroutines.delay(3000)
            clearMessages()
        }
    }
    
    fun setLanguage(language: String) {
        viewModelScope.launch {
            appPreferences.setLanguage(language)
            _uiState.value = _uiState.value.copy(
                language = language,
                successMessage = "Язык изменен. Перезапустите приложение"
            )
        }
    }
    
}
