package com.idento.presentation.registration

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.model.Attendee
import com.idento.data.model.PrintState
import com.idento.data.model.RegistrationVerdict
import com.idento.presentation.components.AppIcons
import com.idento.presentation.components.redesign.ActionButtonSpec
import com.idento.presentation.components.redesign.ActionStack
import com.idento.presentation.components.redesign.DetailRow
import com.idento.presentation.components.redesign.DetailTable
import com.idento.presentation.components.redesign.ListRow
import com.idento.presentation.components.redesign.ModeSegmentedControl
import com.idento.presentation.components.redesign.OfflineBanner
import com.idento.presentation.components.redesign.ScanReticle
import com.idento.presentation.components.redesign.StatusBar
import com.idento.presentation.components.redesign.StatusCell
import com.idento.presentation.components.redesign.VerdictBand
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoSpacing
import com.idento.presentation.theme.IdentoTypeScale
import org.koin.compose.koinInject

@Composable
fun RegistrationHomeScreen(
    viewModel: RegistrationHomeViewModel = koinInject(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME ->
                    if (viewModel.uiState.value.currentTab == RegistrationTab.SCAN) {
                        viewModel.onScanResumed()
                    }
                Lifecycle.Event.ON_PAUSE -> viewModel.onScanPaused()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {
        StatusBar(
            cells = listOf(
                StatusCell(
                    value = uiState.zoneName,
                    label = stringResource(StringKey.REGISTRATION_STATUSBAR_ZONE_LABEL),
                ),
                StatusCell(
                    value = uiState.printerLabel,
                    label = stringResource(StringKey.REGISTRATION_STATUSBAR_PRINTER_LABEL),
                    valueColor = if (uiState.printerStatusOk) IdentoColors.Brand else IdentoColors.TextSecondary,
                ),
                StatusCell(
                    value = uiState.pendingQueueCount.toString(),
                    label = stringResource(StringKey.REGISTRATION_STATUSBAR_QUEUE_LABEL),
                    valueColor = if (uiState.pendingQueueCount > 0) IdentoColors.Queue else IdentoColors.TextPrimary,
                ),
                StatusCell(
                    value = uiState.sessionCheckedCount.toString(),
                    label = stringResource(StringKey.REGISTRATION_STATUSBAR_CHECKED_LABEL),
                ),
            ),
        )

        ModeSegmentedControl(
            options = listOf(
                stringResource(StringKey.REGISTRATION_TAB_SCAN),
                stringResource(StringKey.REGISTRATION_TAB_SEARCH),
            ),
            selectedIndex = if (uiState.currentTab == RegistrationTab.SCAN) 0 else 1,
            onSelect = { index ->
                viewModel.onTabSelected(if (index == 0) RegistrationTab.SCAN else RegistrationTab.SEARCH)
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm),
        )

        if (uiState.offlineBannerVisible) {
            OfflineBanner(
                queuedCount = uiState.pendingQueueCount,
                lastSyncLabel = "—",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = IdentoSpacing.md),
            )
        }

        when (uiState.currentTab) {
            RegistrationTab.SCAN -> ScanTab(
                uiState = uiState,
                onVerdictDismissed = viewModel::onVerdictDismissed,
            )
            RegistrationTab.SEARCH -> SearchTab(
                uiState = uiState,
                onQueryChanged = viewModel::onSearchQueryChanged,
                onManualCheckIn = viewModel::onManualCheckIn,
            )
        }
    }
}

// ── Scan tab ─────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ScanTab(
    uiState: RegistrationHomeUiState,
    onVerdictDismissed: () -> Unit,
) {
    val verdict = uiState.currentVerdict
    if (verdict == null) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            ScanReticle()
        }
    } else {
        VerdictCard(verdict = verdict, onDismiss = onVerdictDismissed)
    }
}

// ── Verdict card ──────────────────────────────────────────────────────────────────────────────────

@Composable
private fun VerdictCard(
    verdict: RegistrationVerdict,
    onDismiss: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(IdentoSpacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when (verdict) {
            is RegistrationVerdict.Success -> SuccessVerdictContent(verdict, onDismiss)
            is RegistrationVerdict.AlreadyChecked -> AlreadyCheckedVerdictContent(verdict, onDismiss)
            is RegistrationVerdict.NotFound -> NotFoundVerdictContent(onDismiss)
            is RegistrationVerdict.Denied -> DeniedVerdictContent(verdict, onDismiss)
            is RegistrationVerdict.PrintError -> PrintErrorVerdictContent(verdict, onDismiss)
            is RegistrationVerdict.LookupError -> LookupErrorVerdictContent(verdict, onDismiss)
        }
    }
}

