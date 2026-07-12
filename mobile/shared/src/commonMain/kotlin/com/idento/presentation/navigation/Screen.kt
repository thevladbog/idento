package com.idento.presentation.navigation

/**
 * Screen routes for navigation (Cross-platform)
 */
sealed class Screen(val route: String) {
    data object Settings : Screen("settings")

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
