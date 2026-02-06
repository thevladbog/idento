package com.idento.presentation.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Определение типа устройства по ширине экрана
 */
enum class WindowSize {
    COMPACT,  // Телефон в портретной ориентации (< 600dp)
    MEDIUM,   // Телефон в landscape / маленький планшет (600dp - 840dp)
    EXPANDED  // Планшет / складной телефон (> 840dp)
}

/**
 * Получить текущий размер окна
 */
@Composable
fun rememberWindowSize(): WindowSize {
    val configuration = LocalConfiguration.current
    val screenWidth = configuration.screenWidthDp.dp
    
    return when {
        screenWidth < 600.dp -> WindowSize.COMPACT
        screenWidth < 840.dp -> WindowSize.MEDIUM
        else -> WindowSize.EXPANDED
    }
}

/**
 * Адаптивный padding в зависимости от размера экрана
 */
@Composable
fun getResponsivePadding(): Dp {
    return when (rememberWindowSize()) {
        WindowSize.COMPACT -> 16.dp
        WindowSize.MEDIUM -> 24.dp
        WindowSize.EXPANDED -> 32.dp
    }
}

/**
 * Адаптивная ширина контента (для центрирования на больших экранах)
 */
@Composable
fun getMaxContentWidth(): Dp {
    return when (rememberWindowSize()) {
        WindowSize.COMPACT -> Dp.Infinity
        WindowSize.MEDIUM -> 600.dp
        WindowSize.EXPANDED -> 840.dp
    }
}

/**
 * Количество колонок для grid layout
 */
@Composable
fun getGridColumns(): Int {
    return when (rememberWindowSize()) {
        WindowSize.COMPACT -> 1
        WindowSize.MEDIUM -> 2
        WindowSize.EXPANDED -> 3
    }
}

/**
 * Размер карточек
 */
@Composable
fun getCardSpacing(): Dp {
    return when (rememberWindowSize()) {
        WindowSize.COMPACT -> 12.dp
        WindowSize.MEDIUM -> 16.dp
        WindowSize.EXPANDED -> 20.dp
    }
}
