package com.idento.presentation.setup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.model.EventZoneWithStats
import com.idento.presentation.components.redesign.ActionButtonSpec
import com.idento.presentation.components.redesign.ActionStack
import com.idento.presentation.components.redesign.FilterChipSpec
import com.idento.presentation.components.redesign.FilterChips
import com.idento.presentation.components.redesign.SelectableCard
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoSpacing
import org.koin.compose.koinInject

/**
 * Fourth screen of the setup wizard, step 3/4 (Task 9's nav graph: `Screen.SetupDayZone`). Day
 * pills are built with [FilterChips]/[FilterChipSpec] rather than a new pill component: its
 * `(key, label, count: Int?)` shape fits a plain date-pill row perfectly once `count` is left
 * `null` (the composable already renders just `label` in that case — see FilterChips.kt) and
 * `selectedKey` compares by equality, so passing `uiState.selectedDay ?: ""` before any day is
 * picked simply renders with nothing highlighted rather than crashing. Writing a bespoke pill row
 * would have duplicated this for no behavioral gain.
 *
 * Day pills are only shown when [SetupDayZoneUiState.showDayPicker] is true (false for
 * [com.idento.data.model.StationMode.KIOSK] — spec §6.3, "Киоск вместо дня/зоны — только точка
 * регистрации"). The title switches between [StringKey.SETUP_STEP_DAYZONE_TITLE] and
 * [StringKey.SETUP_STEP_WORKPOINT_ONLY_TITLE] on the same flag.
 *
 * Continue is gated on having a selected work point (and, when shown, a selected day), then
 * branches per [SetupDayZoneViewModel.shouldSkipPrinterStep] — spec §6.3's "Контроль зоны
 * пропускает шаг «Принтер»" — to either [onNavigateToPrinter] or [onNavigateToDone].
 */
@Composable
fun SetupDayZoneScreen(
    viewModel: SetupDayZoneViewModel = koinInject(),
    onNavigateToPrinter: () -> Unit = {},
    onNavigateToDone: () -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.load() }

    val canContinue = uiState.selectedWorkPointId != null && (!uiState.showDayPicker || uiState.selectedDay != null)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(IdentoColors.Background)
            .statusBarsPadding(),
    ) {
        Column(modifier = Modifier.padding(horizontal = IdentoSpacing.xl)) {
            Spacer(modifier = Modifier.height(IdentoSpacing.lg))

            Text(
                text = stringResource(StringKey.SETUP_STEP_DAYZONE_LABEL),
                color = IdentoColors.TextSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.xs))

            Text(
                text = stringResource(
                    if (uiState.showDayPicker) StringKey.SETUP_STEP_DAYZONE_TITLE else StringKey.SETUP_STEP_WORKPOINT_ONLY_TITLE,
                ),
                color = IdentoColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.lg))
        }

        if (uiState.showDayPicker) {
            FilterChips(
                options = uiState.days.map { day -> FilterChipSpec(key = day, label = day) },
                selectedKey = uiState.selectedDay ?: "",
                onSelect = { day -> viewModel.onDaySelected(day) },
            )
        }

        when {
            uiState.isLoading && uiState.workPoints.isEmpty() -> {
                Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = IdentoColors.Indicator)
                }
            }

            uiState.workPoints.isEmpty() -> {
                Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Text(
                        text = stringResource(StringKey.SETUP_WORKPOINT_EMPTY),
                        color = IdentoColors.TextSecondary,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = IdentoSpacing.xl),
                    )
                }
            }

            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().weight(1f).padding(horizontal = IdentoSpacing.xl),
                    verticalArrangement = Arrangement.spacedBy(IdentoSpacing.sm),
                ) {
                    items(uiState.workPoints, key = EventZoneWithStats::id) { workPoint ->
                        SelectableCard(
                            selected = uiState.selectedWorkPointId == workPoint.id,
                            onClick = { viewModel.onWorkPointSelected(id = workPoint.id, name = workPoint.name) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = workPoint.name,
                                color = IdentoColors.TextPrimary,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }

        if (uiState.isLoading && uiState.workPoints.isNotEmpty()) {
            Box(modifier = Modifier.fillMaxWidth().padding(vertical = IdentoSpacing.md), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = IdentoColors.Indicator, modifier = Modifier.size(28.dp))
            }
        }

        if (uiState.error != null) {
            Text(
                text = uiState.error ?: "",
                color = IdentoColors.AlertTextLight,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(horizontal = IdentoSpacing.xl, vertical = IdentoSpacing.md),
            )
        }

        ActionStack(
            primary = ActionButtonSpec(
                label = stringResource(StringKey.SETUP_WIZARD_CONTINUE),
                onClick = {
                    if (canContinue) {
                        if (viewModel.shouldSkipPrinterStep()) onNavigateToDone() else onNavigateToPrinter()
                    }
                },
                containerColor = if (canContinue) IdentoColors.Brand else IdentoColors.Border,
                contentColor = if (canContinue) Color.White else IdentoColors.TextDisabled,
            ),
        )
    }
}
