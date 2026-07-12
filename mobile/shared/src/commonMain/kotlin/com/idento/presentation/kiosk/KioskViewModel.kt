package com.idento.presentation.kiosk

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.BadgeTemplate
import com.idento.data.model.RegistrationVerdict
import com.idento.data.model.StationConfig
import com.idento.data.network.ApiResult
import com.idento.data.registration.DebouncedScanPipeline
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationVerdictLookup
import com.idento.data.registration.RegistrationVerdictMapper
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.registration.EventBadgeTemplateSource
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface KioskScreenState {
    data object Waiting : KioskScreenState
    data class Greeting(val attendeeName: String) : KioskScreenState
    data object NeedsStaff : KioskScreenState
}

data class KioskUiState(
    val screenState: KioskScreenState = KioskScreenState.Waiting,
    val scannerState: ScannerConnectionState = ScannerConnectionState.Camera,
    val exited: Boolean = false,
)

/** Loaded from persistence; wired in Koin via
 * `StationConfigPreferences.stationConfig.filterNotNull().first()` — same pattern as
 * `RegistrationStationGateway`/`ZoneStationGateway`. */
fun interface KioskStationGateway {
    suspend fun getConfig(): StationConfig
}

/** Clears the persisted StationConfig and the staff's auth session — the effect of Kiosk's
 * "Выйти со станции" confirm. Wired in Koin to StationConfigPreferences.clear() +
 * AuthPreferences.clearAuth(), the same two calls SetupCompleteViewModel.exitStation() makes. */
fun interface KioskExitGateway {
    suspend fun exitStation()
}

/**
 * Self-service check-in for Kiosk-mode stations. Reuses [RegistrationVerdictMapper] and
 * [RegistrationCheckInService] directly — Kiosk is self-service Registration, not a separate
 * check-in pipeline. Collapses [RegistrationVerdict]'s 5 variants into 3 attendee-facing screen
 * states: `Success`/`PrintError` -> [KioskScreenState.Greeting] (check-in succeeded either way; a
 * print failure is a staff-side/print-queue concern, not shown to the attendee), everything else
 * -> [KioskScreenState.NeedsStaff] (neutral — no reason ever shown to the attendee, per the design
 * spec's §8 error-handling policy: "Kiosk: any problem -> neutral screen to attendee, details
 * staff-side only").
 */
class KioskViewModel(
    private val stationGateway: KioskStationGateway,
    private val verdictMapper: RegistrationVerdictMapper,
    private val checkInService: RegistrationCheckInService,
    private val scanSource: ScanSource,
    private val badgeTemplateSource: EventBadgeTemplateSource,
    private val exitGateway: KioskExitGateway,
) : ViewModel() {

    private val _uiState = MutableStateFlow(KioskUiState())
    val uiState: StateFlow<KioskUiState> = _uiState.asStateFlow()

    private var stationConfig: StationConfig? = null
    private var badgeTemplate: BadgeTemplate? = null
    private var scanJob: Job? = null
    private var resetJob: Job? = null

    /** Per-code debounce pipeline — one instance per ViewModel, resets its last-seen map
     * only across process death — matching [com.idento.presentation.registration.RegistrationHomeViewModel]'s
     * established pattern. */
    private val pipeline = DebouncedScanPipeline()

    init {
        viewModelScope.launch {
            val config = stationGateway.getConfig()
            stationConfig = config
            scanSource.setExcludedBluetoothAddress(config.printer?.address)
            viewModelScope.launch { loadBadgeTemplate(config.eventId) }
            onScanResumed()
        }
        viewModelScope.launch {
            scanSource.connectionState.collect { state ->
                _uiState.update { it.copy(scannerState = state) }
            }
        }
    }

    fun onScanResumed() {
        val config = stationConfig ?: return
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            pipeline.process(scanSource.startScanning()).collect { code ->
                processScannedCode(config, code)
            }
        }
    }

    fun onScanPaused() {
        scanJob?.cancel()
        // Also cancel a pending Greeting/NeedsStaff auto-return timer — it runs on
        // viewModelScope, not the Activity lifecycle, so without this it would still fire while
        // the app is backgrounded and call onScanResumed() (restarting the camera) mid-pause.
        resetJob?.cancel()
        scanSource.stopScanning()
    }

    fun exitStation() {
        viewModelScope.launch {
            exitGateway.exitStation()
            _uiState.update { it.copy(exited = true) }
        }
    }

    private suspend fun processScannedCode(config: StationConfig, code: String) {
        val verdict = when (val lookup = verdictMapper.lookup(config.eventId, code)) {
            is RegistrationVerdictLookup.Found -> withContext(NonCancellable) {
                checkInService.checkIn(
                    eventId = config.eventId,
                    station = config,
                    attendee = lookup.attendee,
                    badgeTemplate = badgeTemplate,
                )
            }
            is RegistrationVerdictLookup.AlreadyChecked -> lookup.verdict
            is RegistrationVerdictLookup.Denied -> lookup.verdict
            is RegistrationVerdictLookup.NotFound -> lookup.verdict
            is RegistrationVerdictLookup.LookupFailed -> RegistrationVerdict.LookupError(lookup.message)
        }
        val screenState = when (verdict) {
            is RegistrationVerdict.Success -> KioskScreenState.Greeting(verdict.attendee.fullName)
            is RegistrationVerdict.PrintError -> KioskScreenState.Greeting(verdict.attendee.fullName)
            else -> KioskScreenState.NeedsStaff
        }
        _uiState.update { it.copy(screenState = screenState) }
        onScanPaused()
        resetJob?.cancel()
        resetJob = viewModelScope.launch {
            delay(if (screenState is KioskScreenState.Greeting) GREETING_TIMEOUT_MS else NEEDS_STAFF_TIMEOUT_MS)
            _uiState.update { it.copy(screenState = KioskScreenState.Waiting) }
            onScanResumed()
        }
    }

    private suspend fun loadBadgeTemplate(eventId: String) {
        val result = badgeTemplateSource.getBadgeTemplate(eventId)
        if (result is ApiResult.Success && result.data != null) {
            badgeTemplate = BadgeTemplate(zplTemplate = result.data)
        }
    }

    override fun onCleared() {
        super.onCleared()
        scanJob?.cancel()
        resetJob?.cancel()
        scanSource.stopScanning()
    }

    private companion object {
        const val GREETING_TIMEOUT_MS = 5_000L
        const val NEEDS_STAFF_TIMEOUT_MS = 10_000L
    }
}
