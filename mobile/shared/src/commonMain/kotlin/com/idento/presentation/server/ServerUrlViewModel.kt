package com.idento.presentation.server

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.network.ServerUrlInvalidReason
import com.idento.data.network.ServerUrlValidation
import com.idento.data.network.validateServerUrl
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Narrow seam: probes a candidate server URL and reports its `/api/instance` `mode`, or fails.
 *
 * Deliberately a plain class wrapping the lambda rather than a `fun interface` (SAM). A `fun
 * interface` whose single abstract method is `suspend fun check(url: String): Result<String>`
 * hits a Kotlin/JVM codegen bug when SAM-converting a `suspend (String) -> Result<String>`
 * lambda: `Result<T>` gets special ABI treatment for ordinary suspend *function* return types
 * (the coroutines machinery unwraps/rewraps it), but that special-casing doesn't line up with
 * the SAM-adapter bridge method, producing a `ClassCastException: class kotlin.Result cannot be
 * cast to class java.lang.String` at runtime on the success path (see Step 5 of this task's
 * brief, where the literal `fun interface` version failed `testConnection_success_setsConnectedMode`
 * this exact way). A plain class constructor call has no such bridge and isn't affected.
 */
class ServerConnectionChecker(private val block: suspend (String) -> Result<String>) {
    suspend fun check(url: String): Result<String> = block(url)
}

/**
 * Narrow seam bundling the two effects a successful Save performs: persist the new URL, and
 * clear whatever station/session state belonged to the *previous* server (a different server is
 * plausibly a different tenant/event — see this task's ViewModel doc below for why both always
 * fire together, never just one).
 */
class ServerUrlSaveGateway(
    private val save: suspend (String) -> Unit,
    private val clearSession: suspend () -> Unit,
) {
    suspend fun saveAndClearSession(url: String) {
        save(url)
        clearSession()
    }
}

sealed class ConnectionCheckState {
    data object Idle : ConnectionCheckState()
    data object Checking : ConnectionCheckState()
    data class Success(val mode: String) : ConnectionCheckState()
    data class Failed(val message: String) : ConnectionCheckState()
}

data class ServerUrlUiState(
    val url: String = "",
    val validationError: ServerUrlInvalidReason? = null,
    val connectionCheckState: ConnectionCheckState = ConnectionCheckState.Idle,
    val isSaving: Boolean = false,
)

/**
 * Server URL screen's ViewModel. `currentUrlProvider` seeds the field with whatever URL is
 * currently effective (a prior custom save, or null meaning "using the default") — a lambda
 * rather than injecting `NetworkPreferences` directly, following this codebase's narrow-seam
 * convention (see `di/ViewModelModule.kt` for the pattern this mirrors).
 *
 * Save always clears station config + auth (via [ServerUrlSaveGateway]) regardless of entry
 * point (first-run "Advanced" link vs. mid-session Settings row) — a different server is
 * plausibly a different tenant/event, so keeping the old station config or session would either
 * mismatch station data during handoff or point a live session at the wrong server. On the
 * first-run path there's nothing to clear yet; clearing there is a harmless no-op, not a special
 * case to branch on.
 */
class ServerUrlViewModel(
    private val currentUrlProvider: () -> String?,
    private val connectionChecker: ServerConnectionChecker,
    private val onSave: ServerUrlSaveGateway,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ServerUrlUiState(url = currentUrlProvider().orEmpty()))
    val uiState: StateFlow<ServerUrlUiState> = _uiState.asStateFlow()

    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(
            isSaving = false,
            connectionCheckState = ConnectionCheckState.Failed(throwable.message ?: "Unknown error"),
        )
    }

    fun onUrlChanged(value: String) {
        _uiState.value = _uiState.value.copy(
            url = value,
            validationError = null,
            connectionCheckState = ConnectionCheckState.Idle,
        )
    }

    fun testConnection() {
        val url = _uiState.value.url
        when (val validation = validateServerUrl(url)) {
            is ServerUrlValidation.Invalid -> {
                _uiState.value = _uiState.value.copy(validationError = validation.reason)
                return
            }
            ServerUrlValidation.Valid -> {}
        }
        _uiState.value = _uiState.value.copy(
            validationError = null,
            connectionCheckState = ConnectionCheckState.Checking,
        )
        viewModelScope.launch(exceptionHandler) {
            val result = connectionChecker.check(url)
            _uiState.value = _uiState.value.copy(
                connectionCheckState = result.fold(
                    onSuccess = { mode -> ConnectionCheckState.Success(mode) },
                    onFailure = { e -> ConnectionCheckState.Failed(e.message ?: "Unknown error") },
                ),
            )
        }
    }

    /** [onSaved] fires only after both the save and the session clear complete. */
    fun save(onSaved: () -> Unit = {}) {
        val url = _uiState.value.url
        when (val validation = validateServerUrl(url)) {
            is ServerUrlValidation.Invalid -> {
                _uiState.value = _uiState.value.copy(validationError = validation.reason)
                return
            }
            ServerUrlValidation.Valid -> {}
        }
        _uiState.value = _uiState.value.copy(validationError = null, isSaving = true)
        viewModelScope.launch(exceptionHandler) {
            onSave.saveAndClearSession(url)
            _uiState.value = _uiState.value.copy(isSaving = false)
            onSaved()
        }
    }
}
