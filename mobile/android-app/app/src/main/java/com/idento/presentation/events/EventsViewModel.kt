package com.idento.presentation.events

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Event
import com.idento.data.repository.AuthRepository
import com.idento.data.repository.EventRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class EventsUiState(
    val events: List<Event> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val userEmail: String = ""
)

@HiltViewModel
class EventsViewModel @Inject constructor(
    private val eventRepository: EventRepository,
    private val authRepository: AuthRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(EventsUiState())
    val uiState: StateFlow<EventsUiState> = _uiState.asStateFlow()
    
    init {
        loadEvents()
        loadUserInfo()
    }
    
    private fun loadUserInfo() {
        viewModelScope.launch {
            authRepository.userEmail.collect { email ->
                _uiState.value = _uiState.value.copy(userEmail = email ?: "")
            }
        }
    }
    
    fun loadEvents() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                errorMessage = null
            )
            
            eventRepository.getEvents()
                .onSuccess { events ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        events = events
                    )
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.message ?: "Failed to load events"
                    )
                }
        }
    }
    
    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
        }
    }
}
