package com.idento.presentation.qrscanner

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.repository.EventRepository
import com.idento.data.preferences.TemplatePreferences
import com.idento.data.scanner.HardwareScannerService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class QRScannerUiState(
    val eventId: String = "",
    val eventName: String = "",
    val isProcessing: Boolean = false,
    val lastScannedCode: String? = null,
    val errorMessage: String? = null,
    val scanEnabled: Boolean = true,
    val checkedInAttendee: com.idento.data.model.Attendee? = null,
    val displayTemplate: String? = null, // Markdown template для отображения
    val isHardwareScannerAvailable: Boolean = false,
    val hardwareScannerName: String? = null,
    val useHardwareScanner: Boolean = false
)

@HiltViewModel
class QRScannerViewModel @Inject constructor(
    private val eventRepository: EventRepository,
    private val templatePreferences: TemplatePreferences,
    private val hardwareScannerService: HardwareScannerService,
    savedStateHandle: SavedStateHandle
) : ViewModel() {
    
    private val eventId: String = savedStateHandle.get<String>("eventId") ?: ""
    private val eventName: String = savedStateHandle.get<String>("eventName") ?: ""
    
    private val _uiState = MutableStateFlow(QRScannerUiState(
        eventId = eventId,
        eventName = eventName
    ))
    val uiState: StateFlow<QRScannerUiState> = _uiState.asStateFlow()
    
    init {
        loadTemplate()
        checkHardwareScanner()
        setupHardwareScannerListener()
    }
    
    /**
     * Проверяет наличие встроенного сканера
     */
    private fun checkHardwareScanner() {
        val isAvailable = hardwareScannerService.isDataCollectionTerminal()
        val scannerName = if (isAvailable) {
            hardwareScannerService.getScannerManufacturerName()
        } else {
            null
        }
        
        _uiState.value = _uiState.value.copy(
            isHardwareScannerAvailable = isAvailable,
            hardwareScannerName = scannerName,
            useHardwareScanner = isAvailable // Автоматически используем если доступен
        )
        
        // Автоматически регистрируем receiver если hardware scanner доступен
        if (isAvailable) {
            hardwareScannerService.registerReceiver()
        }
    }
    
    /**
     * Настраивает слушатель для встроенного сканера
     */
    private fun setupHardwareScannerListener() {
        viewModelScope.launch {
            hardwareScannerService.scanResults.collect { scanResult ->
                // Обрабатываем результат только если используем аппаратный сканер
                if (_uiState.value.useHardwareScanner) {
                    onQRCodeScanned(scanResult.data)
                }
            }
        }
    }
    
    /**
     * Переключает режим сканирования (камера/встроенный сканер)
     */
    fun toggleScannerMode() {
        val newMode = !_uiState.value.useHardwareScanner
        _uiState.value = _uiState.value.copy(useHardwareScanner = newMode)
        
        if (newMode) {
            // Регистрируем receiver для встроенного сканера
            hardwareScannerService.registerReceiver()
        } else {
            // Отменяем регистрацию если переключились на камеру
            hardwareScannerService.unregisterReceiver()
        }
    }
    
    /**
     * Программный триггер встроенного сканера
     */
    fun triggerHardwareScan() {
        if (_uiState.value.useHardwareScanner) {
            hardwareScannerService.triggerScan()
        }
    }
    
    /**
     * Останавливает встроенный сканер
     */
    fun stopHardwareScan() {
        if (_uiState.value.useHardwareScanner) {
            hardwareScannerService.stopScan()
        }
    }
    
    override fun onCleared() {
        super.onCleared()
        hardwareScannerService.unregisterReceiver()
    }
    
    private fun loadTemplate() {
        viewModelScope.launch {
            // Загружаем локальный шаблон
            val localTemplate = templatePreferences.getSuccessScreenTemplate(eventId).first()
            
            // Если локального нет, попробуем загрузить серверный
            if (localTemplate == null) {
                eventRepository.getEvents().getOrNull()?.let { events ->
                    val event = events.find { it.id == eventId }
                    val serverTemplate = event?.getSuccessScreenTemplate()
                    _uiState.value = _uiState.value.copy(displayTemplate = serverTemplate)
                }
            } else {
                _uiState.value = _uiState.value.copy(displayTemplate = localTemplate)
            }
        }
    }
    
    fun onQRCodeScanned(code: String) {
        // Игнорируем если уже обрабатываем или это тот же код
        if (_uiState.value.isProcessing || _uiState.value.lastScannedCode == code) {
            return
        }
        
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isProcessing = true,
                lastScannedCode = code,
                scanEnabled = false,
                errorMessage = null
            )
            
            // Ищем участника по коду
            eventRepository.searchAttendee(eventId, code)
                .onSuccess { attendee ->
                    // Нашли участника, делаем check-in
                    if (attendee.checkinStatus) {
                        _uiState.value = _uiState.value.copy(
                            isProcessing = false,
                            errorMessage = "${attendee.firstName} ${attendee.lastName} already checked in"
                        )
                        // Разрешаем новое сканирование через 2 секунды
                        enableScanningAfterDelay()
                    } else {
                        checkinAttendee(attendee.id, "${attendee.firstName} ${attendee.lastName}")
                    }
                }
                .onFailure { _ ->
                    _uiState.value = _uiState.value.copy(
                        isProcessing = false,
                        errorMessage = "Attendee not found: $code"
                    )
                    enableScanningAfterDelay()
                }
        }
    }
    
    @Suppress("UNUSED_PARAMETER")
    private fun checkinAttendee(attendeeId: String, attendeeName: String) {
        viewModelScope.launch {
            eventRepository.checkinAttendee(eventId, attendeeId)
                .onSuccess { attendee ->
                    _uiState.value = _uiState.value.copy(
                        isProcessing = false,
                        checkedInAttendee = attendee,
                        scanEnabled = false
                    )
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isProcessing = false,
                        errorMessage = "Check-in failed: ${error.message}"
                    )
                    enableScanningAfterDelay()
                }
        }
    }
    
    private fun enableScanningAfterDelay() {
        viewModelScope.launch {
            kotlinx.coroutines.delay(2000) // 2 секунды задержка
            _uiState.value = _uiState.value.copy(
                scanEnabled = true,
                lastScannedCode = null
            )
        }
    }
    
    fun resetToScanning() {
        _uiState.value = _uiState.value.copy(
            checkedInAttendee = null,
            errorMessage = null,
            lastScannedCode = null,
            scanEnabled = true,
            isProcessing = false
        )
    }
    
    fun clearMessages() {
        _uiState.value = _uiState.value.copy(
            errorMessage = null
        )
    }
}
