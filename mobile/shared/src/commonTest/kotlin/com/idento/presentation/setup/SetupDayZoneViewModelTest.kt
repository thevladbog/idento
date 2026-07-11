package com.idento.presentation.setup

import com.idento.data.model.Event
import com.idento.data.model.EventZoneWithStats
import com.idento.data.model.StationMode
import com.idento.data.network.ApiResult
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
 * `eventLoader`/`zoneLister`/`eventDaysCalculator` are narrow fun-interface seams
 * `SetupDayZoneViewModel` depends on instead of `EventRepository`/`ZoneRepository` directly (see
 * SetupDayZoneViewModel.kt's kdoc) — same rationale as `SetupEventViewModel`/
 * `SetupEventViewModelTest`: those repositories are plain classes wrapping a live Ktor
 * `HttpClient` with no mock-engine seam, so they cannot be constructed from commonTest.
 * `EventLister` (declared in SetupEventViewModel.kt) wraps the no-arg `getEvents()` and doesn't
 * fit this screen's `getEvent(eventId)` need, so `EventLoader` is a new, differently-shaped seam
 * rather than a reuse.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetupDayZoneViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class FakeEventLoader(private val result: ApiResult<Event> = ApiResult.Error(RuntimeException("not used"))) : EventLoader {
        override suspend fun getEvent(eventId: String): ApiResult<Event> = result
    }

    private class FakeZoneLister(private val result: ApiResult<List<EventZoneWithStats>> = ApiResult.Success(emptyList())) : ZoneLister {
        override suspend fun getStaffZones(eventId: String): ApiResult<List<EventZoneWithStats>> = result
    }

    private class FakeEventDaysCalculator(private val days: List<String> = emptyList()) : EventDaysCalculator {
        override fun getEventDays(startDate: String, endDate: String): List<String> = days
    }

    private fun zone(id: String, isRegistration: Boolean) = EventZoneWithStats(
        id = id, eventId = "evt-1", name = "Zone $id", zoneType = "general", orderIndex = 0,
        isRegistrationZone = isRegistration, isActive = true,
    )

    @Test
    fun kioskModeSkipsDayPillsAndFiltersToRegistrationZonesOnly() = runTest(testDispatcher) {
        val draft = SetupWizardDraft().apply { eventId = "evt-1"; mode = StationMode.KIOSK }
        val zones = listOf(zone("z1", isRegistration = true), zone("z2", isRegistration = false))
        val viewModel = SetupDayZoneViewModel(
            eventLoader = FakeEventLoader(ApiResult.Success(Event(id = "evt-1", name = "E", startDate = "2026-07-10", endDate = "2026-07-12"))),
            zoneLister = FakeZoneLister(ApiResult.Success(zones)),
            eventDaysCalculator = FakeEventDaysCalculator(listOf("2026-07-10", "2026-07-11", "2026-07-12")),
            draft = draft,
        )

        viewModel.load()

        assertEquals(emptyList<String>(), viewModel.uiState.value.days) // no day pills for KIOSK
        assertEquals(listOf("z1"), viewModel.uiState.value.workPoints.map { it.id }) // registration-only
        assertEquals(false, viewModel.uiState.value.showDayPicker)
    }

    @Test
    fun zoneControlModeShowsDaysAndAllZones() = runTest(testDispatcher) {
        val draft = SetupWizardDraft().apply { eventId = "evt-1"; mode = StationMode.ZONE_CONTROL }
        val zones = listOf(zone("z1", isRegistration = true), zone("z2", isRegistration = false))
        val viewModel = SetupDayZoneViewModel(
            eventLoader = FakeEventLoader(ApiResult.Success(Event(id = "evt-1", name = "E", startDate = "2026-07-10", endDate = "2026-07-11"))),
            zoneLister = FakeZoneLister(ApiResult.Success(zones)),
            eventDaysCalculator = FakeEventDaysCalculator(listOf("2026-07-10", "2026-07-11")),
            draft = draft,
        )

        viewModel.load()

        assertTrue(viewModel.uiState.value.days.isNotEmpty())
        assertEquals(listOf("z1", "z2"), viewModel.uiState.value.workPoints.map { it.id })
        assertTrue(viewModel.uiState.value.showDayPicker)
    }

    @Test
    fun registrationModeShowsDaysButFiltersToRegistrationZonesOnly() = runTest(testDispatcher) {
        val draft = SetupWizardDraft().apply { eventId = "evt-1"; mode = StationMode.REGISTRATION }
        val zones = listOf(zone("z1", isRegistration = true), zone("z2", isRegistration = false))
        val viewModel = SetupDayZoneViewModel(
            eventLoader = FakeEventLoader(ApiResult.Success(Event(id = "evt-1", name = "E", startDate = "2026-07-10", endDate = "2026-07-11"))),
            zoneLister = FakeZoneLister(ApiResult.Success(zones)),
            eventDaysCalculator = FakeEventDaysCalculator(listOf("2026-07-10", "2026-07-11")),
            draft = draft,
        )

        viewModel.load()

        assertTrue(viewModel.uiState.value.days.isNotEmpty())
        assertEquals(listOf("z1"), viewModel.uiState.value.workPoints.map { it.id })
        assertTrue(viewModel.uiState.value.showDayPicker)
    }

    @Test
    fun selectingDayAndWorkPointWritesToDraft() {
        val draft = SetupWizardDraft().apply { mode = StationMode.REGISTRATION }
        val viewModel = SetupDayZoneViewModel(FakeEventLoader(), FakeZoneLister(), FakeEventDaysCalculator(), draft)

        viewModel.onDaySelected("2026-07-10")
        viewModel.onWorkPointSelected(id = "z1", name = "Главный вход")

        assertEquals("2026-07-10", draft.dayDate)
        assertEquals("z1", draft.workPointId)
        assertEquals("Главный вход", draft.workPointName)
    }

    @Test
    fun eventLoadFailureSurfacesAnErrorAndDoesNotLoadWorkPoints() = runTest(testDispatcher) {
        val draft = SetupWizardDraft().apply { eventId = "evt-1"; mode = StationMode.REGISTRATION }
        val viewModel = SetupDayZoneViewModel(
            eventLoader = FakeEventLoader(ApiResult.Error(RuntimeException("boom"), "Could not load event")),
            zoneLister = FakeZoneLister(ApiResult.Error(RuntimeException("must not be called"))),
            eventDaysCalculator = FakeEventDaysCalculator(),
            draft = draft,
        )

        viewModel.load()

        assertEquals("Could not load event", viewModel.uiState.value.error)
        assertTrue(viewModel.uiState.value.workPoints.isEmpty())
    }

    @Test
    fun zoneControlSkipsThePrinterStepButOtherModesDoNot() {
        val zoneControlDraft = SetupWizardDraft().apply { mode = StationMode.ZONE_CONTROL }
        val zoneControlViewModel = SetupDayZoneViewModel(FakeEventLoader(), FakeZoneLister(), FakeEventDaysCalculator(), zoneControlDraft)
        assertTrue(zoneControlViewModel.shouldSkipPrinterStep())

        val registrationDraft = SetupWizardDraft().apply { mode = StationMode.REGISTRATION }
        val registrationViewModel = SetupDayZoneViewModel(FakeEventLoader(), FakeZoneLister(), FakeEventDaysCalculator(), registrationDraft)
        assertEquals(false, registrationViewModel.shouldSkipPrinterStep())

        val kioskDraft = SetupWizardDraft().apply { mode = StationMode.KIOSK }
        val kioskViewModel = SetupDayZoneViewModel(FakeEventLoader(), FakeZoneLister(), FakeEventDaysCalculator(), kioskDraft)
        assertEquals(false, kioskViewModel.shouldSkipPrinterStep())
    }
}
