package com.idento.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * iOS-style Action Sheet
 * A modal bottom sheet with action items
 */
@Composable
fun ActionSheet(
    visible: Boolean,
    onDismiss: () -> Unit,
    title: String? = null,
    actions: List<ActionSheetItem>,
    destructiveAction: ActionSheetItem? = null
) {
    if (visible) {
        Dialog(
            onDismissRequest = onDismiss,
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.4f))
                    .clickable(onClick = onDismiss),
                contentAlignment = Alignment.BottomCenter
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp)
                        .clickable(enabled = false, onClick = {}), // Prevent dismiss on content click
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Main actions card
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surface,
                        tonalElevation = 0.dp
                    ) {
                        Column {
                            // Title (optional)
                            title?.let {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = it,
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        textAlign = TextAlign.Center
                                    )
                                }
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                            
                            // Action items
                            actions.forEachIndexed { index, action ->
                                ActionSheetRow(
                                    item = action,
                                    onClick = {
                                        onDismiss()
                                        action.onClick()
                                    }
                                )
                                if (index < actions.size - 1) {
                                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                }
                            }
                            
                            // Destructive action
                            destructiveAction?.let { action ->
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                ActionSheetRow(
                                    item = action,
                                    isDestructive = true,
                                    onClick = {
                                        onDismiss()
                                        action.onClick()
                                    }
                                )
                            }
                        }
                    }
                    
                    // Cancel button
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surface,
                        tonalElevation = 0.dp
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(onClick = onDismiss)
                                .padding(16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "Cancel",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                    
                    // Bottom padding for safe area
                    Spacer(modifier = Modifier.height(16.dp))
                }
            }
        }
    }
}

@Composable
private fun ActionSheetRow(
    item: ActionSheetItem,
    isDestructive: Boolean = false,
    onClick: () -> Unit
) {
    val textColor = if (isDestructive) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.primary
    }
    
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        item.icon?.let { icon ->
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = textColor,
                modifier = Modifier.size(22.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
        }
        Text(
            text = item.title,
            style = MaterialTheme.typography.titleMedium,
            color = textColor
        )
    }
}

/**
 * Action sheet item data class
 */
data class ActionSheetItem(
    val title: String,
    val icon: ImageVector? = null,
    val onClick: () -> Unit
)
