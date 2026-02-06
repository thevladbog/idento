package com.idento.presentation.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.network.ApiResult
import com.idento.data.repository.AuthRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Login ViewModel (Cross-platform)
 * Migrated from Hilt to Koin
 */
class LoginViewModel(
    private val authRepository: AuthRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()
    
    // Exception handler to prevent crashes on iOS
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("⚠️ Login coroutine exception: ${throwable.message}")
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            error = throwable.message ?: "An error occurred"
        )
    }
    
    fun onEmailChanged(email: String) {
        _uiState.value = _uiState.value.copy(
            email = email,
            emailError = null
        )
    }
    
    fun onPasswordChanged(password: String) {
        _uiState.value = _uiState.value.copy(
            password = password,
            passwordError = null
        )
    }
    
    fun login() {
        val email = _uiState.value.email
        val password = _uiState.value.password
        
        // Validation
        if (email.isBlank()) {
            _uiState.value = _uiState.value.copy(
                emailError = "Email is required"
            )
            return
        }
        
        if (password.isBlank()) {
            _uiState.value = _uiState.value.copy(
                passwordError = "Password is required"
            )
            return
        }
        
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            
            try {
                when (val result = authRepository.login(email, password)) {
                    is ApiResult.Success -> {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            isLoggedIn = true
                        )
                    }
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = result.message ?: "Login failed"
                        )
                    }
                    is ApiResult.Loading -> {
                        // Already set loading = true
                    }
                }
            } catch (e: Exception) {
                println("⚠️ login error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Login failed"
                )
            }
        }
    }
    
    fun loginWithQR(token: String) {
        viewModelScope.launch(exceptionHandler) {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            
            try {
                when (val result = authRepository.loginWithQR(token)) {
                    is ApiResult.Success -> {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            isLoggedIn = true
                        )
                    }
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = result.message ?: "QR login failed"
                        )
                    }
                    is ApiResult.Loading -> {}
                }
            } catch (e: Exception) {
                println("⚠️ loginWithQR error: ${e.message}")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "QR login failed"
                )
            }
        }
    }
    
    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val emailError: String? = null,
    val passwordError: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val isLoggedIn: Boolean = false
)
