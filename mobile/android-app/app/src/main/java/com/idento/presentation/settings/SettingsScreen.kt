package com.idento.presentation.settings

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.BluetoothSearching
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.idento.R
import com.google.accompanist.permissions.*
import com.idento.data.bluetooth.BluetoothPrinter
import com.idento.data.preferences.AppPreferences
import com.idento.presentation.theme.*

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onNavigateToBluetoothScanner: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    
    val bluetoothPermissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        listOf(
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN
        )
    } else {
        listOf(
            Manifest.permission.BLUETOOTH,
            Manifest.permission.BLUETOOTH_ADMIN
        )
    }
    
    val bluetoothPermissionState = rememberMultiplePermissionsState(bluetoothPermissions)
    
    LaunchedEffect(uiState.printerType) {
        if (uiState.printerType == PrinterType.BLUETOOTH) {
            if (!bluetoothPermissionState.allPermissionsGranted) {
                bluetoothPermissionState.launchMultiplePermissionRequest()
            } else {
                viewModel.refreshBluetoothPrinters()
            }
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings", style = MaterialTheme.typography.titleLarge) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent
                )
            )
        },
        floatingActionButton = {
            AnimatedVisibility(
                visible = uiState.printerType == PrinterType.BLUETOOTH && 
                         bluetoothPermissionState.allPermissionsGranted && 
                         uiState.isBluetoothEnabled,
                enter = scaleIn() + fadeIn(),
                exit = scaleOut() + fadeOut()
            ) {
                FloatingActionButton(
                    onClick = { viewModel.refreshBluetoothPrinters() },
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                ) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "Refresh")
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item { Spacer(modifier = Modifier.height(8.dp)) }
            
            // Bluetooth Scanner Link
            item {
                SettingsLinkCard(
                    icon = Icons.Outlined.QrCodeScanner,
                    title = "Bluetooth Scanner",
                    subtitle = "External barcode scanner settings",
                    onClick = onNavigateToBluetoothScanner
                )
            }
            
            // Printer Section Header
            item {
                Text(
                    text = stringResource(R.string.badge_printer),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
            
            // Printer Type
            item {
                PrinterTypeSelector(
                    selectedType = uiState.printerType,
                    onTypeSelected = { viewModel.switchPrinterType(it) }
                )
            }
            
            // Bluetooth Section
            if (uiState.printerType == PrinterType.BLUETOOTH) {
                item {
                    BluetoothStatusCard(
                        isEnabled = uiState.isBluetoothEnabled,
                        hasPermission = bluetoothPermissionState.allPermissionsGranted,
                        onEnableBluetooth = {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                                context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                            }
                        },
                        onRequestPermission = {
                            if (!bluetoothPermissionState.allPermissionsGranted) {
                                bluetoothPermissionState.launchMultiplePermissionRequest()
                            }
                        }
                    )
                }
            }
            
            // Ethernet Section
            if (uiState.printerType == PrinterType.ETHERNET) {
                item {
                    EthernetPrinterForm(
                        ipAddress = uiState.ethernetIpAddress,
                        port = uiState.ethernetPort,
                        printerName = uiState.ethernetName,
                        onIpChanged = { viewModel.onEthernetIpChanged(it) },
                        onPortChanged = { viewModel.onEthernetPortChanged(it) },
                        onNameChanged = { viewModel.onEthernetNameChanged(it) },
                        onSave = { viewModel.saveEthernetPrinter() },
                        isLoading = uiState.isLoading
                    )
                }
            }
            
            // Selected Printer
            if (uiState.selectedPrinterName != null) {
                item {
                    SelectedPrinterCard(
                        printerName = uiState.selectedPrinterName!!,
                        onTestPrint = { viewModel.testPrint() },
                        onClearPrinter = { viewModel.clearPrinter() },
                        isTesting = uiState.isTestingPrinter
                    )
                }
            }
            
            // Available Printers
            if (bluetoothPermissionState.allPermissionsGranted && uiState.isBluetoothEnabled && 
                uiState.printerType == PrinterType.BLUETOOTH) {
                item {
                    Text(
                        text = stringResource(R.string.available_printers),
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                
                if (uiState.isLoading) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator(strokeWidth = 2.dp)
                        }
                    }
                } else if (uiState.availableBluetoothPrinters.isEmpty()) {
                    item { EmptyPrintersCard() }
                } else {
                    items(
                        items = uiState.availableBluetoothPrinters,
                        key = { it.address }
                    ) { printer ->
                        PrinterCard(
                            printer = printer,
                            isSelected = printer.address == uiState.selectedPrinterAddress && 
                                        uiState.selectedPrinterType == "bluetooth",
                            onSelect = { viewModel.selectBluetoothPrinter(printer) }
                        )
                    }
                }
            }
            
            // Messages
            uiState.errorMessage?.let { message ->
                item { MessageCard(message = message, isError = true) }
            }
            
            uiState.successMessage?.let { message ->
                item { MessageCard(message = message, isError = false) }
            }
            
            item { Spacer(modifier = Modifier.height(80.dp)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsLinkCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = CardShape,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(22.dp)
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

@Composable
private fun PrinterTypeSelector(
    selectedType: PrinterType,
    onTypeSelected: (PrinterType) -> Unit
) {
    Surface(
        shape = CardShape,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = stringResource(R.string.connection_type),
                style = MaterialTheme.typography.titleSmall
            )
            Spacer(modifier = Modifier.height(12.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                FilterChip(
                    selected = selectedType == PrinterType.BLUETOOTH,
                    onClick = { onTypeSelected(PrinterType.BLUETOOTH) },
                    label = { Text(stringResource(R.string.bluetooth)) },
                    leadingIcon = {
                        Icon(
                            Icons.Outlined.Bluetooth, 
                            contentDescription = null, 
                            modifier = Modifier.size(18.dp)
                        )
                    },
                    shape = ChipShape,
                    modifier = Modifier.weight(1f)
                )
                
                FilterChip(
                    selected = selectedType == PrinterType.ETHERNET,
                    onClick = { onTypeSelected(PrinterType.ETHERNET) },
                    label = { Text(stringResource(R.string.ethernet)) },
                    leadingIcon = {
                        Icon(
                            Icons.Outlined.Cable, 
                            contentDescription = null, 
                            modifier = Modifier.size(18.dp)
                        )
                    },
                    shape = ChipShape,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun BluetoothStatusCard(
    isEnabled: Boolean,
    hasPermission: Boolean,
    onEnableBluetooth: () -> Unit,
    onRequestPermission: () -> Unit
) {
    val isReady = isEnabled && hasPermission
    
    Surface(
        shape = CardShape,
        color = if (isReady) SuccessLight else WarningLight
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(
                    imageVector = if (isReady) Icons.Default.BluetoothConnected else Icons.Outlined.BluetoothDisabled,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = if (isReady) Success else Warning
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.bluetooth),
                        style = MaterialTheme.typography.titleSmall
                    )
                    Text(
                        text = when {
                            !hasPermission -> "Permission required"
                            !isEnabled -> "Disabled"
                            else -> "Ready"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (isReady) Color(0xFF166534) else Color(0xFF92400E)
                    )
                }
            }
            
            if (!hasPermission) {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onRequestPermission,
                    modifier = Modifier.fillMaxWidth(),
                    shape = ButtonShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Warning
                    )
                ) {
                    Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.grant_permission))
                }
            } else if (!isEnabled) {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onEnableBluetooth,
                    modifier = Modifier.fillMaxWidth(),
                    shape = ButtonShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Warning
                    )
                ) {
                    Icon(Icons.Outlined.Settings, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.enable_bluetooth))
                }
            }
        }
    }
}

