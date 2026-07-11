package com.idento.presentation.setup

import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * `stationConfigPreferences`/`authPreferences` are [StationConfigGateway]/[AuthLogoutGateway] —
 * narrow seams onto `StationConfigPreferences`/`AuthPreferences` (`data/preferences/...`; see
 * `di/ViewModelModule.kt` for how the real singletons are adapted into these). Same rationale as
 * every other setup-wizard ViewModel test (see e.g. `SetupLoginViewModelTest.kt`'s kdoc): both
 * preferences classes wrap a `DataStoreFactory`/`SecureStore` (`expect class`es with no `actual`
 * outside androidMain/iosMain) and are non-`open`, so neither can be constructed nor subclassed
 * from `commonTest` — going through these seams instead is what keeps [SetupCompleteViewModel]
 * unit testable with plain local fakes.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetupCompleteViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class FakeStationConfigPreferences : StationConfigGateway {
        var saved: StationConfig? = null
        var cleared = false
        override suspend fun save(config: StationConfig) {
            saved = config
        }
        override suspend fun clear() {
            cleared = true
        }
    }

    private class FakeAuthPreferences : AuthLogoutGateway {
        var authCleared = false
        override suspend fun clearAuth() {
            authCleared = true
        }
    }

    @Test
    fun finishPersistsTheBuiltStationConfig() = runTest(testDispatcher) {
        val draft = SetupWizardDraft().apply {
            eventId = "evt-1"; eventName = "Технопром-2026"; mode = StationMode.KIOSK
            workPointId = "z1"; workPointName = "Холл"; deviceNumber = 4; staffName = "kiosk@idento.app"
        }
        val fakePreferences = FakeStationConfigPreferences()
        val viewModel = SetupCompleteViewModel(draft, fakePreferences, FakeAuthPreferences())

        viewModel.finish()

        assertEquals("evt-1", fakePreferences.saved?.eventId)
        assertTrue(viewModel.uiState.value.stationConfig != null)
    }

    @Test
    fun exitStationClearsPersistedConfigAndAuth() = runTest(testDispatcher) {
        val fakePreferences = FakeStationConfigPreferences()
        val fakeAuth = FakeAuthPreferences()
        val draft = SetupWizardDraft().apply {
            eventId = "evt-1"; mode = StationMode.KIOSK; workPointId = "z1"; workPointName = "Холл"
        }
        val viewModel = SetupCompleteViewModel(draft, fakePreferences, fakeAuth)
        viewModel.finish()

        viewModel.exitStation()

        assertTrue(fakePreferences.cleared)
        assertTrue(fakeAuth.authCleared)
    }
}
