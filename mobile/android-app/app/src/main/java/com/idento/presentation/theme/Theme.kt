package com.idento.presentation.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Light color scheme - легкий и воздушный
 * Много белого пространства, мягкие тени
 */
private val LightColorScheme = lightColorScheme(
    // Primary
    primary = Primary,
    onPrimary = Color.White,
    primaryContainer = PrimaryContainer,
    onPrimaryContainer = OnPrimaryContainer,
    inversePrimary = PrimaryLight,
    
    // Secondary
    secondary = Secondary,
    onSecondary = Color.White,
    secondaryContainer = SecondaryContainer,
    onSecondaryContainer = OnSecondaryContainer,
    
    // Tertiary
    tertiary = Tertiary,
    onTertiary = Color.White,
    tertiaryContainer = TertiaryContainer,
    onTertiaryContainer = Neutral900,
    
    // Background & Surface
    background = Neutral50,
    onBackground = Neutral900,
    surface = SurfaceLight,
    onSurface = Neutral900,
    surfaceVariant = SurfaceContainer,
    onSurfaceVariant = Neutral600,
    surfaceTint = Primary,
    
    // Inverse
    inverseSurface = Neutral800,
    inverseOnSurface = Neutral100,
    
    // Error
    error = Error,
    onError = Color.White,
    errorContainer = ErrorLight,
    onErrorContainer = Color(0xFF7F1D1D),
    
    // Outline
    outline = Neutral300,
    outlineVariant = Neutral200,
    
    // Scrim
    scrim = Color.Black.copy(alpha = 0.32f)
)

/**
 * Dark color scheme - современный темный режим
 */
private val DarkColorScheme = darkColorScheme(
    // Primary
    primary = PrimaryLight,
    onPrimary = OnPrimaryContainer,
    primaryContainer = PrimaryDark,
    onPrimaryContainer = PrimaryContainer,
    inversePrimary = Primary,
    
    // Secondary
    secondary = SecondaryLight,
    onSecondary = OnSecondaryContainer,
    secondaryContainer = Secondary,
    onSecondaryContainer = SecondaryContainer,
    
    // Tertiary
    tertiary = Tertiary,
    onTertiary = Neutral900,
    tertiaryContainer = Color(0xFF78350F),
    onTertiaryContainer = TertiaryContainer,
    
    // Background & Surface
    background = SurfaceDark,
    onBackground = Neutral100,
    surface = SurfaceDarkDim,
    onSurface = Neutral100,
    surfaceVariant = SurfaceContainerDark,
    onSurfaceVariant = Neutral400,
    surfaceTint = PrimaryLight,
    
    // Inverse
    inverseSurface = Neutral100,
    inverseOnSurface = Neutral800,
    
    // Error
    error = Color(0xFFF87171),
    onError = Color(0xFF7F1D1D),
    errorContainer = Color(0xFF450A0A),
    onErrorContainer = ErrorLight,
    
    // Outline
    outline = Neutral600,
    outlineVariant = Neutral700,
    
    // Scrim
    scrim = Color.Black.copy(alpha = 0.6f)
)

@Composable
fun IdentoTheme(
    themeMode: String = "system",
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val darkTheme = when (themeMode) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }
    
    val colorScheme = when {
        // Dynamic color on Android 12+
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            // Делаем статус бар прозрачным для edge-to-edge
            WindowCompat.setDecorFitsSystemWindows(window, false)
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        shapes = IdentoShapes,
        content = content
    )
}
