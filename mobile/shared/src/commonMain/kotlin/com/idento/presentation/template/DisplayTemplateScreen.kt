package com.idento.presentation.template

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.data.model.PlaceholderInfo
import org.koin.compose.koinInject

/**
 * Display Template Editor Screen
 * Edit markdown template for attendee display at check-in
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DisplayTemplateScreen(
    eventId: String,
    viewModel: DisplayTemplateViewModel = koinInject(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var showPlaceholdersSheet by remember { mutableStateOf(false) }
    
    LaunchedEffect(eventId) {
        viewModel.setEventId(eventId)
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Text(
                        "Display Template",
                        fontWeight = FontWeight.Bold
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    // Reset button
                    TextButton(onClick = { viewModel.resetToDefault() }) {
                        Text("Reset")
                    }
                    
                    // Save button
                    TextButton(
                        onClick = { viewModel.saveTemplate() },
                        enabled = uiState.hasChanges && !uiState.isSaving
                    ) {
                        if (uiState.isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text(
                                "Save",
                                color = if (uiState.hasChanges) 
                                    MaterialTheme.colorScheme.primary 
                                else 
                                    MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { paddingValues ->
        if (uiState.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Info card
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            Icons.Default.Info,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Column {
                            Text(
                                "Markdown Template",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                "Use placeholders like {{full_name}} to insert attendee data. " +
                                "Supports basic Markdown formatting.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                
                // Fetch from server button
                OutlinedButton(
                    onClick = { viewModel.fetchDefaultFromServer() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !uiState.isFetchingFromServer
                ) {
                    if (uiState.isFetchingFromServer) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp
                        )
                        Spacer(Modifier.width(8.dp))
                    } else {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text("Load Default from Server")
                }
                
                // Quick insert placeholders
                Text(
                    "INSERT PLACEHOLDER",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    uiState.standardPlaceholders.forEach { placeholder ->
                        PlaceholderChip(
                            placeholder = placeholder,
                            onClick = { viewModel.insertPlaceholder(placeholder.placeholder) }
                        )
                    }
                }
                
                // Custom fields (if any)
                if (uiState.customPlaceholders.isNotEmpty()) {
                    Text(
                        "CUSTOM FIELDS",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        uiState.customPlaceholders.forEach { placeholder ->
                            PlaceholderChip(
                                placeholder = placeholder,
                                onClick = { viewModel.insertPlaceholder(placeholder.placeholder) }
                            )
                        }
                    }
                }
                
                // Template Editor
                Text(
                    "TEMPLATE",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                
                OutlinedTextField(
                    value = uiState.template,
                    onValueChange = { viewModel.onTemplateChanged(it) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 200.dp),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 14.sp
                    ),
                    placeholder = { 
                        Text(
                            "# {{full_name}}\n\n**Company:** {{company}}",
                            fontFamily = FontFamily.Monospace,
                            fontSize = 14.sp
                        ) 
                    },
                    shape = RoundedCornerShape(12.dp)
                )
                
                // Preview Section
                Text(
                    "PREVIEW",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = androidx.compose.foundation.BorderStroke(
                        1.dp, 
                        MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
                    )
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp)
                    ) {
                        if (uiState.previewError != null) {
                            Text(
                                uiState.previewError!!,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.error
                            )
                        } else {
                            MarkdownPreview(
                                markdown = uiState.preview,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
                
                // Success/Error messages
                uiState.successMessage?.let { message ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = Color(0xFF4CAF50).copy(alpha = 0.1f)
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                tint = Color(0xFF4CAF50)
                            )
                            Text(message, color = Color(0xFF4CAF50))
                        }
                    }
                }
                
                uiState.errorMessage?.let { message ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.Warning,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error
                            )
                            Text(message, color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                
                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }
}

@Composable
private fun PlaceholderChip(
    placeholder: PlaceholderInfo,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
    ) {
        Text(
            text = placeholder.label,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer
        )
    }
}

/**
 * Simple Markdown Preview
 * Renders basic markdown formatting
 */
@Composable
private fun MarkdownPreview(
    markdown: String,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        markdown.lines().forEach { line ->
            when {
                // H1
                line.startsWith("# ") -> {
                    Text(
                        text = line.removePrefix("# "),
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                // H2
                line.startsWith("## ") -> {
                    Text(
                        text = line.removePrefix("## "),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                // H3
                line.startsWith("### ") -> {
                    Text(
                        text = line.removePrefix("### "),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                // Horizontal rule
                line.startsWith("---") || line.startsWith("***") -> {
                    HorizontalDivider(
                        modifier = Modifier.padding(vertical = 8.dp),
                        color = MaterialTheme.colorScheme.outlineVariant
                    )
                }
                // Italic (wrapped in * or _)
                line.startsWith("*") && line.endsWith("*") && !line.startsWith("**") -> {
                    Text(
                        text = line.trim('*'),
                        style = MaterialTheme.typography.bodyMedium.copy(
                            fontStyle = androidx.compose.ui.text.font.FontStyle.Italic
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                // Empty line
                line.isBlank() -> {
                    Spacer(modifier = Modifier.height(4.dp))
                }
                // Regular text with bold support
                else -> {
                    val processedLine = processBoldText(line)
                    Text(
                        text = processedLine,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}

/**
 * Process bold text markers (**text**)
 * Returns plain text with bold markers removed (simplified version)
 */
private fun processBoldText(text: String): String {
    return text.replace(Regex("\\*\\*(.+?)\\*\\*"), "$1")
}
