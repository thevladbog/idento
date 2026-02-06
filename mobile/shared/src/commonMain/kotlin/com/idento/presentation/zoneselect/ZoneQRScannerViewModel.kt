package com.idento.presentation.zoneselect

import androidx.lifecycle.ViewModel
import com.idento.data.model.ZoneQRData
import com.idento.data.network.ZoneApiService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * ViewModel for Zone QR Scanner
 * Handles scanning zone QR codes for quick zone selection
 */
class ZoneQRScannerViewModel(
    private val zoneApiService: ZoneApiService
) : ViewModel() {
    
    private val _state = MutableStateFlow<ZoneQRScannerState>(ZoneQRScannerState.Idle)
    val state: StateFlow<ZoneQRScannerState> = _state.asStateFlow()
    
    fun onQRScanned(qrData: String) {
        try {
            // Try to parse as ZoneQRData
            val zoneQR = kotlinx.serialization.json.Json.decodeFromString(
                ZoneQRData.serializer(), 
                qrData
            )
            
            if (zoneQR.type == "zone") {
                _state.value = ZoneQRScannerState.Success(zoneQR)
            } else {
                _state.value = ZoneQRScannerState.Error("Invalid QR code type")
            }
        } catch (e: Exception) {
            _state.value = ZoneQRScannerState.Error("Not a valid zone QR code")
        }
    }
    
    fun reset() {
        _state.value = ZoneQRScannerState.Idle
    }
}

sealed class ZoneQRScannerState {
    data object Idle : ZoneQRScannerState()
    data class Success(val zoneQRData: ZoneQRData) : ZoneQRScannerState()
    data class Error(val message: String) : ZoneQRScannerState()
}

