package com.idento.presentation.setup

import com.idento.data.model.PrinterConfig
import com.idento.data.model.StationMode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SetupWizardDraftTest {

    @Test
    fun toStationConfigBuildsRegistrationConfigWithPrinter() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.REGISTRATION
        draft.dayDate = "2026-07-10"
        draft.workPointId = "zone-1"
        draft.workPointName = "Главный вход"
        draft.printer = PrinterConfig(name = "Zebra ZD421", transport = "bluetooth", address = "00:11:22:33:44:55")
        draft.autoPrint = true

        val config = draft.toStationConfig(deviceNumber = 3, staffName = "staff@idento.app")

        assertEquals("evt-1", config.eventId)
        assertEquals(StationMode.REGISTRATION, config.mode)
        assertEquals("2026-07-10", config.dayDate)
        assertEquals("zone-1", config.workPointId)
        assertEquals(true, config.autoPrint)
        assertEquals(3, config.deviceNumber)
        assertEquals("staff@idento.app", config.staffName)
    }

    @Test
    fun toStationConfigAllowsNullDayForKiosk() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.KIOSK
        draft.dayDate = null
        draft.workPointId = "zone-2"
        draft.workPointName = "Регистрация — Холл"
        draft.printer = PrinterConfig(name = "Zebra ZD421", transport = "ethernet", address = "192.168.1.50:9100")
        draft.autoPrint = true

        val config = draft.toStationConfig(deviceNumber = 7, staffName = "kiosk@idento.app")
        assertEquals(null, config.dayDate)
    }

    @Test
    fun toStationConfigAllowsNullPrinterForZoneControl() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.ZONE_CONTROL
        draft.dayDate = "2026-07-10"
        draft.workPointId = "zone-3"
        draft.workPointName = "Зона «Конференция»"
        draft.printer = null
        draft.autoPrint = false

        val config = draft.toStationConfig(deviceNumber = 5, staffName = "staff2@idento.app")
        assertEquals(null, config.printer)
    }

    @Test
    fun toStationConfigRejectsMissingDayForNonKioskModes() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.REGISTRATION
        draft.dayDate = null // missing — required for REGISTRATION/ZONE_CONTROL
        draft.workPointId = "zone-1"
        draft.workPointName = "Главный вход"
        draft.printer = null
        draft.autoPrint = false

        assertFailsWith<IllegalStateException> {
            draft.toStationConfig(deviceNumber = 1, staffName = "staff@idento.app")
        }
    }

    @Test
    fun toStationConfigRejectsMissingWorkPoint() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.KIOSK
        draft.workPointId = "" // missing
        draft.workPointName = ""

        assertFailsWith<IllegalStateException> {
            draft.toStationConfig(deviceNumber = 1, staffName = "staff@idento.app")
        }
    }

    @Test
    fun resetClearsEveryField() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.KIOSK
        draft.dayDate = "2026-07-10"
        draft.workPointId = "zone-1"
        draft.workPointName = "Главный вход"
        draft.printer = PrinterConfig(name = "Zebra ZD421", transport = "bluetooth", address = "00:11:22:33:44:55")
        draft.autoPrint = true
        draft.deviceNumber = 3
        draft.staffName = "staff@idento.app"

        draft.reset()

        assertEquals("", draft.eventId)
        assertEquals("", draft.eventName)
        assertEquals(null, draft.mode)
        assertEquals(null, draft.dayDate)
        assertEquals("", draft.workPointId)
        assertEquals("", draft.workPointName)
        assertEquals(null, draft.printer)
        assertEquals(false, draft.autoPrint)
        assertEquals(0, draft.deviceNumber)
        assertEquals("", draft.staffName)
    }
}
