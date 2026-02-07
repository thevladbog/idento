package com.idento.presentation.zoneselect

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.FloatingActionButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.idento.data.localization.Strings
import com.idento.data.model.EventZoneWithStats
import org.koin.compose.koinInject

/**
 * Zone Selection Screen
 * Allows staff to select which zone they are working with
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ZoneSelectScreen(
    eventId: String,
    eventDay: String,
    onBackClick: () -> Unit,
    onZoneSelected: (String, String, String, String) -> Unit, // eventId, eventName, zoneId, eventDay
    onScanZoneQR: () -> Unit = {}, // Navigate to zone QR scanner
    viewModel: ZoneSelectViewModel = koinInject()
) {
    val state by viewModel.state.collectAsState()
    
    LaunchedEffect(eventId, eventDay) {
        viewModel.loadStaffZones(eventId, eventDay)
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Column {
                        Text(Strings.selectZone)
                        Text(
                            text = eventDay,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Strings.back)
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onScanZoneQR,
                containerColor = MaterialTheme.colorScheme.primary
            ) {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = Strings.scanZoneQR
                )
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when (val currentState = state) {
                is ZoneSelectState.Loading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                
                is ZoneSelectState.Error -> {
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
                        Button(onClick = { viewModel.loadStaffZones(eventId, eventDay) }) {
                            Text(Strings.retry)
                        }
                    }
                }
                
                is ZoneSelectState.Success -> {
                    ZoneListContent(
                        zones = currentState.zones,
                        onZoneClick = { zone ->
                            onZoneSelected(eventId, zone.name, zone.id, eventDay)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ZoneListContent(
    zones: List<EventZoneWithStats>,
    onZoneClick: (EventZoneWithStats) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text(
                text = Strings.selectZone,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }
        
        items(zones) { zone ->
            ZoneCard(
                zone = zone,
                onClick = { onZoneClick(zone) }
            )
        }
    }
}

@Composable
private fun ZoneCard(
    zone: EventZoneWithStats,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = getZoneIcon(zone.zoneType),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(32.dp)
                )
                
                Spacer(modifier = Modifier.width(16.dp))
                
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = zone.name,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = getZoneTypeLabel(zone.zoneType),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                
                if (zone.isRegistrationZone) {
                    AssistChip(
                        onClick = {},
                        label = { Text(Strings.registration) },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    )
                }
            }
            
            // Zone stats
            if (zone.totalCheckins > 0 || zone.todayCheckins > 0) {
                Spacer(modifier = Modifier.height(12.dp))
                Divider()
                Spacer(modifier = Modifier.height(12.dp))
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    StatItem(
                        label = Strings.today,
                        value = zone.todayCheckins.toString(),
                        icon = Icons.Default.DateRange
                    )
                    StatItem(
                        label = Strings.total,
                        value = zone.totalCheckins.toString(),
                        icon = Icons.Default.CheckCircle
                    )
                    StatItem(
                        label = Strings.unique,
                        value = zone.uniqueAttendees.toString(),
                        icon = Icons.Default.Person
                    )
                }
            }
            
            // Time restrictions
            if (zone.openTime != null || zone.closeTime != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "${zone.openTime ?: "00:00"} - ${zone.closeTime ?: "23:59"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun StatItem(
    label: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

private fun getZoneIcon(zoneType: String): androidx.compose.ui.graphics.vector.ImageVector {
    return when (zoneType) {
        "registration" -> Icons.Default.Check
        "vip" -> Icons.Default.Star
        "workshop" -> Icons.Default.Build
        else -> Icons.Default.LocationOn
    }
}

private fun getZoneTypeLabel(zoneType: String): String {
    return when (zoneType) {
        "registration" -> Strings.registration
        "general" -> Strings.general
        "vip" -> "VIP"
        "workshop" -> Strings.workshop
        else -> zoneType
    }
}