@Composable
private fun SelectedPrinterCard(
    printerName: String,
    onTestPrint: () -> Unit,
    onClearPrinter: () -> Unit,
    isTesting: Boolean
) {
    Surface(
        shape = CardShape,
        color = PrimaryContainer
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Print,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = Primary
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.selected_printer),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = printerName,
                        style = MaterialTheme.typography.titleSmall
                    )
                }
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = Primary,
                    modifier = Modifier.size(20.dp)
                )
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = onTestPrint,
                    enabled = !isTesting,
                    modifier = Modifier.weight(1f),
                    shape = ButtonShape
                ) {
                    if (isTesting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(Icons.Outlined.Print, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.test))
                }
                
                OutlinedButton(
                    onClick = onClearPrinter,
                    enabled = !isTesting,
                    modifier = Modifier.weight(1f),
                    shape = ButtonShape,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Error
                    )
                ) {
                    Icon(Icons.Outlined.Clear, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.remove))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PrinterCard(
    printer: BluetoothPrinter,
    isSelected: Boolean,
    onSelect: () -> Unit
) {
    Surface(
        onClick = onSelect,
        shape = CardShape,
        color = if (isSelected) PrimaryContainer else MaterialTheme.colorScheme.surface,
        tonalElevation = if (isSelected) 0.dp else 1.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = Icons.Outlined.Print,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = if (isSelected) Primary else MaterialTheme.colorScheme.onSurfaceVariant
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = printer.name,
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = printer.address,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = Primary,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

@Composable
private fun EmptyPrintersCard() {
    Surface(
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.BluetoothSearching,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = stringResource(R.string.no_printers_found),
                style = MaterialTheme.typography.titleSmall
            )
            Text(
                text = stringResource(R.string.printer_pairing_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun MessageCard(message: String, isError: Boolean) {
    Surface(
        shape = CardShape,
        color = if (isError) ErrorLight else SuccessLight
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = if (isError) Icons.Outlined.Error else Icons.Default.CheckCircle,
                contentDescription = null,
                tint = if (isError) Error else Success,
                modifier = Modifier.size(20.dp)
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = if (isError) Color(0xFF991B1B) else Color(0xFF166534)
            )
        }
    }
}

@Composable
private fun EthernetPrinterForm(
    ipAddress: String,
    port: String,
    printerName: String,
    onIpChanged: (String) -> Unit,
    onPortChanged: (String) -> Unit,
    onNameChanged: (String) -> Unit,
    onSave: () -> Unit,
    isLoading: Boolean
) {
    Surface(
        shape = CardShape,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = stringResource(R.string.ethernet_printer),
                style = MaterialTheme.typography.titleSmall
            )
            
            OutlinedTextField(
                value = ipAddress,
                onValueChange = onIpChanged,
                label = { Text(stringResource(R.string.ip_address)) },
                placeholder = { Text(stringResource(R.string.ip_address_placeholder)) },
                leadingIcon = { Icon(Icons.Outlined.Cable, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
                shape = InputShape,
                singleLine = true
            )
            
            OutlinedTextField(
                value = port,
                onValueChange = onPortChanged,
                label = { Text(stringResource(R.string.port)) },
                placeholder = { Text(stringResource(R.string.port_placeholder)) },
                modifier = Modifier.fillMaxWidth(),
                shape = InputShape,
                singleLine = true
            )
            
            OutlinedTextField(
                value = printerName,
                onValueChange = onNameChanged,
                label = { Text(stringResource(R.string.printer_name)) },
                placeholder = { Text(stringResource(R.string.printer_name_placeholder)) },
                modifier = Modifier.fillMaxWidth(),
                shape = InputShape,
                singleLine = true
            )
            
            Button(
                onClick = onSave,
                enabled = !isLoading && ipAddress.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                shape = ButtonShape
            ) {
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(stringResource(R.string.save))
            }
        }
    }
}
