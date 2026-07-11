package com.idento.presentation.setup

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.model.PrinterConfig
import com.idento.platform.camera.CameraService
import com.idento.platform.printer.BluetoothPrinterDevice
import com.idento.presentation.components.IdentoTextField
import com.idento.presentation.components.redesign.ActionButtonSpec
import com.idento.presentation.components.redesign.ActionStack
import com.idento.presentation.components.redesign.IdentoToggle
import com.idento.presentation.components.redesign.ModeSegmentedControl
import com.idento.presentation.components.redesign.ScanReticle
import com.idento.presentation.components.redesign.SelectableCard
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius
import com.idento.presentation.theme.IdentoSpacing
import kotlinx.serialization.json.Json
import org.koin.compose.koinInject

private val printerQrJson = Json { ignoreUnknownKeys = true }

/**
 * Fifth and last screen of the setup wizard, step 4/4 (Task 9's nav graph: `Screen.SetupPrinter`).
 * Never reached for [com.idento.data.model.StationMode.ZONE_CONTROL] — no branch on that mode
 * exists here at all, since `SetupDayZoneScreen` (Task 6) already routes that mode straight to
 * "Готово" before this screen is ever shown.
 *
 * Three tabs (driven by a local [ModeSegmentedControl] index, not `uiState` — this screen has no
 * server-driven tab state) each set `draft.printer` a different way: pick a paired Bluetooth
 * device, type an Ethernet IP:port, or scan the printer's own QR code (decoded here from
 * `CameraService.startScanning()`'s raw string into a [PrinterConfig] JSON payload — same
 * `Flow<String>` scanning pattern as `SetupLoginScreen`'s QR tab, just decoding a different
 * payload shape). iOS has no Bluetooth printer transport (spec §7: "BT-SPP на iOS недоступен без
 * MFi — принято дизайном"); `BluetoothPrinterService`'s iOS `actual` already degrades safely
 * (`getPairedPrinters()` returns `Result.success(emptyList())`, never throws — see
 * `SetupPrinterViewModel`'s kdoc), so the Bluetooth tab needs no iOS-specific casing here: it
 * simply always renders [StringKey.SETUP_PRINTER_NONE_PAIRED] on iOS.
 */
@Composable
fun SetupPrinterScreen(
    viewModel: SetupPrinterViewModel = koinInject(),
    cameraService: CameraService = koinInject(),
    onNavigateToDone: () -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedTab by remember { mutableStateOf(0) }
    val hasPrinter = uiState.printer != null

    LaunchedEffect(Unit) { viewModel.loadPairedPrinters() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(IdentoColors.Background)
            .statusBarsPadding(),
    ) {
        Column(modifier = Modifier.padding(horizontal = IdentoSpacing.xl)) {
            Spacer(modifier = Modifier.height(IdentoSpacing.lg))

            Text(
                text = stringResource(StringKey.SETUP_STEP_PRINTER_LABEL),
                color = IdentoColors.TextSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.xs))

            Text(
                text = stringResource(StringKey.SETUP_STEP_PRINTER_TITLE),
                color = IdentoColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )

            Spacer(modifier = Modifier.height(IdentoSpacing.lg))

            ModeSegmentedControl(
                options = listOf(
                    stringResource(StringKey.SETUP_PRINTER_TAB_BLUETOOTH),
                    stringResource(StringKey.SETUP_PRINTER_TAB_ETHERNET),
                    stringResource(StringKey.SETUP_PRINTER_TAB_QR),
                ),
                selectedIndex = selectedTab,
                onSelect = { selectedTab = it },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(modifier = Modifier.height(IdentoSpacing.md))

        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when (selectedTab) {
                0 -> BluetoothTab(uiState = uiState, viewModel = viewModel, modifier = Modifier.fillMaxSize())
                1 -> EthernetTab(viewModel = viewModel, modifier = Modifier.fillMaxSize())
                else -> QrTab(cameraService = cameraService, viewModel = viewModel, modifier = Modifier.fillMaxSize())
            }
        }

        Column(modifier = Modifier.padding(horizontal = IdentoSpacing.xl)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(StringKey.SETUP_PRINTER_AUTOPRINT_TOGGLE),
                    color = IdentoColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                )
                IdentoToggle(checked = uiState.autoPrint, onCheckedChange = viewModel::onAutoPrintToggled)
            }

            Spacer(modifier = Modifier.height(IdentoSpacing.md))

            OutlinedButton(
                onClick = viewModel::testPrint,
                enabled = hasPrinter && !uiState.isLoading,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(IdentoRadius.buttonSecondary),
                border = BorderStroke(1.dp, IdentoColors.Border),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = IdentoColors.ButtonLabel,
                    disabledContentColor = IdentoColors.TextDisabled,
                ),
            ) {
                Text(
                    text = when (uiState.testPrintResult) {
                        true -> stringResource(StringKey.SETUP_PRINTER_TEST_PRINT_SENT)
                        false -> stringResource(StringKey.SETUP_PRINTER_TEST_PRINT_FAILED)
                        null -> stringResource(StringKey.SETUP_PRINTER_TEST_PRINT)
                    },
                )
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
                label = stringResource(StringKey.SETUP_WIZARD_CONTINUE),
                onClick = { if (hasPrinter) onNavigateToDone() },
                containerColor = if (hasPrinter) IdentoColors.Brand else IdentoColors.Border,
                contentColor = if (hasPrinter) Color.White else IdentoColors.TextDisabled,
            ),
        )
    }
}

