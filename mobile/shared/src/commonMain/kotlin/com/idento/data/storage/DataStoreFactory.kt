package com.idento.data.storage

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences

/**
 * Platform-specific DataStore factory
 */
expect class DataStoreFactory {
    fun createDataStore(fileName: String): DataStore<Preferences>
}

/**
 * DataStore file names
 */
object DataStoreNames {
    const val AUTH = "auth_preferences"
    const val APP_SETTINGS = "app_settings"
    const val PRINTER = "printer_settings"
    const val SCANNER = "scanner_settings"
    const val CHECKIN = "checkin_preferences"
    const val DISPLAY_TEMPLATES = "display_templates"
}
