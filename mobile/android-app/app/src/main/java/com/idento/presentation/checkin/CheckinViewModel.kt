package com.idento.presentation.checkin

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Attendee
import com.idento.data.repository.EventRepository
import com.idento.data.bluetooth.BluetoothPrinterService
import com.idento.data.bluetooth.BadgeTemplate
import com.idento.data.ethernet.EthernetPrinterService
import com.idento.data.scanner.HardwareScannerService
import com.idento.data.scanner.BluetoothScannerService
import com.idento.data.preferences.PrinterPreferences
import com.idento.data.preferences.ScannerPreferences
import com.idento.data.preferences.TemplatePreferences
import com.idento.data.preferences.CheckinPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CheckinUiState(
    val eventId: String = "",
    val eventName: String = "",
    val searchQuery: String = "",
    val attendees: List<Attendee> = emptyList(),
    val searchSuggestions: List<Attendee> = emptyList(),
    val selectedAttendee: Attendee? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val successMessage: String? = null,
    val isPrinting: Boolean = false,
    val printSuccess: String? = null,
    val hasPrinterConfigured: Boolean = false,
    val autoPrintBadge: Boolean = false,
    val printOnButton: Boolean = true,
    val isHardwareScannerAvailable: Boolean = false,
    val hardwareScannerName: String? = null
)

