package com.idento.presentation.attendees

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Attendee
import com.idento.data.network.ApiResult
import com.idento.data.repository.AttendeeRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel for Attendees List Screen
 */
class AttendeesListViewModel(
    private val attendeeRepository: AttendeeRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(AttendeesListUiState())
    val uiState: StateFlow<AttendeesListUiState> = _uiState.asStateFlow()
    
    private var allAttendees: List<Attendee> = emptyList()
    private var currentFilter: AttendeeFilter = AttendeeFilter.ALL
    
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("⚠️ AttendeesListViewModel exception: ${throwable.message}")
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            error = throwable.message ?: "An error occurred"
        )
    }
    
    fun loadAttendees(eventId: String) {
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            
            try {
                when (val result = attendeeRepository.getAttendees(eventId)) {
                    is ApiResult.Success -> {
                        allAttendees = result.data
                        applyFilters()
                    }
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = result.message ?: "Failed to load attendees"
                        )
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ loadAttendees error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Failed to load attendees"
                )
            }
        }
    }
    
    fun onSearchQueryChanged(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
        applyFilters()
    }
    
    fun setFilter(filter: AttendeeFilter) {
        currentFilter = filter
        applyFilters()
    }
    
    private fun applyFilters() {
        val query = _uiState.value.searchQuery.lowercase()
        
        val filtered = allAttendees.filter { attendee ->
            // Apply search query
            val matchesQuery = query.isEmpty() || 
                attendee.fullName.lowercase().contains(query) ||
                attendee.email?.lowercase()?.contains(query) == true ||
                attendee.code.lowercase().contains(query) ||
                attendee.company?.lowercase()?.contains(query) == true
            
            // Apply filter
            val matchesFilter = when (currentFilter) {
                AttendeeFilter.ALL -> true
                AttendeeFilter.CHECKED_IN -> attendee.isCheckedIn
                AttendeeFilter.NOT_CHECKED_IN -> !attendee.isCheckedIn
            }
            
            matchesQuery && matchesFilter
        }
        
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            filteredAttendees = filtered,
            totalCount = allAttendees.size,
            checkedInCount = allAttendees.count { it.isCheckedIn }
        )
    }
}

data class AttendeesListUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val searchQuery: String = "",
    val filteredAttendees: List<Attendee> = emptyList(),
    val totalCount: Int = 0,
    val checkedInCount: Int = 0
)
