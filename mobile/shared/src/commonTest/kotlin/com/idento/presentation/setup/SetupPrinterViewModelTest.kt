package com.idento.presentation.setup

import com.idento.data.model.PrinterConfig
import com.idento.platform.printer.BluetoothPrinterDevice
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `bluetoothPrinterService`/`ethernetPrinterService` are [BluetoothPrinterGateway]/
 * [EthernetPrinterGateway] — narrow seams onto `BluetoothPrinterService`/`EthernetPrinterService`
 * (`platform/printer/PrinterService.kt`; see `di/ViewModelModule.kt` for how the real singletons
 * are adapted into these). Both are `expect class` themselves with no `actual` outside
 * androidMain/iosMain, so — same problem as the repositories other setup-wizard ViewModels wrap
 * (see e.g. `SetupLoginViewModel.kt`'s kdoc) — they cannot be constructed from `commonTest`
 * directly; going through these seams instead is what keeps [SetupPrinterViewModel] testable with
 * plain local fakes.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetupPrinterViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class FakeBluetoothPrinterService(
        private val pairedPrinters: Result<List<BluetoothPrinterDevice>> = Result.success(emptyList()),
        private val printTestResult: Result<Unit> = Result.success(Unit),
    ) : BluetoothPrinterGateway {
        var printTestCalledWith: String? = null
        override suspend fun getPairedPrinters(): Result<List<BluetoothPrinterDevice>> = pairedPrinters
        override suspend fun printTest(address: String): Result<Unit> {
            printTestCalledWith = address
            return printTestResult
        }
    }

    private class FakeEthernetPrinterService(
        private val printTestResult: Result<Unit> = Result.success(Unit),
    ) : EthernetPrinterGateway {
        var printTestCalledWith: Pair<String, Int>? = null
        override suspend fun printTest(ip: String, port: Int): Result<Unit> {
            printTestCalledWith = ip to port
            return printTestResult
        }
    }

    @Test
    fun selectingABluetoothPrinterWritesConfigToDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupPrinterViewModel(
            bluetoothPrinterService = FakeBluetoothPrinterService(),
            ethernetPrinterService = FakeEthernetPrinterService(),
            draft = draft,
        )

        viewModel.onBluetoothPrinterSelected(name = "Zebra ZD421", address = "00:11:22:33:44:55")

        assertEquals(PrinterConfig(name = "Zebra ZD421", transport = "bluetooth", address = "00:11:22:33:44:55"), draft.printer)
    }

    @Test
    fun settingEthernetAddressWritesConfigToDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), FakeEthernetPrinterService(), draft)

        viewModel.onEthernetAddressConfirmed(name = "Zebra ZD421", ip = "192.168.1.50", port = 9100)

        assertEquals(PrinterConfig(name = "Zebra ZD421", transport = "ethernet", address = "192.168.1.50:9100"), draft.printer)
    }

    @Test
    fun toggleAutoPrintWritesToDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), FakeEthernetPrinterService(), draft)

        viewModel.onAutoPrintToggled(true)

        assertEquals(true, draft.autoPrint)
    }

    @Test
    fun onPrinterQrScannedWritesConfigToDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), FakeEthernetPrinterService(), draft)
        val scanned = PrinterConfig(name = "Zebra ZD421", transport = "ethernet", address = "192.168.1.50:9100")

        viewModel.onPrinterQrScanned(scanned)

        assertEquals(scanned, draft.printer)
        assertEquals(scanned, viewModel.uiState.value.printer)
    }

    @Test
    fun loadPairedPrintersPopulatesUiState() = runTest(testDispatcher) {
        val devices = listOf(BluetoothPrinterDevice(address = "00:11:22:33:44:55", name = "Zebra ZD421", isPaired = true))
        val viewModel = SetupPrinterViewModel(
            bluetoothPrinterService = FakeBluetoothPrinterService(pairedPrinters = Result.success(devices)),
            ethernetPrinterService = FakeEthernetPrinterService(),
            draft = SetupWizardDraft(),
        )

        viewModel.loadPairedPrinters()

        assertEquals(devices, viewModel.uiState.value.pairedPrinters)
    }

    @Test
    fun testPrintIsANoOpWithoutAConfiguredPrinter() = runTest(testDispatcher) {
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), FakeEthernetPrinterService(), SetupWizardDraft())

        viewModel.testPrint()

        assertNull(viewModel.uiState.value.testPrintResult)
        assertFalse(viewModel.uiState.value.isLoading)
    }

    @Test
    fun testPrintRoutesToBluetoothServiceForABluetoothPrinter() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val bluetooth = FakeBluetoothPrinterService()
        val viewModel = SetupPrinterViewModel(bluetooth, FakeEthernetPrinterService(), draft)
        viewModel.onBluetoothPrinterSelected(name = "Zebra ZD421", address = "00:11:22:33:44:55")

        viewModel.testPrint()

        assertEquals("00:11:22:33:44:55", bluetooth.printTestCalledWith)
        assertEquals(true, viewModel.uiState.value.testPrintResult)
    }

    @Test
    fun testPrintRoutesToEthernetServiceForAnEthernetPrinterAndParsesIpAndPort() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val ethernet = FakeEthernetPrinterService()
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), ethernet, draft)
        viewModel.onEthernetAddressConfirmed(name = "Zebra ZD421", ip = "192.168.1.50", port = 9100)

        viewModel.testPrint()

        assertEquals("192.168.1.50" to 9100, ethernet.printTestCalledWith)
        assertEquals(true, viewModel.uiState.value.testPrintResult)
    }

    @Test
    fun testPrintSurfacesFailureAsFalseResult() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val bluetooth = FakeBluetoothPrinterService(printTestResult = Result.failure(RuntimeException("not connected")))
        val viewModel = SetupPrinterViewModel(bluetooth, FakeEthernetPrinterService(), draft)
        viewModel.onBluetoothPrinterSelected(name = "Zebra ZD421", address = "00:11:22:33:44:55")

        viewModel.testPrint()

        assertEquals(false, viewModel.uiState.value.testPrintResult)
        assertTrue(viewModel.uiState.value.error == null) // printTest failure is a Result, not a thrown exception
    }

    // onPrinterQrScanned accepts ANY decoded PrinterConfig with zero validation (unlike
    // onEthernetAddressConfirmed, which always builds a valid "ip:port" address) — a scanned QR
    // payload can carry a non-bluetooth address with no colon, or a non-numeric port. testPrint()
    // must surface that as a clear failure instead of throwing out of the destructuring split.
    @Test
    fun testPrintSurfacesMissingPortAsFailureWithoutThrowing() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val ethernet = FakeEthernetPrinterService()
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), ethernet, draft)
        viewModel.onPrinterQrScanned(PrinterConfig(name = "Label", transport = "ethernet", address = "192.168.1.50"))

        viewModel.testPrint()

        assertEquals(false, viewModel.uiState.value.testPrintResult)
        assertEquals("Invalid printer address", viewModel.uiState.value.error)
        assertNull(ethernet.printTestCalledWith)
        assertFalse(viewModel.uiState.value.isLoading)
    }

    @Test
    fun testPrintSurfacesNonNumericPortAsFailureWithoutThrowing() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val ethernet = FakeEthernetPrinterService()
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), ethernet, draft)
        viewModel.onPrinterQrScanned(PrinterConfig(name = "Label", transport = "ethernet", address = "192.168.1.50:abc"))

        viewModel.testPrint()

        assertEquals(false, viewModel.uiState.value.testPrintResult)
        assertEquals("Invalid printer port", viewModel.uiState.value.error)
        assertNull(ethernet.printTestCalledWith)
        assertFalse(viewModel.uiState.value.isLoading)
    }
}
