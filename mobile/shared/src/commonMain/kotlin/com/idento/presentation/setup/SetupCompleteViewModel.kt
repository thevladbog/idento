package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.StationConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SetupCompleteUiState(val stationConfig: StationConfig? = null, val exited: Boolean = false)

/**
 * Narrow seam onto `StationConfigPreferences` (`data/preferences/StationConfigPreferences.kt`;
 * see `di/ViewModelModule.kt` for how the real singleton is adapted into this). Same rationale as
 * every other setup-wizard seam (see e.g. `SetupLoginViewModel.kt`'s kdoc): `StationConfigPreferences`
 * wraps a `DataStoreFactory`, an `expect class` with no `actual` outside androidMain/iosMain, and
 * is itself a non-`open` class — so it can neither be constructed nor subclassed from `commonTest`.
 * Both [save] and [clear] are needed here, so this is a plain interface rather than a single-method
 * `fun interface`.
 */
interface StationConfigGateway {
    suspend fun save(config: StationConfig)
    suspend fun clear()
}

/**
 * Narrow single-method seam onto `AuthPreferences.clearAuth()` — same rationale as
 * [StationConfigGateway]; `AuthPreferences` wraps a `DataStoreFactory`/`SecureStore` and is also
 * non-`open`.
 */
fun interface AuthLogoutGateway {
    suspend fun clearAuth()
}

/**
 * Sixth and last screen of the setup wizard (Task 9's nav graph: `Screen.SetupComplete`) — a
 * placeholder "station home" for M1b's purposes (spec §6.3). [finish] is where
 * `SetupWizardDraft.toStationConfig` (Task 1) is actually built and persisted, via
 * `StationConfigPreferences.save` (through [stationConfigPreferences]) — later milestones (M1c
 * Registration, M2 Zone Control, M3 Kiosk) replace this screen with their own real mode-specific
 * ones; this plan intentionally does not build those.
 *
 * [exitStation] is "Выйти со станции": clears both the persisted `StationConfig` and the staff's
 * auth session (through [authPreferences]), so the next launch lands back on the login step of a
 * fresh setup wizard run.
 */
class SetupCompleteViewModel(
    private val draft: SetupWizardDraft,
    private val stationConfigPreferences: StationConfigGateway,
    private val authPreferences: AuthLogoutGateway,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupCompleteUiState())
    val uiState: StateFlow<SetupCompleteUiState> = _uiState.asStateFlow()

    fun finish() {
        viewModelScope.launch {
            val config = draft.toStationConfig(deviceNumber = draft.deviceNumber, staffName = draft.staffName)
            stationConfigPreferences.save(config)
            draft.reset()
            _uiState.value = SetupCompleteUiState(stationConfig = config)
        }
    }

    fun exitStation() {
        viewModelScope.launch {
            stationConfigPreferences.clear()
            authPreferences.clearAuth()
            _uiState.value = _uiState.value.copy(exited = true)
        }
    }
}
