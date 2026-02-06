package com.idento.presentation.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.localization.LocalizationManager
import com.idento.data.preferences.AppPreferences
import com.idento.presentation.theme.ThemeState
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Settings ViewModel (Cross-platform)
 * Manages app settings, printer configuration, and scanner settings
 */
class SettingsViewModel(
    private val appPreferences: AppPreferences
) : ViewModel() {
    
    private val json = Json { ignoreUnknownKeys = true }
    
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()
    
    // Exception handler to prevent crashes on iOS
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("⚠️ Settings coroutine exception: ${throwable.message}")
        _uiState.value = _uiState.value.copy(
            errorMessage = throwable.message ?: "An error occurred"
        )
    }
    
    init {
        loadAppSettings()
    }
    
    private fun loadAppSettings() {
        viewModelScope.launch(exceptionHandler) {
            try {
                appPreferences.themeMode.collect { theme ->
                    _uiState.value = _uiState.value.copy(themeMode = theme)
                }
            } catch (e: Exception) {
                println("⚠️ Failed to load theme settings (iOS): ${e.message}")
                // Use default system theme on iOS
                _uiState.value = _uiState.value.copy(themeMode = AppPreferences.THEME_SYSTEM)
            }
        }
        viewModelScope.launch(exceptionHandler) {
            try {
                appPreferences.language.collect { lang ->
                    _uiState.value = _uiState.value.copy(language = lang)
                    // Update LocalizationManager when language is loaded
                    LocalizationManager.setLanguage(lang)
                }
            } catch (e: Exception) {
                println("⚠️ Failed to load language settings (iOS): ${e.message}")
                // Use default system language on iOS
                _uiState.value = _uiState.value.copy(language = AppPreferences.LANG_SYSTEM)
            }
        }
    }
    
    fun setThemeMode(mode: String) {
        // Update global theme state immediately for instant switching
        ThemeState.setTheme(mode)
        
        viewModelScope.launch(exceptionHandler) {
            try {
                appPreferences.setThemeMode(mode)
                _uiState.value = _uiState.value.copy(
                    themeMode = mode,
                    successMessage = "Theme changed"
                )
            } catch (e: Exception) {
                println("⚠️ Failed to save theme (iOS): ${e.message}")
                // Theme is already applied via ThemeState, just warn about persistence
                _uiState.value = _uiState.value.copy(
                    themeMode = mode,
                    successMessage = "Theme applied (may not persist on restart)"
                )
            }
            clearMessagesDelayed()
        }
    }
    
    fun setLanguage(language: String) {
        // Update LocalizationManager immediately for instant language switch
        LocalizationManager.setLanguage(language)
        
        viewModelScope.launch(exceptionHandler) {
            try {
                appPreferences.setLanguage(language)
                _uiState.value = _uiState.value.copy(
                    language = language,
                    successMessage = if (language == "ru") "Язык изменён" else "Language changed"
                )
            } catch (e: Exception) {
                println("⚠️ Failed to save language (iOS): ${e.message}")
                _uiState.value = _uiState.value.copy(
                    language = language,
                    successMessage = if (language == "ru") "Язык изменён" else "Language changed"
                )
            }
            clearMessagesDelayed()
        }
    }
    
    // Printer Settings (Platform-specific will be implemented later)
    fun selectBluetoothPrinter(address: String, name: String) {
        viewModelScope.launch(exceptionHandler) {
            // TODO: Save to PrinterPreferences
            _uiState.value = _uiState.value.copy(
                selectedPrinterName = name,
                selectedPrinterAddress = address,
                successMessage = "Printer selected: $name"
            )
            clearMessagesDelayed()
        }
    }
    
    fun selectEthernetPrinter(ip: String, port: Int, name: String) {
        viewModelScope.launch(exceptionHandler) {
            // TODO: Save to PrinterPreferences
            _uiState.value = _uiState.value.copy(
                selectedPrinterName = name,
                selectedPrinterAddress = "$ip:$port",
                successMessage = "Printer configured: $name"
            )
            clearMessagesDelayed()
        }
    }
    
    fun testPrint() {
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isTestingPrinter = true)
            
            // TODO: Platform-specific printer service
            kotlinx.coroutines.delay(2000)
            
            _uiState.value = _uiState.value.copy(
                isTestingPrinter = false,
                successMessage = "Test print sent"
            )
            clearMessagesDelayed()
        }
    }
    
    fun clearPrinter() {
        viewModelScope.launch(exceptionHandler) {
            // TODO: Clear PrinterPreferences
            _uiState.value = _uiState.value.copy(
                selectedPrinterName = null,
                selectedPrinterAddress = null,
                successMessage = "Printer cleared"
            )
            clearMessagesDelayed()
        }
    }
    
    /**
     * Configure printer from QR code
     * QR code should contain JSON: {"type":"ethernet|bluetooth","name":"Printer Name","ip":"192.168.1.100","port":9100,"address":"XX:XX:XX:XX:XX:XX"}
     */
    fun configurePrinterFromQR(qrContent: String) {
        viewModelScope.launch(exceptionHandler) {
            try {
                val config = json.decodeFromString<PrinterQRConfig>(qrContent)
                
                when (config.type.lowercase()) {
                    "ethernet", "network", "ip" -> {
                        val ip = config.ip ?: throw IllegalArgumentException("IP address required for ethernet printer")
                        val port = config.port ?: 9100
                        val name = config.name ?: "Network Printer"
                        
                        _uiState.value = _uiState.value.copy(
                            selectedPrinterName = name,
                            selectedPrinterAddress = "$ip:$port",
                            successMessage = "Printer configured: $name"
                        )
                    }
                    "bluetooth", "bt" -> {
                        val address = config.address ?: throw IllegalArgumentException("Bluetooth address required")
                        val name = config.name ?: "Bluetooth Printer"
                        
                        _uiState.value = _uiState.value.copy(
                            selectedPrinterName = name,
                            selectedPrinterAddress = address,
                            successMessage = "Printer configured: $name"
                        )
                    }
                    else -> {
                        _uiState.value = _uiState.value.copy(
                            errorMessage = "Unknown printer type: ${config.type}"
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    errorMessage = "Invalid QR code: ${e.message}"
                )
            }
            clearMessagesDelayed()
        }
    }
    
    // Scanner Settings
    fun setScannerMode(mode: String) {
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(
                scannerMode = mode,
                successMessage = "Scanner mode: ${if (mode == "hardware") "Hardware Scanner" else "Camera"}"
            )
            clearMessagesDelayed()
        }
    }
    
    fun checkHardwareScannerConnection() {
        viewModelScope.launch(exceptionHandler) {
            // TODO: Check actual hardware scanner connection
            // For now, simulate check
            _uiState.value = _uiState.value.copy(
                isHardwareScannerConnected = false
            )
        }
    }
    
    fun showPrinterQRScanner() {
        _uiState.value = _uiState.value.copy(showPrinterQRScanner = true)
    }
    
    fun hidePrinterQRScanner() {
        _uiState.value = _uiState.value.copy(showPrinterQRScanner = false)
    }
    
    private fun clearMessagesDelayed() {
        viewModelScope.launch(exceptionHandler) {
            kotlinx.coroutines.delay(3000)
            clearMessages()
        }
    }
    
    fun clearMessages() {
        _uiState.value = _uiState.value.copy(
            successMessage = null,
            errorMessage = null
        )
    }
}

