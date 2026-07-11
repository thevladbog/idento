package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Event
import com.idento.data.model.EventZoneWithStats
import com.idento.data.model.StationMode
import com.idento.data.network.ApiResult
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SetupDayZoneUiState(
    val showDayPicker: Boolean = true,
    val days: List<String> = emptyList(),
    val selectedDay: String? = null,
    val workPoints: List<EventZoneWithStats> = emptyList(),
    val selectedWorkPointId: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

/**
 * Narrow, single-method seams onto `EventRepository`/`ZoneRepository` (see `di/ViewModelModule.kt`,
 * where the real repositories are adapted into these via method references) — same rationale as
 * `SetupEventViewModel.kt`'s kdoc: those repositories are plain (non-`open`) classes wrapping a
 * live Ktor `HttpClient` with no mock-engine seam, so they cannot be constructed from `commonTest`.
 *
 * `EventLister` (declared in `SetupEventViewModel.kt`) wraps the no-arg `getEvents()` and doesn't
 * fit this screen's `getEvent(eventId)` need, so [EventLoader] is a new, differently-shaped seam
 * rather than a reuse. [ZoneLister] and [EventDaysCalculator] are likewise new — nothing existing
 * matches their shapes either. `ZoneRepository.getEventDays` itself is a plain, non-suspend, pure
 * function (no network call) but `ZoneRepository` still can't be *constructed* in `commonTest`
 * (same live-`HttpClient` constraint), so [EventDaysCalculator] exists purely to keep this
 * ViewModel's constructor free of the concrete repository type — it's intentionally the thinnest
 * possible wrapper (no suspend, no `ApiResult`) rather than a fully-fledged documented seam.
 */
fun interface EventLoader {
    suspend fun getEvent(eventId: String): ApiResult<Event>
}

fun interface ZoneLister {
    suspend fun getStaffZones(eventId: String): ApiResult<List<EventZoneWithStats>>
}

fun interface EventDaysCalculator {
    fun getEventDays(startDate: String, endDate: String): List<String>
}

/**
 * Fourth screen of the setup wizard, step 3/4 (Task 9's nav graph: `Screen.SetupDayZone`) — mode
 * branching per spec §6.3:
 * - [StationMode.KIOSK]: day pills are never shown ("Киоск вместо дня/зоны — только точка
 *   регистрации"); work points are filtered to `isRegistrationZone == true`.
 * - [StationMode.REGISTRATION]: day pills shown; work points filtered to
 *   `isRegistrationZone == true` ("вход").
 * - [StationMode.ZONE_CONTROL]: day pills shown; ALL work points shown, unfiltered (any zone can
 *   be "controlled"). This mode also skips the following Printer step entirely — see
 *   [shouldSkipPrinterStep] — which the screen reads to decide whether Continue navigates to
 *   `Screen.SetupPrinter` or straight to `Screen.SetupComplete` ("Готово").
 */
class SetupDayZoneViewModel(
    private val eventLoader: EventLoader,
    private val zoneLister: ZoneLister,
    private val eventDaysCalculator: EventDaysCalculator,
    private val draft: SetupWizardDraft,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupDayZoneUiState(showDayPicker = draft.mode != StationMode.KIOSK))
    val uiState: StateFlow<SetupDayZoneUiState> = _uiState.asStateFlow()

    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(isLoading = false, error = throwable.message ?: "Unknown error")
    }

    /**
     * Spec §6.3 branching rule: "Контроль зоны пропускает шаг «Принтер»" — the screen reads this
     * once, on Continue, to decide whether to navigate to the Printer step or skip straight to
     * "Готово".
     */
    fun shouldSkipPrinterStep(): Boolean = draft.mode == StationMode.ZONE_CONTROL

    fun load() {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            val days = if (draft.mode == StationMode.KIOSK) {
                emptyList()
            } else {
                when (val eventResult = eventLoader.getEvent(draft.eventId)) {
                    is ApiResult.Success -> eventDaysCalculator.getEventDays(
                        eventResult.data.startDate,
                        eventResult.data.endDate ?: eventResult.data.startDate,
                    )
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(isLoading = false, error = eventResult.message ?: "Could not load event")
                        return@launch
                    }
                    ApiResult.Loading -> emptyList()
                }
            }

            when (val zonesResult = zoneLister.getStaffZones(draft.eventId)) {
                is ApiResult.Success -> {
                    val workPoints = if (draft.mode == StationMode.ZONE_CONTROL) {
                        zonesResult.data
                    } else {
                        zonesResult.data.filter { it.isRegistrationZone }
                    }
                    _uiState.value = _uiState.value.copy(isLoading = false, days = days, workPoints = workPoints)
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = zonesResult.message ?: "Could not load work points")
                ApiResult.Loading -> _uiState.value = _uiState.value.copy(isLoading = false)
            }
        }
    }

    fun onDaySelected(day: String) {
        draft.dayDate = day
        _uiState.value = _uiState.value.copy(selectedDay = day)
    }

    fun onWorkPointSelected(id: String, name: String) {
        draft.workPointId = id
        draft.workPointName = name
        _uiState.value = _uiState.value.copy(selectedWorkPointId = id)
    }
}
