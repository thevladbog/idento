package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import com.idento.data.model.StationMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SetupModeUiState(val selectedMode: StationMode? = null)

/**
 * Third screen of the setup wizard, both QR and manager paths — neither path fixes the station
 * mode ahead of time, so every station reaches this screen to pick a [StationMode]. Pure local
 * selection: no network calls, just writes straight into the shared [draft] (Task 1) so later
 * steps (Day/Zone, Printer, Complete) can read it back.
 */
class SetupModeViewModel(private val draft: SetupWizardDraft) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupModeUiState(selectedMode = draft.mode))
    val uiState: StateFlow<SetupModeUiState> = _uiState.asStateFlow()

    fun onModeSelected(mode: StationMode) {
        draft.mode = mode
        _uiState.value = SetupModeUiState(selectedMode = mode)
    }
}
