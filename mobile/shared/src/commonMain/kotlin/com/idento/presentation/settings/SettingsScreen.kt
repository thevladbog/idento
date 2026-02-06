package com.idento.presentation.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.preferences.AppPreferences
import com.idento.presentation.components.ActionSheet
import com.idento.presentation.components.ActionSheetItem
import org.koin.compose.koinInject

/**
 * Settings Screen (Cross-platform)
 * App settings, printer config, scanner setup
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel = koinInject(),
    onNavigateBack: () -> Unit = {},
    onNavigateToBluetoothScanner: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    
    var showThemeSheet by remember { mutableStateOf(false) }
    var showLanguageSheet by remember { mutableStateOf(false) }
    var showPrinterTypeSheet by remember { mutableStateOf(false) }
    var showBluetoothPrinterSheet by remember { mutableStateOf(false) }
    var showEthernetPrinterDialog by remember { mutableStateOf(false) }
    var showScannerSheet by remember { mutableStateOf(false) }
    
    // Theme Action Sheet
    ActionSheet(
        visible = showThemeSheet,
        onDismiss = { showThemeSheet = false },
        title = stringResource(StringKey.THEME),
        actions = listOf(
            ActionSheetItem(
                title = stringResource(StringKey.THEME_SYSTEM),
                onClick = { viewModel.setThemeMode(AppPreferences.THEME_SYSTEM) }
            ),
            ActionSheetItem(
                title = stringResource(StringKey.THEME_LIGHT),
                onClick = { viewModel.setThemeMode(AppPreferences.THEME_LIGHT) }
            ),
            ActionSheetItem(
                title = stringResource(StringKey.THEME_DARK),
                onClick = { viewModel.setThemeMode(AppPreferences.THEME_DARK) }
            )
        )
    )
    
    // Language Action Sheet
    ActionSheet(
        visible = showLanguageSheet,
        onDismiss = { showLanguageSheet = false },
        title = stringResource(StringKey.LANGUAGE),
        actions = listOf(
            ActionSheetItem(
                title = stringResource(StringKey.LANGUAGE_SYSTEM),
                onClick = { viewModel.setLanguage(AppPreferences.LANG_SYSTEM) }
            ),
            ActionSheetItem(
                title = stringResource(StringKey.LANGUAGE_ENGLISH),
                onClick = { viewModel.setLanguage(AppPreferences.LANG_EN) }
            ),
            ActionSheetItem(
                title = stringResource(StringKey.LANGUAGE_RUSSIAN),
                onClick = { viewModel.setLanguage(AppPreferences.LANG_RU) }
            )
        )
    )
    
    // Printer Type Action Sheet
    ActionSheet(
        visible = showPrinterTypeSheet,
        onDismiss = { showPrinterTypeSheet = false },
        title = stringResource(StringKey.PRINTER_SETTINGS),
        actions = listOf(
            ActionSheetItem(
                title = stringResource(StringKey.SCAN_QR_CODE),
                icon = Icons.Default.Search,
                onClick = { viewModel.showPrinterQRScanner() }
            ),
            ActionSheetItem(
                title = "Bluetooth",
                icon = Icons.Default.Phone,
                onClick = { showBluetoothPrinterSheet = true }
            ),
            ActionSheetItem(
                title = "Ethernet (IP)",
                icon = Icons.Default.Settings,
                onClick = { showEthernetPrinterDialog = true }
            )
        )
    )
    
    // Ethernet Printer Dialog
    if (showEthernetPrinterDialog) {
        EthernetPrinterDialog(
            onDismiss = { showEthernetPrinterDialog = false },
            onSave = { ip, port, name ->
                viewModel.selectEthernetPrinter(ip, port, name)
                showEthernetPrinterDialog = false
            }
        )
    }
    
    // QR Scanner for Printer Config
    if (uiState.showPrinterQRScanner) {
        PrinterQRScannerDialog(
            onDismiss = { viewModel.hidePrinterQRScanner() },
            onQRScanned = { qrContent ->
                viewModel.configurePrinterFromQR(qrContent)
                viewModel.hidePrinterQRScanner()
            }
        )
    }
    
    // Scanner Action Sheet
    ActionSheet(
        visible = showScannerSheet,
        onDismiss = { showScannerSheet = false },
        title = "Barcode Scanner",
        actions = listOf(
            ActionSheetItem(
                title = "Camera Scanner",
                icon = Icons.Default.Search,
                onClick = { viewModel.setScannerMode("camera") }
            ),
            ActionSheetItem(
                title = "Hardware Scanner (USB/Bluetooth)",
                icon = Icons.Default.Phone,
                onClick = { viewModel.setScannerMode("hardware") }
            )
        )
    )
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Text(
                        "Settings",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    ) 
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            // === APPEARANCE SECTION ===
            SettingsSection(title = "Appearance") {
                SettingsGroup {
                    // Theme
                    SettingsRow(
                        icon = Icons.Default.Face,
                        title = "Theme",
                        value = when (uiState.themeMode) {
                            AppPreferences.THEME_LIGHT -> "Light"
                            AppPreferences.THEME_DARK -> "Dark"
                            else -> "System"
                        },
                        onClick = { showThemeSheet = true }
                    )
                    
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 56.dp),
                        color = MaterialTheme.colorScheme.outlineVariant
                    )
                    
                    // Language
                    SettingsRow(
                        icon = Icons.Default.Place,
                        title = "Language",
                        value = when (uiState.language) {
                            AppPreferences.LANG_EN -> "English"
                            AppPreferences.LANG_RU -> "Русский"
                            else -> "System"
                        },
                        onClick = { showLanguageSheet = true }
                    )
                }
            }
            
            // === PRINTER SECTION ===
            SettingsSection(title = "Label Printer") {
                SettingsGroup {
                    // Printer Selection
                    SettingsRow(
                        icon = Icons.Default.Create,
                        title = "Printer",
                        value = uiState.selectedPrinterName ?: "Not configured",
                        valueColor = if (uiState.selectedPrinterName != null) 
                            MaterialTheme.colorScheme.primary 
                        else 
                            MaterialTheme.colorScheme.onSurfaceVariant,
                        onClick = { showPrinterTypeSheet = true }
                    )
                    
                    if (uiState.selectedPrinterName != null) {
                        HorizontalDivider(
                            modifier = Modifier.padding(start = 56.dp),
                            color = MaterialTheme.colorScheme.outlineVariant
                        )
                        
                        // Printer Address
                        SettingsRow(
                            icon = Icons.Default.Info,
                            title = "Address",
                            value = uiState.selectedPrinterAddress ?: "-",
                            showArrow = false
                        )
                        
                        HorizontalDivider(
                            modifier = Modifier.padding(start = 56.dp),
                            color = MaterialTheme.colorScheme.outlineVariant
                        )
                        
                        // Test Print
                        SettingsRow(
                            icon = Icons.Default.Check,
                            title = "Test Print",
                            value = if (uiState.isTestingPrinter) "Printing..." else "Send test label",
                            valueColor = MaterialTheme.colorScheme.primary,
                            onClick = { viewModel.testPrint() },
                            showArrow = false
                        )
                        
                        HorizontalDivider(
                            modifier = Modifier.padding(start = 56.dp),
                            color = MaterialTheme.colorScheme.outlineVariant
                        )
                        
                        // Clear Printer
                        SettingsRow(
                            icon = Icons.Default.Delete,
                            iconTint = MaterialTheme.colorScheme.error,
                            title = "Remove Printer",
                            titleColor = MaterialTheme.colorScheme.error,
                            onClick = { viewModel.clearPrinter() },
                            showArrow = false
                        )
                    }
                }
            }
            
            // === SCANNER SECTION ===
            SettingsSection(title = "Barcode Scanner") {
                SettingsGroup {
                    // Scanner Mode
                    SettingsRow(
                        icon = Icons.Default.Search,
                        title = "Scanner Mode",
                        value = when (uiState.scannerMode) {
                            "hardware" -> "Hardware Scanner"
                            else -> "Camera"
                        },
                        onClick = { showScannerSheet = true }
                    )
                    
                    if (uiState.scannerMode == "hardware") {
                        HorizontalDivider(
                            modifier = Modifier.padding(start = 56.dp),
                            color = MaterialTheme.colorScheme.outlineVariant
                        )
                        
                        // Hardware Scanner Status
                        SettingsRow(
                            icon = Icons.Default.Check,
                            title = "Scanner Status",
                            value = if (uiState.isHardwareScannerConnected) "Connected" else "Disconnected",
                            valueColor = if (uiState.isHardwareScannerConnected) 
                                Color(0xFF4CAF50) 
                            else 
                                MaterialTheme.colorScheme.onSurfaceVariant,
                            showArrow = false
                        )
                    }
                }
            }
            
            // === ABOUT SECTION ===
            SettingsSection(title = "About") {
                SettingsGroup {
                    SettingsRow(
                        icon = Icons.Default.Info,
                        title = "Version",
                        value = "1.0.0",
                        showArrow = false
                    )
                }
            }
            
            // Success/Error Messages
            uiState.successMessage?.let { message ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = Color(0xFF4CAF50).copy(alpha = 0.1f)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = null,
                            tint = Color(0xFF4CAF50)
                        )
                        Text(
                            text = message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF4CAF50)
                        )
                    }
                }
            }
            
            uiState.errorMessage?.let { message ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
            
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun SettingsSection(
    title: String,
    content: @Composable () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = title.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp)
        )
        content()
    }
}

@Composable
private fun SettingsGroup(
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp
    ) {
        Column(content = content)
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    value: String? = null,
    iconTint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    titleColor: Color = MaterialTheme.colorScheme.onSurface,
    valueColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    showArrow: Boolean = true,
    onClick: (() -> Unit)? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier
            )
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = iconTint,
            modifier = Modifier.size(24.dp)
        )
        
        Spacer(modifier = Modifier.width(16.dp))
        
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            color = titleColor,
            modifier = Modifier.weight(1f)
        )
        
        value?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = valueColor
            )
        }
        
        if (showArrow && onClick != null) {
            Spacer(modifier = Modifier.width(8.dp))
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

@Composable
private fun EthernetPrinterDialog(
    onDismiss: () -> Unit,
    onSave: (ip: String, port: Int, name: String) -> Unit
) {
    var ip by remember { mutableStateOf("") }
    var port by remember { mutableStateOf("9100") }
    var name by remember { mutableStateOf("Ethernet Printer") }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Ethernet Printer") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = ip,
                    onValueChange = { ip = it },
                    label = { Text("IP Address") },
                    placeholder = { Text("192.168.1.100") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = port,
                    onValueChange = { port = it.filter { c -> c.isDigit() } },
                    label = { Text("Port") },
                    placeholder = { Text("9100") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { 
                    val portNum = port.toIntOrNull() ?: 9100
                    onSave(ip, portNum, name)
                },
                enabled = ip.isNotBlank()
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

/**
 * QR Scanner Dialog for Printer Configuration
 * Scans QR code containing printer settings JSON
 */
