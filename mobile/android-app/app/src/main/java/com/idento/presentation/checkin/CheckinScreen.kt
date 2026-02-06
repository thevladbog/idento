package com.idento.presentation.checkin

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.idento.data.model.Attendee
import com.idento.presentation.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CheckinScreen(
    viewModel: CheckinViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onNavigateToAttendeesList: () -> Unit,
    onNavigateToTemplateEditor: (String) -> Unit,
    onNavigateToQRScanner: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Check-in",
                            style = MaterialTheme.typography.titleLarge
                        )
                        Text(
                            text = uiState.eventName,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                actions = {
                    var expanded by remember { mutableStateOf(false) }
                    
                    IconButton(onClick = { expanded = true }) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = "Menu")
                    }
                    
                    DropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("Terminal Mode") },
                            onClick = {
                                expanded = false
                                onNavigateToQRScanner()
                            },
                            leadingIcon = {
                                Icon(Icons.Outlined.QrCodeScanner, contentDescription = null)
                            }
                        )
                        
                        HorizontalDivider()
                        
                        DropdownMenuItem(
                            text = { Text("View All Attendees") },
                            onClick = {
                                expanded = false
                                onNavigateToAttendeesList()
                            },
                            leadingIcon = {
                                Icon(Icons.Outlined.People, contentDescription = null)
                            }
                        )
                        
                        DropdownMenuItem(
                            text = { Text("Edit Success Screen") },
                            onClick = {
                                expanded = false
                                onNavigateToTemplateEditor("success_screen")
                            },
                            leadingIcon = {
                                Icon(Icons.Outlined.Edit, contentDescription = null)
                            }
                        )
                        
                        DropdownMenuItem(
                            text = { Text("Edit Badge Template") },
                            onClick = {
                                expanded = false
                                onNavigateToTemplateEditor("badge_template")
                            },
                            leadingIcon = {
                                Icon(Icons.Outlined.Badge, contentDescription = null)
                            }
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Spacer(modifier = Modifier.height(8.dp))
                
                // Hardware Scanner Info
                AnimatedVisibility(
                    visible = uiState.isHardwareScannerAvailable,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically()
                ) {
                    HardwareScannerInfoCard(
                        scannerName = uiState.hardwareScannerName ?: "Scanner"
                    )
                }
                
                // Search Bar - modern floating style
                SearchBar(
                    query = uiState.searchQuery,
                    onQueryChanged = { viewModel.onSearchQueryChanged(it) },
                    onClear = { viewModel.clearSelectedAttendee() }
                )
                
                // Suggestions
                AnimatedVisibility(
                    visible = uiState.searchSuggestions.isNotEmpty() && uiState.selectedAttendee == null,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically()
                ) {
                    SearchSuggestionsCard(
                        suggestions = uiState.searchSuggestions,
                        onSuggestionClick = { viewModel.selectAttendee(it) }
                    )
                }
                
                // Selected Attendee
                AnimatedVisibility(
                    visible = uiState.selectedAttendee != null,
                    enter = fadeIn() + scaleIn(initialScale = 0.95f),
                    exit = fadeOut() + scaleOut(targetScale = 0.95f)
                ) {
                    uiState.selectedAttendee?.let { attendee ->
                        AttendeeDetailCard(
                            attendee = attendee,
                            onCheckin = { viewModel.checkinAttendee(it.id) },
                            onPrint = if (uiState.autoPrintBadge && uiState.printOnButton) {
                                { viewModel.printBadge(it) }
                            } else null,
                            isLoading = uiState.isLoading,
                            isPrinting = uiState.isPrinting,
                            hasPrinterConfigured = uiState.hasPrinterConfigured
                        )
                    }
                }
                
                // Empty state
                AnimatedVisibility(
                    visible = uiState.selectedAttendee == null && uiState.searchQuery.isEmpty(),
                    enter = fadeIn(),
                    exit = fadeOut()
                ) {
                    EmptyStateCard(
                        onViewAllClick = onNavigateToAttendeesList,
                        isHardwareScannerAvailable = uiState.isHardwareScannerAvailable
                    )
                }
                
                // Loading
                if (uiState.isLoading && uiState.selectedAttendee == null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(strokeWidth = 2.dp)
                    }
                }
            }
            
            // Snackbar messages
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                uiState.successMessage?.let { message ->
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = SuccessLight,
                        contentColor = Color(0xFF166534)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.CheckCircle, contentDescription = null, modifier = Modifier.size(20.dp))
                            Text(message, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                
                uiState.printSuccess?.let { message ->
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = InfoLight,
                        contentColor = Color(0xFF1E40AF)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Outlined.Print, contentDescription = null, modifier = Modifier.size(20.dp))
                            Text(message, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                
                uiState.errorMessage?.let { message ->
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = ErrorLight,
                        contentColor = Color(0xFF991B1B),
                        onClick = { viewModel.clearError() }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Outlined.Error, contentDescription = null, modifier = Modifier.size(20.dp))
                            Text(message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                            Icon(Icons.Default.Close, contentDescription = "Dismiss", modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HardwareScannerInfoCard(scannerName: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = CardShape,
        color = InfoLight,
        contentColor = Color(0xFF1E40AF)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = Icons.Outlined.QrCodeScanner,
                contentDescription = null,
                modifier = Modifier.size(24.dp)
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Terminal Mode",
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = scannerName,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF1E40AF).copy(alpha = 0.7f)
                )
            }
            Surface(
                shape = ChipShape,
                color = Success.copy(alpha = 0.15f)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(Success)
                    )
                    Text(
                        text = "Active",
                        style = MaterialTheme.typography.labelSmall,
                        color = Success
                    )
                }
            }
        }
    }
}

