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
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
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

    private class FakeStationConfigPreferences(private val throwOnClear: Boolean = false) : StationConfigGateway {
        var saved: StationConfig? = null
        var cleared = false
        var existing: StationConfig? = null
        override suspend fun save(config: StationConfig) {
            saved = config
        }
        override suspend fun clear() {
            if (throwOnClear) throw IllegalStateException("clear failed")
            cleared = true
        }
        override suspend fun get(): StationConfig? = existing
    }

    private class FakeAuthPreferences(private val throwOnClearAuth: Boolean = false) : AuthLogoutGateway {
        var authCleared = false
        override suspend fun clearAuth() {
            if (throwOnClearAuth) throw IllegalStateException("clearAuth failed")
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
    fun finishLoadsAlreadyPersistedConfigWithoutTouchingDraftOnReentry() = runTest(testDispatcher) {
        // Simulates re-entry to this screen after the wizard has already completed once — e.g.
        // Kiosk's lockdown-exit route navigating back to Screen.SetupComplete, which mounts a
        // fresh SetupCompleteViewModel while SetupWizardDraft (a Koin singleton) is still sitting
        // in its post-finish() reset() state (mode = null). If finish() didn't check for an
        // already-persisted config FIRST, draft.toStationConfig() would throw and uiState.error
        // would be non-null instead of stationConfig being populated.
        val persistedConfig = StationConfig(
            eventId = "evt-1", eventName = "Технопром-2026", mode = StationMode.KIOSK,
            dayDate = null, workPointId = "z1", workPointName = "Холл", printer = null,
            autoPrint = false, deviceNumber = 4, staffName = "kiosk@idento.app",
        )
        val fakePreferences = FakeStationConfigPreferences().apply { existing = persistedConfig }
        val draft = SetupWizardDraft() // reset/blank state: mode == null
        val viewModel = SetupCompleteViewModel(draft, fakePreferences, FakeAuthPreferences())

        viewModel.finish()

        assertEquals(persistedConfig, viewModel.uiState.value.stationConfig)
        assertEquals(null, viewModel.uiState.value.error)
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

    @Test
    fun finishSurfacesErrorInsteadOfCrashingWhenDraftIsMissingARequiredField() = runTest(testDispatcher) {
        // workPointId intentionally left blank: toStationConfig() throws IllegalStateException
        // ("Cannot build StationConfig: workPointId missing") — a required-field bug in an earlier
        // wizard step, not something the wizard's own flow can normally produce, but still a real
        // possible failure mode that must surface as uiState.error rather than crash the app.
        val draft = SetupWizardDraft().apply {
            eventId = "evt-1"; eventName = "Технопром-2026"; mode = StationMode.REGISTRATION
            dayDate = "2026-07-10"; deviceNumber = 4; staffName = "staff@idento.app"
        }
        val fakePreferences = FakeStationConfigPreferences()
        val viewModel = SetupCompleteViewModel(draft, fakePreferences, FakeAuthPreferences())

        viewModel.finish()

        assertEquals("Cannot build StationConfig: workPointId missing", viewModel.uiState.value.error)
        assertEquals(null, viewModel.uiState.value.stationConfig)
        assertEquals(null, fakePreferences.saved)
    }

    @Test
    fun exitStationSurfacesErrorAndLeavesExitedFalseWhenClearThrows() = runTest(testDispatcher) {
        val fakePreferences = FakeStationConfigPreferences(throwOnClear = true)
        val fakeAuth = FakeAuthPreferences()
        val draft = SetupWizardDraft().apply {
            eventId = "evt-1"; mode = StationMode.KIOSK; workPointId = "z1"; workPointName = "Холл"
        }
        val viewModel = SetupCompleteViewModel(draft, fakePreferences, fakeAuth)

        viewModel.exitStation()

        // Not stranded silently: uiState.error is non-null so the screen CAN show something, even
        // though exited correctly stays false (the persisted config genuinely wasn't cleared).
        assertNotNull(viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.exited)
        assertFalse(fakeAuth.authCleared)
    }

    @Test
    fun exitStationSurfacesErrorAndLeavesExitedFalseWhenClearAuthThrows() = runTest(testDispatcher) {
        val fakePreferences = FakeStationConfigPreferences()
        val fakeAuth = FakeAuthPreferences(throwOnClearAuth = true)
        val draft = SetupWizardDraft().apply {
            eventId = "evt-1"; mode = StationMode.KIOSK; workPointId = "z1"; workPointName = "Холл"
        }
        val viewModel = SetupCompleteViewModel(draft, fakePreferences, fakeAuth)

        viewModel.exitStation()

        assertNotNull(viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.exited)
        assertTrue(fakePreferences.cleared)
    }
}
