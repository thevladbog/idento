package com.idento.presentation.scanner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.scanner.BluetoothScanner
import com.idento.data.scanner.BluetoothScannerService
import com.idento.data.preferences.ScannerPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class BluetoothScannerUiState(
    val isLoading: Boolean = false,
    val availableScanners: List<BluetoothScanner> = emptyList(),
    val selectedScannerAddress: String? = null,
    val selectedScannerName: String? = null,
    val isBluetoothEnabled: Boolean = false,
    val hasBluetoothPermission: Boolean = false,
    val errorMessage: String? = null,
    val successMessage: String? = null,
    val isTesting: Boolean = false,
    val isConnected: Boolean = false,
    val connectingToAddress: String? = null
)

@HiltViewModel
class BluetoothScannerViewModel @Inject constructor(
    private val bluetoothScannerService: BluetoothScannerService,
    private val scannerPreferences: ScannerPreferences
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(BluetoothScannerUiState())
    val uiState: StateFlow<BluetoothScannerUiState> = _uiState.asStateFlow()
    
    init {
        loadSettings()
        checkBluetoothStatus()
        
        // Слушаем результаты сканирования
        viewModelScope.launch {
            bluetoothScannerService.scanResults.collect { scanResult ->
                // Результат успешного сканирования
                _uiState.value = _uiState.value.copy(
                    isTesting = false,
                    successMessage = "Scan successful: ${scanResult.data}"
                )
                
                // Очищаем сообщение через 3 секунды
                kotlinx.coroutines.delay(3000)
                clearMessages()
            }
        }
        
        // Слушаем найденные устройства (если используем discovery)
        viewModelScope.launch {
            bluetoothScannerService.discoveredScanners.collect { scanners ->
                _uiState.value = _uiState.value.copy(
                    availableScanners = scanners,
                    isLoading = false
                )
            }
        }
    }
    
    private fun loadSettings() {
        viewModelScope.launch {
            val address = scannerPreferences.scannerAddress.first()
            val name = scannerPreferences.scannerName.first()
            
            _uiState.value = _uiState.value.copy(
                selectedScannerAddress = address,
                selectedScannerName = name
            )
        }
    }
    
    private fun checkBluetoothStatus() {
        _uiState.value = _uiState.value.copy(
            isBluetoothEnabled = bluetoothScannerService.isBluetoothEnabled(),
            hasBluetoothPermission = bluetoothScannerService.hasBluetoothPermissions()
        )
    }
    
    fun refreshScanners() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                errorMessage = null
            )
            
            // Проверяем статус Bluetooth снова
            checkBluetoothStatus()
            
            // Получаем спаренные устройства
            bluetoothScannerService.getPairedScanners()
                .onSuccess { scanners ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        availableScanners = scanners,
                        errorMessage = if (scanners.isEmpty()) "No paired scanners found. Pair your scanner in Bluetooth settings first." else null
                    )
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.message ?: "Failed to load scanners"
                    )
                }
            
            // Можно также запустить discovery для поиска новых устройств
            // bluetoothScannerService.startDiscovery()
        }
    }
    
    fun selectScanner(scanner: BluetoothScanner) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                connectingToAddress = scanner.address,
                errorMessage = null
            )
            
            // Подключаемся к сканеру
            bluetoothScannerService.connect(scanner)
                .onSuccess {
                    // Сохраняем в preferences
                    scannerPreferences.saveScanner(scanner.address, scanner.name)
                    
                    _uiState.value = _uiState.value.copy(
                        selectedScannerAddress = scanner.address,
                        selectedScannerName = scanner.name,
                        isConnected = true,
                        connectingToAddress = null,
                        successMessage = "Scanner connected: ${scanner.name}"
                    )
                    
                    // Очищаем сообщение через 3 секунды
                    kotlinx.coroutines.delay(3000)
                    clearMessages()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        connectingToAddress = null,
                        errorMessage = "Connection failed: ${error.message}"
                    )
                }
        }
    }
    
    fun clearScanner() {
        viewModelScope.launch {
            bluetoothScannerService.disconnect()
            scannerPreferences.clearScanner()
            
            _uiState.value = _uiState.value.copy(
                selectedScannerAddress = null,
                selectedScannerName = null,
                isConnected = false,
                successMessage = "Scanner disconnected"
            )
            
            kotlinx.coroutines.delay(3000)
            clearMessages()
        }
    }
    
    fun testConnection() {
        _uiState.value = _uiState.value.copy(
            isTesting = true,
            errorMessage = null,
            successMessage = null
        )
        
        // Проверяем подключение
        if (!bluetoothScannerService.isConnected()) {
            _uiState.value = _uiState.value.copy(
                isTesting = false,
                errorMessage = "Scanner not connected. Please select a scanner first."
            )
            return
        }
        
        // Просто показываем что тест начался
        // Реальное тестирование произойдет когда придет scan result
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                successMessage = "Scanner ready. Scan a barcode to test..."
            )
            
            // Таймаут на тест
            kotlinx.coroutines.delay(10000)
            if (_uiState.value.isTesting) {
                _uiState.value = _uiState.value.copy(
                    isTesting = false,
                    errorMessage = "Test timeout. No barcode scanned."
                )
            }
        }
    }
    
    fun clearMessages() {
        _uiState.value = _uiState.value.copy(
            errorMessage = null,
            successMessage = null
        )
    }
    
    override fun onCleared() {
        super.onCleared()
        bluetoothScannerService.stopDiscovery()
    }
}
