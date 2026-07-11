package com.idento.presentation.zonecontrol

import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.data.model.VerdictAttendee
import com.idento.data.model.ZoneScanResponseDto
import com.idento.data.model.ZoneVerdict
import com.idento.data.network.ApiResult
import com.idento.data.zonecontrol.ZoneScanSource
import com.idento.data.zonecontrol.ZoneVerdictAdapter
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.registration.PendingQueueCountSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class ZoneControlViewModelTest {

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
        mode = StationMode.ZONE_CONTROL,
        dayDate = "2026-07-11",
        workPointId = "zone-1",
        workPointName = "Главный вход",
        printer = null,
        autoPrint = false,
        deviceNumber = 1,
        staffName = "test@idento.app",
    )

    private fun fakeScanSource(codes: Flow<String>) = object : ScanSource {
        override val connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
        override fun startScanning(): Flow<String> = codes
        override fun stopScanning() {}
        override fun preferCamera() {}
    }

    private fun buildViewModel(
        stationGateway: ZoneStationGateway = ZoneStationGateway { fakeConfig },
        verdictAdapter: ZoneVerdictAdapter = ZoneVerdictAdapter(
            ZoneScanSource { _, _ -> ApiResult.Error(Exception("not configured")) },
        ),
        scanSource: ScanSource = fakeScanSource(flowOf()),
        pendingQueueCountSource: PendingQueueCountSource = PendingQueueCountSource { flowOf(0) },
        overrideSource: CheckinOverrideSource = CheckinOverrideSource { _, _, _ -> ApiResult.Success(Unit) },
    ) = ZoneControlViewModel(
        stationGateway = stationGateway,
        verdictAdapter = verdictAdapter,
        scanSource = scanSource,
        pendingQueueCountSource = pendingQueueCountSource,
        overrideSource = overrideSource,
    )

    @Test
    fun initialStateHasZoneName() = runTest(testDispatcher) {
        val vm = buildViewModel()
        assertEquals("Главный вход", vm.uiState.value.zoneName)
    }

    @Test
    fun pendingQueueCountUpdatesOfflineBannerVisibility() = runTest(testDispatcher) {
        val countFlow = MutableStateFlow(0)
        val vm = buildViewModel(pendingQueueCountSource = PendingQueueCountSource { countFlow })
        assertEquals(false, vm.uiState.value.offlineBannerVisible)
        countFlow.value = 2
        assertEquals(true, vm.uiState.value.offlineBannerVisible)
        assertEquals(2, vm.uiState.value.pendingQueueCount)
    }

    @Test
    fun scanResultAllowedIncrementsAllowedCount() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(
                ZoneScanResponseDto(
                    verdict = "allowed",
                    attendee = fakeAttendeeDto(),
                    firstEntry = true,
                )
            )
        })
        val vm = buildViewModel(scanSource = fakeScanSource(codeFlow), verdictAdapter = verdictAdapter)
        vm.onScanResumed()
        assertEquals(0, vm.uiState.value.allowedCount)
        codeFlow.emit("QR-001")
        assertEquals(1, vm.uiState.value.allowedCount)
        assertEquals(0, vm.uiState.value.deniedCount)
        assertIs<ZoneVerdict.Allowed>(vm.uiState.value.currentVerdict)
    }

    @Test
    fun scanResultNoAccessIncrementsDeniedCount() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "no_access", reason = "Zone is closed", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(scanSource = fakeScanSource(codeFlow), verdictAdapter = verdictAdapter)
        vm.onScanResumed()
        codeFlow.emit("QR-002")
        assertEquals(0, vm.uiState.value.allowedCount)
        assertEquals(1, vm.uiState.value.deniedCount)
        assertIs<ZoneVerdict.NoAccess>(vm.uiState.value.currentVerdict)
    }

    @Test
    fun scanResultNotRegisteredDoesNotIncrementEitherCounter() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "not_registered", reason = "hint", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(scanSource = fakeScanSource(codeFlow), verdictAdapter = verdictAdapter)
        vm.onScanResumed()
        codeFlow.emit("QR-003")
        assertEquals(0, vm.uiState.value.allowedCount)
        assertEquals(0, vm.uiState.value.deniedCount)
        assertIs<ZoneVerdict.NotRegistered>(vm.uiState.value.currentVerdict)
    }

    @Test
    fun onVerdictDismissedClearsVerdictAndResumesScanning() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "no_access", reason = "x", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(scanSource = fakeScanSource(codeFlow), verdictAdapter = verdictAdapter)
        vm.onScanResumed()
        codeFlow.emit("QR-004")
        assertTrue(vm.uiState.value.currentVerdict != null)
        vm.onVerdictDismissed()
        assertNull(vm.uiState.value.currentVerdict)
        assertTrue(vm.uiState.value.isScanActive)
    }

    @Test
    fun onOverrideSuccessClearsVerdictAndIncrementsAllowedCount() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "not_registered", reason = "hint", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictAdapter = verdictAdapter,
            overrideSource = CheckinOverrideSource { _, _, _ -> ApiResult.Success(Unit) },
        )
        vm.onScanResumed()
        codeFlow.emit("QR-005")
        assertIs<ZoneVerdict.NotRegistered>(vm.uiState.value.currentVerdict)
        vm.onOverride("att-1")
        assertNull(vm.uiState.value.currentVerdict)
        assertEquals(1, vm.uiState.value.allowedCount)
    }

    @Test
    fun onOverrideFailureLeavesVerdictVisible() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "not_registered", reason = "hint", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictAdapter = verdictAdapter,
            overrideSource = CheckinOverrideSource { _, _, _ -> ApiResult.Error(Exception("network")) },
        )
        vm.onScanResumed()
        codeFlow.emit("QR-006")
        vm.onOverride("att-1")
        assertIs<ZoneVerdict.NotRegistered>(vm.uiState.value.currentVerdict)
        assertEquals(0, vm.uiState.value.allowedCount)
    }
}

private fun fakeAttendeeDto() = com.idento.data.model.Attendee(
    id = "att-1",
    eventId = "evt-1",
    firstName = "Иван",
    lastName = "Иванов",
    code = "QR-001",
    checkinStatus = false,
)
