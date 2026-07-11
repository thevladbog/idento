package com.idento.presentation.zonecontrol

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.StationConfig
import com.idento.data.model.ZoneVerdict
import com.idento.data.network.ApiResult
import com.idento.data.zonecontrol.ZoneVerdictAdapter
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.registration.PendingQueueCountSource
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Loaded from persistence; wired in Koin via
 * `StationConfigPreferences.stationConfig.filterNotNull().first()` — same pattern as
 * RegistrationStationGateway. */
fun interface ZoneStationGateway {
    suspend fun getConfig(): StationConfig
}

/** Maps to POST /api/events/:event_id/checkins/override, body {attendee_id, zone_id, context}.
 * context is fixed server-side to one of a small enum (already_checked | not_registered |
 * no_access) — Zone Control's override button always sends "not_registered", the only ZoneVerdict
 * with an override action in this design. Wired in Koin to AttendeeRepository::submitOverride. */
fun interface CheckinOverrideSource {
    suspend fun submitOverride(eventId: String, zoneId: String, attendeeId: String): ApiResult<Unit>
}

data class ZoneControlUiState(
    val zoneName: String = "",
    val allowedCount: Int = 0,
    val deniedCount: Int = 0,
    val pendingQueueCount: Int = 0,
    val currentVerdict: ZoneVerdict? = null,
    val isScanActive: Boolean = false,
    val scannerState: ScannerConnectionState = ScannerConnectionState.Camera,
    val offlineBannerVisible: Boolean = false,
)

/**
 * Core business logic for the Zone Control home screen. Owns the scan pipeline
 * (`scanSource -> ZoneVerdictAdapter`) and all StatusBar state (zone name, allowed/denied session
 * counters, pending offline-queue count). Unlike RegistrationHomeViewModel there is no client-side
 * verdict classification and no DebouncedScanPipeline — the single POST /api/zones/:zone_id/scan
 * call performs both the read and (on an allowed outcome) the write atomically server-side, so the
 * whole lookup is wrapped in withContext(NonCancellable) rather than only the write half, unlike
 * Registration's separate lookup/checkIn split.
 */
class ZoneControlViewModel(
    private val stationGateway: ZoneStationGateway,
    private val verdictAdapter: ZoneVerdictAdapter,
    private val scanSource: ScanSource,
    private val pendingQueueCountSource: PendingQueueCountSource,
    private val overrideSource: CheckinOverrideSource,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ZoneControlUiState())
    val uiState: StateFlow<ZoneControlUiState> = _uiState.asStateFlow()

    private var stationConfig: StationConfig? = null
    private var scanJob: Job? = null

    init {
        viewModelScope.launch {
            val config = stationGateway.getConfig()
            stationConfig = config
            _uiState.update { it.copy(zoneName = config.workPointName) }
            onScanResumed()
        }
        viewModelScope.launch {
            pendingQueueCountSource.observe().collect { count ->
                _uiState.update { it.copy(pendingQueueCount = count, offlineBannerVisible = count > 0) }
            }
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
            _uiState.update { it.copy(isScanActive = true) }
            scanSource.startScanning().collect { code ->
                processScannedCode(config, code)
            }
        }
    }

    fun onScanPaused() {
        scanJob?.cancel()
        scanSource.stopScanning()
        _uiState.update { it.copy(isScanActive = false) }
    }

    fun onSwitchToCamera() {
        scanSource.preferCamera()
    }

    private suspend fun processScannedCode(config: StationConfig, code: String) {
        // withContext(NonCancellable): unlike Registration's separate lookup/checkIn calls, one
        // HTTP request here performs both the read and (on "allowed") the server-side write —
        // cancelling mid-request on a tab switch could orphan that write.
        val verdict = withContext(NonCancellable) {
            verdictAdapter.lookup(config.workPointId, code)
        }
        _uiState.update {
            it.copy(
                currentVerdict = verdict,
                allowedCount = it.allowedCount + if (verdict is ZoneVerdict.Allowed) 1 else 0,
                deniedCount = it.deniedCount + if (verdict is ZoneVerdict.NoAccess) 1 else 0,
            )
        }
        onScanPaused()
    }

    fun onVerdictDismissed() {
        _uiState.update { it.copy(currentVerdict = null) }
        onScanResumed()
    }

    /** "Всё равно пропустить" — submits an audit-logged override for a NotRegistered verdict.
     * Does NOT re-scan: CreateCheckinOverride is audit-only and does not change what a subsequent
     * scan returns (see this plan's Global Constraints). On success, the operator's tap on this
     * button IS the pass-through decision — clear the verdict and count it as allowed locally. */
    fun onOverride(attendeeId: String) {
        val config = stationConfig ?: return
        viewModelScope.launch {
            val result = withContext(NonCancellable) {
                overrideSource.submitOverride(config.eventId, config.workPointId, attendeeId)
            }
            if (result is ApiResult.Success) {
                _uiState.update {
                    it.copy(currentVerdict = null, allowedCount = it.allowedCount + 1)
                }
                onScanResumed()
            }
            // On ApiResult.Error the verdict stays visible so the operator can retry or dismiss —
            // no silent failure.
        }
    }

    override fun onCleared() {
        super.onCleared()
        scanJob?.cancel()
        scanSource.stopScanning()
    }
}
