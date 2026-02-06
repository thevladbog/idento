package com.idento.presentation.qrscanner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Attendee
import com.idento.data.model.ZoneQRData
import com.idento.data.network.ApiResult
import com.idento.data.repository.AttendeeRepository
import com.idento.data.repository.ZoneRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * QR Scanner ViewModel (Cross-platform)
 * Terminal/Kiosk mode for self-service check-in
 */
class QRScannerViewModel(
    private val attendeeRepository: AttendeeRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(QRScannerUiState())
    val uiState: StateFlow<QRScannerUiState> = _uiState.asStateFlow()
    
    // Exception handler to prevent crashes on iOS
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("⚠️ QRScanner coroutine exception: ${throwable.message}")
        _uiState.value = _uiState.value.copy(
            isProcessing = false,
            errorTitle = "Error",
            errorMessage = throwable.message ?: "An error occurred"
        )
    }
    
    private var currentEventId: String? = null
    
    fun setEventId(eventId: String) {
        currentEventId = eventId
    }
    
    fun onQRScanned(code: String) {
        val eventId = currentEventId ?: return
        
        // Prevent duplicate scans
        if (_uiState.value.isProcessing) return
        
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(
                isProcessing = true,
                scannedCode = code
            )
            
            try {
                when (val result = attendeeRepository.getAttendeeByCode(eventId, code)) {
                    is ApiResult.Success -> {
                        val attendee = result.data
                        
                        if (attendee.isBlocked) {
                            showError("Access Denied", attendee.blockReason)
                        } else if (attendee.isCheckedIn) {
                            showError("Already Checked In", attendee.fullName)
                        } else {
                            checkinAttendee(attendee)
                        }
                    }
                    is ApiResult.Error -> {
                        showError("Not Found", "QR code not recognized")
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ onQRScanned error: ${e.message}")
                showError("Error", e.message ?: "Scan failed")
            }
        }
    }
    
    private fun checkinAttendee(attendee: Attendee) {
        viewModelScope.launch(exceptionHandler) {
            try {
                when (val result = attendeeRepository.checkinAttendee(attendee.id)) {
                    is ApiResult.Success -> {
                        val updated = result.data
                        _uiState.value = _uiState.value.copy(
                            isProcessing = false,
                            showSuccess = true,
                            successAttendee = updated,
                            errorTitle = null,
                            errorMessage = null
                        )
                        
                        // Auto-clear success screen after 5 seconds
                        kotlinx.coroutines.delay(5000)
                        clearScreen()
                    }
                    is ApiResult.Error -> {
                        showError("Check-in Failed", result.message ?: "Unknown error")
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ checkinAttendee error: ${e.message}")
                showError("Check-in Failed", e.message ?: "Unknown error")
            }
        }
    }
    
    private fun showError(title: String, message: String?) {
        _uiState.value = _uiState.value.copy(
            isProcessing = false,
            showSuccess = false,
            errorTitle = title,
            errorMessage = message
        )
        
        // Auto-clear error after 5 seconds
        viewModelScope.launch(exceptionHandler) {
            kotlinx.coroutines.delay(5000)
            clearScreen()
        }
    }
    
    fun clearScreen() {
        _uiState.value = QRScannerUiState()
    }
    
    fun manualClear() {
        clearScreen()
    }
}

data class QRScannerUiState(
    val isProcessing: Boolean = false,
    val scannedCode: String? = null,
    val showSuccess: Boolean = false,
    val successAttendee: Attendee? = null,
    val errorTitle: String? = null,
    val errorMessage: String? = null
)
