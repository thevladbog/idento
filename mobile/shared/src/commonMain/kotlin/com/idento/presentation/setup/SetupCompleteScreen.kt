package com.idento.presentation.setup

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.presentation.components.redesign.DetailRow
import com.idento.presentation.components.redesign.DetailTable
import com.idento.presentation.components.redesign.StatusBar
import com.idento.presentation.components.redesign.StatusCell
import com.idento.presentation.navigation.Screen
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius
import com.idento.presentation.theme.IdentoSpacing
import org.koin.compose.koinInject

private fun modeNameKey(mode: StationMode): StringKey = when (mode) {
    StationMode.REGISTRATION -> StringKey.SETUP_MODE_REGISTRATION_NAME
    StationMode.ZONE_CONTROL -> StringKey.SETUP_MODE_ZONE_CONTROL_NAME
    StationMode.KIOSK -> StringKey.SETUP_MODE_KIOSK_NAME
}

/**
 * Sixth and last screen of the setup wizard (Task 9's nav graph: `Screen.SetupComplete`) — a
 * placeholder "station home" for M1b's purposes (see [SetupCompleteViewModel]'s kdoc for why later
 * milestones replace it entirely rather than this plan building the real mode-specific screens).
 * `LaunchedEffect(Unit)` calls [SetupCompleteViewModel.finish] once on entry, which is where the
 * wizard's [SetupWizardDraft] is actually turned into a persisted [StationConfig] (Task 1's
 * `StationConfigPreferences.save`); until that completes, a spinner is shown instead of the station
 * summary.
 *
 * "Выйти со станции" always confirms first (spec: exiting throws the station back to a
 * from-scratch setup) before calling [SetupCompleteViewModel.exitStation]; once `uiState.exited`
 * flips to `true`, [onExitStation] fires exactly once (guarded by `LaunchedEffect(uiState.exited)`)
 * — Task 9's nav graph wires that to `Screen.SetupLogin`.
 */
@Composable
fun SetupCompleteScreen(
    viewModel: SetupCompleteViewModel = koinInject(),
    onExitStation: () -> Unit = {},
    onNavigateToStation: (route: String) -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()
    var showExitConfirm by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.finish() }

    LaunchedEffect(uiState.exited) {
        if (uiState.exited) onExitStation()
    }

    LaunchedEffect(uiState.stationConfig) {
        val config = uiState.stationConfig ?: return@LaunchedEffect
        when (config.mode) {
            StationMode.REGISTRATION -> onNavigateToStation(Screen.RegistrationHome.route)
            StationMode.ZONE_CONTROL -> onNavigateToStation(Screen.ZoneControlHome.route)
            StationMode.KIOSK -> onNavigateToStation(Screen.KioskHome.route)
        }
    }

    val config = uiState.stationConfig

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(IdentoColors.Background)
            .statusBarsPadding(),
    ) {
        Column(modifier = Modifier.padding(horizontal = IdentoSpacing.xl)) {
            Spacer(modifier = Modifier.height(IdentoSpacing.lg))

            Text(
                text = stringResource(StringKey.SETUP_DONE_TITLE),
                color = IdentoColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.lg))
        }

        if (config == null) {
            Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                if (uiState.error != null) {
                    Text(
                        text = uiState.error ?: "",
                        color = IdentoColors.AlertTextLight,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = IdentoSpacing.xl),
                    )
                } else {
                    CircularProgressIndicator(color = IdentoColors.Indicator)
                }
            }
        } else {
            StatusBar(
                cells = listOf(
                    StatusCell(value = stringResource(modeNameKey(config.mode)), label = stringResource(StringKey.SETUP_DONE_LABEL_MODE)),
                    StatusCell(value = config.eventName, label = stringResource(StringKey.SETUP_DONE_LABEL_EVENT)),
                    StatusCell(value = config.workPointName, label = stringResource(StringKey.SETUP_DONE_LABEL_WORKPOINT)),
                    StatusCell(value = config.deviceNumber.toString(), label = stringResource(StringKey.SETUP_DONE_LABEL_DEVICE)),
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            DetailTable(
                rows = listOf(
                    DetailRow(stringResource(StringKey.SETUP_DONE_LABEL_EVENT), config.eventName),
                    DetailRow(stringResource(StringKey.SETUP_DONE_LABEL_MODE), stringResource(modeNameKey(config.mode))),
                    DetailRow(stringResource(StringKey.SETUP_DONE_LABEL_DAY), config.dayDate ?: stringResource(StringKey.NOT_CONFIGURED)),
                    DetailRow(stringResource(StringKey.SETUP_DONE_LABEL_WORKPOINT), config.workPointName),
                    DetailRow(stringResource(StringKey.SETUP_DONE_LABEL_PRINTER), config.printer?.name ?: stringResource(StringKey.NOT_CONFIGURED)),
                    DetailRow(
                        stringResource(StringKey.SETUP_DONE_LABEL_AUTOPRINT),
                        stringResource(if (config.autoPrint) StringKey.SETUP_DONE_AUTOPRINT_ON else StringKey.SETUP_DONE_AUTOPRINT_OFF),
                    ),
                ),
                modifier = Modifier.weight(1f).padding(horizontal = IdentoSpacing.xl),
            )

            Text(
                text = stringResource(StringKey.SETUP_STATION_HOME_DEVICE).replace("{n}", config.deviceNumber.toString()),
                color = IdentoColors.TextSecondary,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(horizontal = IdentoSpacing.xl, vertical = IdentoSpacing.md),
            )
        }

        if (config != null && uiState.error != null) {
            Text(
                text = uiState.error ?: "",
                color = IdentoColors.AlertTextLight,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(horizontal = IdentoSpacing.xl, vertical = IdentoSpacing.md),
            )
        }

        Column(modifier = Modifier.padding(IdentoSpacing.xl)) {
            OutlinedButton(
                onClick = { showExitConfirm = true },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(IdentoRadius.buttonSecondary),
                border = BorderStroke(1.dp, IdentoColors.Border),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = IdentoColors.AlertTextLight,
                    disabledContentColor = IdentoColors.TextDisabled,
                ),
            ) {
                Text(stringResource(StringKey.SETUP_EXIT_STATION))
            }
        }
    }

    if (showExitConfirm) {
        AlertDialog(
            onDismissRequest = { showExitConfirm = false },
            title = { Text(stringResource(StringKey.SETUP_EXIT_STATION_CONFIRM_TITLE)) },
            text = { Text(stringResource(StringKey.SETUP_EXIT_STATION_CONFIRM_BODY)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showExitConfirm = false
                        viewModel.exitStation()
                    },
                ) {
                    Text(stringResource(StringKey.SETUP_EXIT_STATION))
                }
            },
            dismissButton = {
                TextButton(onClick = { showExitConfirm = false }) {
                    Text(stringResource(StringKey.CANCEL))
                }
            },
        )
    }
}
