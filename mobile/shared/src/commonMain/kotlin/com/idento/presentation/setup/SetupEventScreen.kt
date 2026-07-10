package com.idento.presentation.setup

import androidx.compose.animation.AnimatedVisibility
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
import com.idento.data.model.Event
import com.idento.presentation.components.redesign.SelectableCard
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoSpacing
import org.koin.compose.koinInject

/**
 * Second screen of the setup wizard, manager path only (Task 3's `NextStep.Event`) — the QR path
 * never reaches this screen since the event is already fixed by the scanned token. Selecting an
 * event immediately kicks off the self-mint + redeem provisioning round trip
 * ([SetupEventViewModel.onEventSelected]); there is no separate "continue" step. Navigates away
 * exactly once, via [SetupEventUiState.provisioned], to [onEventProvisioned] (Task 9's nav graph
 * wires this to the Mode step).
 */
@Composable
fun SetupEventScreen(
    viewModel: SetupEventViewModel = koinInject(),
    onEventProvisioned: () -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedEventId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { viewModel.loadEvents() }

    // Keyed on the boolean itself: only fires again if it actually flips back to false and true,
    // matching how SetupLoginScreen guards its own navigation callbacks against re-firing on a
    // plain recomposition.
    LaunchedEffect(uiState.provisioned) {
        if (uiState.provisioned) onEventProvisioned()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(IdentoColors.Background)
            .statusBarsPadding()
            .padding(horizontal = IdentoSpacing.xl),
    ) {
        Spacer(modifier = Modifier.height(IdentoSpacing.lg))

        Text(
            text = stringResource(StringKey.SETUP_STEP_EVENT_LABEL),
            color = IdentoColors.TextSecondary,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )

        Spacer(modifier = Modifier.height(IdentoSpacing.xs))

        Text(
            text = stringResource(StringKey.SETUP_STEP_EVENT_TITLE),
            color = IdentoColors.TextPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
        )

        Spacer(modifier = Modifier.height(IdentoSpacing.lg))

        when {
            uiState.isLoading && uiState.events.isEmpty() -> {
                Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = IdentoColors.Indicator)
                }
            }

            uiState.events.isEmpty() -> {
                Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Text(
                        text = stringResource(StringKey.SETUP_STEP_EVENT_EMPTY),
                        color = IdentoColors.TextSecondary,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    verticalArrangement = Arrangement.spacedBy(IdentoSpacing.sm),
                ) {
                    items(uiState.events, key = Event::id) { event ->
                        SelectableCard(
                            selected = selectedEventId == event.id,
                            onClick = {
                                selectedEventId = event.id
                                viewModel.onEventSelected(event)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column {
                                Text(
                                    text = event.name,
                                    color = IdentoColors.TextPrimary,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Spacer(modifier = Modifier.height(IdentoSpacing.xs))
                                Text(
                                    text = event.startDate,
                                    color = IdentoColors.TextSecondary,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                    }
                }
            }
        }

        AnimatedVisibility(visible = uiState.isLoading && uiState.events.isNotEmpty()) {
            Box(modifier = Modifier.fillMaxWidth().padding(vertical = IdentoSpacing.md), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = IdentoColors.Indicator, modifier = Modifier.size(28.dp))
            }
        }

        AnimatedVisibility(visible = uiState.error != null) {
            Column {
                Spacer(modifier = Modifier.height(IdentoSpacing.md))
                Text(
                    text = uiState.error ?: "",
                    color = IdentoColors.AlertTextLight,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                )
                Spacer(modifier = Modifier.height(IdentoSpacing.md))
            }
        }
    }
}
