package com.idento.presentation.setup

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.presentation.components.IdentoTextField
import com.idento.presentation.components.redesign.ActionButtonSpec
import com.idento.presentation.components.redesign.ActionStack
import com.idento.presentation.components.redesign.ScanReticle
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoSpacing
import org.koin.compose.koinInject

/**
 * First screen of the setup wizard (kiosk-strict dark UI, see DesignTokens.kt). Two sub-layouts
 * driven by [SetupLoginUiState.isManagerMode]: a QR scan viewfinder (default) or a manager
 * email/password form (toggled). Navigates away exactly once per successful attempt via
 * [SetupLoginUiState.nextStep] — [onNavigateToEvent] for the manager path, [onNavigateToMode]
 * for the QR path (Task 9 wires these into the wizard's nav graph).
 */
@Composable
fun SetupLoginScreen(
    viewModel: SetupLoginViewModel = koinInject(),
    onNavigateToEvent: () -> Unit = {},
    onNavigateToMode: () -> Unit = {},
    onNavigateToServerUrl: () -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()

    // Keyed on nextStep itself: LaunchedEffect only restarts (and thus only fires the callback
    // again) when the value actually changes, so a plain recomposition while it stays e.g.
    // NextStep.Mode does not re-navigate.
    LaunchedEffect(uiState.nextStep) {
        when (uiState.nextStep) {
            NextStep.Event -> onNavigateToEvent()
            NextStep.Mode -> onNavigateToMode()
            null -> {}
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(IdentoColors.Background)
    ) {
        if (uiState.isManagerMode) {
            ManagerLoginContent(
                uiState = uiState,
                viewModel = viewModel,
                onNavigateToServerUrl = onNavigateToServerUrl,
            )
        } else {
            QrScanContent(
                uiState = uiState,
                viewModel = viewModel,
                onNavigateToServerUrl = onNavigateToServerUrl,
            )
        }
    }
}

@Composable
private fun QrScanContent(
    uiState: SetupLoginUiState,
    viewModel: SetupLoginViewModel,
    onNavigateToServerUrl: () -> Unit,
) {
    // Scanning starts automatically as soon as this sub-layout appears.
    LaunchedEffect(Unit) { viewModel.startQrScan() }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = IdentoSpacing.xl),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = stringResource(StringKey.SETUP_LOGIN_TITLE),
                color = IdentoColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.xl))

            ScanReticle()

            Spacer(modifier = Modifier.height(IdentoSpacing.lg))

            Text(
                text = if (uiState.isLoading) {
                    stringResource(StringKey.SETUP_LOGIN_PROVISIONING)
                } else {
                    stringResource(StringKey.SETUP_LOGIN_SCAN_HINT)
                },
                color = IdentoColors.TextSecondary,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
            )

            AnimatedVisibility(visible = uiState.isLoading) {
                Column {
                    Spacer(modifier = Modifier.height(IdentoSpacing.md))
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
                }
            }
        }

        ActionStack(
            primary = ActionButtonSpec(
                label = stringResource(StringKey.SETUP_LOGIN_SCAN_QR),
                onClick = viewModel::startQrScan,
            ),
            secondary = ActionButtonSpec(
                label = stringResource(StringKey.SETUP_LOGIN_MANAGER_TOGGLE),
                onClick = viewModel::toggleManagerMode,
            ),
        )

        Text(
            text = stringResource(StringKey.SETUP_LOGIN_ADVANCED_SERVER),
            color = IdentoColors.TextSecondary,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onNavigateToServerUrl)
                .padding(vertical = IdentoSpacing.md),
        )
    }
}

@Composable
private fun ManagerLoginContent(
    uiState: SetupLoginUiState,
    viewModel: SetupLoginViewModel,
    onNavigateToServerUrl: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = IdentoSpacing.xl),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = stringResource(StringKey.SETUP_LOGIN_TITLE),
                color = IdentoColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.xl))

            IdentoTextField(
                value = uiState.email,
                onValueChange = viewModel::onEmailChanged,
                label = stringResource(StringKey.EMAIL),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.md))

            IdentoTextField(
                value = uiState.password,
                onValueChange = viewModel::onPasswordChanged,
                label = stringResource(StringKey.PASSWORD),
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { viewModel.signInAsManager() }),
                modifier = Modifier.fillMaxWidth(),
            )

            AnimatedVisibility(visible = uiState.error != null) {
                Column {
                    Spacer(modifier = Modifier.height(IdentoSpacing.md))
                    Text(
                        text = uiState.error ?: "",
                        color = IdentoColors.AlertTextLight,
                        fontSize = 14.sp,
                    )
                }
            }

            AnimatedVisibility(visible = uiState.isLoading) {
                Column {
                    Spacer(modifier = Modifier.height(IdentoSpacing.md))
                    CircularProgressIndicator(color = IdentoColors.Indicator, modifier = Modifier.size(28.dp))
                }
            }
        }

        ActionStack(
            primary = ActionButtonSpec(
                label = stringResource(StringKey.SIGN_IN),
                onClick = viewModel::signInAsManager,
            ),
            secondary = ActionButtonSpec(
                label = stringResource(StringKey.SETUP_LOGIN_BACK_TO_QR),
                onClick = viewModel::toggleManagerMode,
            ),
        )

        Text(
            text = stringResource(StringKey.SETUP_LOGIN_ADVANCED_SERVER),
            color = IdentoColors.TextSecondary,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onNavigateToServerUrl)
                .padding(vertical = IdentoSpacing.md),
        )
    }
}
