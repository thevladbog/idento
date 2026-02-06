package com.idento.presentation.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.idento.presentation.theme.CardShape

/**
 * Современная карточка с минимальными тенями - легкий и воздушный дизайн
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IdentoCard(
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable ColumnScope.() -> Unit
) {
    if (onClick != null) {
        Surface(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier.fillMaxWidth(),
            shape = CardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 1.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                content = content
            )
        }
    } else {
        Surface(
            modifier = modifier.fillMaxWidth(),
            shape = CardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 1.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                content = content
            )
        }
    }
}

/**
 * Компактная карточка для списков
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IdentoListCard(
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    containerColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.surface,
    content: @Composable ColumnScope.() -> Unit
) {
    if (onClick != null) {
        Surface(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier.fillMaxWidth(),
            shape = CardShape,
            color = containerColor,
            tonalElevation = 1.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                content = content
            )
        }
    } else {
        Surface(
            modifier = modifier.fillMaxWidth(),
            shape = CardShape,
            color = containerColor,
            tonalElevation = 1.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                content = content
            )
        }
    }
}
