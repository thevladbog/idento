package com.idento.presentation.kiosk

import com.idento.data.model.Attendee
import com.idento.data.model.BatchCheckinResultDto
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.data.network.ApiResult
import com.idento.data.registration.AttendeeLookup
import com.idento.data.registration.BatchCheckinSubmitter
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationVerdictMapper
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.registration.EventBadgeTemplateSource
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
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

@OptIn(ExperimentalCoroutinesApi::class)
class KioskViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val fakeConfig = StationConfig(
        eventId = "evt-1",
        eventName = "Тест",
        mode = StationMode.KIOSK,
        dayDate = null,
        workPointId = "point-1",
        workPointName = "Точка регистрации",
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
        code = "QR-001",
        checkinStatus = false,
    )

    private fun fakeScanSource(codes: Flow<String>) = object : ScanSource {
        override val connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
        override fun startScanning(): Flow<String> = codes
        override fun stopScanning() {}
        override fun preferCamera() {}
        override fun setExcludedBluetoothAddress(address: String?) {}
    }

    private fun buildViewModel(
        stationGateway: KioskStationGateway = KioskStationGateway { fakeConfig },
        verdictMapper: RegistrationVerdictMapper = RegistrationVerdictMapper(
            AttendeeLookup { _, _ -> ApiResult.Error(Exception("not configured")) },
        ),
        checkInService: RegistrationCheckInService = RegistrationCheckInService(
            batchSubmitter = BatchCheckinSubmitter { _, _ -> ApiResult.Error(Exception("fake")) },
        ),
        scanSource: ScanSource = fakeScanSource(flowOf()),
        badgeTemplateSource: EventBadgeTemplateSource = EventBadgeTemplateSource { ApiResult.Success(null) },
    ) = KioskViewModel(
        stationGateway = stationGateway,
        verdictMapper = verdictMapper,
        checkInService = checkInService,
        scanSource = scanSource,
        badgeTemplateSource = badgeTemplateSource,
    )

    private fun successCheckInService() = RegistrationCheckInService(
        batchSubmitter = BatchCheckinSubmitter { _, items ->
            ApiResult.Success(
                listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "created")),
            )
        },
    )

    @Test
    fun initialStateIsWaiting() = runTest(testDispatcher) {
        val vm = buildViewModel()
        assertIs<KioskScreenState.Waiting>(vm.uiState.value.screenState)
    }

    @Test
    fun scanResultSuccessMapsToGreetingWithAttendeeName() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee) }),
            checkInService = successCheckInService(),
        )
        codeFlow.emit("QR-001")
        val state = vm.uiState.value.screenState
        assertIs<KioskScreenState.Greeting>(state)
        assertEquals("Иван Иванов", state.attendeeName)
    }

    @Test
    fun scanResultAlreadyCheckedMapsToNeedsStaff() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(
                AttendeeLookup { _, _ ->
                    ApiResult.Success(fakeAttendee.copy(checkinStatus = true, checkedInAt = "2026-07-11T10:00:00Z"))
                },
            ),
        )
        codeFlow.emit("QR-002")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
    }

    @Test
    fun scanResultDeniedMapsToNeedsStaff() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(
                AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee.copy(isBlocked = true, blockReason = "VIP only")) },
            ),
        )
        codeFlow.emit("QR-003")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
    }

    @Test
    fun scanResultNotFoundMapsToNeedsStaff() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Success(null) }),
        )
        codeFlow.emit("UNKNOWN")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
    }

    @Test
    fun scanResultLookupFailedMapsToNeedsStaff() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Error(Exception("timeout")) }),
        )
        codeFlow.emit("QR-004")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
    }

    @Test
    fun greetingAutoReturnsToWaitingAndResumesScanningAfter5Seconds() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee) }),
            checkInService = successCheckInService(),
        )
        codeFlow.emit("QR-005")
        assertIs<KioskScreenState.Greeting>(vm.uiState.value.screenState)
        advanceTimeBy(5_001)
        assertIs<KioskScreenState.Waiting>(vm.uiState.value.screenState)
        // Scanning resumed — a fresh scan is picked up. Use a different code than the first scan:
        // the debounce pipeline is a class-level field (matches RegistrationHomeViewModel), so
        // re-emitting the same code here would be suppressed as a duplicate within the debounce
        // window (advanceTimeBy doesn't move the real wall-clock DebouncedScanPipeline uses).
        codeFlow.emit("QR-006")
        assertIs<KioskScreenState.Greeting>(vm.uiState.value.screenState)
    }

    @Test
    fun needsStaffAutoReturnsToWaitingAfter10Seconds() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Success(null) }),
        )
        codeFlow.emit("UNKNOWN")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
        advanceTimeBy(10_001)
        assertIs<KioskScreenState.Waiting>(vm.uiState.value.screenState)
    }
}