@Composable
private fun SuccessVerdictContent(
    verdict: RegistrationVerdict.Success,
    onDismiss: () -> Unit,
) {
    VerdictBand(
        word = stringResource(StringKey.REGISTRATION_VERDICT_SUCCESS_WORD),
        icon = AppIcons.CheckCircle,
        color = IdentoColors.Brand,
    )
    Spacer(Modifier.height(IdentoSpacing.md))
    Text(
        text = verdict.attendee.fullName,
        fontSize = IdentoTypeScale.attendeeName,
        fontWeight = FontWeight.SemiBold,
        color = IdentoColors.TextPrimary,
    )
    val detailRows = buildList {
        verdict.attendee.company?.let { company ->
            add(DetailRow(stringResource(StringKey.REGISTRATION_ATTENDEE_COMPANY), company))
        }
        add(DetailRow(stringResource(StringKey.REGISTRATION_ATTENDEE_CATEGORY), verdict.attendee.category))
        val printLabel = when (verdict.printState) {
            PrintState.Printing, PrintState.Done ->
                stringResource(StringKey.REGISTRATION_PRINT_STATE_SENT)
            PrintState.Queued ->
                stringResource(StringKey.REGISTRATION_PRINT_STATE_QUEUED)
            is PrintState.Failed ->
                stringResource(StringKey.REGISTRATION_PRINT_STATE_FAILED)
            PrintState.NotRequested -> null
        }
        if (printLabel != null) {
            add(DetailRow(stringResource(StringKey.REGISTRATION_STATUSBAR_PRINTER_LABEL), printLabel))
        }
    }
    if (detailRows.isNotEmpty()) {
        Spacer(Modifier.height(IdentoSpacing.sm))
        DetailTable(rows = detailRows)
    }
    Spacer(Modifier.height(IdentoSpacing.lg))
    ActionStack(
        primary = ActionButtonSpec(
            label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
            onClick = onDismiss,
            containerColor = IdentoColors.Brand,
            contentColor = Color.White,
        ),
    )
}

@Composable
private fun AlreadyCheckedVerdictContent(
    verdict: RegistrationVerdict.AlreadyChecked,
    onDismiss: () -> Unit,
) {
    VerdictBand(
        word = stringResource(StringKey.REGISTRATION_VERDICT_ALREADY_WORD),
        icon = AppIcons.CheckCircle,
        color = IdentoColors.Amber,
    )
    Spacer(Modifier.height(IdentoSpacing.md))
    Text(
        text = verdict.attendee.fullName,
        fontSize = IdentoTypeScale.attendeeName,
        fontWeight = FontWeight.SemiBold,
        color = IdentoColors.TextPrimary,
    )
    Spacer(Modifier.height(IdentoSpacing.sm))
    DetailTable(
        rows = listOf(
            DetailRow(
                label = stringResource(StringKey.REGISTRATION_ALREADY_FIRST_AT),
                value = verdict.firstAt.toString(),
            ),
            DetailRow(
                label = stringResource(StringKey.REGISTRATION_ALREADY_POINT),
                value = verdict.firstPoint,
            ),
            DetailRow(
                label = stringResource(StringKey.REGISTRATION_ALREADY_DEVICE),
                value = verdict.firstDevice.toString(),
            ),
        ),
    )
    Spacer(Modifier.height(IdentoSpacing.lg))
    ActionStack(
        primary = ActionButtonSpec(
            label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
            onClick = onDismiss,
            containerColor = IdentoColors.Amber,
            contentColor = Color.White,
        ),
    )
}

@Composable
private fun NotFoundVerdictContent(onDismiss: () -> Unit) {
    VerdictBand(
        word = stringResource(StringKey.REGISTRATION_VERDICT_NOT_FOUND_WORD),
        // Warning is the closest available AppIcon for "unknown/not found"
        icon = AppIcons.Warning,
        color = IdentoColors.NeutralBand,
    )
    Spacer(Modifier.height(IdentoSpacing.lg))
    ActionStack(
        primary = ActionButtonSpec(
            label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
            onClick = onDismiss,
            containerColor = IdentoColors.NeutralBand,
            contentColor = Color.White,
        ),
    )
}

