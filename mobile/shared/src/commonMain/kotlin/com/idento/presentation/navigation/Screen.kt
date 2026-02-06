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
    data object Checkin : Screen("checkin/{eventId}/{eventName}/{zoneId}/{eventDay}") {
        fun createRoute(eventId: String, eventName: String, zoneId: String, eventDay: String) = 
            "checkin/$eventId/$eventName/$zoneId/$eventDay"
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
}
