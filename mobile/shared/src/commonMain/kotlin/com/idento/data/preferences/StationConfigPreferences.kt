package com.idento.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.idento.data.model.PrinterConfig
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.DataStoreNames
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Persists the wizard's finished [StationConfig] — one field per DataStore key, mirroring
 * AuthPreferences/AppPreferences (this codebase never stores a JSON blob in DataStore).
 * "Выйти со станции" (Exit station) calls [clear].
 */
class StationConfigPreferences(dataStoreFactory: DataStoreFactory) {

    private val dataStore: DataStore<Preferences> =
        dataStoreFactory.createDataStore(DataStoreNames.STATION_CONFIG)

    companion object {
        private val EVENT_ID = stringPreferencesKey("event_id")
        private val EVENT_NAME = stringPreferencesKey("event_name")
        private val MODE = stringPreferencesKey("mode")
        private val DAY_DATE = stringPreferencesKey("day_date")
        private val WORK_POINT_ID = stringPreferencesKey("work_point_id")
        private val WORK_POINT_NAME = stringPreferencesKey("work_point_name")
        private val PRINTER_NAME = stringPreferencesKey("printer_name")
        private val PRINTER_TRANSPORT = stringPreferencesKey("printer_transport")
        private val PRINTER_ADDRESS = stringPreferencesKey("printer_address")
        private val AUTO_PRINT = booleanPreferencesKey("auto_print")
        private val DEVICE_NUMBER = intPreferencesKey("device_number")
        private val STAFF_NAME = stringPreferencesKey("staff_name")
    }

    val stationConfig: Flow<StationConfig?> = dataStore.data.map { prefs ->
        val eventId = prefs[EVENT_ID] ?: return@map null
        val modeName = prefs[MODE] ?: return@map null
        val mode = runCatching { StationMode.valueOf(modeName) }.getOrNull() ?: return@map null
        val printerName = prefs[PRINTER_NAME]
        val printer = if (printerName != null) {
            PrinterConfig(
                name = printerName,
                transport = prefs[PRINTER_TRANSPORT] ?: "",
                address = prefs[PRINTER_ADDRESS] ?: "",
            )
        } else {
            null
        }
        StationConfig(
            eventId = eventId,
            eventName = prefs[EVENT_NAME] ?: "",
            mode = mode,
            dayDate = prefs[DAY_DATE],
            workPointId = prefs[WORK_POINT_ID] ?: "",
            workPointName = prefs[WORK_POINT_NAME] ?: "",
            printer = printer,
            autoPrint = prefs[AUTO_PRINT] ?: false,
            deviceNumber = prefs[DEVICE_NUMBER] ?: 0,
            staffName = prefs[STAFF_NAME] ?: "",
        )
    }

    suspend fun save(config: StationConfig) {
        dataStore.edit { prefs ->
            prefs[EVENT_ID] = config.eventId
            prefs[EVENT_NAME] = config.eventName
            prefs[MODE] = config.mode.name
            if (config.dayDate != null) prefs[DAY_DATE] = config.dayDate else prefs.remove(DAY_DATE)
            prefs[WORK_POINT_ID] = config.workPointId
            prefs[WORK_POINT_NAME] = config.workPointName
            if (config.printer != null) {
                prefs[PRINTER_NAME] = config.printer.name
                prefs[PRINTER_TRANSPORT] = config.printer.transport
                prefs[PRINTER_ADDRESS] = config.printer.address
            } else {
                prefs.remove(PRINTER_NAME)
                prefs.remove(PRINTER_TRANSPORT)
                prefs.remove(PRINTER_ADDRESS)
            }
            prefs[AUTO_PRINT] = config.autoPrint
            prefs[DEVICE_NUMBER] = config.deviceNumber
            prefs[STAFF_NAME] = config.staffName
        }
    }

    suspend fun clear() {
        dataStore.edit { it.clear() }
    }
}
