package com.idento.presentation.template

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.network.ApiResult
import com.idento.data.repository.EventRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel for Template Editor Screen
 */
class TemplateEditorViewModel(
    private val eventRepository: EventRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(TemplateEditorUiState())
    val uiState: StateFlow<TemplateEditorUiState> = _uiState.asStateFlow()
    
    private var currentEventId: String = ""
    private var originalTemplate: String = ""
    
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("⚠️ TemplateEditorViewModel exception: ${throwable.message}")
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            isSaving = false,
            error = throwable.message ?: "An error occurred"
        )
    }
    
    fun loadTemplate(eventId: String) {
        currentEventId = eventId
        
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            
            try {
                when (val result = eventRepository.getBadgeTemplate(eventId)) {
                    is ApiResult.Success -> {
                        val template = result.data ?: getDefaultTemplate()
                        originalTemplate = template
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            templateCode = template,
                            hasChanges = false
                        )
                    }
                    is ApiResult.Error -> {
                        // Use default template if not found
                        val defaultTemplate = getDefaultTemplate()
                        originalTemplate = defaultTemplate
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            templateCode = defaultTemplate,
                            hasChanges = false
                        )
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ loadTemplate error: ${e.message}")
                val defaultTemplate = getDefaultTemplate()
                originalTemplate = defaultTemplate
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    templateCode = defaultTemplate,
                    hasChanges = false
                )
            }
        }
    }
    
    fun onTemplateChanged(code: String) {
        _uiState.value = _uiState.value.copy(
            templateCode = code,
            hasChanges = code != originalTemplate,
            error = null,
            successMessage = null
        )
    }
    
    fun insertPlaceholder(placeholder: String) {
        val currentCode = _uiState.value.templateCode
        val newCode = currentCode + placeholder
        onTemplateChanged(newCode)
    }
    
    fun saveTemplate() {
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isSaving = true, error = null, successMessage = null)
            
            try {
                // TODO: Implement save API call
                // For now, simulate save
                delay(1000)
                
                originalTemplate = _uiState.value.templateCode
                _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    hasChanges = false,
                    successMessage = "Template saved successfully"
                )
                
                // Clear success message after delay
                delay(3000)
                _uiState.value = _uiState.value.copy(successMessage = null)
                
            } catch (e: Exception) {
                println("⚠️ saveTemplate error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    error = e.message ?: "Failed to save template"
                )
            }
        }
    }
    
    private fun getDefaultTemplate(): String {
        return """^XA
^FO50,50^A0N,40,40^FD{{name}}^FS
^FO50,110^A0N,25,25^FD{{company}}^FS
^FO50,150^A0N,20,20^FD{{position}}^FS
^FO50,200^BQN,2,5^FDQA,{{code}}^FS
^XZ"""
    }
}

data class TemplateEditorUiState(
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val templateCode: String = "",
    val hasChanges: Boolean = false,
    val error: String? = null,
    val successMessage: String? = null
)
