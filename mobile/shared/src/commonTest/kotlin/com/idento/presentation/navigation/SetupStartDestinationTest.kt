package com.idento.presentation.navigation

import com.idento.data.model.StationMode
import kotlin.test.Test
import kotlin.test.assertEquals

class SetupStartDestinationTest {

    @Test
    fun startsAtSetupLoginWhenNoStationConfigured() {
        assertEquals(Screen.SetupLogin.route, resolveStartDestination(hasStationConfig = false, isLoggedIn = false))
    }

    @Test
    fun startsAtSetupLoginWhenConfiguredButLoggedOut() {
        // token expired/revoked (spec §8: "Истечение/отзыв токена → на экран входа")
        assertEquals(Screen.SetupLogin.route, resolveStartDestination(hasStationConfig = true, isLoggedIn = false))
    }

    @Test
    fun startsAtSetupCompleteWhenFullyConfiguredWithNoMode() {
        // No mode provided (null default) — falls back to SetupComplete for non-REGISTRATION modes.
        assertEquals(Screen.SetupComplete.route, resolveStartDestination(hasStationConfig = true, isLoggedIn = true))
    }

    @Test
    fun startsAtRegistrationHomeWhenRegistrationModeConfigured() {
        // M1d: REGISTRATION-mode station cold-starts directly at RegistrationHomeScreen.
        assertEquals(
            Screen.RegistrationHome.route,
            resolveStartDestination(hasStationConfig = true, isLoggedIn = true, stationMode = StationMode.REGISTRATION),
        )
    }

    @Test
    fun startsAtSetupCompleteForNonRegistrationModes() {
        // ZONE_CONTROL and KIOSK still go to SetupComplete until M2/M3 implement their screens.
        assertEquals(
            Screen.SetupComplete.route,
            resolveStartDestination(hasStationConfig = true, isLoggedIn = true, stationMode = StationMode.ZONE_CONTROL),
        )
        assertEquals(
            Screen.SetupComplete.route,
            resolveStartDestination(hasStationConfig = true, isLoggedIn = true, stationMode = StationMode.KIOSK),
        )
    }
}
