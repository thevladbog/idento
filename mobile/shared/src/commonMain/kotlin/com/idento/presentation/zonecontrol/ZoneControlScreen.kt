package com.idento.presentation.zonecontrol

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
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
import com.idento.data.model.ZoneVerdict
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.components.AppIcons
import com.idento.presentation.components.redesign.ActionButtonSpec
import com.idento.presentation.components.redesign.ActionStack
import com.idento.presentation.components.redesign.DetailRow
import com.idento.presentation.components.redesign.DetailTable
import com.idento.presentation.components.redesign.ScanReticle
import com.idento.presentation.components.redesign.ScannerStatusIndicator
import com.idento.presentation.components.redesign.StatusBar
import com.idento.presentation.components.redesign.StatusCell
import com.idento.presentation.components.redesign.VerdictBand
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius
import com.idento.presentation.theme.IdentoSpacing
import com.idento.presentation.theme.IdentoTypeScale
import org.koin.compose.koinInject

@Composable
fun ZoneControlScreen(
    viewModel: ZoneControlViewModel = koinInject(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> viewModel.onScanResumed()
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
                    label = stringResource(StringKey.ZONE_STATUSBAR_ZONE_LABEL),
                ),
                StatusCell(
                    value = uiState.allowedCount.toString(),
                    label = stringResource(StringKey.ZONE_STATUSBAR_ALLOWED_LABEL),
                    valueColor = IdentoColors.Brand,
                ),
                StatusCell(
                    value = uiState.deniedCount.toString(),
                    label = stringResource(StringKey.ZONE_STATUSBAR_DENIED_LABEL),
                    valueColor = if (uiState.deniedCount > 0) IdentoColors.Denied else IdentoColors.TextPrimary,
                ),
                StatusCell(
                    value = uiState.pendingQueueCount.toString(),
                    label = stringResource(StringKey.ZONE_STATUSBAR_QUEUE_LABEL),
                    valueColor = if (uiState.pendingQueueCount > 0) IdentoColors.Queue else IdentoColors.TextPrimary,
                ),
            ),
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm)
                .background(IdentoColors.Surface, RoundedCornerShape(IdentoRadius.pill))
                .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm),
        ) {
            Text(
                text = stringResource(StringKey.ZONE_BADGE_PRINT_DISABLED),
                color = IdentoColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
        }

        if (uiState.offlineBannerVisible) {
            com.idento.presentation.components.redesign.OfflineBanner(
                queuedCount = uiState.pendingQueueCount,
                lastSyncLabel = "—",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = IdentoSpacing.md),
            )
        }

        ScanBody(
            uiState = uiState,
            onVerdictDismissed = viewModel::onVerdictDismissed,
            onSwitchToCamera = viewModel::onSwitchToCamera,
            onOverride = viewModel::onOverride,
        )
    }
}

@Composable
private fun ScanBody(
    uiState: ZoneControlUiState,
    onVerdictDismissed: () -> Unit,
    onSwitchToCamera: () -> Unit,
    onOverride: (String) -> Unit,
) {
    val verdict = uiState.currentVerdict
    val scannerState = uiState.scannerState
    when {
        verdict != null -> VerdictCard(verdict = verdict, onDismiss = onVerdictDismissed, onOverride = onOverride)
        scannerState is ScannerConnectionState.HardwareConnected -> ScannerStatusIndicator(
            label = scannerState.label,
            onSwitchToCamera = onSwitchToCamera,
        )
        else -> Box(
            modifier = Modifier.fillMaxSize().background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            ScanReticle()
        }
    }
}

@Composable
private fun VerdictCard(
    verdict: ZoneVerdict,
    onDismiss: () -> Unit,
    onOverride: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(IdentoSpacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when (verdict) {
            is ZoneVerdict.Allowed -> AllowedVerdictContent(verdict, onDismiss)
            is ZoneVerdict.NoAccess -> NoAccessVerdictContent(verdict, onDismiss)
            is ZoneVerdict.NotRegistered -> NotRegisteredVerdictContent(verdict, onDismiss, onOverride)
            is ZoneVerdict.LookupError -> LookupErrorVerdictContent(verdict, onDismiss)
        }
    }
}

@Composable
private fun AllowedVerdictContent(verdict: ZoneVerdict.Allowed, onDismiss: () -> Unit) {
    VerdictBand(
        word = stringResource(StringKey.ZONE_VERDICT_ALLOWED_WORD),
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
    DetailTable(
        rows = listOf(
            DetailRow(stringResource(StringKey.ZONE_ALLOWED_REGISTERED_AT), verdict.registeredAt.toString()),
            DetailRow(stringResource(StringKey.ZONE_ALLOWED_POINT), verdict.registeredPoint),
        ),
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
private fun NoAccessVerdictContent(verdict: ZoneVerdict.NoAccess, onDismiss: () -> Unit) {
    VerdictBand(
        word = stringResource(StringKey.ZONE_VERDICT_NO_ACCESS_WORD),
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
    DetailTable(rows = listOf(DetailRow(stringResource(StringKey.ZONE_NO_ACCESS_REASON), verdict.ruleReason)))
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
private fun NotRegisteredVerdictContent(
    verdict: ZoneVerdict.NotRegistered,
    onDismiss: () -> Unit,
    onOverride: (String) -> Unit,
) {
    VerdictBand(
        word = stringResource(StringKey.ZONE_VERDICT_NOT_REGISTERED_WORD),
        icon = AppIcons.Warning,
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
    Text(
        // registrationPointHint is dynamic (from the backend's `reason` field, e.g. "Attendee has
        // not registered yet") — show it, don't override with a static local string. Fall back to
        // the generic ZONE_NOT_REGISTERED_HINT only if the backend ever sends an empty reason.
        text = verdict.registrationPointHint.ifBlank { stringResource(StringKey.ZONE_NOT_REGISTERED_HINT) },
        fontSize = 14.sp,
        color = IdentoColors.TextSecondary,
        modifier = Modifier.padding(horizontal = IdentoSpacing.md),
    )
    Spacer(Modifier.height(IdentoSpacing.lg))
    ActionStack(
        primary = ActionButtonSpec(
            label = stringResource(StringKey.ZONE_ACTION_OVERRIDE),
            onClick = { onOverride(verdict.attendee.id) },
            containerColor = IdentoColors.Amber,
            contentColor = Color.White,
        ),
        secondary = ActionButtonSpec(
            label = stringResource(StringKey.ZONE_ACTION_NEXT),
            onClick = onDismiss,
        ),
    )
}

@Composable
private fun LookupErrorVerdictContent(verdict: ZoneVerdict.LookupError, onDismiss: () -> Unit) {
    VerdictBand(
        word = stringResource(StringKey.ZONE_VERDICT_ERROR_WORD),
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