@Composable
private fun BluetoothTab(uiState: SetupPrinterUiState, viewModel: SetupPrinterViewModel, modifier: Modifier = Modifier) {
    if (uiState.pairedPrinters.isEmpty()) {
        Box(modifier = modifier.padding(horizontal = IdentoSpacing.xl), contentAlignment = Alignment.Center) {
            Text(
                text = stringResource(StringKey.SETUP_PRINTER_NONE_PAIRED),
                color = IdentoColors.TextSecondary,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
            )
        }
    } else {
        LazyColumn(
            modifier = modifier.padding(horizontal = IdentoSpacing.xl),
            verticalArrangement = Arrangement.spacedBy(IdentoSpacing.sm),
        ) {
            items(uiState.pairedPrinters, key = BluetoothPrinterDevice::address) { device ->
                SelectableCard(
                    selected = uiState.printer?.transport == "bluetooth" && uiState.printer.address == device.address,
                    onClick = { viewModel.onBluetoothPrinterSelected(name = device.name, address = device.address) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = device.name,
                        color = IdentoColors.TextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

@Composable
private fun EthernetTab(viewModel: SetupPrinterViewModel, modifier: Modifier = Modifier) {
    var name by remember { mutableStateOf("") }
    var ip by remember { mutableStateOf("") }
    var port by remember { mutableStateOf("9100") }

    Column(modifier = modifier.padding(horizontal = IdentoSpacing.xl)) {
        IdentoTextField(
            value = name,
            onValueChange = { name = it },
            label = stringResource(StringKey.SETUP_PRINTER_ETHERNET_NAME_LABEL),
            placeholder = "Zebra ZD421",
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(IdentoSpacing.md))

        IdentoTextField(
            value = ip,
            onValueChange = { ip = it },
            label = stringResource(StringKey.SETUP_PRINTER_ETHERNET_IP_LABEL),
            placeholder = "192.168.1.50",
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(IdentoSpacing.md))

        IdentoTextField(
            value = port,
            onValueChange = { newValue -> port = newValue.filter(Char::isDigit) },
            label = stringResource(StringKey.SETUP_PRINTER_ETHERNET_PORT_LABEL),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(IdentoSpacing.md))

        val portNumber = port.toIntOrNull()
        val canConfirm = ip.isNotBlank() && portNumber != null
        OutlinedButton(
            onClick = {
                if (portNumber != null) {
                    viewModel.onEthernetAddressConfirmed(name = name.ifBlank { ip }, ip = ip, port = portNumber)
                }
            },
            enabled = canConfirm,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(IdentoRadius.buttonSecondary),
            border = BorderStroke(1.dp, IdentoColors.Border),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = IdentoColors.ButtonLabel,
                disabledContentColor = IdentoColors.TextDisabled,
            ),
        ) {
            Text(stringResource(StringKey.SAVE))
        }
    }
}

@Composable
private fun QrTab(cameraService: CameraService, viewModel: SetupPrinterViewModel, modifier: Modifier = Modifier) {
    // Same `CameraService.startScanning(): Flow<String>` pattern as `SetupLoginScreen`'s QR tab
    // (Task 3), just decoding a `PrinterConfig` JSON payload instead of a provisioning token.
    // Malformed/unrelated QR payloads (e.g. a different screen's QR code) are simply ignored —
    // scanning keeps running until a payload that actually parses as `PrinterConfig` shows up.
    LaunchedEffect(Unit) {
        if (!cameraService.hasCameraPermission()) return@LaunchedEffect
        cameraService.startScanning().collect { raw ->
            val config = runCatching { printerQrJson.decodeFromString(PrinterConfig.serializer(), raw) }.getOrNull()
            if (config != null) {
                cameraService.stopScanning()
                viewModel.onPrinterQrScanned(config)
            }
        }
    }

    // Switching away to another tab must stop the camera — unlike SetupLoginScreen (a whole
    // screen, left exactly once via navigation), this is one of three tabs on the same screen, so
    // the user can switch back and forth without ever navigating away.
    DisposableEffect(Unit) {
        onDispose { cameraService.stopScanning() }
    }

    Column(
        modifier = modifier.padding(horizontal = IdentoSpacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        ScanReticle()

        Spacer(modifier = Modifier.height(IdentoSpacing.lg))

        Text(
            text = stringResource(StringKey.SETUP_PRINTER_QR_HINT),
            color = IdentoColors.TextSecondary,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
        )
    }
}
