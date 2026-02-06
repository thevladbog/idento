package com.idento

import androidx.compose.runtime.*
import com.idento.data.preferences.AppPreferences
import com.idento.presentation.navigation.IdentoNavHost
import com.idento.presentation.theme.IdentoTheme
import com.idento.presentation.theme.ThemeState
import kotlinx.coroutines.flow.catch
import org.koin.compose.koinInject

/**
 * Main App Composable (Cross-platform entry point)
 * Works on Android and iOS
 */
@Composable
fun App() {
    val appPreferences: AppPreferences = koinInject()
    
    // Load theme from DataStore on startup
    LaunchedEffect(Unit) {
        try {
            appPreferences.themeMode
                .catch { e ->
                    println("⚠️ Failed to load theme on iOS: ${e.message}")
                }
                .collect { theme ->
                    ThemeState.setTheme(theme)
                }
        } catch (e: Exception) {
            println("⚠️ Theme collection failed: ${e.message}")
        }
    }
    
    // Use global ThemeState for instant theme switching
    IdentoTheme(themeMode = ThemeState.currentTheme) {
        IdentoNavHost()
    }
}
