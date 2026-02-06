package com.idento.presentation.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.idento.presentation.login.LoginScreen
import com.idento.presentation.login.LoginViewModel
import com.idento.presentation.events.EventsScreen
import com.idento.presentation.events.EventsViewModel
import com.idento.presentation.checkin.CheckinScreen
import com.idento.presentation.checkin.CheckinViewModel
import com.idento.presentation.attendees.AttendeesListScreen
import com.idento.presentation.qrscanner.QRScannerScreen
import com.idento.presentation.qrscanner.QRScannerViewModel
import com.idento.presentation.settings.SettingsScreen
import com.idento.presentation.settings.SettingsViewModel
import com.idento.presentation.template.TemplateEditorScreen
import com.idento.presentation.template.TemplateEditorViewModel
import com.idento.presentation.scanner.BluetoothScannerSettingsScreen
import com.idento.presentation.scanner.BluetoothScannerViewModel

@Composable
fun IdentoNavHost(
    navController: NavHostController = rememberNavController(),
    startDestination: String = Screen.Login.route
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        // Login Screen
        composable(Screen.Login.route) {
            val viewModel: LoginViewModel = hiltViewModel()
            LoginScreen(
                viewModel = viewModel,
                onNavigateToQRLogin = {
                    navController.navigate(Screen.QRLogin.route)
                },
                onNavigateToEvents = {
                    navController.navigate(Screen.Events.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }
        
        // QR Login Screen
        composable(Screen.QRLogin.route) {
            // TODO: QRLoginScreen
        }
        
        // Events Screen
        composable(Screen.Events.route) {
            val viewModel: EventsViewModel = hiltViewModel()
            EventsScreen(
                viewModel = viewModel,
                onNavigateToCheckin = { eventId, eventName ->
                    navController.navigate("checkin/$eventId/$eventName")
                },
                onNavigateToSettings = {
                    navController.navigate(Screen.Settings.route)
                },
                onNavigateToLogin = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
        
        // Settings Screen
        composable(Screen.Settings.route) {
            val viewModel: SettingsViewModel = hiltViewModel()
            SettingsScreen(
                viewModel = viewModel,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToBluetoothScanner = {
                    navController.navigate(Screen.BluetoothScannerSettings.route)
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
            val viewModel: CheckinViewModel = hiltViewModel()
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            val eventName = backStackEntry.arguments?.getString("eventName") ?: ""
            CheckinScreen(
                viewModel = viewModel,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToAttendeesList = {
                    navController.navigate(Screen.AttendeesList.createRoute(eventId, eventName))
                },
                onNavigateToTemplateEditor = { templateType ->
                    navController.navigate(Screen.TemplateEditor.createRoute(eventId, eventName, templateType))
                },
                onNavigateToQRScanner = {
                    navController.navigate(Screen.QRScanner.createRoute(eventId, eventName))
                }
            )
        }
        
        // Attendees List Screen
        composable(
            route = Screen.AttendeesList.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType },
                navArgument("eventName") { type = NavType.StringType }
            )
        ) { _ ->
            val viewModel: CheckinViewModel = hiltViewModel()
            AttendeesListScreen(
                viewModel = viewModel,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onAttendeeClick = { attendee ->
                    // Выбираем участника и возвращаемся
                    viewModel.selectAttendee(attendee)
                }
            )
        }
        
        // QR Scanner Screen
        composable(
            route = Screen.QRScanner.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType },
                navArgument("eventName") { type = NavType.StringType }
            )
        ) { _ ->
            val viewModel: QRScannerViewModel = hiltViewModel()
            QRScannerScreen(
                viewModel = viewModel,
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
        
        // Template Editor Screen
        composable(
            route = Screen.TemplateEditor.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType },
                navArgument("eventName") { type = NavType.StringType },
                navArgument("templateType") { type = NavType.StringType }
            )
        ) { _ ->
            val viewModel: TemplateEditorViewModel = hiltViewModel()
            TemplateEditorScreen(
                viewModel = viewModel,
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
        
        // Bluetooth Scanner Settings Screen
        composable(Screen.BluetoothScannerSettings.route) {
            val viewModel: BluetoothScannerViewModel = hiltViewModel()
            BluetoothScannerSettingsScreen(
                viewModel = viewModel,
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}
