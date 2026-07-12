package com.idento.presentation.navigation

/**
 * Screen routes for navigation (Cross-platform)
 */
sealed class Screen(val route: String) {
    data object Login : Screen("login")
    data object Events : Screen("events")
    data object DaySelect : Screen("day_select/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String) = 
            "day_select/$eventId/$eventName"
    }
    data object ZoneSelect : Screen("zone_select/{eventId}/{eventDay}") {
        fun createRoute(eventId: String, eventDay: String) = 
            "zone_select/$eventId/$eventDay"
    }
    data object Checkin : Screen("checkin/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String) = 
            "checkin/$eventId/$eventName"
    }
    data object AttendeesList : Screen("attendees/{eventId}") {
        fun createRoute(eventId: String) = "attendees/$eventId"
    }
    data object Settings : Screen("settings")
    data object QRScanner : Screen("qr_scanner/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String) = 
            "qr_scanner/$eventId/$eventName"
    }
    data object TemplateEditor : Screen("template_editor/{eventId}") {
        fun createRoute(eventId: String) = "template_editor/$eventId"
    }
    data object DisplayTemplate : Screen("display_template/{eventId}") {
        fun createRoute(eventId: String) = "display_template/$eventId"
    }
    data object BluetoothScannerSettings : Screen("bluetooth_scanner_settings")

    // Setup wizard (M1b) — all wizard state lives in the shared SetupWizardDraft, not nav args.
    data object SetupLogin : Screen("setup_login")
    data object SetupEvent : Screen("setup_event")
    data object SetupMode : Screen("setup_mode")
    data object SetupDayZone : Screen("setup_day_zone")
    data object SetupPrinter : Screen("setup_printer")
    data object SetupComplete : Screen("setup_complete")

    // Registration mode (M1d) — screen shown on cold start when stationMode == REGISTRATION.
    data object RegistrationHome : Screen("registration_home")

    // Zone Control mode (M2) — screen shown on cold start when stationMode == ZONE_CONTROL.
    data object ZoneControlHome : Screen("zone_control_home")

    // Kiosk mode (M3) — screen shown on cold start when stationMode == KIOSK.
    data object KioskHome : Screen("kiosk_home")
}
