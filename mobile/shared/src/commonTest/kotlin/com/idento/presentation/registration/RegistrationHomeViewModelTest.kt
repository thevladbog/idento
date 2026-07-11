package com.idento.presentation.registration

import com.idento.data.model.Attendee
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.data.model.VerdictAttendee
import com.idento.data.model.PrintState
import com.idento.data.model.RegistrationVerdict
import com.idento.data.network.ApiResult
import com.idento.data.registration.AttendeeLookup
import com.idento.data.registration.BatchCheckinSubmitter
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationVerdictMapper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.datetime.Instant
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Unit tests for [RegistrationHomeViewModel]. All platform-specific dependencies are replaced with
 * narrow seam fakes:
 *  - [RegistrationStationGateway] / [PendingQueueCountSource] — defined in this file, trivial lambdas
 *  - [EventBadgeTemplateSource] / [AttendeeSearchSource] — trivial lambdas (no HTTP needed)
 *  - [CameraScanGateway] — a fake backed by a [MutableSharedFlow] or [flowOf]; avoids constructing
 *    `CameraService` (an `expect class` with no commonTest `actual`)
 *  - [RegistrationVerdictMapper] / [RegistrationCheckInService] — constructed from their own seam
 *    lambdas (same approach as [com.idento.di.RegistrationServiceConstructionTest])
 *
 * The test dispatcher is set as Main so that `viewModelScope.launch` runs eagerly (unconfined),
 * which lets init-block coroutines complete before assertions are made.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RegistrationHomeViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────────────────────────

    private val fakeConfig = StationConfig(
        eventId = "evt-1",
        eventName = "Тест",
        mode = StationMode.REGISTRATION,
        dayDate = "2026-07-11",
        workPointId = "zone-1",
        workPointName = "Главный вход",
        printer = null,
        autoPrint = false,
        deviceNumber = 1,
        staffName = "test@idento.app",
    )

    private val fakeAttendee = Attendee(
        id = "att-1",
        eventId = "evt-1",
        firstName = "Иван",
        lastName = "Иванов",
        email = "ivan@example.com",
        company = "ООО Тест",
        position = "Гость",
        code = "QR-001",
        checkinStatus = false,
    )

    private val fakeVerdictAttendee = VerdictAttendee(
        id = "att-1",
        fullName = "Иван Иванов",
        company = "ООО Тест",
        category = "Гость",
    )

    private val fakeSuccessVerdict = RegistrationVerdict.Success(
        attendee = fakeVerdictAttendee,
        at = Instant.fromEpochMilliseconds(0),
        firstTime = true,
        printState = PrintState.NotRequested,
    )

    // ── Builder ───────────────────────────────────────────────────────────────────────────────────

    private fun buildViewModel(
        stationGateway: RegistrationStationGateway = RegistrationStationGateway { fakeConfig },
        verdictMapper: RegistrationVerdictMapper = RegistrationVerdictMapper(
            AttendeeLookup { _, _ -> ApiResult.Error(Exception("not found")) },
        ),
        checkInService: RegistrationCheckInService = RegistrationCheckInService(
            batchSubmitter = BatchCheckinSubmitter { _, _ -> ApiResult.Error(Exception("fake")) },
        ),
        cameraGateway: CameraScanGateway? = null,
        badgeTemplateSource: EventBadgeTemplateSource = EventBadgeTemplateSource { ApiResult.Success(null) },
        attendeeSearchSource: AttendeeSearchSource = AttendeeSearchSource { _, _ -> ApiResult.Success(emptyList()) },
        pendingQueueCountSource: PendingQueueCountSource = PendingQueueCountSource { flowOf(0) },
    ) = RegistrationHomeViewModel(
        stationGateway = stationGateway,
        verdictMapper = verdictMapper,
        checkInService = checkInService,
        cameraGateway = cameraGateway,
        badgeTemplateSource = badgeTemplateSource,
        attendeeSearchSource = attendeeSearchSource,
        pendingQueueCountSource = pendingQueueCountSource,
    )

    // ── Tests ─────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun initialStateHasZoneNameAndNoPrinterWhenConfigHasNoPrinter() = runTest(testDispatcher) {
        val vm = buildViewModel()
        val state = vm.uiState.value
        assertEquals("Главный вход", state.zoneName)
        assertEquals("—", state.printerLabel)
        assertEquals(false, state.printerStatusOk)
    }

    @Test
    fun initialStateHasPrinterOkLabelWhenConfigHasPrinter() = runTest(testDispatcher) {
        val configWithPrinter = fakeConfig.copy(
            printer = com.idento.data.model.PrinterConfig(
                name = "Zebra ZD420",
                transport = "bluetooth",
                address = "00:11:22:33:44:55",
            )
        )
        val vm = buildViewModel(stationGateway = RegistrationStationGateway { configWithPrinter })
        assertEquals("OK", vm.uiState.value.printerLabel)
        assertEquals(true, vm.uiState.value.printerStatusOk)
    }

    @Test
    fun pendingQueueCountUpdatesOfflineBannerVisibility() = runTest(testDispatcher) {
        val countFlow = MutableStateFlow(0)
        val vm = buildViewModel(pendingQueueCountSource = PendingQueueCountSource { countFlow })
        assertEquals(false, vm.uiState.value.offlineBannerVisible)
        countFlow.value = 3
        assertEquals(true, vm.uiState.value.offlineBannerVisible)
        assertEquals(3, vm.uiState.value.pendingQueueCount)
        countFlow.value = 0
        assertEquals(false, vm.uiState.value.offlineBannerVisible)
    }

    @Test
    fun scanResultUpdatesVerdictWhenCodeIsUnknown() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            cameraGateway = fakeCameraGateway(codeFlow),
            // AttendeeLookup returns Error → LookupFailed → NotFound verdict
            verdictMapper = RegistrationVerdictMapper(
                AttendeeLookup { _, _ -> ApiResult.Error(Exception("not found")) },
            ),
        )
        vm.onScanResumed()
        assertTrue(vm.uiState.value.isScanActive)
        codeFlow.emit("UNKNOWN-CODE")
        // With UnconfinedTestDispatcher, the collector runs eagerly on emit
        val verdict = vm.uiState.value.currentVerdict
        assertTrue(verdict != null)
        assertTrue(verdict is RegistrationVerdict.NotFound)
        assertEquals("UNKNOWN-CODE", (verdict as RegistrationVerdict.NotFound).rawCode)
    }

    @Test
    fun scanResultIncrementsSessionCountOnSuccess() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            cameraGateway = fakeCameraGateway(codeFlow),
            verdictMapper = RegistrationVerdictMapper(
                AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee) },
            ),
            checkInService = RegistrationCheckInService(
                batchSubmitter = BatchCheckinSubmitter { _, items ->
                    ApiResult.Success(
                        listOf(
                            com.idento.data.model.BatchCheckinResultDto(
                                clientUuid = items.first().clientUuid,
                                status = "created",
                            )
                        )
                    )
                },
            ),
        )
        vm.onScanResumed()
        assertEquals(0, vm.uiState.value.sessionCheckedCount)
        codeFlow.emit("QR-001")
        assertEquals(1, vm.uiState.value.sessionCheckedCount)
        assertTrue(vm.uiState.value.currentVerdict is RegistrationVerdict.Success)
    }

    @Test
    fun onVerdictDismissedClearsVerdictAndResumesScanning() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            cameraGateway = fakeCameraGateway(codeFlow),
            verdictMapper = RegistrationVerdictMapper(
                AttendeeLookup { _, _ -> ApiResult.Error(Exception("not found")) },
            ),
        )
        vm.onScanResumed()
        codeFlow.emit("UNKNOWN-CODE")
        assertTrue(vm.uiState.value.currentVerdict != null)
        vm.onVerdictDismissed()
        assertNull(vm.uiState.value.currentVerdict)
        // Scanning should resume (isScanActive back to true after resume)
        assertTrue(vm.uiState.value.isScanActive)
    }

    @Test
    fun tabSwitchToSearchStopsScanning() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(cameraGateway = fakeCameraGateway(codeFlow))
        vm.onScanResumed()
        assertTrue(vm.uiState.value.isScanActive)
        vm.onTabSelected(RegistrationTab.SEARCH)
        assertEquals(RegistrationTab.SEARCH, vm.uiState.value.currentTab)
        assertEquals(false, vm.uiState.value.isScanActive)
    }

    @Test
    fun tabSwitchBackToScanResumesScanning() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(cameraGateway = fakeCameraGateway(codeFlow))
        vm.onTabSelected(RegistrationTab.SEARCH)
        assertEquals(false, vm.uiState.value.isScanActive)
        vm.onTabSelected(RegistrationTab.SCAN)
        assertEquals(RegistrationTab.SCAN, vm.uiState.value.currentTab)
        assertTrue(vm.uiState.value.isScanActive)
    }

    @Test
    fun onSearchQueryChangedUpdatesSearchQueryInState() = runTest(testDispatcher) {
        val vm = buildViewModel()
        vm.onSearchQueryChanged("Alice")
        assertEquals("Alice", vm.uiState.value.searchQuery)
    }

    @Test
    fun searchQueryChangeTriggersSearchAfterDebounce() = runTest(testDispatcher) {
        val vm = buildViewModel(
            attendeeSearchSource = AttendeeSearchSource { _, _ -> ApiResult.Success(emptyList()) },
        )
        vm.onSearchQueryChanged("Alice")
        assertEquals("Alice", vm.uiState.value.searchQuery)
        // Advance past the 300ms debounce window
        advanceTimeBy(350)
        assertEquals(false, vm.uiState.value.isSearchLoading)
        assertEquals(emptyList(), vm.uiState.value.searchResults)
    }

    @Test
    fun searchQueryBelowTwoCharsDoesNotTriggerSearch() = runTest(testDispatcher) {
        var searchCallCount = 0
        val vm = buildViewModel(
            attendeeSearchSource = AttendeeSearchSource { _, _ ->
                searchCallCount++
                ApiResult.Success(emptyList())
            },
        )
        vm.onSearchQueryChanged("A") // length 1 — below threshold
        advanceTimeBy(400)
        assertEquals(0, searchCallCount)
        assertEquals(emptyList(), vm.uiState.value.searchResults)
    }
}

// ── Test helpers ─────────────────────────────────────────────────────────────────────────────────

private fun fakeCameraGateway(codes: Flow<String>) = object : CameraScanGateway {
    override fun startScanning(): Flow<String> = codes
    override fun stopScanning() {}
}
