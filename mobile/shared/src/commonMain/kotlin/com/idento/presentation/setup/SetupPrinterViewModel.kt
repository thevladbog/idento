package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.PrinterConfig
import com.idento.platform.printer.BluetoothPrinterDevice
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SetupPrinterUiState(
    val pairedPrinters: List<BluetoothPrinterDevice> = emptyList(),
    val printer: PrinterConfig? = null,
    val autoPrint: Boolean = false,
    val testPrintResult: Boolean? = null, // null = not yet tried, true = sent, false = failed
    val isLoading: Boolean = false,
    val error: String? = null,
)

/**
 * Narrow seams onto `BluetoothPrinterService`/`EthernetPrinterService`
 * (`platform/printer/PrinterService.kt`; see `di/ViewModelModule.kt`, where the real singletons —
 * already Koin `single`-scoped in `AppModule.kt` — are adapted into these). Unlike the
 * repositories wrapped by the `fun interface` seams elsewhere in this package (`EventLoader`,
 * `ZoneLister`, ... in `SetupDayZoneViewModel.kt`/`SetupLoginViewModel.kt`), these two services are
 * `expect class` themselves rather than a plain class wrapping one — but the effect on
 * testability is identical: no `actual` exists outside androidMain/iosMain, so neither can be
 * constructed (or fed to `commonTest`) directly either way.
 *
 * [BluetoothPrinterGateway] needs two methods this screen actually uses (list paired devices,
 * then test-print to one) — since a `fun interface` SAM only allows one abstract method, it's a
 * plain interface instead. [EthernetPrinterGateway] only needs `printTest`, so it stays a `fun
 * interface` like the single-method seams elsewhere.
 */
interface BluetoothPrinterGateway {
    suspend fun getPairedPrinters(): Result<List<BluetoothPrinterDevice>>
    suspend fun printTest(address: String): Result<Unit>
}

fun interface EthernetPrinterGateway {
    suspend fun printTest(ip: String, port: Int): Result<Unit>
}

/**
 * Fifth and last screen of the setup wizard, step 4/4 (Task 9's nav graph: `Screen.SetupPrinter`).
 * Never reached for [com.idento.data.model.StationMode.ZONE_CONTROL] — no branch on that mode
 * exists here at all, since `SetupDayZoneViewModel.shouldSkipPrinterStep` (Task 6) already routes
 * that mode straight to "Готово" before this screen is ever shown.
 *
 * Three independent ways to set `draft.printer` — a Bluetooth pairing-list pick
 * ([onBluetoothPrinterSelected]), a manual Ethernet IP:port ([onEthernetAddressConfirmed]), or
 * scanning a printer's own QR code ([onPrinterQrScanned], decoded by `SetupPrinterScreen` from
 * `CameraService.startScanning()`'s raw string into a [PrinterConfig] JSON payload) — plus the
 * `autoPrint` toggle ([onAutoPrintToggled]).
 *
 * Platform note (spec §7): iOS has no Bluetooth printer transport ("BT-SPP на iOS недоступен без
 * MFi — принято дизайном"). `BluetoothPrinterService`'s iOS `actual`
 * (`platform/printer/PrinterService.ios.kt`) already degrades safely without this ViewModel's or
 * the screen's help: `getPairedPrinters()` returns `Result.success(emptyList())` (never throws),
 * so [loadPairedPrinters] and the screen's Bluetooth tab need no iOS-specific casing — the tab
 * simply always renders the "none paired" empty state on iOS.
 */
class SetupPrinterViewModel(
    private val bluetoothPrinterService: BluetoothPrinterGateway,
    private val ethernetPrinterService: EthernetPrinterGateway,
    private val draft: SetupWizardDraft,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupPrinterUiState(autoPrint = draft.autoPrint, printer = draft.printer))
    val uiState: StateFlow<SetupPrinterUiState> = _uiState.asStateFlow()

    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(isLoading = false, error = throwable.message ?: "Unknown error")
    }

    fun loadPairedPrinters() {
        viewModelScope.launch(exceptionHandler) {
            bluetoothPrinterService.getPairedPrinters()
                .onSuccess { devices ->
                    _uiState.value = _uiState.value.copy(pairedPrinters = devices)
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(error = error.message ?: "Could not load paired printers")
                }
        }
    }

    fun onBluetoothPrinterSelected(name: String, address: String) {
        val config = PrinterConfig(name = name, transport = "bluetooth", address = address)
        draft.printer = config
        _uiState.value = _uiState.value.copy(printer = config, testPrintResult = null)
    }

    fun onEthernetAddressConfirmed(name: String, ip: String, port: Int) {
        val config = PrinterConfig(name = name, transport = "ethernet", address = "$ip:$port")
        draft.printer = config
        _uiState.value = _uiState.value.copy(printer = config, testPrintResult = null)
    }

    fun onPrinterQrScanned(printerConfig: PrinterConfig) {
        draft.printer = printerConfig
        _uiState.value = _uiState.value.copy(printer = printerConfig, testPrintResult = null)
    }

    fun onAutoPrintToggled(enabled: Boolean) {
        draft.autoPrint = enabled
        _uiState.value = _uiState.value.copy(autoPrint = enabled)
    }

    fun testPrint() {
        val printer = draft.printer ?: return
        _uiState.value = _uiState.value.copy(isLoading = true, testPrintResult = null)
        viewModelScope.launch(exceptionHandler) {
            val result = if (printer.transport == "bluetooth") {
                bluetoothPrinterService.printTest(printer.address)
            } else {
                // printer.address isn't necessarily "ip:port" here: a scanned QR payload
                // (onPrinterQrScanned) is accepted into draft.printer with zero validation, unlike
                // the Ethernet tab's own manual entry (onEthernetAddressConfirmed), which always
                // builds a valid "ip:port" string. Parse defensively instead of destructuring, so a
                // malformed scanned address surfaces as a clear failure rather than an unchecked
                // IndexOutOfBoundsException/NumberFormatException.
                val parts = printer.address.split(":", limit = 2)
                if (parts.size != 2) {
                    _uiState.value = _uiState.value.copy(isLoading = false, testPrintResult = false, error = "Invalid printer address")
                    return@launch
                }
                val port = parts[1].toIntOrNull()
                if (port == null) {
                    _uiState.value = _uiState.value.copy(isLoading = false, testPrintResult = false, error = "Invalid printer port")
                    return@launch
                }
                ethernetPrinterService.printTest(parts[0], port)
            }
            _uiState.value = _uiState.value.copy(isLoading = false, testPrintResult = result.isSuccess)
        }
    }
}
