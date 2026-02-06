package com.idento.presentation.template

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Attendee
import com.idento.data.preferences.TemplatePreferences
import com.idento.data.repository.EventRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class TemplateType {
    SUCCESS_SCREEN,
    BADGE_PRINT
}

data class TemplateEditorUiState(
    val eventId: String = "",
    val eventName: String = "",
    val templateType: TemplateType = TemplateType.SUCCESS_SCREEN,
    val template: String = "",
    val serverTemplate: String? = null,
    val isModified: Boolean = false,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val successMessage: String? = null,
    val previewData: Attendee? = null
)

@HiltViewModel
class TemplateEditorViewModel @Inject constructor(
    private val eventRepository: EventRepository,
    private val templatePreferences: TemplatePreferences,
    savedStateHandle: SavedStateHandle
) : ViewModel() {
    
    private val eventId: String = savedStateHandle.get<String>("eventId") ?: ""
    private val eventName: String = savedStateHandle.get<String>("eventName") ?: ""
    private val templateTypeStr: String = savedStateHandle.get<String>("templateType") ?: "success"
    
    private val _uiState = MutableStateFlow(TemplateEditorUiState(
        eventId = eventId,
        eventName = eventName,
        templateType = if (templateTypeStr == "badge") TemplateType.BADGE_PRINT else TemplateType.SUCCESS_SCREEN
    ))
    val uiState: StateFlow<TemplateEditorUiState> = _uiState.asStateFlow()
    
    init {
        loadTemplate()
        loadPreviewData()
    }
    
    private fun loadTemplate() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            
            try {
                // Загружаем события чтобы получить серверный шаблон
                val events = eventRepository.getEvents().getOrNull() ?: emptyList()
                val event = events.find { it.id == eventId }
                
                val serverTemplate = when (_uiState.value.templateType) {
                    TemplateType.SUCCESS_SCREEN -> event?.getSuccessScreenTemplate()
                    TemplateType.BADGE_PRINT -> event?.getBadgeTemplate()
                }
                
                // Загружаем локальный шаблон
                val localTemplate = when (_uiState.value.templateType) {
                    TemplateType.SUCCESS_SCREEN -> 
                        templatePreferences.getSuccessScreenTemplate(eventId).first()
                    TemplateType.BADGE_PRINT -> 
                        templatePreferences.getBadgeTemplate(eventId).first()
                }
                
                // Приоритет: локальный (если был изменен) > серверный > дефолтный
                val hasLocalChanges = localTemplate != null && localTemplate != serverTemplate
                val currentTemplate = if (hasLocalChanges) {
                    localTemplate!!
                } else {
                    serverTemplate ?: getDefaultTemplate()
                }
                
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    template = currentTemplate,
                    serverTemplate = serverTemplate,
                    isModified = hasLocalChanges
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = "Failed to load template: ${e.message}",
                    template = getDefaultTemplate()
                )
            }
        }
    }
    
    private fun loadPreviewData() {
        viewModelScope.launch {
            try {
                // Загружаем первого участника для preview
                val attendees = eventRepository.getAttendees(eventId).getOrNull()
                val previewAttendee = attendees?.firstOrNull() ?: createMockAttendee()
                
                _uiState.value = _uiState.value.copy(previewData = previewAttendee)
            } catch (e: Exception) {
                // Используем mock данные
                _uiState.value = _uiState.value.copy(previewData = createMockAttendee())
            }
        }
    }
    
    fun onTemplateChange(newTemplate: String) {
        _uiState.value = _uiState.value.copy(
            template = newTemplate,
            isModified = newTemplate != _uiState.value.serverTemplate
        )
    }
    
    fun saveTemplate() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            
            try {
                when (_uiState.value.templateType) {
                    TemplateType.SUCCESS_SCREEN -> {
                        templatePreferences.saveSuccessScreenTemplate(
                            eventId,
                            _uiState.value.template
                        )
                    }
                    TemplateType.BADGE_PRINT -> {
                        templatePreferences.saveBadgeTemplate(
                            eventId,
                            _uiState.value.template
                        )
                    }
                }
                
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    successMessage = "Шаблон сохранен локально",
                    isModified = _uiState.value.template != _uiState.value.serverTemplate
                )
                
                // Очищаем сообщение через 2 секунды
                kotlinx.coroutines.delay(2000)
                _uiState.value = _uiState.value.copy(successMessage = null)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = "Failed to save template: ${e.message}"
                )
            }
        }
    }
    
    fun resetToServer() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            
            try {
                // Удаляем локальный шаблон
                when (_uiState.value.templateType) {
                    TemplateType.SUCCESS_SCREEN -> {
                        templatePreferences.clearSuccessScreenTemplate(eventId)
                    }
                    TemplateType.BADGE_PRINT -> {
                        templatePreferences.clearBadgeTemplate(eventId)
                    }
                }
                
                // Восстанавливаем серверный или дефолтный
                val template = _uiState.value.serverTemplate ?: getDefaultTemplate()
                
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    template = template,
                    isModified = false,
                    successMessage = "Восстановлен шаблон по умолчанию"
                )
                
                kotlinx.coroutines.delay(2000)
                _uiState.value = _uiState.value.copy(successMessage = null)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = "Failed to reset template: ${e.message}"
                )
            }
        }
    }
    
    fun clearError() {
        _uiState.value = _uiState.value.copy(errorMessage = null)
    }
    
    private fun getDefaultTemplate(): String {
        return when (_uiState.value.templateType) {
            TemplateType.SUCCESS_SCREEN -> DEFAULT_SUCCESS_TEMPLATE
            TemplateType.BADGE_PRINT -> DEFAULT_BADGE_TEMPLATE
        }
    }
    
    private fun createMockAttendee(): Attendee {
        return Attendee(
            id = "mock-id",
            eventId = eventId,
            firstName = "John",
            lastName = "Doe",
            email = "john.doe@example.com",
            company = "Tech Corp",
            position = "Software Engineer",
            code = "ABC123",
            checkinStatus = true,
            checkedInByEmail = "admin@test.com",
            printedCount = 0,
            customFields = null,
            createdAt = "",
            updatedAt = ""
        )
    }
    
    companion object {
        private const val DEFAULT_SUCCESS_TEMPLATE = """# Welcome!

**{{first_name}} {{last_name}}**

You're registered as **{{position}}** from **{{company}}**.

Thank you for attending!"""
        
        private const val DEFAULT_BADGE_TEMPLATE = """^XA
^PW812
^FO50,50^A0N,80,80^FD{{first_name}} {{last_name}}^FS
^FO50,150^A0N,50,50^FD{{company}}^FS
^FO50,220^A0N,40,40^FD{{position}}^FS
^FO600,900^BQN,2,6^FDQA,{{code}}^FS
^XZ"""
    }
}
