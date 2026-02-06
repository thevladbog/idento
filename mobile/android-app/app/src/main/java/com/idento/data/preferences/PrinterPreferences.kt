package com.idento.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.printerDataStore: DataStore<Preferences> by preferencesDataStore(name = "printer_settings")

@Singleton
class PrinterPreferences @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val dataStore = context.printerDataStore
    
    companion object {
        private val PRINTER_TYPE = stringPreferencesKey("printer_type") // "bluetooth" or "ethernet"
        private val PRINTER_ADDRESS = stringPreferencesKey("printer_address") // MAC или IP
        private val PRINTER_NAME = stringPreferencesKey("printer_name")
        private val PRINTER_PORT = stringPreferencesKey("printer_port") // Для Ethernet
        private val BADGE_TEMPLATE = stringPreferencesKey("badge_template")
    }
    
    val printerType: Flow<String?> = dataStore.data.map { preferences ->
        preferences[PRINTER_TYPE]
    }
    
    val printerAddress: Flow<String?> = dataStore.data.map { preferences ->
        preferences[PRINTER_ADDRESS]
    }
    
    val printerName: Flow<String?> = dataStore.data.map { preferences ->
        preferences[PRINTER_NAME]
    }
    
    val printerPort: Flow<String?> = dataStore.data.map { preferences ->
        preferences[PRINTER_PORT]
    }
    
    val badgeTemplate: Flow<String?> = dataStore.data.map { preferences ->
        preferences[BADGE_TEMPLATE]
    }
    
    suspend fun saveBluetoothPrinter(address: String, name: String) {
        dataStore.edit { preferences ->
            preferences[PRINTER_TYPE] = "bluetooth"
            preferences[PRINTER_ADDRESS] = address
            preferences[PRINTER_NAME] = name
            preferences.remove(PRINTER_PORT)
        }
    }
    
    suspend fun saveEthernetPrinter(ipAddress: String, port: Int, name: String) {
        dataStore.edit { preferences ->
            preferences[PRINTER_TYPE] = "ethernet"
            preferences[PRINTER_ADDRESS] = ipAddress
            preferences[PRINTER_PORT] = port.toString()
            preferences[PRINTER_NAME] = name
        }
    }
    
    suspend fun clearPrinter() {
        dataStore.edit { preferences ->
            preferences.remove(PRINTER_TYPE)
            preferences.remove(PRINTER_ADDRESS)
            preferences.remove(PRINTER_NAME)
            preferences.remove(PRINTER_PORT)
        }
    }
    
    suspend fun saveBadgeTemplate(template: String) {
        dataStore.edit { preferences ->
            preferences[BADGE_TEMPLATE] = template
        }
    }
}
