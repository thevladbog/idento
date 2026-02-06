package com.idento.presentation.dayselect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.network.ApiResult
import com.idento.data.repository.EventRepository
import com.idento.data.repository.ZoneRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel for Day Selection Screen
 */
class DaySelectViewModel(
    private val eventRepository: EventRepository,
    private val zoneRepository: ZoneRepository
) : ViewModel() {
    
    private val _state = MutableStateFlow<DaySelectState>(DaySelectState.Loading)
    val state: StateFlow<DaySelectState> = _state.asStateFlow()
    
    fun loadEventDays(eventId: String) {
        viewModelScope.launch {
            _state.value = DaySelectState.Loading
            
            when (val result = eventRepository.getEvent(eventId)) {
                is ApiResult.Success -> {
                    val event = result.data
                    val days = zoneRepository.getEventDays(
                        startDate = event.startDate,
                        endDate = event.endDate
                    )
                    
                    if (days.isNotEmpty()) {
                        _state.value = DaySelectState.Success(
                            eventId = eventId,
                            eventName = event.name,
                            days = days
                        )
                    } else {
                        _state.value = DaySelectState.Error("No days found for event")
                    }
                }
                is ApiResult.Error -> {
                    _state.value = DaySelectState.Error(result.message ?: "Failed to load event")
                }
                is ApiResult.Loading -> {
                    // Keep loading state
                }
            }
        }
    }
}

sealed class DaySelectState {
    data object Loading : DaySelectState()
    data class Success(
        val eventId: String,
        val eventName: String,
        val days: List<String>
    ) : DaySelectState()
    data class Error(val message: String) : DaySelectState()
}

