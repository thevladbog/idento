package com.idento.presentation.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val isLoginSuccessful: Boolean = false
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()
    
    fun onEmailChanged(email: String) {
        _uiState.value = _uiState.value.copy(
            email = email,
            errorMessage = null
        )
    }
    
    fun onPasswordChanged(password: String) {
        _uiState.value = _uiState.value.copy(
            password = password,
            errorMessage = null
        )
    }
    
    fun login() {
        val email = _uiState.value.email.trim()
        val password = _uiState.value.password
        
        if (email.isEmpty() || password.isEmpty()) {
            _uiState.value = _uiState.value.copy(
                errorMessage = "Please enter email and password"
            )
            return
        }
        
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                errorMessage = null
            )
            
            authRepository.login(email, password)
                .onSuccess {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isLoginSuccessful = true
                    )
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.message ?: "Login failed"
                    )
                }
        }
    }
    
    fun clearError() {
        _uiState.value = _uiState.value.copy(errorMessage = null)
    }
}
