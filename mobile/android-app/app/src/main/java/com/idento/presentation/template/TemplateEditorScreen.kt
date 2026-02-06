package com.idento.presentation.template

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.idento.data.model.Attendee
import com.idento.presentation.components.IdentoCard
import com.idento.presentation.components.rememberWindowSize
import com.idento.presentation.components.WindowSize

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TemplateEditorScreen(
    viewModel: TemplateEditorViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val windowSize = rememberWindowSize()
    
    // Show success/error messages
    LaunchedEffect(uiState.successMessage, uiState.errorMessage) {
        uiState.successMessage?.let { snackbarHostState.showSnackbar(it) }
        uiState.errorMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = when (uiState.templateType) {
                                TemplateType.SUCCESS_SCREEN -> "Success Screen Template"
                                TemplateType.BADGE_PRINT -> "Badge Print Template"
                            },
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
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
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    // Reset button - только если есть локальные изменения
                    if (uiState.isModified) {
                        TextButton(
                            onClick = { viewModel.resetToServer() },
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = MaterialTheme.colorScheme.error
                            )
                        ) {
                            Icon(
                                Icons.Default.Refresh, 
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("По умолчанию")
                        }
                    }
                    
                    // Save button
                    IconButton(
                        onClick = { viewModel.saveTemplate() },
                        enabled = !uiState.isLoading
                    ) {
                        Icon(Icons.Default.Check, contentDescription = "Save")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        if (windowSize == WindowSize.COMPACT) {
            // Vertical layout for phones
            VerticalLayout(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                uiState = uiState,
                onTemplateChange = viewModel::onTemplateChange
            )
        } else {
            // Horizontal split for tablets
            HorizontalSplitLayout(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                uiState = uiState,
                onTemplateChange = viewModel::onTemplateChange
            )
        }
    }
}

@Composable
private fun VerticalLayout(
    modifier: Modifier = Modifier,
    uiState: TemplateEditorUiState,
    onTemplateChange: (String) -> Unit
) {
    var showPreview by remember { mutableStateOf(false) }
    
    Column(modifier = modifier) {
        // Toggle button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.Center
        ) {
            SegmentedButton(
                selected = !showPreview,
                onClick = { showPreview = false },
                label = "Editor"
            )
            Spacer(modifier = Modifier.width(8.dp))
            SegmentedButton(
                selected = showPreview,
                onClick = { showPreview = true },
                label = "Preview"
            )
        }
        
        if (showPreview) {
            PreviewSection(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(16.dp),
                uiState = uiState
            )
        } else {
            EditorSection(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(16.dp),
                uiState = uiState,
                onTemplateChange = onTemplateChange
            )
        }
    }
}

@Composable
private fun HorizontalSplitLayout(
    modifier: Modifier = Modifier,
    uiState: TemplateEditorUiState,
    onTemplateChange: (String) -> Unit
) {
    Row(modifier = modifier) {
        // Editor on the left
        EditorSection(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(16.dp),
            uiState = uiState,
            onTemplateChange = onTemplateChange
        )
        
        VerticalDivider()
        
        // Preview on the right
        PreviewSection(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(16.dp),
            uiState = uiState
        )
    }
}

@Composable
private fun EditorSection(
    modifier: Modifier = Modifier,
    uiState: TemplateEditorUiState,
    onTemplateChange: (String) -> Unit
) {
    Column(modifier = modifier) {
        // Available variables
        IdentoCard(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Available Variables",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                
                val variables = listOf(
                    "{{first_name}}" to "First name",
                    "{{last_name}}" to "Last name",
                    "{{email}}" to "Email address",
                    "{{company}}" to "Company name",
                    "{{position}}" to "Job position",
                    "{{code}}" to "Attendee code"
                )
                
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    variables.forEach { (variable, _) ->
                        AssistChip(
                            onClick = {
                                onTemplateChange(uiState.template + " $variable")
                            },
                            label = { Text(variable, style = MaterialTheme.typography.labelSmall) }
                        )
                    }
                }
            }
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Template editor
        Text(
            text = "Template",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(8.dp))
        
        OutlinedTextField(
            value = uiState.template,
            onValueChange = onTemplateChange,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            textStyle = MaterialTheme.typography.bodyMedium.copy(
                fontFamily = FontFamily.Monospace
            ),
            placeholder = {
                Text("Enter template here...")
            }
        )
        
        Spacer(modifier = Modifier.height(8.dp))
        
        // Help text
        Text(
            text = when (uiState.templateType) {
                TemplateType.SUCCESS_SCREEN -> 
                    "Use Markdown syntax for formatting. Variables will be replaced with actual data."
                TemplateType.BADGE_PRINT -> 
                    "Use ZPL commands for badge layout. ^XA starts, ^XZ ends the label."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun PreviewSection(
    modifier: Modifier = Modifier,
    uiState: TemplateEditorUiState
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState())
    ) {
        Text(
            text = "Preview",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(8.dp))
        
        Text(
            text = "Using sample data: ${uiState.previewData?.firstName} ${uiState.previewData?.lastName}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        when (uiState.templateType) {
            TemplateType.SUCCESS_SCREEN -> {
                MarkdownPreview(
                    template = uiState.template,
                    attendee = uiState.previewData
                )
            }
            TemplateType.BADGE_PRINT -> {
                ZPLPreview(
                    template = uiState.template,
                    attendee = uiState.previewData
                )
            }
        }
    }
}

@Composable
private fun MarkdownPreview(
    template: String,
    attendee: Attendee?
) {
    IdentoCard(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            if (attendee != null) {
                val rendered = template
                    .replace("{{first_name}}", attendee.firstName)
                    .replace("{{last_name}}", attendee.lastName)
                    .replace("{{email}}", attendee.email)
                    .replace("{{company}}", attendee.company)
                    .replace("{{position}}", attendee.position)
                    .replace("{{code}}", attendee.code)
                    // Удаляем Markdown форматирование для отображения
                    .replace(Regex("#+ "), "")
                    .replace("**", "")
                    .replace("*", "")
                
                Text(
                    text = rendered,
                    style = MaterialTheme.typography.bodyMedium
                )
            } else {
                Text(
                    text = "No preview data available",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun ZPLPreview(
    template: String,
    attendee: Attendee?
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFFF5F5F5),
        shape = MaterialTheme.shapes.large
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "ZPL Commands Preview:",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(8.dp))
            
            if (attendee != null) {
                val rendered = template
                    .replace("{{first_name}}", attendee.firstName)
                    .replace("{{last_name}}", attendee.lastName)
                    .replace("{{email}}", attendee.email)
                    .replace("{{company}}", attendee.company)
                    .replace("{{position}}", attendee.position)
                    .replace("{{code}}", attendee.code)
                
                Text(
                    text = rendered,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontFamily = FontFamily.Monospace
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                )
            } else {
                Text(
                    text = "No preview data available",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            Text(
                text = "Note: For full ZPL preview, use Zebra's online tools like Labelary.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun SegmentedButton(
    selected: Boolean,
    onClick: () -> Unit,
    label: String
) {
    Button(
        onClick = onClick,
        colors = if (selected) {
            ButtonDefaults.buttonColors()
        } else {
            ButtonDefaults.outlinedButtonColors()
        },
        modifier = Modifier.height(40.dp)
    ) {
        Text(label)
    }
}
