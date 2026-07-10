package com.idento.data.model

import kotlinx.serialization.Serializable

enum class StationMode { REGISTRATION, ZONE_CONTROL, KIOSK }

@Serializable
data class PrinterConfig(
    val name: String,
    val transport: String, // "bluetooth" | "ethernet"
    val address: String, // MAC address or IP:port depending on transport
)

/**
 * Persisted station setup (result of the M1b wizard). Local-only — not a network DTO, though
 * eventId/eventName/staffName/deviceNumber originate from the backend at provisioning time
 * (see StationRepository, Task 6).
 */
@Serializable
data class StationConfig(
    val eventId: String,
    val eventName: String,
    val mode: StationMode,
    val dayDate: String?, // ISO "YYYY-MM-DD", null for KIOSK
    val workPointId: String,
    val workPointName: String,
    val printer: PrinterConfig?, // null for ZONE_CONTROL
    val autoPrint: Boolean,
    val deviceNumber: Int,
    val staffName: String,
)
