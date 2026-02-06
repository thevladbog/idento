package com.idento.presentation.dayselect

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.idento.data.localization.Strings
import org.koin.compose.koinInject

/**
 * Day Selection Screen
 * Allows staff to select which day of the event they are working with
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DaySelectScreen(
    eventId: String,
    eventName: String,
    onBackClick: () -> Unit,
    onDaySelected: (String, String) -> Unit, // eventId, eventDay
    viewModel: DaySelectViewModel = koinInject()
) {
    val state by viewModel.state.collectAsState()
    
    LaunchedEffect(eventId) {
        viewModel.loadEventDays(eventId)
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(eventName) },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Strings.back)
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when (val currentState = state) {
                is DaySelectState.Loading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                
                is DaySelectState.Error -> {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = currentState.message,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { viewModel.loadEventDays(eventId) }) {
                            Text(Strings.retry)
                        }
                    }
                }
                
                is DaySelectState.Success -> {
                    DayListContent(
                        days = currentState.days,
                        onDayClick = { day ->
                            onDaySelected(eventId, day)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun DayListContent(
    days: List<String>,
    onDayClick: (String) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text(
                text = Strings.selectEventDay,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }
        
        items(days) { day ->
            DayCard(
                day = day,
                onClick = { onDayClick(day) }
            )
        }
    }
}

@Composable
private fun DayCard(
    day: String,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.CalendarToday,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(32.dp)
            )
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Column {
                Text(
                    text = formatDate(day),
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = day,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * Format date from YYYY-MM-DD to human-readable format
 */
private fun formatDate(dateString: String): String {
    val parts = dateString.split("-")
    if (parts.size != 3) return dateString
    
    val year = parts[0]
    val month = parts[1].toIntOrNull() ?: return dateString
    val day = parts[2]
    
    val monthName = when (month) {
        1 -> "January"
        2 -> "February"
        3 -> "March"
        4 -> "April"
        5 -> "May"
        6 -> "June"
        7 -> "July"
        8 -> "August"
        9 -> "September"
        10 -> "October"
        11 -> "November"
        12 -> "December"
        else -> ""
    }
    
    return "$monthName $day, $year"
}

