package com.idento

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.idento.data.preferences.AppPreferences
import com.idento.data.preferences.AuthPreferences
import com.idento.data.preferences.StationConfigPreferences
import com.idento.data.sync.SyncService
import com.idento.presentation.navigation.IdentoNavHost
import com.idento.presentation.navigation.resolveStartDestination
import com.idento.presentation.theme.IdentoTheme
import com.idento.presentation.theme.ThemeState
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import org.koin.compose.koinInject

/**
 * Main App Composable (Cross-platform entry point)
 * Works on Android and iOS
 */
@Composable
fun App() {
    val appPreferences: AppPreferences = koinInject()
    val stationConfigPreferences: StationConfigPreferences = koinInject()
    val authPreferences: AuthPreferences = koinInject()
    val syncService: SyncService = koinInject()

    // Start the offline-queue auto-sync loop once at app launch. Unconditional on login/
    // StationConfig state — per spec §8 ("очереди... доливаются после входа"), queued zone/
    // registration check-ins should start flushing the moment a session becomes valid, not only
    // once Registration mode's screens exist. `startAutoSync()` itself is a no-op until
    // `NetworkMonitor.isOnline` reports connectivity and a queue actually has pending items, so
    // calling it eagerly here (before login/setup) is safe.
    LaunchedEffect(Unit) {
        try {
            syncService.startAutoSync()
        } catch (e: Exception) {
            println("⚠️ Failed to start sync service: ${e.message}")
        }
    }

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

    // Resolve which screen the wizard/nav graph should start at before the NavHost is first
    // composed — unlike the theme (which can update reactively via ThemeState after the fact),
    // NavHost's startDestination is fixed at first composition and can't be changed later. Held
    // in `remember` and populated exactly once by this LaunchedEffect; the NavHost below is only
    // composed once this is non-null, so there is a brief blank frame instead of a wrong route.
    var startDestination by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        val stationConfig = try {
            stationConfigPreferences.stationConfig
                .catch { e ->
                    println("⚠️ Failed to load station config on startup: ${e.message}")
                }
                .first()
        } catch (e: Exception) {
            println("⚠️ Station config check failed: ${e.message}")
            null
        }
        val isLoggedIn = try {
            authPreferences.isLoggedIn()
        } catch (e: Exception) {
            println("⚠️ Login check failed: ${e.message}")
            false
        }
        startDestination = resolveStartDestination(
            hasStationConfig = stationConfig != null,
            isLoggedIn = isLoggedIn,
            stationMode = stationConfig?.mode,
        )
    }

    // Use global ThemeState for instant theme switching
    IdentoTheme(themeMode = ThemeState.currentTheme) {
        val resolvedStartDestination = startDestination
        if (resolvedStartDestination != null) {
            IdentoNavHost(startDestination = resolvedStartDestination)
        } else {
            // Blank frame while resolving — avoids composing the NavHost with a start
            // destination that would need to change after first composition.
            Surface(modifier = Modifier.fillMaxSize()) {}
        }
    }
}
