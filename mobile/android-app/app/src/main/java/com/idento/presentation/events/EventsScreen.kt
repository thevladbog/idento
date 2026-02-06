package com.idento.presentation.events

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.idento.data.model.Event
import com.idento.presentation.theme.*
import com.idento.presentation.components.getGridColumns
import com.idento.presentation.components.getCardSpacing
import com.idento.presentation.components.getResponsivePadding
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsScreen(
    viewModel: EventsViewModel,
    onNavigateToCheckin: (eventId: String, eventName: String) -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToLogin: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    
    val responsivePadding = getResponsivePadding()
    val gridColumns = getGridColumns()
    val cardSpacing = getCardSpacing()
    
    // Logout handler
    LaunchedEffect(uiState.userEmail) {
        if (uiState.userEmail.isEmpty()) {
            onNavigateToLogin()
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Events",
                            style = MaterialTheme.typography.titleLarge
                        )
                        AnimatedVisibility(
                            visible = uiState.userEmail.isNotEmpty(),
                            enter = fadeIn() + expandVertically(),
                            exit = fadeOut() + shrinkVertically()
                        ) {
                            Text(
                                text = uiState.userEmail,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(
                            imageVector = Icons.Outlined.Settings,
                            contentDescription = "Settings"
                        )
                    }
                    IconButton(onClick = { viewModel.loadEvents() }) {
                        Icon(
                            imageVector = Icons.Outlined.Refresh,
                            contentDescription = "Refresh"
                        )
                    }
                    IconButton(onClick = { viewModel.logout() }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ExitToApp,
                            contentDescription = "Logout"
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
            when {
                uiState.isLoading && uiState.events.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(strokeWidth = 2.dp)
                    }
                }
                
                uiState.errorMessage != null && uiState.events.isEmpty() -> {
                    ErrorState(
                        message = uiState.errorMessage ?: "Unknown error",
                        onRetry = { viewModel.loadEvents() },
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(responsivePadding)
                    )
                }
                
                uiState.events.isEmpty() -> {
                    EmptyState(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(responsivePadding)
                    )
                }
                
                else -> {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(gridColumns),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(responsivePadding),
                        horizontalArrangement = Arrangement.spacedBy(cardSpacing),
                        verticalArrangement = Arrangement.spacedBy(cardSpacing)
                    ) {
                        items(uiState.events) { event ->
                            EventCard(
                                event = event,
                                onClick = {
                                    onNavigateToCheckin(event.id, event.name)
                                }
                            )
                        }
                    }
                }
            }
            
            // Loading overlay
            AnimatedVisibility(
                visible = uiState.isLoading && uiState.events.isNotEmpty(),
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 8.dp),
                enter = fadeIn() + scaleIn(),
                exit = fadeOut() + scaleOut()
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 3.dp
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .padding(8.dp)
                            .size(20.dp),
                        strokeWidth = 2.dp
                    )
                }
            }
        }
    }
}

@Composable
private fun ErrorState(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(ErrorLight),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Outlined.Error,
                contentDescription = null,
                modifier = Modifier.size(32.dp),
                tint = Error
            )
        }
        
        Spacer(modifier = Modifier.height(24.dp))
        
        Text(
            text = "Something went wrong",
            style = MaterialTheme.typography.titleMedium
        )
        
        Spacer(modifier = Modifier.height(8.dp))
        
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        
        Spacer(modifier = Modifier.height(24.dp))
        
        FilledTonalButton(
            onClick = onRetry,
            shape = ButtonShape
        ) {
            Icon(
                Icons.Outlined.Refresh, 
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text("Try again")
        }
    }
}

@Composable
private fun EmptyState(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Outlined.Event,
                contentDescription = null,
                modifier = Modifier.size(32.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        }
        
        Spacer(modifier = Modifier.height(24.dp))
        
        Text(
            text = "No events yet",
            style = MaterialTheme.typography.titleMedium
        )
        
        Spacer(modifier = Modifier.height(8.dp))
        
        Text(
            text = "Events will appear here once created",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventCard(
    event: Event,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = CardShape,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(20.dp)
        ) {
            // Title
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = event.name,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                
                Icon(
                    imageVector = Icons.Default.ChevronRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp)
                )
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            // Date
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.CalendarToday,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Column {
                    Text(
                        text = formatDate(event.startDate),
                        style = MaterialTheme.typography.bodyMedium
                    )
                    if (!event.endDate.isNullOrEmpty() && event.endDate != event.startDate) {
                        Text(
                            text = "to ${formatDate(event.endDate)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            
            // Location
            if (!event.location.isNullOrEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.LocationOn,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = event.location,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

private fun formatDate(dateStr: String): String {
    return try {
        val inputFormat = when {
            dateStr.endsWith("Z") -> SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.getDefault())
            dateStr.contains("+") || dateStr.lastIndexOf("-") > 10 -> SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.getDefault())
            else -> SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        }
        val outputFormat = SimpleDateFormat("MMM dd, yyyy", Locale.getDefault())
        val date = inputFormat.parse(dateStr)
        outputFormat.format(date ?: Date())
    } catch (e: Exception) {
        dateStr.substringBefore("T").ifEmpty { dateStr }
    }
}
