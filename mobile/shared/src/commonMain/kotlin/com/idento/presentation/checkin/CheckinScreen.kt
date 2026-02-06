package com.idento.presentation.checkin

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.data.model.Attendee
import com.idento.data.model.DisplayTemplate
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.presentation.components.ActionSheet
import com.idento.presentation.components.ActionSheetItem
import com.idento.presentation.components.IdentoCard
import com.idento.presentation.components.IdentoSearchField
import kotlinx.coroutines.delay
import org.koin.compose.koinInject

// Status colors
private val StatusGreen = Color(0xFF4CAF50)
private val StatusYellow = Color(0xFFFFCA28)
private val StatusRed = Color(0xFFE53935)

/**
 * Check-in status for visual feedback
 */
private enum class CheckinDisplayStatus {
    IDLE,           // No attendee selected - normal screen
    READY,          // Attendee selected, ready to check in
    SUCCESS,        // First check-in successful - GREEN
    REPEAT,         // Already checked in - YELLOW
    BLOCKED         // Blocked attendee - RED
}

/**
 * Check-in Screen (Cross-platform)
 * Full-screen color status indicators
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CheckinScreen(
    eventId: String,
    eventName: String,
    selectedAttendeeId: String? = null,
    viewModel: CheckinViewModel = koinInject(),
    onNavigateBack: () -> Unit = {},
    onNavigateToAttendeesList: () -> Unit = {},
    onNavigateToQRScanner: () -> Unit = {},
    onNavigateToTemplateEditor: () -> Unit = {},
    onNavigateToDisplayTemplate: () -> Unit = {},
    onClearSelectedAttendee: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var showMenu by remember { mutableStateOf(false) }
    var showPrintSettings by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    
    // Track check-in status for display
    var displayStatus by remember { mutableStateOf(CheckinDisplayStatus.IDLE) }
    var wasCheckedInBefore by remember { mutableStateOf(false) }
    
    // Determine display status based on attendee state
    LaunchedEffect(uiState.selectedAttendee) {
        val attendee = uiState.selectedAttendee
        displayStatus = when {
            attendee == null -> CheckinDisplayStatus.IDLE
            attendee.isBlocked -> CheckinDisplayStatus.BLOCKED
            attendee.isCheckedIn -> {
                // If we just checked them in (wasCheckedInBefore was false), show SUCCESS
                // Otherwise show REPEAT (they were already checked in)
                if (!wasCheckedInBefore) {
                    wasCheckedInBefore = true
                    CheckinDisplayStatus.SUCCESS
                } else {
                    CheckinDisplayStatus.REPEAT
                }
            }
            else -> {
                wasCheckedInBefore = false
                CheckinDisplayStatus.READY
            }
        }
    }
    
    // Reset when attendee changes
    LaunchedEffect(uiState.selectedAttendee?.id) {
        if (uiState.selectedAttendee == null) {
            wasCheckedInBefore = false
        } else {
            // Check if this attendee was already checked in when selected
            wasCheckedInBefore = uiState.selectedAttendee?.isCheckedIn == true
            displayStatus = when {
                uiState.selectedAttendee?.isBlocked == true -> CheckinDisplayStatus.BLOCKED
                uiState.selectedAttendee?.isCheckedIn == true -> CheckinDisplayStatus.REPEAT
                else -> CheckinDisplayStatus.READY
            }
        }
    }
    
    // Auto-dismiss timer
    var dismissCountdown by remember { mutableStateOf(10) }
    
    LaunchedEffect(displayStatus) {
        if (displayStatus in listOf(CheckinDisplayStatus.SUCCESS, CheckinDisplayStatus.REPEAT, CheckinDisplayStatus.BLOCKED)) {
            dismissCountdown = 10
            while (dismissCountdown > 0) {
                delay(1000L)
                dismissCountdown--
            }
            viewModel.clearSelectedAttendee()
        }
    }
    
    // Set event ID when screen opens
    LaunchedEffect(eventId) {
        viewModel.setEventId(eventId)
    }
    
    // Select attendee from list navigation
    LaunchedEffect(selectedAttendeeId) {
        if (selectedAttendeeId != null) {
            viewModel.selectAttendeeById(selectedAttendeeId)
            onClearSelectedAttendee()
        }
    }
    
    // Get background color based on status
    val backgroundColor by animateColorAsState(
        targetValue = when (displayStatus) {
            CheckinDisplayStatus.SUCCESS -> StatusGreen
            CheckinDisplayStatus.REPEAT -> StatusYellow
            CheckinDisplayStatus.BLOCKED -> StatusRed
            else -> MaterialTheme.colorScheme.background
        },
        animationSpec = tween(300),
        label = "backgroundColor"
    )
    
    val isColoredStatus = displayStatus in listOf(
        CheckinDisplayStatus.SUCCESS,
        CheckinDisplayStatus.REPEAT,
        CheckinDisplayStatus.BLOCKED
    )
    
    // iOS-style Action Sheet
    ActionSheet(
        visible = showMenu,
        onDismiss = { showMenu = false },
        title = stringResource(StringKey.SETTINGS),
        actions = listOf(
            ActionSheetItem(
                title = stringResource(StringKey.VIEW_ALL_ATTENDEES),
                icon = Icons.Default.Person,
                onClick = onNavigateToAttendeesList
            ),
            ActionSheetItem(
                title = stringResource(StringKey.TERMINAL_MODE),
                icon = Icons.Default.Search,
                onClick = onNavigateToQRScanner
            ),
            ActionSheetItem(
                title = stringResource(StringKey.BADGE_TEMPLATE),
                icon = Icons.Default.Edit,
                onClick = onNavigateToTemplateEditor
            ),
            ActionSheetItem(
                title = stringResource(StringKey.DISPLAY_SETTINGS),
                icon = Icons.Default.Face,
                onClick = onNavigateToDisplayTemplate
            ),
            ActionSheetItem(
                title = stringResource(StringKey.PRINT_SETTINGS),
                icon = Icons.Default.Settings,
                onClick = { showPrintSettings = true }
            )
        )
    )
    
    // Print Settings Dialog
    if (showPrintSettings) {
        PrintSettingsDialog(
            printOnCheckin = uiState.autoPrintBadge,
            printOnButton = uiState.printOnButton,
            onPrintOnCheckinChanged = { viewModel.setPrintOnCheckin(it) },
            onPrintOnButtonChanged = { viewModel.setPrintOnButton(it) },
            onDismiss = { showPrintSettings = false }
        )
    }
    
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundColor)
    ) {
        Column(
            modifier = Modifier.fillMaxSize()
        ) {
            // Top App Bar
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = eventName,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = if (isColoredStatus) Color.White else MaterialTheme.colorScheme.onBackground
                        )
                        Text(
                            text = "${stringResource(StringKey.CHECKED_IN)}: ${uiState.checkedInCount}",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (isColoredStatus) Color.White.copy(alpha = 0.8f) else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = {
                        if (isColoredStatus) {
                            viewModel.clearSelectedAttendee()
                        } else {
                            onNavigateBack()
                        }
                    }) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = if (isColoredStatus) Color.White else MaterialTheme.colorScheme.onBackground
                        )
                    }
                },
                actions = {
                    if (!isColoredStatus) {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(
                                Icons.Default.MoreVert,
                                contentDescription = "Menu",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent
                )
            )
            
            // Main Content
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Search Bar (only when not in status mode)
                if (!isColoredStatus) {
                    IdentoSearchField(
                        value = uiState.searchQuery,
                        onValueChange = viewModel::onSearchQueryChanged,
                        placeholder = stringResource(StringKey.SEARCH_BY_NAME_EMAIL_CODE),
                        onClear = { viewModel.clearSelectedAttendee() }
                    )
                    
                    // Search Suggestions
                    if (uiState.searchSuggestions.isNotEmpty()) {
                        SearchSuggestionsCard(
                            suggestions = uiState.searchSuggestions,
                            onSelectAttendee = { attendee ->
                                focusManager.clearFocus()
                                viewModel.selectAttendee(attendee)
                            }
                        )
                    }
                }
                
                // Attendee Card (white card for readability)
                uiState.selectedAttendee?.let { attendee ->
                    AttendeeInfoCard(
                        attendee = attendee,
                        displayTemplate = uiState.displayTemplate,
                        onDismiss = { viewModel.clearSelectedAttendee() },
                        dismissCountdown = dismissCountdown,
                        showDismiss = isColoredStatus
                    )
                    
                    // Check-in Button (only when READY status)
                    if (displayStatus == CheckinDisplayStatus.READY) {
                        Spacer(Modifier.weight(1f))
                        
                        Button(
                            onClick = {
                                wasCheckedInBefore = false // Mark that we're doing fresh check-in
                                viewModel.checkinAttendee(attendee.id)
                            },
                            enabled = !uiState.isProcessing,
                            modifier = Modifier.fillMaxWidth().height(60.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = StatusGreen
                            ),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            if (uiState.isProcessing) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(24.dp),
                                    color = Color.White
                                )
                            } else {
                                Icon(
                                    Icons.Default.Check,
                                    contentDescription = null,
                                    modifier = Modifier.size(28.dp)
                                )
                                Spacer(Modifier.width(12.dp))
                                Text(
                                    stringResource(StringKey.CHECK_IN),
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
                
                // Status Indicator Section (when colored status)
                if (isColoredStatus && uiState.selectedAttendee != null) {
                    Spacer(Modifier.weight(1f))
                    
                    StatusIndicatorSection(
                        status = displayStatus,
                        attendee = uiState.selectedAttendee!!,
                        dismissCountdown = dismissCountdown,
                        onPrintBadge = { viewModel.printBadge(uiState.selectedAttendee!!) },
                        onDismiss = { viewModel.clearSelectedAttendee() },
                        showPrintButton = uiState.autoPrintBadge && displayStatus == CheckinDisplayStatus.SUCCESS,
                        isPrinting = uiState.isPrinting
                    )
                }
                
                // Empty state (when nothing selected)
                if (uiState.selectedAttendee == null && 
                    uiState.searchQuery.isEmpty() && 
                    uiState.searchSuggestions.isEmpty()) {
                    Spacer(Modifier.weight(1f))
                    EmptyStateCard()
                }
            }
        }
    }
}

/**
 * White info card for attendee data (readable on any background)
 */
