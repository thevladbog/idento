package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.LoginResponse
import com.idento.data.model.ProvisionStationResponseDto
import com.idento.data.network.ApiResult
import com.idento.platform.camera.CameraService
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Where [SetupLoginScreen] navigates once a login/provisioning attempt succeeds.
 * [Mode] = QR path, the event is already fixed by the scanned token, so the Event step is
 * skipped entirely. [Event] = manager path, the event still needs to be picked (Task 4).
 */
enum class NextStep { Event, Mode }

data class SetupLoginUiState(
    val isManagerMode: Boolean = false,
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val nextStep: NextStep? = null,
)

/**
 * Narrow, single-method seams onto `StationRepository`/`AuthRepository`/`AuthPreferences`
 * (see `di/ViewModelModule.kt`, where the real repositories/preferences are adapted into these
 * via method references). `StationRepository`/`AuthRepository`/`AuthPreferences` are plain
 * (non-open) classes wrapping platform `expect`/`actual` singletons (`ApiClient`'s Ktor engine,
 * `SecureStore`, `DataStoreFactory`) that cannot be constructed or subclassed from `commonTest`
 * — going through these `fun interface` seams instead is what keeps [SetupLoginViewModel] unit
 * testable with plain local fakes, without touching those unrelated production classes.
 */
fun interface StationProvisioner {
    suspend fun provisionStation(token: String, deviceInfo: Map<String, String>?): ApiResult<ProvisionStationResponseDto>
}

fun interface ManagerAuthenticator {
    suspend fun login(email: String, password: String): ApiResult<LoginResponse>
}

fun interface AuthTokenSaver {
    suspend fun saveAuthToken(token: String): Boolean
}

/**
 * First screen of the setup wizard. Two convergent paths, both ending with an auth token
 * persisted and the wizard draft (Task 1) populated enough to move on:
 *  - QR path (default): [onQrTokenScanned] provisions the station directly for the event fixed
 *    by the scanned token, then jumps straight to [NextStep.Mode].
 *  - Manager path (toggle): [signInAsManager] just signs the manager in; the event is still
 *    unknown, so the next screen (Task 4) picks it and provisions the station itself.
 *
 * [cameraService] is nullable purely so this ViewModel stays unit-testable: `CameraService` is
 * an `expect class` backed by a platform actual (e.g. Android's needs a `Context`) that cannot
 * be constructed or faked from `commonTest`, so tests that never exercise [startQrScan] simply
 * omit it — production Koin wiring always supplies the real instance.
 */
class SetupLoginViewModel(
    private val cameraService: CameraService?,
    private val stationProvisioner: StationProvisioner,
    private val managerAuthenticator: ManagerAuthenticator,
    private val authTokenSaver: AuthTokenSaver,
    private val draft: SetupWizardDraft,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupLoginUiState())
    val uiState: StateFlow<SetupLoginUiState> = _uiState.asStateFlow()

    // Prevents an unhandled exception (e.g. a network hiccup mid-scan) from crashing the app;
    // surfaces it as a normal error state instead.
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(isLoading = false, error = throwable.message ?: "Unknown error")
    }

    init {
        // Starting the wizard over always starts from a clean draft.
        draft.reset()
    }

    /** Starts the camera QR scan. No-op if there's no camera or no permission for it. */
    fun startQrScan() {
        val camera = cameraService ?: return
        if (!camera.hasCameraPermission()) return
        viewModelScope.launch(exceptionHandler) {
            camera.startScanning().collect { token ->
                camera.stopScanning()
                onQrTokenScanned(token)
            }
        }
    }

    fun toggleManagerMode() {
        _uiState.value = _uiState.value.copy(isManagerMode = !_uiState.value.isManagerMode, error = null)
    }

    fun onEmailChanged(value: String) {
        _uiState.value = _uiState.value.copy(email = value, error = null)
    }

    fun onPasswordChanged(value: String) {
        _uiState.value = _uiState.value.copy(password = value, error = null)
    }

    fun onQrTokenScanned(token: String) {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            when (val result = stationProvisioner.provisionStation(token, deviceInfo = null)) {
                is ApiResult.Success -> applyProvisioning(result.data)
                is ApiResult.Error ->
                    _uiState.value = _uiState.value.copy(isLoading = false, error = result.message ?: "Could not set up this station")
                is ApiResult.Loading -> {}
            }
        }
    }

    fun signInAsManager() {
        val email = _uiState.value.email
        val password = _uiState.value.password
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            // ManagerAuthenticator (AuthRepository.login in production) already persists the
            // token — and best-effort user info — on success, so there's nothing left to do
            // here besides moving the wizard on to the Event step.
            when (val result = managerAuthenticator.login(email, password)) {
                is ApiResult.Success ->
                    _uiState.value = _uiState.value.copy(isLoading = false, nextStep = NextStep.Event)
                is ApiResult.Error ->
                    _uiState.value = _uiState.value.copy(isLoading = false, error = result.message ?: "Sign-in failed")
                is ApiResult.Loading -> {}
            }
        }
    }

    private suspend fun applyProvisioning(response: ProvisionStationResponseDto) {
        // Unlike the manager path's login, station provisioning has no side effects of its
        // own — persisting the staff JWT is this ViewModel's job.
        val tokenSaved = authTokenSaver.saveAuthToken(response.staffJwt)
        if (!tokenSaved) {
            _uiState.value = _uiState.value.copy(isLoading = false, error = "Could not securely store credentials")
            return
        }
        draft.eventId = response.stationConfig.eventId
        draft.eventName = response.stationConfig.eventName
        draft.deviceNumber = response.deviceNumber
        draft.staffName = response.stationConfig.staffName
        _uiState.value = _uiState.value.copy(isLoading = false, nextStep = NextStep.Mode)
    }
}