@Composable
private fun SearchBar(
    query: String,
    onQueryChanged: (String) -> Unit,
    onClear: () -> Unit
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChanged,
        placeholder = { 
            Text(
                "Search by name, email, or code...",
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            ) 
        },
        leadingIcon = {
            Icon(
                Icons.Outlined.Search, 
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = onClear) {
                    Icon(Icons.Default.Close, contentDescription = "Clear")
                }
            }
        } else null,
        modifier = Modifier.fillMaxWidth(),
        shape = InputShape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface
        ),
        singleLine = true
    )
}

@Composable
private fun SearchSuggestionsCard(
    suggestions: List<Attendee>,
    onSuggestionClick: (Attendee) -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = CardShape,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp
    ) {
        LazyColumn(
            modifier = Modifier.heightIn(max = 320.dp)
        ) {
            items(suggestions) { attendee ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSuggestionClick(attendee) }
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Avatar
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(
                                if (attendee.checkedInAt != null)
                                    Success
                                else
                                    MaterialTheme.colorScheme.primaryContainer
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = attendee.firstName.take(1).uppercase(),
                            style = MaterialTheme.typography.titleMedium,
                            color = if (attendee.checkedInAt != null)
                                Color.White
                            else
                                MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                    
                    // Info
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "${attendee.firstName} ${attendee.lastName}",
                            style = MaterialTheme.typography.titleSmall
                        )
                        if (attendee.company.isNotEmpty()) {
                            Text(
                                text = attendee.company,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    
                    // Check icon
                    if (attendee.checkedInAt != null) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = "Checked in",
                            tint = Success,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
                
                if (suggestions.last() != attendee) {
                    HorizontalDivider(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
                    )
                }
            }
        }
    }
}

@Composable
private fun AttendeeDetailCard(
    attendee: Attendee,
    onCheckin: (Attendee) -> Unit,
    onPrint: ((Attendee) -> Unit)?,
    isLoading: Boolean,
    isPrinting: Boolean,
    hasPrinterConfigured: Boolean
) {
    val isCheckedIn = attendee.checkedInAt != null
    
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = CardShape,
        color = if (isCheckedIn) SuccessLight else MaterialTheme.colorScheme.surface,
        tonalElevation = if (isCheckedIn) 0.dp else 1.dp
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Header
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Avatar
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(
                            if (isCheckedIn) Success else MaterialTheme.colorScheme.primary
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = attendee.firstName.take(1).uppercase(),
                        style = MaterialTheme.typography.headlineSmall,
                        color = Color.White
                    )
                }
                
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "${attendee.firstName} ${attendee.lastName}",
                        style = MaterialTheme.typography.titleLarge
                    )
                    
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        if (isCheckedIn) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = Success,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                "Checked In",
                                style = MaterialTheme.typography.bodyMedium,
                                color = Color(0xFF166534)
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Outlined.RadioButtonUnchecked,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                "Not Checked In",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
            
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
            
            // Info rows
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (attendee.company.isNotEmpty()) {
                    InfoRow(
                        icon = Icons.Outlined.Business,
                        value = attendee.company
                    )
                }
                
                InfoRow(
                    icon = Icons.Outlined.Email,
                    value = attendee.email
                )
                
                InfoRow(
                    icon = Icons.Outlined.Tag,
                    value = attendee.code
                )
            }
            
            // Action buttons
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (!isCheckedIn) {
                    Button(
                        onClick = { onCheckin(attendee) },
                        enabled = !isLoading,
                        modifier = Modifier.weight(1f),
                        shape = ButtonShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary
                        )
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Check In")
                    }
                }
                
                if (onPrint != null && hasPrinterConfigured) {
                    OutlinedButton(
                        onClick = { onPrint(attendee) },
                        enabled = !isPrinting && isCheckedIn,
                        modifier = Modifier.weight(if (isCheckedIn) 1f else 0.5f),
                        shape = ButtonShape
                    ) {
                        if (isPrinting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                Icons.Outlined.Print,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Print")
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: String
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}

@Composable
private fun EmptyStateCard(
    onViewAllClick: () -> Unit,
    isHardwareScannerAvailable: Boolean
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = if (isHardwareScannerAvailable) 
                        Icons.Outlined.QrCodeScanner 
                    else 
                        Icons.Outlined.Search,
                    contentDescription = null,
                    modifier = Modifier.size(32.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
            
            Text(
                text = if (isHardwareScannerAvailable)
                    "Ready to scan"
                else
                    "Search for attendee",
                style = MaterialTheme.typography.titleMedium
            )
            
            Text(
                text = if (isHardwareScannerAvailable)
                    "Use the hardware scanner or search above"
                else
                    "Type name, email, company, or code",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            
            Spacer(modifier = Modifier.height(8.dp))
            
            FilledTonalButton(
                onClick = onViewAllClick,
                shape = ButtonShape
            ) {
                Icon(
                    Icons.Outlined.People, 
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("View All Attendees")
            }
        }
    }
}
