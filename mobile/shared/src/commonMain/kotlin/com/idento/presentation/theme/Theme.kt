package com.idento.presentation.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * iOS-inspired color scheme with neutral grays
 * Avoids Material UI purple tints
 */
private val DarkColorScheme = darkColorScheme(
    primary = ItalianGreen,
    onPrimary = Color.White,
    primaryContainer = ItalianGreenDark,
    onPrimaryContainer = Color.White,
    secondary = Gray500,
    onSecondary = Color.White,
    secondaryContainer = Gray700,
    onSecondaryContainer = Gray100,
    tertiary = Gray400,
    onTertiary = Gray900,
    background = Color(0xFF000000),
    onBackground = Color.White,
    surface = Color(0xFF1C1C1E),  // iOS dark surface
    onSurface = Color.White,
    surfaceVariant = Color(0xFF2C2C2E),  // iOS secondary dark
    onSurfaceVariant = Gray400,
    outline = Gray600,
    outlineVariant = Gray700,
    error = Error,
    onError = Color.White
)

private val LightColorScheme = lightColorScheme(
    primary = ItalianGreen,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE8F5E9),  // Very light green
    onPrimaryContainer = ItalianGreenDark,
    secondary = Gray600,
    onSecondary = Color.White,
    secondaryContainer = Gray200,
    onSecondaryContainer = Gray800,
    tertiary = Gray500,
    onTertiary = Color.White,
    background = Color(0xFFF2F2F7),  // iOS system background
    onBackground = Color(0xFF1C1C1E),
    surface = Color.White,
    onSurface = Color(0xFF1C1C1E),
    surfaceVariant = Color(0xFFF2F2F7),  // iOS grouped background
    onSurfaceVariant = Gray600,
    outline = Gray300,
    outlineVariant = Gray200,
    error = Error,
    onError = Color.White
)

/**
 * Idento Theme (Cross-platform)
 * Works on Android and iOS
 */
@Composable
fun IdentoTheme(
    themeMode: String = "system",
    content: @Composable () -> Unit
) {
    val darkTheme = when (themeMode) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme() // "system" or default
    }
    
    val colorScheme = when {
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