@Composable
private fun PrinterQRScannerDialog(
    onDismiss: () -> Unit,
    onQRScanned: (String) -> Unit
) {
    var manualInput by remember { mutableStateOf("") }
    var showManualInput by remember { mutableStateOf(false) }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Scan Printer QR Code") },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (!showManualInput) {
                    // QR Scanner placeholder - actual camera will be platform-specific
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp),
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Icon(
                                    Icons.Default.Search,
                                    contentDescription = null,
                                    modifier = Modifier.size(48.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    "Point camera at QR code",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                    
                    TextButton(onClick = { showManualInput = true }) {
                        Text("Enter manually")
                    }
                    
                    // QR Code format hint
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                "QR Code Format:",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                "Ethernet: {\"type\":\"ethernet\",\"ip\":\"192.168.1.100\",\"port\":9100}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                "Bluetooth: {\"type\":\"bluetooth\",\"address\":\"XX:XX:XX:XX\"}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                } else {
                    // Manual JSON input
                    OutlinedTextField(
                        value = manualInput,
                        onValueChange = { manualInput = it },
                        label = { Text("Printer Config JSON") },
                        placeholder = { Text("{\"type\":\"ethernet\",\"ip\":\"...\"}") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 3,
                        maxLines = 5
                    )
                    
                    TextButton(onClick = { showManualInput = false }) {
                        Text("Back to scanner")
                    }
                }
            }
        },
        confirmButton = {
            if (showManualInput) {
                TextButton(
                    onClick = { onQRScanned(manualInput) },
                    enabled = manualInput.isNotBlank()
                ) {
                    Text("Apply")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
