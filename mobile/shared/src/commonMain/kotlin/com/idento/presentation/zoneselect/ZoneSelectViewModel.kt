package com.idento.presentation.zoneselect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.EventZoneWithStats
import com.idento.data.network.ApiResult
import com.idento.data.repository.ZoneRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel for Zone Selection Screen
 */
class ZoneSelectViewModel(
    private val zoneRepository: ZoneRepository
) : ViewModel() {
    
    private val _state = MutableStateFlow<ZoneSelectState>(ZoneSelectState.Loading)
    val state: StateFlow<ZoneSelectState> = _state.asStateFlow()
    
    fun loadStaffZones(eventId: String, eventDay: String) {
        viewModelScope.launch {
            _state.value = ZoneSelectState.Loading
            
            when (val result = zoneRepository.getStaffZones(eventId)) {
                is ApiResult.Success -> {
                    val zones = result.data.filter { it.isActive }
                    
                    if (zones.isNotEmpty()) {
                        _state.value = ZoneSelectState.Success(
                            eventId = eventId,
                            eventDay = eventDay,
                            zones = zones
                        )
                    } else {
                        _state.value = ZoneSelectState.Error("No zones assigned to your account")
                    }
                }
                is ApiResult.Error -> {
                    _state.value = ZoneSelectState.Error(result.message ?: "Failed to load zones")
                }
                is ApiResult.Loading -> {
                    // Keep loading state
                }
            }
        }
    }
}

sealed class ZoneSelectState {
    data object Loading : ZoneSelectState()
    data class Success(
        val eventId: String,
        val eventDay: String,
        val zones: List<EventZoneWithStats>
    ) : ZoneSelectState()
    data class Error(val message: String) : ZoneSelectState()
}