data class SettingsUiState(
    val isLoading: Boolean = false,
    
    // App Settings
    val themeMode: String = AppPreferences.THEME_SYSTEM,
    val language: String = AppPreferences.LANG_SYSTEM,
    
    // Printer Settings
    val selectedPrinterName: String? = null,
    val selectedPrinterAddress: String? = null,
    val isTestingPrinter: Boolean = false,
    
    // Scanner Settings
    val scannerMode: String = "camera", // "camera" or "hardware"
    val isHardwareScannerConnected: Boolean = false,
    val hardwareScannerName: String? = null,
    
    // QR Scanner for printer config
    val showPrinterQRScanner: Boolean = false,
    
    // Messages
    val successMessage: String? = null,
    val errorMessage: String? = null
)

/**
 * Printer configuration from QR code
 * Example JSON: {"type":"ethernet","name":"Office Printer","ip":"192.168.1.100","port":9100}
 * or: {"type":"bluetooth","name":"Mobile Printer","address":"XX:XX:XX:XX:XX:XX"}
 */
@Serializable
data class PrinterQRConfig(
    val type: String,              // "ethernet" | "bluetooth"
    val name: String? = null,      // Optional printer name
    val ip: String? = null,        // For ethernet: IP address
    val port: Int? = null,         // For ethernet: port (default 9100)
    val address: String? = null    // For bluetooth: MAC address
)