@Composable
private fun DeniedVerdictContent(
    verdict: RegistrationVerdict.Denied,
    onDismiss: () -> Unit,
) {
    VerdictBand(
        word = stringResource(StringKey.REGISTRATION_VERDICT_DENIED_WORD),
        // Close is the closest available AppIcon for "denied/blocked"
        icon = AppIcons.Close,
        color = IdentoColors.Denied,
    )
    Spacer(Modifier.height(IdentoSpacing.md))
    Text(
        text = verdict.attendee.fullName,
        fontSize = IdentoTypeScale.attendeeName,
        fontWeight = FontWeight.SemiBold,
        color = IdentoColors.TextPrimary,
    )
    Spacer(Modifier.height(IdentoSpacing.sm))
    DetailTable(
        rows = listOf(
            DetailRow(
                label = stringResource(StringKey.REGISTRATION_DENIED_REASON),
                value = verdict.reason,
            ),
        ),
    )
    Spacer(Modifier.height(IdentoSpacing.lg))
    ActionStack(
        primary = ActionButtonSpec(
            label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
            onClick = onDismiss,
            containerColor = IdentoColors.Denied,
            contentColor = Color.White,
        ),
    )
}

@Composable
private fun PrintErrorVerdictContent(
    verdict: RegistrationVerdict.PrintError,
    onDismiss: () -> Unit,
) {
    // Check-in succeeded; print failed — green success band + red print-failure note
    VerdictBand(
        word = stringResource(StringKey.REGISTRATION_VERDICT_SUCCESS_WORD),
        icon = AppIcons.CheckCircle,
        color = IdentoColors.Brand,
    )
    Spacer(Modifier.height(IdentoSpacing.md))
    Text(
        text = verdict.attendee.fullName,
        fontSize = IdentoTypeScale.attendeeName,
        fontWeight = FontWeight.SemiBold,
        color = IdentoColors.TextPrimary,
    )
    Spacer(Modifier.height(IdentoSpacing.sm))
    Text(
        text = "${stringResource(StringKey.REGISTRATION_PRINT_STATE_FAILED)}: ${verdict.printReason}",
        fontSize = 14.sp,
        color = IdentoColors.Denied,
        modifier = Modifier.padding(horizontal = IdentoSpacing.md),
    )
    Spacer(Modifier.height(IdentoSpacing.lg))
    ActionStack(
        primary = ActionButtonSpec(
            label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
            onClick = onDismiss,
            containerColor = IdentoColors.Brand,
            contentColor = Color.White,
        ),
    )
}

@Composable
private fun LookupErrorVerdictContent(
    verdict: RegistrationVerdict.LookupError,
    onDismiss: () -> Unit,
) {
    VerdictBand(
        word = stringResource(StringKey.REGISTRATION_VERDICT_ERROR_WORD),
        icon = AppIcons.Warning,
        color = IdentoColors.Denied,
    )
    Spacer(Modifier.height(IdentoSpacing.sm))
    Text(
        text = verdict.message,
        fontSize = 14.sp,
        color = IdentoColors.TextSecondary,
        modifier = Modifier.padding(horizontal = IdentoSpacing.md),
    )
    Spacer(Modifier.height(IdentoSpacing.lg))
    ActionStack(
        primary = ActionButtonSpec(
            label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
            onClick = onDismiss,
            containerColor = IdentoColors.Denied,
            contentColor = Color.White,
        ),
    )
}

// ── Search tab ───────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SearchTab(
    uiState: RegistrationHomeUiState,
    onQueryChanged: (String) -> Unit,
    onManualCheckIn: (Attendee) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        TextField(
            value = uiState.searchQuery,
            onValueChange = onQueryChanged,
            placeholder = {
                Text(stringResource(StringKey.REGISTRATION_SEARCH_PLACEHOLDER))
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm),
            singleLine = true,
        )

        val showEmpty = uiState.searchResults.isEmpty()
            && uiState.searchQuery.length >= 2
            && !uiState.isSearchLoading

        if (showEmpty) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(StringKey.REGISTRATION_SEARCH_EMPTY),
                    fontSize = 14.sp,
                    color = IdentoColors.TextSecondary,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(uiState.searchResults) { attendee ->
                    ListRow(
                        initials = buildInitials(attendee.fullName),
                        title = attendee.fullName,
                        subtitle = listOfNotNull(attendee.company, attendee.position)
                            .joinToString(" · "),
                        highlighted = attendee.isCheckedIn,
                        onClick = { onManualCheckIn(attendee) },
                    )
                }
            }
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

private fun buildInitials(fullName: String): String {
    val parts = fullName.trim().split(" ").filter { it.isNotEmpty() }
    return when {
        parts.size >= 2 -> "${parts[0].first()}${parts[1].first()}".uppercase()
        parts.size == 1 -> parts[0].take(2).uppercase()
        else -> "?"
    }
}
