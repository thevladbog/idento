package com.idento.presentation.events

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Event
import com.idento.data.network.ApiResult
import com.idento.data.repository.AuthRepository
import com.idento.data.repository.EventRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Events ViewModel (Cross-platform)
 */
class EventsViewModel(
    private val eventRepository: EventRepository,
    private val authRepository: AuthRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(EventsUiState())
    val uiState: StateFlow<EventsUiState> = _uiState.asStateFlow()
    
    // Exception handler to prevent crashes on iOS
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("⚠️ Coroutine exception: ${throwable.message}")
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            error = throwable.message ?: "An error occurred"
        )
    }
    
    init {
        loadEvents()
    }
    
    fun loadEvents() {
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            
            try {
                when (val result = eventRepository.getEvents()) {
                    is ApiResult.Success -> {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            events = result.data
                        )
                    }
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = result.message ?: "Failed to load events"
                        )
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ loadEvents error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Failed to load events"
                )
            }
        }
    }
    
    fun selectEvent(event: Event) {
        _uiState.value = _uiState.value.copy(selectedEvent = event)
    }
    
    fun logout() {
        viewModelScope.launch(exceptionHandler) {
            try {
                authRepository.logout()
            } catch (e: Exception) {
                println("⚠️ logout error: ${e.message}")
            }
            _uiState.value = EventsUiState() // Reset state
        }
    }
    
    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}

data class EventsUiState(
    val isLoading: Boolean = false,
    val events: List<Event> = emptyList(),
    val selectedEvent: Event? = null,
    val error: String? = null
)
