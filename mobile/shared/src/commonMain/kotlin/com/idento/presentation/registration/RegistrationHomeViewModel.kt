package com.idento.presentation.registration

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Attendee
import com.idento.data.model.BadgeTemplate
import com.idento.data.model.RegistrationVerdict
import com.idento.data.model.StationConfig
import com.idento.data.network.ApiResult
import com.idento.data.registration.DebouncedScanPipeline
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationVerdictLookup
import com.idento.data.registration.RegistrationVerdictMapper
import com.idento.data.registration.toVerdictAttendee
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.milliseconds

enum class RegistrationTab { SCAN, SEARCH }

data class RegistrationHomeUiState(
    val currentTab: RegistrationTab = RegistrationTab.SCAN,
    val zoneName: String = "",
    val printerLabel: String = "",
    val printerStatusOk: Boolean = false,
    val pendingQueueCount: Int = 0,
    val sessionCheckedCount: Int = 0,
    val currentVerdict: RegistrationVerdict? = null,
    val isScanActive: Boolean = false,
    val scannerState: ScannerConnectionState = ScannerConnectionState.Camera,
    val searchQuery: String = "",
    val searchResults: List<Attendee> = emptyList(),
    val isSearchLoading: Boolean = false,
    val offlineBannerVisible: Boolean = false,
)

// ── Seam interfaces ──────────────────────────────────────────────────────────────────────────────

/** Loads the active [StationConfig] from persistence; wired in Koin via
 * `StationConfigPreferences.stationConfig.filterNotNull().first()`. */
fun interface RegistrationStationGateway {
    suspend fun getConfig(): StationConfig
}

/** Provides the live count of registration check-ins awaiting offline sync. */
fun interface PendingQueueCountSource {
    fun observe(): Flow<Int>
}

/** Fetches the event's ZPL badge template (nullable — not all events have one). Decouples
 * [RegistrationHomeViewModel] from [com.idento.data.repository.EventRepository]'s HTTP
 * constructor so it stays unit-testable from commonTest. Wired as a method reference in Koin. */
fun interface EventBadgeTemplateSource {
    suspend fun getBadgeTemplate(eventId: String): ApiResult<String?>
}

/** Searches attendees by free-text query. Decouples [RegistrationHomeViewModel] from
 * [com.idento.data.repository.AttendeeRepository]'s HTTP constructor for the same reason
 * as [EventBadgeTemplateSource]. Wired as a method reference in Koin. */
fun interface AttendeeSearchSource {
    suspend fun searchAttendees(eventId: String, query: String): ApiResult<List<Attendee>>
}

// ── ViewModel ────────────────────────────────────────────────────────────────────────────────────

/**
 * Core business logic for the registration check-in home screen. Owns the scan pipeline
 * (`scanSource → DebouncedScanPipeline → RegistrationVerdictMapper → RegistrationCheckInService`),
 * the attendee search flow, badge-template loading, and all StatusBar state (zone name, printer
 * label, pending offline-queue count).
 *
 * [scanSource] is the shared [ScanSource] seam (also used by `ZoneControlViewModel`), merging the
 * platform camera with any connected hardware/BT scanner. Tests that exercise the scan path pass a
 * fake [ScanSource] with a [MutableSharedFlow] as the scan source.
 */
