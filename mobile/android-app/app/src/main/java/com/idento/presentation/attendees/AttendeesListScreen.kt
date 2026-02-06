package com.idento.presentation.attendees

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.hilt.navigation.compose.hiltViewModel
import com.idento.data.model.Attendee
import com.idento.presentation.checkin.CheckinViewModel
import com.idento.presentation.components.IdentoSearchField

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendeesListScreen(
    viewModel: CheckinViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onAttendeeClick: (Attendee) -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    
    // Фильтруем участников локально для списка
    val filteredAttendees = remember(uiState.attendees, searchQuery) {
        if (searchQuery.isEmpty()) {
            uiState.attendees
        } else {
            uiState.attendees.filter { attendee ->
                attendee.firstName.contains(searchQuery, ignoreCase = true) ||
                attendee.lastName.contains(searchQuery, ignoreCase = true) ||
                attendee.email.contains(searchQuery, ignoreCase = true) ||
                attendee.company.contains(searchQuery, ignoreCase = true) ||
                attendee.code.contains(searchQuery, ignoreCase = true)
            }
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "All Attendees",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "${filteredAttendees.size} of ${uiState.attendees.size}",
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
                    // Показываем статистику
                    val checkedInCount = uiState.attendees.count { it.checkedInAt != null }
                    
                    Surface(
                        shape = MaterialTheme.shapes.small,
                        color = Color(0xFFE8F5E9),
                        modifier = Modifier.padding(end = 8.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = Color(0xFF4CAF50),
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                text = "$checkedInCount",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF2E7D32)
                            )
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Строка поиска
            IdentoSearchField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = "Search attendees...",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            )
            
            // Список участников
            if (uiState.isLoading && uiState.attendees.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (filteredAttendees.isEmpty()) {
                EmptyState(searchQuery = searchQuery)
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filteredAttendees, key = { it.id }) { attendee ->
                        AttendeeListItem(
                            attendee = attendee,
                            onClick = { 
                                onAttendeeClick(attendee)
                                onNavigateBack()
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AttendeeListItem(
    attendee: Attendee,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (attendee.checkedInAt != null)
                Color(0xFFE8F5E9)
            else
                MaterialTheme.colorScheme.surface
        )
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
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(
                        if (attendee.checkedInAt != null)
                            Color(0xFF4CAF50)
                        else
                            MaterialTheme.colorScheme.primaryContainer
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = attendee.firstName.take(1).uppercase(),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = if (attendee.checkedInAt != null)
                        Color.White
                    else
                        MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            // Информация
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = "${attendee.firstName} ${attendee.lastName}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                
                if (attendee.company.isNotEmpty()) {
                    Text(
                        text = attendee.company,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                
                Text(
                    text = attendee.email,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            // Статус
            if (attendee.checkedInAt != null) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "Checked in",
                    tint = Color(0xFF4CAF50),
                    modifier = Modifier.size(24.dp)
                )
            } else {
                Icon(
                    imageVector = Icons.Default.RadioButtonUnchecked,
                    contentDescription = "Not checked in",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

@Composable
private fun EmptyState(searchQuery: String) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.padding(32.dp)
        ) {
            Icon(
                imageVector = if (searchQuery.isEmpty()) 
                    Icons.Default.People 
                else 
                    Icons.Default.SearchOff,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
            
            Text(
                text = if (searchQuery.isEmpty())
                    "No attendees found"
                else
                    "No results for \"$searchQuery\"",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            
            Text(
                text = if (searchQuery.isEmpty())
                    "Attendees will appear here when they are registered"
                else
                    "Try adjusting your search",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