@Composable
private fun AttendeeInfoCard(
    attendee: Attendee,
    displayTemplate: DisplayTemplate?,
    onDismiss: () -> Unit,
    dismissCountdown: Int,
    showDismiss: Boolean
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Header with close button
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = attendee.code,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Close",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            
            // Attendee info
            if (displayTemplate != null) {
                val renderedContent = displayTemplate.render(attendee)
                TemplateRenderedContent(
                    markdown = renderedContent,
                    textColor = MaterialTheme.colorScheme.onSurface
                )
            } else {
                DefaultAttendeeInfo(
                    attendee = attendee,
                    textColor = MaterialTheme.colorScheme.onSurface
                )
            }
        }
    }
}

/**
 * Status indicator section with icon and text
 */
@Composable
private fun StatusIndicatorSection(
    status: CheckinDisplayStatus,
    attendee: Attendee,
    dismissCountdown: Int,
    onPrintBadge: () -> Unit,
    onDismiss: () -> Unit,
    showPrintButton: Boolean,
    isPrinting: Boolean
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Status Icon
        Box(
            modifier = Modifier
                .size(100.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = when (status) {
                    CheckinDisplayStatus.SUCCESS -> Icons.Default.Check
                    CheckinDisplayStatus.REPEAT -> Icons.Default.Warning
                    CheckinDisplayStatus.BLOCKED -> Icons.Default.Close
                    else -> Icons.Default.Check
                },
                contentDescription = null,
                modifier = Modifier.size(60.dp),
                tint = Color.White
            )
        }
        
        // Status Text
        Text(
            text = when (status) {
                CheckinDisplayStatus.SUCCESS -> stringResource(StringKey.CHECK_IN_SUCCESS)
                CheckinDisplayStatus.REPEAT -> stringResource(StringKey.ALREADY_CHECKED_IN)
                CheckinDisplayStatus.BLOCKED -> stringResource(StringKey.BLOCKED)
                else -> ""
            },
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = Color.White,
            textAlign = TextAlign.Center
        )
        
        // Additional info based on status
        when (status) {
            CheckinDisplayStatus.SUCCESS -> {
                // Show time of check-in
                attendee.checkedInAt?.let { time ->
                    Text(
                        text = formatCheckinTime(time),
                        style = MaterialTheme.typography.bodyLarge,
                        color = Color.White.copy(alpha = 0.9f)
                    )
                }
            }
            CheckinDisplayStatus.REPEAT -> {
                // Show when already checked in
                attendee.checkedInAt?.let { time ->
                    Text(
                        text = "${stringResource(StringKey.CHECKIN_TIME)}: ${formatCheckinTime(time)}",
                        style = MaterialTheme.typography.bodyLarge,
                        color = Color.Black.copy(alpha = 0.7f)
                    )
                }
            }
            CheckinDisplayStatus.BLOCKED -> {
                // Show block reason
                attendee.blockReason?.let { reason ->
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Color.White.copy(alpha = 0.2f)
                    ) {
                        Text(
                            text = reason,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            style = MaterialTheme.typography.bodyLarge,
                            color = Color.White,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
            else -> {}
        }
        
        Spacer(Modifier.height(16.dp))
        
        // Action buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Print Badge button (if success and printing enabled)
            if (showPrintButton && status == CheckinDisplayStatus.SUCCESS) {
                Button(
                    onClick = onPrintBadge,
                    enabled = !isPrinting,
                    modifier = Modifier.weight(1f).height(52.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color.White
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    if (isPrinting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = StatusGreen
                        )
                    } else {
                        Icon(
                            Icons.Default.Create,
                            contentDescription = null,
                            tint = StatusGreen
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            stringResource(StringKey.PRINT_BADGE),
                            color = StatusGreen,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
            
            // Close button with countdown
            Button(
                onClick = onDismiss,
                modifier = Modifier
                    .then(if (showPrintButton && status == CheckinDisplayStatus.SUCCESS) Modifier.weight(1f) else Modifier.fillMaxWidth())
                    .height(52.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.White.copy(alpha = 0.3f)
                ),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = null,
                    tint = Color.White
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "${stringResource(StringKey.CLOSE)} ($dismissCountdown)",
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

@Composable
private fun SearchSuggestionsCard(
    suggestions: List<Attendee>,
    onSelectAttendee: (Attendee) -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column {
            suggestions.forEachIndexed { index, attendee ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelectAttendee(attendee) }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Status indicator
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(
                                when {
                                    attendee.isBlocked -> StatusRed
                                    attendee.isCheckedIn -> StatusYellow
                                    else -> StatusGreen
                                }
                            )
                    )
                    Spacer(Modifier.width(12.dp))
                    
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = attendee.fullName,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium
                        )
                        attendee.email?.let { email ->
                            Text(
                                text = email,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    
                    Icon(
                        Icons.Default.KeyboardArrowRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (index < suggestions.size - 1) {
                    HorizontalDivider()
                }
            }
        }
    }
}

/**
 * Format check-in time for display
 */
private fun formatCheckinTime(isoTime: String): String {
    return try {
        val parts = isoTime.replace("T", " ").replace("Z", "").split(" ")
        if (parts.size >= 2) {
            val timePart = parts[1].split("+")[0]
            if (timePart.length >= 5) {
                timePart.substring(0, 5)
            } else {
                timePart
            }
        } else {
            isoTime
        }
    } catch (e: Exception) {
        isoTime
    }
}

/**
 * Render markdown template content
 */
@Composable
private fun TemplateRenderedContent(
    markdown: String,
    textColor: Color
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        markdown.lines().forEach { line ->
            when {
                line.startsWith("# ") -> {
                    Text(
                        text = line.removePrefix("# "),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = textColor
                    )
                }
                line.startsWith("## ") -> {
                    Text(
                        text = line.removePrefix("## "),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = textColor
                    )
                }
                line.startsWith("---") || line.startsWith("***") -> {
                    HorizontalDivider(
                        modifier = Modifier.padding(vertical = 8.dp),
                        color = MaterialTheme.colorScheme.outlineVariant
                    )
                }
                line.isBlank() -> {
                    Spacer(modifier = Modifier.height(4.dp))
                }
                else -> {
                    Text(
                        text = line.replace(Regex("\\*\\*(.+?)\\*\\*"), "$1"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = textColor
                    )
                }
            }
        }
    }
}

/**
 * Default attendee info display
 */
@Composable
private fun DefaultAttendeeInfo(
    attendee: Attendee,
    textColor: Color
) {
    Text(
        text = attendee.fullName,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        color = textColor
    )
    
    Spacer(Modifier.height(8.dp))
    
    attendee.company?.let { company ->
        Text(
            text = company,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
    
    attendee.position?.let { position ->
        Text(
            text = position,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun EmptyStateCard() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Icon(
            Icons.Default.Search,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Text(
            stringResource(StringKey.SEARCH_ATTENDEE),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * Print Settings Dialog
 */
@Composable
private fun PrintSettingsDialog(
    printOnCheckin: Boolean,
    printOnButton: Boolean,
    onPrintOnCheckinChanged: (Boolean) -> Unit,
    onPrintOnButtonChanged: (Boolean) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { 
            Text(
                stringResource(StringKey.PRINT_SETTINGS),
                fontWeight = FontWeight.Bold
            ) 
        },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            stringResource(StringKey.PRINT_ON_CHECKIN),
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Text(
                            stringResource(StringKey.PRINT_ON_CHECKIN_DESC),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = printOnCheckin,
                        onCheckedChange = onPrintOnCheckinChanged
                    )
                }
                
                if (printOnCheckin) {
                    HorizontalDivider()
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                stringResource(StringKey.PRINT_BY_BUTTON),
                                style = MaterialTheme.typography.bodyLarge
                            )
                            Text(
                                stringResource(StringKey.PRINT_BY_BUTTON_DESC),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = printOnButton,
                            onCheckedChange = onPrintOnButtonChanged
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(StringKey.DONE))
            }
        }
    )
}
