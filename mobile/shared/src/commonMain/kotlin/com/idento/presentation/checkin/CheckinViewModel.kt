package com.idento.presentation.checkin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Attendee
import com.idento.data.model.BadgeTemplate
import com.idento.data.model.DisplayTemplate
import com.idento.data.network.ApiResult
import com.idento.data.preferences.AppPreferences
import com.idento.data.preferences.DisplayTemplatePreferences
import com.idento.data.repository.AttendeeRepository
import com.idento.data.repository.EventRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Checkin ViewModel (Cross-platform)
 * Main screen for checking in attendees
 */
class CheckinViewModel(
    private val attendeeRepository: AttendeeRepository,
    private val eventRepository: EventRepository,
    private val appPreferences: AppPreferences,
    private val displayTemplatePreferences: DisplayTemplatePreferences
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(CheckinUiState())
    val uiState: StateFlow<CheckinUiState> = _uiState.asStateFlow()
    
    // Exception handler to prevent crashes on iOS
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("⚠️ Checkin coroutine exception: ${throwable.message}")
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            isProcessing = false,
            errorMessage = throwable.message ?: "An error occurred"
        )
    }
    
    private var currentEventId: String? = null
    private var allAttendees: List<Attendee> = emptyList()
    
    fun setEventId(eventId: String) {
        currentEventId = eventId
        loadAttendees()
        loadBadgeTemplate()
        loadDisplayTemplate()
    }
    
    private fun loadDisplayTemplate() {
        val eventId = currentEventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            try {
                val template = displayTemplatePreferences.getTemplateOrDefault(eventId).first()
                _uiState.value = _uiState.value.copy(
                    displayTemplate = template
                )
            } catch (e: Exception) {
                println("⚠️ loadDisplayTemplate error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    displayTemplate = DisplayTemplate.default(eventId)
                )
            }
        }
    }
    
    private fun loadAttendees() {
        val eventId = currentEventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isLoading = true)
            
            try {
                when (val result = attendeeRepository.getAttendees(eventId)) {
                    is ApiResult.Success -> {
                        allAttendees = result.data
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            attendees = result.data,
                            checkedInCount = result.data.count { it.isCheckedIn }
                        )
                    }
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            errorMessage = result.message ?: "Failed to load attendees"
                        )
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ loadAttendees error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = e.message ?: "Failed to load attendees"
                )
            }
        }
    }
    
    private fun loadBadgeTemplate() {
        val eventId = currentEventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            try {
                when (val result = eventRepository.getBadgeTemplate(eventId)) {
                    is ApiResult.Success -> {
                        result.data?.let { template ->
                            _uiState.value = _uiState.value.copy(
                                badgeTemplate = BadgeTemplate(
                                    eventId = eventId,
                                    zplTemplate = template
                                )
                            )
                        }
                    }
                    is ApiResult.Error -> {
                        // Badge template is optional, don't show error
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ loadBadgeTemplate error: ${e.message}")
                // Badge template is optional, don't show error
            }
        }
    }
    
    fun onSearchQueryChanged(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
        
        if (query.isBlank()) {
            _uiState.value = _uiState.value.copy(
                searchSuggestions = emptyList(),
                selectedAttendee = null
            )
        } else {
            val suggestions = allAttendees.filter { attendee ->
                attendee.fullName.contains(query, ignoreCase = true) ||
                attendee.email?.contains(query, ignoreCase = true) == true ||
                attendee.code.contains(query, ignoreCase = true)
            }.take(5)
            
            _uiState.value = _uiState.value.copy(searchSuggestions = suggestions)
        }
    }
    
    fun selectAttendee(attendee: Attendee) {
        _uiState.value = _uiState.value.copy(
            selectedAttendee = attendee,
            searchQuery = attendee.fullName,
            searchSuggestions = emptyList()
        )
    }
    
    /**
     * Select attendee by ID (from attendees list navigation)
     */
    fun selectAttendeeById(attendeeId: String) {
        viewModelScope.launch(exceptionHandler) {
            // First try to find in local list
            var attendee = allAttendees.find { it.id == attendeeId }
            
            if (attendee != null) {
                println("✅ Found attendee locally: ${attendee.fullName}")
                selectAttendee(attendee)
                return@launch
            }
            
            // If local list is empty, wait for it to load
            if (allAttendees.isEmpty() && currentEventId != null) {
                println("⏳ Local list empty, reloading attendees...")
                
                // Reload attendees
                when (val result = attendeeRepository.getAttendees(currentEventId!!)) {
                    is ApiResult.Success -> {
                        allAttendees = result.data
                        _uiState.value = _uiState.value.copy(
                            attendees = result.data,
                            checkedInCount = result.data.count { it.isCheckedIn }
                        )
                        
                        // Try to find again
                        attendee = allAttendees.find { it.id == attendeeId }
                        if (attendee != null) {
                            println("✅ Found attendee after reload: ${attendee.fullName}")
                            selectAttendee(attendee)
                        } else {
                            println("❌ Attendee not found: $attendeeId")
                            _uiState.value = _uiState.value.copy(
                                errorMessage = "Attendee not found"
                            )
                        }
                    }
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(
                            errorMessage = "Failed to load attendees"
                        )
                    }
                    is ApiResult.Loading -> {}
                }
            } else {
                println("❌ Attendee not found in local list: $attendeeId")
                _uiState.value = _uiState.value.copy(
                    errorMessage = "Attendee not found"
                )
            }
        }
    }
    
    fun clearSelectedAttendee() {
        _uiState.value = _uiState.value.copy(
            selectedAttendee = null,
            searchQuery = "",
            searchSuggestions = emptyList()
        )
    }
    
    fun onCodeScanned(code: String) {
        val eventId = currentEventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isProcessing = true)
            
            try {
                when (val result = attendeeRepository.getAttendeeByCode(eventId, code)) {
                    is ApiResult.Success -> {
                        val attendee = result.data
                        
                        if (attendee.isBlocked) {
                            _uiState.value = _uiState.value.copy(
                                isProcessing = false,
                                errorMessage = "Attendee is blocked: ${attendee.blockReason}"
                            )
                        } else if (attendee.isCheckedIn) {
                            _uiState.value = _uiState.value.copy(
                                isProcessing = false,
                                errorMessage = "Already checked in"
                            )
                        } else {
                            checkinAttendee(attendee.id)
                        }
                    }
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(
                            isProcessing = false,
                            errorMessage = "Attendee not found"
                        )
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ onCodeScanned error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    errorMessage = e.message ?: "Scan failed"
                )
            }
        }
    }
    
    fun checkinAttendee(attendeeId: String) {
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isProcessing = true)
            
            try {
                when (val result = attendeeRepository.checkinAttendee(attendeeId)) {
                    is ApiResult.Success -> {
                        val updatedAttendee = result.data
                        println("✅ Check-in API success: ${updatedAttendee.fullName}")
                        println("   isCheckedIn=${updatedAttendee.isCheckedIn}, checkinStatus=${updatedAttendee.checkinStatus}")
                        println("   checkedInAt=${updatedAttendee.checkedInAt}, checkedInByEmail=${updatedAttendee.checkedInByEmail}")
                        
                        // Update local list with the response from API
                        allAttendees = allAttendees.map { 
                            if (it.id == attendeeId) updatedAttendee else it 
                        }
                        
                        _uiState.value = _uiState.value.copy(
                            isProcessing = false,
                            selectedAttendee = updatedAttendee,
                            checkedInCount = allAttendees.count { it.isCheckedIn },
                            successMessage = "${updatedAttendee.fullName} checked in!"
                        )
                        
                        // Auto-print badge if enabled
                        if (_uiState.value.autoPrintBadge && !_uiState.value.printOnButton) {
                            printBadge(updatedAttendee)
                        }
                        
                        // Clear success message after 3 seconds
                        kotlinx.coroutines.delay(3000)
                        clearMessages()
                    }
                    is ApiResult.Error -> {
                        println("❌ Check-in API error: ${result.message}")
                        _uiState.value = _uiState.value.copy(
                            isProcessing = false,
                            errorMessage = result.message ?: "Check-in failed"
                        )
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ checkinAttendee error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    errorMessage = e.message ?: "Check-in failed"
                )
            }
        }
    }
    
    fun printBadge(attendee: Attendee) {
        val template = _uiState.value.badgeTemplate
        
        if (template == null) {
            _uiState.value = _uiState.value.copy(
                errorMessage = "Badge template not configured"
            )
            return
        }
        
        viewModelScope.launch(exceptionHandler) {
            try {
                // Generate ZPL code
                val zpl = template.generateZPL(attendee)
                
                // TODO: Send to printer service (platform-specific)
                // This will be implemented in platform services phase
                _uiState.value = _uiState.value.copy(
                    successMessage = "Badge sent to printer"
                )
                
                kotlinx.coroutines.delay(3000)
                clearMessages()
            } catch (e: Exception) {
                println("⚠️ printBadge error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    errorMessage = e.message ?: "Print failed"
                )
            }
        }
    }
    
    fun clearMessages() {
        _uiState.value = _uiState.value.copy(
            successMessage = null,
            errorMessage = null
        )
    }
    
    fun refresh() {
        loadAttendees()
    }
    
    /**
     * Enable/disable automatic badge printing on check-in
     */
    fun setPrintOnCheckin(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(
            autoPrintBadge = enabled,
            // If disabling print on checkin, also disable print on button
            printOnButton = if (enabled) _uiState.value.printOnButton else false
        )
    }
    
    /**
     * Enable/disable "Print by button" mode
     * If true: show Print Badge button after check-in
     * If false: auto-print immediately after check-in
     */
    fun setPrintOnButton(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(
            printOnButton = enabled
        )
    }
}

data class CheckinUiState(
    val isLoading: Boolean = false,
    val isProcessing: Boolean = false,
    val isPrinting: Boolean = false,
    val attendees: List<Attendee> = emptyList(),
    val searchQuery: String = "",
    val searchSuggestions: List<Attendee> = emptyList(),
    val selectedAttendee: Attendee? = null,
    val checkedInCount: Int = 0,
    val badgeTemplate: BadgeTemplate? = null,
    val displayTemplate: DisplayTemplate? = null,
    val autoPrintBadge: Boolean = false,
    val printOnButton: Boolean = true,
    val hasPrinterConfigured: Boolean = false,
    val isHardwareScannerAvailable: Boolean = false,
    val hardwareScannerName: String? = null,
    val successMessage: String? = null,
    val errorMessage: String? = null,
    val eventName: String = "",
    val eventId: String = ""
)