@OptIn(FlowPreview::class)
class RegistrationHomeViewModel(
    private val stationGateway: RegistrationStationGateway,
    private val verdictMapper: RegistrationVerdictMapper,
    private val checkInService: RegistrationCheckInService,
    private val scanSource: ScanSource,
    private val badgeTemplateSource: EventBadgeTemplateSource,
    private val attendeeSearchSource: AttendeeSearchSource,
    private val pendingQueueCountSource: PendingQueueCountSource,
) : ViewModel() {

    private val _uiState = MutableStateFlow(RegistrationHomeUiState())
    val uiState: StateFlow<RegistrationHomeUiState> = _uiState.asStateFlow()

    /** Loaded from [stationGateway] in [init]; stored so [onScanResumed] and [onManualCheckIn]
     * can use it without re-fetching on every action. */
    private var stationConfig: StationConfig? = null

    /** Cached per-event badge template (or null when the event has none / fetch not complete). */
    private var badgeTemplate: BadgeTemplate? = null

    /** Per-code debounce pipeline — one instance per ViewModel, resets its last-seen map
     * when [onCleared] is called (the next get from Koin creates a fresh ViewModel). */
    private val pipeline = DebouncedScanPipeline()

    /** Running coroutine collecting from the camera scan + debounce pipeline. */
    private var scanJob: Job? = null

    /** Drives the 300 ms debounce on the search field. */
    private val searchQueryFlow = MutableStateFlow("")

    init {
        viewModelScope.launch {
            val config = stationGateway.getConfig()
            stationConfig = config
            // Exclude the station's bonded BT printer (same SPP UUID as a BT scanner) from
            // ScanSource's auto-connect candidates — see Finding 1 kdoc on
            // ScanSource.setExcludedBluetoothAddress. Must happen before the first
            // onScanResumed() call below.
            scanSource.setExcludedBluetoothAddress(config.printer?.address)
            _uiState.update {
                it.copy(
                    zoneName = config.workPointName,
                    printerLabel = if (config.printer != null) "OK" else "—",
                    printerStatusOk = config.printer != null,
                )
            }
            viewModelScope.launch { loadBadgeTemplate(config.eventId) }
            if (_uiState.value.currentTab == RegistrationTab.SCAN) {
                onScanResumed()
            }
        }
        viewModelScope.launch {
            pendingQueueCountSource.observe().collect { count ->
                _uiState.update {
                    it.copy(pendingQueueCount = count, offlineBannerVisible = count > 0)
                }
            }
        }
        viewModelScope.launch {
            searchQueryFlow
                .debounce(300.milliseconds)
                .distinctUntilChanged()
                .collectLatest { query ->
                    if (query.length < 2) return@collectLatest
                    executeSearch(query)
                }
        }
        viewModelScope.launch {
            scanSource.connectionState.collect { state ->
                _uiState.update { it.copy(scannerState = state) }
            }
        }
    }

    // ── Scan ─────────────────────────────────────────────────────────────────────────────────────

    /** Called by the screen when the camera composable reports it is ready/visible. No-op if
     * there is no config yet. */
    fun onScanResumed() {
        val config = stationConfig ?: return
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            _uiState.update { it.copy(isScanActive = true) }
            pipeline.process(scanSource.startScanning()).collect { code ->
                processScannedCode(config, code)
            }
        }
    }

    /** Called by the screen when the camera composable is paused/hidden (e.g. verdict overlay). */
    fun onScanPaused() {
        scanJob?.cancel()
        scanSource.stopScanning()
        _uiState.update { it.copy(isScanActive = false) }
    }

    /** Forces the camera path for the current scan session, overriding a connected hardware
     * scanner — wired to the "Switch to phone camera" fallback button on screen 3b. */
    fun onSwitchToCamera() {
        scanSource.preferCamera()
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
        val increment = if (verdict is RegistrationVerdict.Success || verdict is RegistrationVerdict.PrintError) 1 else 0
        _uiState.update {
            it.copy(
                currentVerdict = verdict,
                sessionCheckedCount = it.sessionCheckedCount + increment,
            )
        }
        onScanPaused()
    }

    // ── Verdict actions ───────────────────────────────────────────────────────────────────────────

    /** Dismisses the current verdict overlay and resumes scanning if the SCAN tab is active. */
    fun onVerdictDismissed() {
        _uiState.update { it.copy(currentVerdict = null) }
        if (uiState.value.currentTab == RegistrationTab.SCAN) onScanResumed()
    }

    // ── Tab ───────────────────────────────────────────────────────────────────────────────────────

    /** Switches between [RegistrationTab.SCAN] and [RegistrationTab.SEARCH], updating scan state
     * accordingly (scanning is only active on the SCAN tab). */
    fun onTabSelected(tab: RegistrationTab) {
        _uiState.update { it.copy(currentTab = tab, currentVerdict = null) }
        if (tab == RegistrationTab.SCAN) onScanResumed() else onScanPaused()
    }

    // ── Search ───────────────────────────────────────────────────────────────────────────────────

    /** Updates the search query and schedules a debounced search execution. */
    fun onSearchQueryChanged(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        searchQueryFlow.value = query
        if (query.length < 2) {
            _uiState.update { it.copy(searchResults = emptyList()) }
        }
    }

    private suspend fun executeSearch(query: String) {
        val config = stationConfig ?: return
        _uiState.update { it.copy(isSearchLoading = true) }
        when (val result = attendeeSearchSource.searchAttendees(config.eventId, query)) {
            is ApiResult.Success -> _uiState.update {
                it.copy(searchResults = result.data, isSearchLoading = false)
            }
            is ApiResult.Error -> _uiState.update {
                it.copy(searchResults = emptyList(), isSearchLoading = false)
            }
            is ApiResult.Loading -> _uiState.update { it.copy(isSearchLoading = false) }
        }
    }

    // ── Manual check-in ──────────────────────────────────────────────────────────────────────────

    /** Called when the operator taps "Check in" next to a search result. Submits the check-in,
     * shows the verdict, and switches back to the SCAN tab. */
    fun onManualCheckIn(attendee: Attendee) {
        val config = stationConfig ?: return
        if (attendee.isBlocked) {
            _uiState.update {
                it.copy(
                    currentVerdict = RegistrationVerdict.Denied(
                        attendee = toVerdictAttendee(attendee),
                        reason = attendee.blockReason ?: "Access denied",
                    ),
                    currentTab = RegistrationTab.SCAN,
                )
            }
            return
        }
        viewModelScope.launch {
            val verdict = checkInService.checkIn(
                eventId = config.eventId,
                station = config,
                attendee = attendee,
                badgeTemplate = badgeTemplate,
            )
            val increment = if (verdict is RegistrationVerdict.Success || verdict is RegistrationVerdict.PrintError) 1 else 0
            _uiState.update {
                it.copy(
                    currentVerdict = verdict,
                    sessionCheckedCount = it.sessionCheckedCount + increment,
                    currentTab = RegistrationTab.SCAN,
                )
            }
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────────────────────────

    private suspend fun loadBadgeTemplate(eventId: String) {
        val result = badgeTemplateSource.getBadgeTemplate(eventId)
        if (result is ApiResult.Success && result.data != null) {
            badgeTemplate = BadgeTemplate(zplTemplate = result.data)
        }
    }

    override fun onCleared() {
        super.onCleared()
        scanJob?.cancel()
        scanSource.stopScanning()
    }
}
