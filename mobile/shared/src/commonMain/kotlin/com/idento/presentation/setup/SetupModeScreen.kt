package com.idento.presentation.setup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.model.StationMode
import com.idento.presentation.components.redesign.ActionButtonSpec
import com.idento.presentation.components.redesign.ActionStack
import com.idento.presentation.components.redesign.SelectableCard
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoSpacing
import org.koin.compose.koinInject

private data class ModeOption(val mode: StationMode, val nameKey: StringKey, val descKey: StringKey)

private val MODE_OPTIONS = listOf(
    ModeOption(StationMode.REGISTRATION, StringKey.SETUP_MODE_REGISTRATION_NAME, StringKey.SETUP_MODE_REGISTRATION_DESC),
    ModeOption(StationMode.ZONE_CONTROL, StringKey.SETUP_MODE_ZONE_CONTROL_NAME, StringKey.SETUP_MODE_ZONE_CONTROL_DESC),
    ModeOption(StationMode.KIOSK, StringKey.SETUP_MODE_KIOSK_NAME, StringKey.SETUP_MODE_KIOSK_DESC),
)

/**
 * Third screen of the setup wizard (Task 9's nav graph: `Screen.SetupMode`). Both the QR and
 * manager paths reach this screen — neither fixes the station mode ahead of time — to pick one
 * of the three [StationMode] values via a [SelectableCard] each. Pure local selection (no
 * network calls): [SetupModeViewModel.onModeSelected] just writes into the shared wizard draft
 * (Task 1). [onContinue] navigates on to `Screen.SetupDayZone` and is only reachable once a mode
 * has been picked — the primary action is a no-op button before that.
 */
@Composable
fun SetupModeScreen(
    viewModel: SetupModeViewModel = koinInject(),
    onContinue: () -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(IdentoColors.Background)
            .statusBarsPadding(),
    ) {
        Column(modifier = Modifier.padding(horizontal = IdentoSpacing.xl)) {
            Spacer(modifier = Modifier.height(IdentoSpacing.lg))

            Text(
                text = stringResource(StringKey.SETUP_STEP_MODE_LABEL),
                color = IdentoColors.TextSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.xs))

            Text(
                text = stringResource(StringKey.SETUP_STEP_MODE_TITLE),
                color = IdentoColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.lg))
        }

        LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f).padding(horizontal = IdentoSpacing.xl),
            verticalArrangement = Arrangement.spacedBy(IdentoSpacing.sm),
        ) {
            items(MODE_OPTIONS, key = { it.mode }) { option ->
                SelectableCard(
                    selected = uiState.selectedMode == option.mode,
                    onClick = { viewModel.onModeSelected(option.mode) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column {
                        Text(
                            text = stringResource(option.nameKey),
                            color = IdentoColors.TextPrimary,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(modifier = Modifier.height(IdentoSpacing.xs))
                        Text(
                            text = stringResource(option.descKey),
                            color = IdentoColors.TextSecondary,
                            fontSize = 13.sp,
                        )
                    }
                }
            }
        }

        val modeSelected = uiState.selectedMode != null
        ActionStack(
            primary = ActionButtonSpec(
                label = stringResource(StringKey.SETUP_WIZARD_CONTINUE),
                onClick = { if (modeSelected) onContinue() },
                containerColor = if (modeSelected) IdentoColors.Brand else IdentoColors.Border,
                contentColor = if (modeSelected) Color.White else IdentoColors.TextDisabled,
            ),
        )
    }
}
