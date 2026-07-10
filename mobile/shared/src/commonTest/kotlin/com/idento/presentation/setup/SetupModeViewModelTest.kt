package com.idento.presentation.setup

import com.idento.data.model.StationMode
import kotlin.test.Test
import kotlin.test.assertEquals

class SetupModeViewModelTest {

    @Test
    fun selectingAModeWritesItToTheDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupModeViewModel(draft)

        viewModel.onModeSelected(StationMode.ZONE_CONTROL)

        assertEquals(StationMode.ZONE_CONTROL, draft.mode)
        assertEquals(StationMode.ZONE_CONTROL, viewModel.uiState.value.selectedMode)
    }
}
