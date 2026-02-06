package com.idento.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

/**
 * Custom text field component (Cross-platform)
 * iOS-inspired flat design with rounded corners
 */
@Composable
fun IdentoTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    leadingIcon: @Composable (() -> Unit)? = null,
    trailingIcon: @Composable (() -> Unit)? = null,
    isError: Boolean = false,
    errorMessage: String? = null,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    singleLine: Boolean = true,
    maxLines: Int = 1,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default
) {
    Column(modifier = modifier.fillMaxWidth()) {
        // Label above the field
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = if (isError) MaterialTheme.colorScheme.error 
                    else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 6.dp, start = 4.dp)
        )
        
        // iOS-style filled text field with border
        val backgroundColor = if (isError) {
            MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
        } else {
            MaterialTheme.colorScheme.surface
        }
        
        val borderColor = if (isError) {
            MaterialTheme.colorScheme.error
        } else {
            MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
        }
        
        val shape = RoundedCornerShape(12.dp)
        
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            readOnly = readOnly,
            singleLine = singleLine,
            maxLines = maxLines,
            visualTransformation = visualTransformation,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            textStyle = MaterialTheme.typography.bodyLarge.copy(
                color = MaterialTheme.colorScheme.onSurface
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            decorationBox = { innerTextField ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(shape)
                        .background(backgroundColor)
                        .border(1.dp, borderColor, shape)
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (leadingIcon != null) {
                        leadingIcon()
                        Spacer(modifier = Modifier.width(12.dp))
                    }
                    
                    Box(modifier = Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null) {
                            Text(
                                text = placeholder,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                            )
                        }
                        innerTextField()
                    }
                    
                    if (trailingIcon != null) {
                        Spacer(modifier = Modifier.width(12.dp))
                        trailingIcon()
                    }
                }
            }
        )
        
        // Error message
        if (isError && errorMessage != null) {
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 4.dp, start = 4.dp)
            )
        }
    }
}

/**
 * Search text field variant
 */
@Composable
fun IdentoSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "Search...",
    modifier: Modifier = Modifier,
    onClear: (() -> Unit)? = null
) {
    val backgroundColor = MaterialTheme.colorScheme.surface
    val borderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
    val shape = RoundedCornerShape(12.dp)
    
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(
            color = MaterialTheme.colorScheme.onSurface
        ),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        decorationBox = { innerTextField ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(backgroundColor)
                    .border(1.dp, borderColor, shape)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Search,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                
                Box(modifier = Modifier.weight(1f)) {
                    if (value.isEmpty()) {
                        Text(
                            text = placeholder,
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                        )
                    }
                    innerTextField()
                }
                
                if (value.isNotEmpty() && onClear != null) {
                    Spacer(modifier = Modifier.width(12.dp))
                    IconButton(
                        onClick = onClear,
                        modifier = Modifier.size(20.dp)
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "Clear",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }
        },
        modifier = modifier.fillMaxWidth()
    )
}
