package com.idento.presentation.navigation

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
    fun startsAtSetupCompleteWhenFullyConfigured() {
        assertEquals(Screen.SetupComplete.route, resolveStartDestination(hasStationConfig = true, isLoggedIn = true))
    }
}
