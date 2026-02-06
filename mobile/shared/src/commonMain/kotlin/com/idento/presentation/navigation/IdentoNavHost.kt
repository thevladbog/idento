package com.idento.presentation.navigation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.idento.presentation.attendees.AttendeesListScreen
import com.idento.presentation.checkin.CheckinScreen
import com.idento.presentation.events.EventsScreen
import com.idento.presentation.login.LoginScreen
import com.idento.presentation.qrscanner.QRScannerScreen
import com.idento.presentation.settings.SettingsScreen
import com.idento.presentation.template.DisplayTemplateScreen
import com.idento.presentation.template.TemplateEditorScreen

/**
 * Main Navigation Host (Cross-platform)
 * Handles all app navigation
 */
@Composable
fun IdentoNavHost(
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
    startDestination: String = Screen.Login.route
) {
    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier
    ) {
        // Login Screen
        composable(Screen.Login.route) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(Screen.Events.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }
        
        // Events Screen
        composable(Screen.Events.route) {
            EventsScreen(
                onNavigateToCheckin = { eventId, eventName ->
                    navController.navigate(Screen.Checkin.createRoute(eventId, eventName))
                },
                onNavigateToSettings = {
                    navController.navigate(Screen.Settings.route)
                },
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Events.route) { inclusive = true }
                    }
                }
            )
        }
        
        // Checkin Screen
        composable(
            route = Screen.Checkin.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType },
                navArgument("eventName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            val eventName = backStackEntry.arguments?.getString("eventName") ?: ""
            
            // Get selected attendee ID from previous screen (AttendeesListScreen)
            val selectedAttendeeId = backStackEntry.savedStateHandle.get<String>("selectedAttendeeId")
            
            CheckinScreen(
                eventId = eventId,
                eventName = eventName,
                selectedAttendeeId = selectedAttendeeId,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToAttendeesList = {
                    navController.navigate(Screen.AttendeesList.createRoute(eventId))
                },
                onNavigateToQRScanner = {
                    navController.navigate(Screen.QRScanner.createRoute(eventId, eventName))
                },
                onNavigateToTemplateEditor = {
                    navController.navigate(Screen.TemplateEditor.createRoute(eventId))
                },
                onNavigateToDisplayTemplate = {
                    navController.navigate(Screen.DisplayTemplate.createRoute(eventId))
                },
                onClearSelectedAttendee = {
                    // Clear the savedStateHandle after processing
                    backStackEntry.savedStateHandle.remove<String>("selectedAttendeeId")
                }
            )
        }
        
        // Settings Screen
        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToBluetoothScanner = {
                    navController.navigate(Screen.BluetoothScannerSettings.route)
                }
            )
        }
        
        // QR Scanner Screen (Kiosk mode)
        composable(
            route = Screen.QRScanner.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType },
                navArgument("eventName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            val eventName = backStackEntry.arguments?.getString("eventName") ?: ""
            
            QRScannerScreen(
                eventId = eventId,
                eventName = eventName,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        
        // Attendees List Screen
        composable(
            route = Screen.AttendeesList.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            
            AttendeesListScreen(
                eventId = eventId,
                onNavigateBack = { navController.popBackStack() },
                onSelectAttendee = { attendee ->
                    // Pass selected attendee ID back via savedStateHandle
                    navController.previousBackStackEntry?.savedStateHandle?.set("selectedAttendeeId", attendee.id)
                    navController.popBackStack()
                }
            )
        }
        
        // Template Editor Screen (ZPL Badge)
        composable(
            route = Screen.TemplateEditor.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            
            TemplateEditorScreen(
                eventId = eventId,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        
        // Display Template Screen (Markdown)
        composable(
            route = Screen.DisplayTemplate.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            
            DisplayTemplateScreen(
                eventId = eventId,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        
        // Bluetooth Scanner Settings
        composable(Screen.BluetoothScannerSettings.route) {
            PlaceholderScreen(
                title = "Bluetooth Scanner",
                subtitle = "Scanner settings coming soon",
                onBack = { navController.popBackStack() }
            )
        }
    }
}

/**
 * Placeholder screen for features not yet implemented
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlaceholderScreen(
    title: String,
    subtitle: String,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                )
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
