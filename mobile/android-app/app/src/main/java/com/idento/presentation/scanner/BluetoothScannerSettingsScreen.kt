package com.idento.presentation.scanner

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.BluetoothSearching
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.permissions.*
import com.idento.data.scanner.BluetoothScanner
import com.idento.presentation.components.IdentoCard
import com.idento.presentation.components.IdentoListCard

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun BluetoothScannerSettingsScreen(
    viewModel: BluetoothScannerViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    
    // Bluetooth permissions
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
    
    // Запрашиваем разрешения при первом открытии
    LaunchedEffect(Unit) {
        if (!bluetoothPermissionState.allPermissionsGranted) {
            bluetoothPermissionState.launchMultiplePermissionRequest()
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Bluetooth Scanner Settings") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        floatingActionButton = {
            if (bluetoothPermissionState.allPermissionsGranted && uiState.isBluetoothEnabled) {
                FloatingActionButton(
                    onClick = { viewModel.refreshScanners() }
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                }
            }
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item { Spacer(modifier = Modifier.height(8.dp)) }
            
            // Статус Bluetooth
            item {
                BluetoothStatusCard(
                    isEnabled = uiState.isBluetoothEnabled,
                    hasPermission = bluetoothPermissionState.allPermissionsGranted,
                    onEnableBluetooth = {
                        context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                    },
                    onRequestPermission = {
                        if (!bluetoothPermissionState.allPermissionsGranted) {
                            bluetoothPermissionState.launchMultiplePermissionRequest()
                        }
                    }
                )
            }
            
            // Текущий выбранный сканер
            if (uiState.selectedScannerName != null) {
                item {
                    SelectedScannerCard(
                        scannerName = uiState.selectedScannerName!!,
                        onTest = { viewModel.testConnection() },
                        onDisconnect = { viewModel.clearScanner() },
                        isTesting = uiState.isTesting,
                        isConnected = uiState.isConnected
                    )
                }
            }
            
            // Success/Error messages
            uiState.successMessage?.let { message ->
                item {
                    SuccessCard(message = message)
                }
            }
            
            uiState.errorMessage?.let { message ->
                item {
                    ErrorCard(
                        message = message,
                        onDismiss = { viewModel.clearMessages() }
                    )
                }
            }
            
            // Список доступных сканеров
            if (bluetoothPermissionState.allPermissionsGranted && uiState.isBluetoothEnabled) {
                item {
                    Text(
                        text = "Available Scanners",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(vertical = 8.dp)
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
                            CircularProgressIndicator()
                        }
                    }
                } else if (uiState.availableScanners.isEmpty()) {
                    item {
                        EmptyScannersCard()
                    }
                } else {
                    items(
                        items = uiState.availableScanners,
                        key = { it.address }
                    ) { scanner ->
                        ScannerCard(
                            scanner = scanner,
                            isSelected = scanner.address == uiState.selectedScannerAddress,
                            isConnecting = uiState.connectingToAddress == scanner.address,
                            onSelect = { viewModel.selectScanner(scanner) }
                        )
                    }
                }
            }
            
            item { Spacer(modifier = Modifier.height(80.dp)) }
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
    IdentoCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (isEnabled) Icons.Default.Bluetooth else Icons.Default.BluetoothDisabled,
                        contentDescription = null,
                        tint = if (isEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(32.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Text(
                            text = "Bluetooth Status",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = when {
                                !hasPermission -> "Permission Required"
                                !isEnabled -> "Disabled"
                                else -> "Enabled"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = when {
                                !hasPermission -> MaterialTheme.colorScheme.error
                                !isEnabled -> MaterialTheme.colorScheme.error
                                else -> MaterialTheme.colorScheme.primary
                            }
                        )
                    }
                }
            }
            
            if (!hasPermission) {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onRequestPermission,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Security, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Grant Permission")
                }
            } else if (!isEnabled) {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onEnableBluetooth,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Bluetooth, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Enable Bluetooth")
                }
            }
        }
    }
}

@Composable
private fun SelectedScannerCard(
    scannerName: String,
    onTest: () -> Unit,
    onDisconnect: () -> Unit,
    isTesting: Boolean,
    isConnected: Boolean
) {
    IdentoCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = if (isConnected) Icons.Default.BluetoothConnected else Icons.Default.Bluetooth,
                    contentDescription = null,
                    tint = if (isConnected) Color(0xFF4CAF50) else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(32.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Selected Scanner",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = scannerName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    if (isConnected) {
                        Text(
                            text = "Connected",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF4CAF50)
                        )
                    }
                }
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Button(
                    onClick = onTest,
                    enabled = !isTesting,
                    modifier = Modifier.weight(1f)
                ) {
                    if (isTesting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    Text("Test")
                }
                
                OutlinedButton(
                    onClick = onDisconnect,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Close, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Disconnect")
                }
            }
        }
    }
}

@Composable
private fun ScannerCard(
    scanner: BluetoothScanner,
    isSelected: Boolean,
    isConnecting: Boolean,
    onSelect: () -> Unit
) {
    IdentoListCard(
        modifier = Modifier.clickable(onClick = onSelect)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (scanner.isPaired) Icons.Default.BluetoothConnected else Icons.Default.Bluetooth,
                contentDescription = null,
                tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(32.dp)
            )
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = scanner.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                )
                Text(
                    text = scanner.address,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (scanner.isPaired) {
                    Text(
                        text = "Paired",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            
            if (isConnecting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp
                )
            } else if (isSelected) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "Selected",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

@Composable
private fun EmptyScannersCard() {
    IdentoCard {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.BluetoothSearching,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "No scanners found",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Make sure your scanner is powered on and in pairing mode",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun SuccessCard(message: String) {
    Surface(
        color = Color(0xFFE8F5E9),
        shape = MaterialTheme.shapes.large
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = Color(0xFF4CAF50)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFF1B5E20)
            )
        }
    }
}

@Composable
private fun ErrorCard(
    message: String,
    onDismiss: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        shape = MaterialTheme.shapes.large
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Error,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = onDismiss) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Dismiss",
                    tint = MaterialTheme.colorScheme.onErrorContainer
                )
            }
        }
    }
}
