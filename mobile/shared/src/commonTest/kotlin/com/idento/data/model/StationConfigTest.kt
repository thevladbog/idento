package com.idento.data.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class StationConfigTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun stationConfigRoundTripsThroughJson() {
        val config = StationConfig(
            eventId = "evt-1",
            eventName = "Технопром-2026",
            mode = StationMode.REGISTRATION,
            dayDate = "2026-07-10",
            workPointId = "zone-1",
            workPointName = "Главный вход",
            printer = PrinterConfig(name = "Zebra ZD421", transport = "bluetooth", address = "00:11:22:33:44:55"),
            autoPrint = true,
            deviceNumber = 3,
            staffName = "staff@idento.app",
        )
        val encoded = json.encodeToString(config)
        val decoded = json.decodeFromString<StationConfig>(encoded)
        assertEquals(config, decoded)
    }

    @Test
    fun stationConfigWithNullPrinterRoundTrips() {
        val config = StationConfig(
            eventId = "evt-1",
            eventName = "Технопром-2026",
            mode = StationMode.ZONE_CONTROL,
            dayDate = "2026-07-10",
            workPointId = "zone-2",
            workPointName = "Зона «Конференция»",
            printer = null,
            autoPrint = false,
            deviceNumber = 5,
            staffName = "staff2@idento.app",
        )
        val encoded = json.encodeToString(config)
        val decoded = json.decodeFromString<StationConfig>(encoded)
        assertEquals(config, decoded)
    }
}
