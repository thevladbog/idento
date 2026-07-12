package com.idento.presentation.navigation

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.idento.presentation.settings.SettingsScreen
import com.idento.data.model.StationMode
import com.idento.presentation.kiosk.KioskScreen
import com.idento.presentation.registration.RegistrationHomeScreen
import com.idento.presentation.setup.SetupCompleteScreen
import com.idento.presentation.setup.SetupDayZoneScreen
import com.idento.presentation.setup.SetupEventScreen
import com.idento.presentation.setup.SetupLoginScreen
import com.idento.presentation.setup.SetupModeScreen
import com.idento.presentation.setup.SetupPrinterScreen
import com.idento.presentation.zonecontrol.ZoneControlScreen

/**
 * Per spec §8: an expired/revoked token always routes back to Login, even if a StationConfig
 * is still persisted (queues survive and are re-delivered after signing back in — that's
 * SyncService's job, unrelated to this decision).
 *
 * When both [hasStationConfig] and [isLoggedIn] are true the [stationMode] is used to select
 * the correct home screen: REGISTRATION → [Screen.RegistrationHome]; ZONE_CONTROL →
 * [Screen.ZoneControlHome]; KIOSK → [Screen.KioskHome]; the default null falls back to
 * [Screen.SetupComplete] (no station has been configured with an unrecognized mode).
 */
fun resolveStartDestination(
    hasStationConfig: Boolean,
    isLoggedIn: Boolean,
    stationMode: StationMode? = null,
): String = when {
    !hasStationConfig || !isLoggedIn -> Screen.SetupLogin.route
    stationMode == StationMode.REGISTRATION -> Screen.RegistrationHome.route
    stationMode == StationMode.ZONE_CONTROL -> Screen.ZoneControlHome.route
    stationMode == StationMode.KIOSK -> Screen.KioskHome.route
    else -> Screen.SetupComplete.route
}

/**
 * Main Navigation Host (Cross-platform)
 * Handles all app navigation
 */
@Composable
fun IdentoNavHost(
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
    startDestination: String
) {
    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier
    ) {
        // Settings Screen — reachable from Registration and Zone Control (M4).
        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
            )
        }

        // Setup Wizard (M1b) — station provisioning, run on first launch / after logout.
        composable(Screen.SetupLogin.route) {
            SetupLoginScreen(
                onNavigateToEvent = {
                    navController.navigate(Screen.SetupEvent.route)
                },
                onNavigateToMode = {
                    navController.navigate(Screen.SetupMode.route) {
                        popUpTo(Screen.SetupLogin.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.SetupEvent.route) {
            SetupEventScreen(
                onEventProvisioned = {
                    navController.navigate(Screen.SetupMode.route) {
                        popUpTo(Screen.SetupLogin.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.SetupMode.route) {
            SetupModeScreen(
                onContinue = {
                    navController.navigate(Screen.SetupDayZone.route)
                }
            )
        }

        composable(Screen.SetupDayZone.route) {
            SetupDayZoneScreen(
                onNavigateToPrinter = {
                    navController.navigate(Screen.SetupPrinter.route)
                },
                onNavigateToDone = {
                    navController.navigate(Screen.SetupComplete.route)
                }
            )
        }

        composable(Screen.SetupPrinter.route) {
            SetupPrinterScreen(
                onNavigateToDone = {
                    navController.navigate(Screen.SetupComplete.route)
                }
            )
        }

        composable(Screen.SetupComplete.route) {
            SetupCompleteScreen(
                onExitStation = {
                    navController.navigate(Screen.SetupLogin.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onNavigateToStation = { route ->
                    navController.navigate(route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.RegistrationHome.route) {
            RegistrationHomeScreen(
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
            )
        }

        composable(Screen.ZoneControlHome.route) {
            ZoneControlScreen(
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
            )
        }

        composable(Screen.KioskHome.route) {
            KioskScreen(
                onExitStation = {
                    navController.navigate(Screen.SetupLogin.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
    }
}