@HiltViewModel
class CheckinViewModel @Inject constructor(
    private val eventRepository: EventRepository,
    private val bluetoothService: BluetoothPrinterService,
    private val ethernetService: EthernetPrinterService,
    private val hardwareScannerService: HardwareScannerService,
    private val bluetoothScannerService: BluetoothScannerService,
    private val printerPreferences: PrinterPreferences,
    private val templatePreferences: TemplatePreferences,
    private val checkinPreferences: CheckinPreferences,
    private val scannerPreferences: ScannerPreferences,
    savedStateHandle: SavedStateHandle
) : ViewModel() {
    
    private val eventId: String = savedStateHandle.get<String>("eventId") ?: ""
    private val eventName: String = savedStateHandle.get<String>("eventName") ?: ""
    
    private val _uiState = MutableStateFlow(CheckinUiState(
        eventId = eventId,
        eventName = eventName
    ))
    val uiState: StateFlow<CheckinUiState> = _uiState.asStateFlow()
    
    init {
        checkHardwareScanner() // Сначала проверяем сканер
        setupHardwareScannerListener()
        setupBluetoothScannerListener()
        reconnectBluetoothScanner()
        loadAttendees()
        checkPrinterConfiguration()
        loadBadgeTemplate()
        loadCheckinSettings()
    }
    
    /**
     * Проверяет наличие встроенного сканера
     */
    private fun checkHardwareScanner() {
        val isAvailable = hardwareScannerService.isDataCollectionTerminal()
        val manufacturer = if (isAvailable) {
            hardwareScannerService.getScannerManufacturerName()
        } else {
            null
        }
        
        _uiState.value = _uiState.value.copy(
            isHardwareScannerAvailable = isAvailable, // Только если реально есть hardware scanner
            hardwareScannerName = manufacturer
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
                // Ищем участника по коду
                onCodeScanned(scanResult.data)
            }
        }
    }
    
    /**
     * Настраивает слушатель для Bluetooth сканера
     */
    private fun setupBluetoothScannerListener() {
        viewModelScope.launch {
            bluetoothScannerService.scanResults.collect { scanResult ->
                // Ищем участника по коду
                onCodeScanned(scanResult.data)
            }
        }
    }
    
    /**
     * Переподключается к сохраненному Bluetooth сканеру при запуске
     */
    private fun reconnectBluetoothScanner() {
        viewModelScope.launch {
            val scannerAddress = scannerPreferences.scannerAddress.first()
            if (!scannerAddress.isNullOrEmpty() && !bluetoothScannerService.isConnected()) {
                // Пытаемся переподключиться к сохраненному сканеру
                val pairedScanners = bluetoothScannerService.getPairedScanners().getOrNull()
                val scanner = pairedScanners?.find { it.address == scannerAddress }
                
                if (scanner != null) {
                    bluetoothScannerService.connect(scanner)
                        .onFailure {
                            // Тихо игнорируем ошибку - пользователь может переподключиться вручную
                        }
                }
            }
        }
    }
    
    /**
     * Загружает настройки чекина
     */
    private fun loadCheckinSettings() {
        viewModelScope.launch {
            val autoPrint = checkinPreferences.autoPrintBadge.first()
            val printOnButton = checkinPreferences.printOnButton.first()
            
            _uiState.value = _uiState.value.copy(
                autoPrintBadge = autoPrint,
                printOnButton = printOnButton
            )
        }
    }
    
    override fun onCleared() {
        super.onCleared()
        hardwareScannerService.unregisterReceiver()
        // Bluetooth сканер остается подключенным для использования в других экранах
    }
    
    private fun checkPrinterConfiguration() {
        viewModelScope.launch {
            val printerAddress = printerPreferences.printerAddress.first()
            _uiState.value = _uiState.value.copy(
                hasPrinterConfigured = !printerAddress.isNullOrEmpty()
            )
        }
    }
    
    private fun loadBadgeTemplate() {
        viewModelScope.launch {
            // Загружаем локальный шаблон
            val localTemplate = templatePreferences.getBadgeTemplate(eventId).first()
            
            // Если локального нет, попробуем загрузить серверный
            if (localTemplate != null) {
                // Используем локальный (сохраненный в templatePreferences)
                // Шаблон будет использован при печати
            }
        }
    }
    
    fun loadAttendees() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                errorMessage = null
            )
            
            eventRepository.getAttendees(eventId)
                .onSuccess { attendees ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        attendees = attendees
                    )
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.message ?: "Failed to load attendees"
                    )
                }
        }
    }
    
    fun onSearchQueryChanged(query: String) {
        _uiState.value = _uiState.value.copy(
            searchQuery = query,
            selectedAttendee = null // Сбрасываем выбор при изменении поиска
        )
        updateSearchSuggestions(query)
    }
    
    private fun updateSearchSuggestions(query: String) {
        val suggestions = if (query.isEmpty()) {
            emptyList()
        } else {
            _uiState.value.attendees.filter { attendee ->
                attendee.firstName.contains(query, ignoreCase = true) ||
                attendee.lastName.contains(query, ignoreCase = true) ||
                attendee.email.contains(query, ignoreCase = true) ||
                attendee.company.contains(query, ignoreCase = true) ||
                attendee.code.contains(query, ignoreCase = true)
            }.take(5) // Показываем максимум 5 предложений
        }
        _uiState.value = _uiState.value.copy(searchSuggestions = suggestions)
    }
    
    /**
     * Выбор участника из списка предложений
     */
    fun selectAttendee(attendee: Attendee) {
        _uiState.value = _uiState.value.copy(
            selectedAttendee = attendee,
            searchQuery = "${attendee.firstName} ${attendee.lastName}",
            searchSuggestions = emptyList()
        )
    }
    
    /**
     * Очистка выбранного участника
     */
    fun clearSelectedAttendee() {
        _uiState.value = _uiState.value.copy(
            selectedAttendee = null,
            searchQuery = "",
            searchSuggestions = emptyList()
        )
    }
    
    /**
     * Обработка сканирования кода (QR или barcode)
     */
    fun onCodeScanned(code: String) {
        viewModelScope.launch {
            // Ищем участника по коду
            val attendee = _uiState.value.attendees.find { it.code == code }
            
            if (attendee != null) {
                // Выбираем участника
                selectAttendee(attendee)
                
                // Автоматически делаем чекин
                checkinAttendee(attendee.id)
            } else {
                _uiState.value = _uiState.value.copy(
                    errorMessage = "Participant not found: $code"
                )
            }
        }
    }
    
    fun checkinAttendee(attendeeId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                errorMessage = null,
                successMessage = null
            )
            
            eventRepository.checkinAttendee(eventId, attendeeId)
                .onSuccess { attendee ->
                    // Update the attendee in the list and selected
                    val updatedAttendees = _uiState.value.attendees.map {
                        if (it.id == attendeeId) attendee else it
                    }
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        attendees = updatedAttendees,
                        selectedAttendee = attendee,
                        successMessage = "Check-in successful!"
                    )
                    
                    // Автоматическая печать если настроено
                    if (_uiState.value.autoPrintBadge && !_uiState.value.printOnButton) {
                        printBadge(attendee)
                    }
                    
                    // Очищаем сообщение через 3 секунды
                    kotlinx.coroutines.delay(3000)
                    _uiState.value = _uiState.value.copy(successMessage = null)
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.message ?: "Check-in failed"
                    )
                }
        }
    }
    
    fun clearError() {
        _uiState.value = _uiState.value.copy(errorMessage = null)
    }
    
    fun printBadge(attendee: Attendee) {
        viewModelScope.launch {
            val printerType = printerPreferences.printerType.first()
            val printerAddress = printerPreferences.printerAddress.first()
            
            if (printerType.isNullOrEmpty() || printerAddress.isNullOrEmpty()) {
                _uiState.value = _uiState.value.copy(
                    errorMessage = "No printer configured. Go to Settings to select a printer."
                )
                return@launch
            }
            
            _uiState.value = _uiState.value.copy(
                isPrinting = true,
                errorMessage = null,
                printSuccess = null
            )
            
            // Загружаем серверный шаблон (JSON формат из веб-редактора)
            val events = eventRepository.getEvents().getOrNull() ?: emptyList()
            val event = events.find { it.id == eventId }
            val serverTemplate = event?.getBadgeTemplate()
            
            val zplCommands = if (serverTemplate != null) {
                // Проверяем, является ли шаблон JSON (новый формат с поддержкой кириллицы)
                if (serverTemplate.trimStart().startsWith("{")) {
                    // JSON шаблон с поддержкой кириллицы через image rendering
                    BadgeTemplate.generateFromJsonTemplate(
                        attendee = attendee,
                        jsonTemplate = serverTemplate,
                        customFields = attendee.customFields
                    )
                } else {
                    // Старый формат с плейсхолдерами (без поддержки кириллицы)
                    BadgeTemplate.generateCustomBadge(attendee, serverTemplate)
                }
            } else {
                // Используем дефолтный шаблон с поддержкой кириллицы
                BadgeTemplate.generateStandardBadge(
                    attendee = attendee,
                    eventName = _uiState.value.eventName,
                    includeQR = true
                )
            }
            
            // Печатаем на выбранном типе принтера
            val printResult = when (printerType) {
                "bluetooth" -> {
                    bluetoothService.printWithAutoConnect(printerAddress, zplCommands)
                }
                "ethernet" -> {
                    val port = printerPreferences.printerPort.first()?.toIntOrNull() ?: 9100
                    ethernetService.printWithAutoConnect(printerAddress, port, zplCommands)
                }
                else -> {
                    Result.failure(Exception("Unknown printer type: $printerType"))
                }
            }
            
            printResult
                .onSuccess {
                    _uiState.value = _uiState.value.copy(
                        isPrinting = false,
                        printSuccess = "Badge printed for ${attendee.firstName} ${attendee.lastName}"
                    )
                    kotlinx.coroutines.delay(3000)
                    _uiState.value = _uiState.value.copy(printSuccess = null)
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isPrinting = false,
                        errorMessage = "Print failed: ${error.message}"
                    )
                }
        }
    }
}
