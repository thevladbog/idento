package com.idento.presentation.template

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Attendee
import com.idento.data.model.DisplayTemplate
import com.idento.data.model.PlaceholderInfo
import com.idento.data.network.EventApiService
import com.idento.data.preferences.DisplayTemplatePreferences
import com.idento.data.repository.AttendeeRepository
import com.idento.data.network.ApiResult
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * ViewModel for Display Template Editor
 */
class DisplayTemplateViewModel(
    private val displayTemplatePreferences: DisplayTemplatePreferences,
    private val attendeeRepository: AttendeeRepository,
    private val eventApiService: EventApiService
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(DisplayTemplateUiState())
    val uiState: StateFlow<DisplayTemplateUiState> = _uiState.asStateFlow()
    
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("⚠️ DisplayTemplate exception: ${throwable.message}")
        _uiState.value = _uiState.value.copy(
            errorMessage = throwable.message ?: "An error occurred"
        )
    }
    
    private var eventId: String? = null
    
    fun setEventId(eventId: String) {
        this.eventId = eventId
        loadTemplate()
        loadSampleAttendee()
        loadCustomFields()
    }
    
    private fun loadTemplate() {
        val eventId = this.eventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            try {
                val template = displayTemplatePreferences.getTemplateOrDefault(eventId).first()
                _uiState.value = _uiState.value.copy(
                    template = template.template,
                    originalTemplate = template.template,
                    isLoading = false
                )
                updatePreview()
            } catch (e: Exception) {
                println("⚠️ loadTemplate error: ${e.message}")
                val defaultTemplate = DisplayTemplate.default(eventId)
                _uiState.value = _uiState.value.copy(
                    template = defaultTemplate.template,
                    originalTemplate = defaultTemplate.template,
                    isLoading = false
                )
                updatePreview()
            }
        }
    }
    
    private fun loadSampleAttendee() {
        val eventId = this.eventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            try {
                when (val result = attendeeRepository.getAttendees(eventId)) {
                    is ApiResult.Success -> {
                        val sample = result.data.firstOrNull() ?: createSampleAttendee(eventId)
                        _uiState.value = _uiState.value.copy(sampleAttendee = sample)
                        updatePreview()
                    }
                    else -> {
                        _uiState.value = _uiState.value.copy(
                            sampleAttendee = createSampleAttendee(eventId)
                        )
                        updatePreview()
                    }
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    sampleAttendee = createSampleAttendee(eventId)
                )
                updatePreview()
            }
        }
    }
    
    private fun loadCustomFields() {
        val eventId = this.eventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            try {
                when (val result = attendeeRepository.getAttendees(eventId)) {
                    is ApiResult.Success -> {
                        // Collect all custom field keys from attendees
                        val customFieldKeys = result.data
                            .flatMap { it.customFields.keys }
                            .distinct()
                            .map { key ->
                                PlaceholderInfo(
                                    key = key,
                                    label = key.replace("_", " ").replaceFirstChar { it.uppercase() },
                                    placeholder = "{{custom.$key}}"
                                )
                            }
                        
                        _uiState.value = _uiState.value.copy(
                            customPlaceholders = customFieldKeys
                        )
                    }
                    else -> {}
                }
            } catch (e: Exception) {
                // Ignore - custom fields are optional
            }
        }
    }
    
    private fun createSampleAttendee(eventId: String) = Attendee(
        id = "sample-id",
        eventId = eventId,
        code = "ABC-12345",
        firstName = "John",
        lastName = "Doe",
        email = "john.doe@example.com",
        company = "Acme Corporation",
        position = "Software Engineer",
        phone = "+1 555 123 4567",
        customFields = mapOf(
            "ticket_type" to "VIP",
            "table_number" to "42"
        )
    )
    
    fun onTemplateChanged(template: String) {
        _uiState.value = _uiState.value.copy(
            template = template,
            hasChanges = template != _uiState.value.originalTemplate
        )
        updatePreview()
    }
    
    fun insertPlaceholder(placeholder: String) {
        val currentTemplate = _uiState.value.template
        val newTemplate = currentTemplate + placeholder
        onTemplateChanged(newTemplate)
    }
    
    private fun updatePreview() {
        val template = _uiState.value.template
        val attendee = _uiState.value.sampleAttendee ?: return
        val eventId = this.eventId ?: return
        
        try {
            val displayTemplate = DisplayTemplate(
                eventId = eventId,
                template = template
            )
            val rendered = displayTemplate.render(attendee)
            _uiState.value = _uiState.value.copy(
                preview = rendered,
                previewError = null
            )
        } catch (e: Exception) {
            _uiState.value = _uiState.value.copy(
                previewError = "Template error: ${e.message}"
            )
        }
    }
    
    fun saveTemplate() {
        val eventId = this.eventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isSaving = true)
            
            try {
                val template = DisplayTemplate(
                    eventId = eventId,
                    template = _uiState.value.template,
                    name = "Custom"
                )
                displayTemplatePreferences.saveTemplate(template)
                
                _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    hasChanges = false,
                    originalTemplate = _uiState.value.template,
                    successMessage = "Template saved"
                )
                
                kotlinx.coroutines.delay(2000)
                _uiState.value = _uiState.value.copy(successMessage = null)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    errorMessage = "Failed to save: ${e.message}"
                )
            }
        }
    }
    
    fun resetToDefault() {
        val eventId = this.eventId ?: return
        val defaultTemplate = DisplayTemplate.default(eventId)
        onTemplateChanged(defaultTemplate.template)
    }
    
    /**
     * Fetch default template from server (admin panel settings)
     */
    fun fetchDefaultFromServer() {
        val eventId = this.eventId ?: return
        
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isFetchingFromServer = true)
            
            try {
                val result = eventApiService.getDisplayTemplate(eventId)
                result.fold(
                    onSuccess = { serverTemplate ->
                        if (serverTemplate != null) {
                            _uiState.value = _uiState.value.copy(
                                template = serverTemplate.template,
                                hasChanges = serverTemplate.template != _uiState.value.originalTemplate,
                                isFetchingFromServer = false,
                                successMessage = "Template loaded from server"
                            )
                            updatePreview()
                            
                            kotlinx.coroutines.delay(2000)
                            _uiState.value = _uiState.value.copy(successMessage = null)
                        } else {
                            _uiState.value = _uiState.value.copy(
                                isFetchingFromServer = false,
                                errorMessage = "No template configured on server. Using default."
                            )
                            resetToDefault()
                            
                            kotlinx.coroutines.delay(3000)
                            _uiState.value = _uiState.value.copy(errorMessage = null)
                        }
                    },
                    onFailure = { error ->
                        _uiState.value = _uiState.value.copy(
                            isFetchingFromServer = false,
                            errorMessage = "Failed to fetch: ${error.message}"
                        )
                    }
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isFetchingFromServer = false,
                    errorMessage = "Failed to fetch: ${e.message}"
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
}

data class DisplayTemplateUiState(
    val isLoading: Boolean = true,
    val isSaving: Boolean = false,
    val isFetchingFromServer: Boolean = false,
    val template: String = "",
    val originalTemplate: String = "",
    val preview: String = "",
    val previewError: String? = null,
    val hasChanges: Boolean = false,
    val sampleAttendee: Attendee? = null,
    val standardPlaceholders: List<PlaceholderInfo> = DisplayTemplate.standardPlaceholders,
    val customPlaceholders: List<PlaceholderInfo> = emptyList(),
    val successMessage: String? = null,
    val errorMessage: String? = null
)
