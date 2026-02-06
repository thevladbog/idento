package com.idento.presentation.attendees

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.idento.data.model.Attendee
import com.idento.presentation.components.IdentoSearchField
import org.koin.compose.koinInject

/**
 * Attendees List Screen
 * Shows all attendees for an event with search and filter
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendeesListScreen(
    eventId: String,
    viewModel: AttendeesListViewModel = koinInject(),
    onNavigateBack: () -> Unit = {},
    onSelectAttendee: (Attendee) -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedFilter by remember { mutableStateOf(AttendeeFilter.ALL) }
    
    LaunchedEffect(eventId) {
        viewModel.loadAttendees(eventId)
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Attendees",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onBackground
                        )
                        Text(
                            text = "${uiState.filteredAttendees.size} of ${uiState.totalCount}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = MaterialTheme.colorScheme.onBackground
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.loadAttendees(eventId) }) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = "Refresh",
                            tint = MaterialTheme.colorScheme.primary
                        )
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
        ) {
            // Search bar
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                IdentoSearchField(
                    value = uiState.searchQuery,
                    onValueChange = { viewModel.onSearchQueryChanged(it) },
                    placeholder = "Search by name, email, or code...",
                    onClear = { viewModel.onSearchQueryChanged("") }
                )
            }
            
            // Filter chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = selectedFilter == AttendeeFilter.ALL,
                    onClick = { 
                        selectedFilter = AttendeeFilter.ALL
                        viewModel.setFilter(AttendeeFilter.ALL)
                    },
                    label = { Text("All") },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primary,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimary
                    )
                )
                FilterChip(
                    selected = selectedFilter == AttendeeFilter.CHECKED_IN,
                    onClick = { 
                        selectedFilter = AttendeeFilter.CHECKED_IN
                        viewModel.setFilter(AttendeeFilter.CHECKED_IN)
                    },
                    label = { Text("Checked In") },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Color(0xFF4CAF50),
                        selectedLabelColor = Color.White
                    )
                )
                FilterChip(
                    selected = selectedFilter == AttendeeFilter.NOT_CHECKED_IN,
                    onClick = { 
                        selectedFilter = AttendeeFilter.NOT_CHECKED_IN
                        viewModel.setFilter(AttendeeFilter.NOT_CHECKED_IN)
                    },
                    label = { Text("Pending") },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.secondary,
                        selectedLabelColor = MaterialTheme.colorScheme.onSecondary
                    )
                )
            }
            
            // Stats bar
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    StatItem(
                        value = uiState.totalCount.toString(),
                        label = "Total",
                        color = MaterialTheme.colorScheme.primary
                    )
                    StatItem(
                        value = uiState.checkedInCount.toString(),
                        label = "Checked In",
                        color = Color(0xFF4CAF50)
                    )
                    StatItem(
                        value = (uiState.totalCount - uiState.checkedInCount).toString(),
                        label = "Pending",
                        color = MaterialTheme.colorScheme.secondary
                    )
                }
            }
            
            // Content
            when {
                uiState.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                
                uiState.error != null -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.Warning,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Text(
                                text = uiState.error ?: "Unknown error",
                                color = MaterialTheme.colorScheme.error
                            )
                            Button(onClick = { viewModel.loadAttendees(eventId) }) {
                                Text("Retry")
                            }
                        }
                    }
                }
                
                uiState.filteredAttendees.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                Icons.Default.Person,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                            )
                            Text(
                                text = "No attendees found",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(uiState.filteredAttendees) { attendee ->
                            AttendeeRow(
                                attendee = attendee,
                                onClick = { onSelectAttendee(attendee) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatItem(
    value: String,
    label: String,
    color: Color
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = color
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun AttendeeRow(
    attendee: Attendee,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 0.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Avatar
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(
                        if (attendee.isCheckedIn) Color(0xFF4CAF50).copy(alpha = 0.15f)
                        else MaterialTheme.colorScheme.surfaceVariant
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = attendee.fullName.take(1).uppercase(),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = if (attendee.isCheckedIn) Color(0xFF4CAF50)
                            else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            Spacer(modifier = Modifier.width(12.dp))
            
            // Info
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = attendee.fullName,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    
                    if (attendee.isBlocked) {
                        Surface(
                            shape = RoundedCornerShape(4.dp),
                            color = MaterialTheme.colorScheme.error.copy(alpha = 0.15f)
                        ) {
                            Text(
                                text = "BLOCKED",
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
                
                attendee.email?.let { email ->
                    Text(
                        text = email,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                
                attendee.company?.let { company ->
                    Text(
                        text = company,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            
            // Status indicator
            if (attendee.isCheckedIn) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = "Checked in",
                    tint = Color(0xFF4CAF50),
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

enum class AttendeeFilter {
    ALL, CHECKED_IN, NOT_CHECKED_IN
}
