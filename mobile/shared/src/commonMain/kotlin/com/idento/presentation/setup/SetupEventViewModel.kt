package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.CreateProvisioningTokenResponseDto
import com.idento.data.model.Event
import com.idento.data.model.ProvisionStationResponseDto
import com.idento.data.network.ApiResult
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SetupEventUiState(
    val events: List<Event> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val provisioned: Boolean = false,
)

/**
 * Narrow, single-method seams onto `EventRepository`/`StationRepository`/`AuthRepository` (see
 * `di/ViewModelModule.kt`, where the real repositories are adapted into these via method
 * references) — same rationale as `SetupLoginViewModel.kt`'s kdoc: those repositories are plain
 * (non-open) classes wrapping platform `expect`/`actual` singletons (Ktor engine, `SecureStore`,
 * `DataStoreFactory`) that cannot be constructed or subclassed from `commonTest`. [StationProvisioner]
 * and [AuthTokenSaver] are the exact same seams [SetupLoginViewModel] already declares (same
 * package, same shape) — reused here rather than duplicated, since this screen performs the
 * identical provisionStation + persist-staffJwt round trip for the manager path.
 */
fun interface EventLister {
    suspend fun getEvents(): ApiResult<List<Event>>
}

fun interface ProvisioningTokenMinter {
    suspend fun createProvisioningToken(eventId: String, staffUserId: String): ApiResult<CreateProvisioningTokenResponseDto>
}

fun interface CurrentUserIdProvider {
    suspend fun getUserId(): String?
}

/**
 * Second screen of the setup wizard — manager path only (Task 3's `NextStep.Event`). The QR path
 * never reaches this screen: the event is already fixed by the scanned token.
 *
 * Selecting an event performs the SAME provisioning round trip the QR path's token does: mint a
 * provisioning token for the now-known event + the signed-in manager's own user id
 * ([CurrentUserIdProvider], backed by `AuthRepository.getUserId()` — reliable here because this
 * screen is only ever reached after `SetupLoginViewModel.signInAsManager()`'s
 * `AuthRepository.login()` call already persisted it), then immediately redeems that token via
 * [StationProvisioner]. Once redeemed, both paths have converged: `draft.eventId`/`eventName` set,
 * `deviceNumber`/`staffName` known, and the station-scoped `staffJwt` persisted in place of the
 * manager's own session token — from here on the app talks to the backend as this station, not as
 * the signed-in manager.
 */
class SetupEventViewModel(
    private val eventLister: EventLister,
    private val provisioningTokenMinter: ProvisioningTokenMinter,
    private val stationProvisioner: StationProvisioner,
    private val authTokenSaver: AuthTokenSaver,
    private val currentUserIdProvider: CurrentUserIdProvider,
    private val draft: SetupWizardDraft,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupEventUiState())
    val uiState: StateFlow<SetupEventUiState> = _uiState.asStateFlow()

    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(isLoading = false, error = throwable.message ?: "Unknown error")
    }

    fun loadEvents() {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            when (val result = eventLister.getEvents()) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, events = result.data)
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.message ?: "Could not load events")
                is ApiResult.Loading -> {}
            }
        }
    }

    fun onEventSelected(event: Event) {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            val staffUserId = currentUserIdProvider.getUserId()
            if (staffUserId == null) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "Not signed in")
                return@launch
            }
            when (val tokenResult = provisioningTokenMinter.createProvisioningToken(event.id, staffUserId)) {
                is ApiResult.Success -> redeemToken(tokenResult.data.token)
                is ApiResult.Error ->
                    _uiState.value = _uiState.value.copy(isLoading = false, error = tokenResult.message ?: "Could not provision this station")
                is ApiResult.Loading -> {}
            }
        }
    }

    private suspend fun redeemToken(token: String) {
        when (val result = stationProvisioner.provisionStation(token, deviceInfo = null)) {
            is ApiResult.Success -> applyProvisioning(result.data)
            is ApiResult.Error ->
                _uiState.value = _uiState.value.copy(isLoading = false, error = result.message ?: "Could not provision this station")
            is ApiResult.Loading -> {}
        }
    }

    private suspend fun applyProvisioning(response: ProvisionStationResponseDto) {
        // Same reasoning as SetupLoginViewModel.applyProvisioning: this station-scoped staffJwt
        // replaces whatever session token is currently persisted (the manager's own, in this
        // path) — persisting it is this ViewModel's job, provisionStation has no side effects.
        val tokenSaved = authTokenSaver.saveAuthToken(response.staffJwt)
        if (!tokenSaved) {
            _uiState.value = _uiState.value.copy(isLoading = false, error = "Could not securely store credentials")
            return
        }
        draft.eventId = response.stationConfig.eventId
        draft.eventName = response.stationConfig.eventName
        draft.deviceNumber = response.deviceNumber
        draft.staffName = response.stationConfig.staffName
        _uiState.value = _uiState.value.copy(isLoading = false, provisioned = true)
    }
}
