package com.idento.presentation.kiosk

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.platform.kiosk.KioskLockEffect
import com.idento.presentation.components.redesign.ScanReticle
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoSpacing
import com.idento.presentation.theme.IdentoTypeScale
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import org.koin.compose.koinInject

private const val LONG_PRESS_EXIT_DURATION_MS = 3_000L

@Composable
fun KioskScreen(
    viewModel: KioskViewModel = koinInject(),
    onExitStation: () -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current
    var showExitConfirm by remember { mutableStateOf(false) }

    KioskLockEffect(enabled = true)

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

    LaunchedEffect(uiState.exited) {
        if (uiState.exited) onExitStation()
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when (val state = uiState.screenState) {
            is KioskScreenState.Waiting -> WaitingBody()
            is KioskScreenState.Greeting -> GreetingBody(state.attendeeName)
            is KioskScreenState.NeedsStaff -> NeedsStaffBody()
        }
        KioskLogoExitTarget(
            onLongPressExit = { showExitConfirm = true },
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(top = IdentoSpacing.lg),
        )
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

/** Long-press (3s) target — the only way to exit lockdown. Uses a manual press-and-hold timer
 * instead of Compose's default `detectTapGestures(onLongPress = ...)` (~500ms), which would be
 * far too easy for an attendee's finger to trigger by accident on a public kiosk. */
@Composable
private fun KioskLogoExitTarget(onLongPressExit: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.pointerInput(Unit) {
            detectTapGestures(
                onPress = {
                    val heldLongEnough = try {
                        withTimeout(LONG_PRESS_EXIT_DURATION_MS) {
                            awaitRelease()
                            false
                        }
                    } catch (_: TimeoutCancellationException) {
                        true
                    }
                    if (heldLongEnough) onLongPressExit()
                },
            )
        },
    ) {
        Text(
            text = "Idento",
            color = IdentoColors.TextSecondary,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun WaitingBody() {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            ScanReticle(size = 340.dp)
            Spacer(Modifier.height(IdentoSpacing.xl))
            Text(
                text = stringResource(StringKey.KIOSK_WAITING_HINT),
                color = IdentoColors.TextSecondary,
                fontSize = 16.sp,
            )
        }
    }
}

@Composable
private fun GreetingBody(attendeeName: String) {
    Box(
        modifier = Modifier.fillMaxSize().background(IdentoColors.Brand),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = attendeeName,
                color = Color.White,
                fontSize = IdentoTypeScale.kioskAttendeeName,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(IdentoSpacing.lg))
            Text(
                text = stringResource(StringKey.KIOSK_GREETING_PRINT_CAPTION),
                color = Color.White,
                fontSize = 18.sp,
            )
        }
    }
}

@Composable
private fun NeedsStaffBody() {
    Box(
        modifier = Modifier.fillMaxSize().background(IdentoColors.NeutralBand),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = stringResource(StringKey.KIOSK_NEEDS_STAFF_MESSAGE),
            color = IdentoColors.TextPrimary,
            fontSize = 24.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = IdentoSpacing.xl),
        )
    }
}
