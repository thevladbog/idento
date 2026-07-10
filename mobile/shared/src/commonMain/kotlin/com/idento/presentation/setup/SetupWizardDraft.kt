package com.idento.presentation.setup

import com.idento.data.model.PrinterConfig
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode

/**
 * In-progress wizard state, shared across the five setup screens. A single Koin instance
 * (see AppModule.kt) — every ViewModel in this codebase is Koin `factory`-scoped (a fresh
 * instance per `koinInject()` call site), so this plain holder is what actually survives
 * navigation between the wizard's screens.
 *
 * [deviceNumber] and [staffName] are issued by the backend inside the provisioning response
 * (`ProvisionStationResponseDto.deviceNumber` / `ProvisionedStationConfigDto.staffName`, see
 * StationRepository.provisionStation) — never chosen by the user. The QR login path (Task 3)
 * stashes them here the moment provisioning succeeds; the Complete screen (Task 8) reads them
 * back out and passes them into [toStationConfig] explicitly, so the final build step keeps
 * its data flow explicit rather than silently reaching into this draft.
 */
class SetupWizardDraft {
    var eventId: String = ""
    var eventName: String = ""
    var mode: StationMode? = null
    var dayDate: String? = null
    var workPointId: String = ""
    var workPointName: String = ""
    var printer: PrinterConfig? = null
    var autoPrint: Boolean = false
    var deviceNumber: Int = 0
    var staffName: String = ""

    fun reset() {
        eventId = ""
        eventName = ""
        mode = null
        dayDate = null
        workPointId = ""
        workPointName = ""
        printer = null
        autoPrint = false
        deviceNumber = 0
        staffName = ""
    }

    /**
     * Builds the final [StationConfig] once the wizard reaches "Готово". [deviceNumber] and
     * [staffName] come from the provisioning response (StationRepository.provisionStation),
     * not from this draft — they're issued by the backend, not chosen by the user.
     */
    fun toStationConfig(deviceNumber: Int, staffName: String): StationConfig {
        val mode = checkNotNull(mode) { "Cannot build StationConfig: mode not selected" }
        check(eventId.isNotBlank()) { "Cannot build StationConfig: eventId missing" }
        check(workPointId.isNotBlank()) { "Cannot build StationConfig: workPointId missing" }
        check(mode == StationMode.KIOSK || dayDate != null) {
            "Cannot build StationConfig: dayDate is required for $mode"
        }
        return StationConfig(
            eventId = eventId,
            eventName = eventName,
            mode = mode,
            dayDate = dayDate,
            workPointId = workPointId,
            workPointName = workPointName,
            printer = printer,
            autoPrint = autoPrint,
            deviceNumber = deviceNumber,
            staffName = staffName,
        )
    }
}
