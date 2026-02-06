package com.idento.presentation.navigation

sealed class Screen(val route: String) {
    object Login : Screen("login")
    object QRLogin : Screen("qr_login")
    object Events : Screen("events")
    object Settings : Screen("settings")
    data object Checkin : Screen("checkin/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String): String {
            return "checkin/$eventId/$eventName"
        }
    }
    data object QRScanner : Screen("qr_scanner/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String): String {
            return "qr_scanner/$eventId/$eventName"
        }
    }
    data object TemplateEditor : Screen("template_editor/{eventId}/{eventName}/{templateType}") {
        fun createRoute(eventId: String, eventName: String, templateType: String): String {
            return "template_editor/$eventId/$eventName/$templateType"
        }
    }
    
    data object AttendeesList : Screen("attendees_list/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String): String {
            return "attendees_list/$eventId/$eventName"
        }
    }
    
    object BluetoothScannerSettings : Screen("bluetooth_scanner_settings")
}
