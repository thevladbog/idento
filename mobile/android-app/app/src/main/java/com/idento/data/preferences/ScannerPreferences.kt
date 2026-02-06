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

private val Context.scannerDataStore: DataStore<Preferences> by preferencesDataStore(name = "scanner_settings")

@Singleton
class ScannerPreferences @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val dataStore = context.scannerDataStore
    
    companion object {
        private val SCANNER_ADDRESS = stringPreferencesKey("scanner_address")
        private val SCANNER_NAME = stringPreferencesKey("scanner_name")
    }
    
    val scannerAddress: Flow<String?> = dataStore.data.map { preferences ->
        preferences[SCANNER_ADDRESS]
    }
    
    val scannerName: Flow<String?> = dataStore.data.map { preferences ->
        preferences[SCANNER_NAME]
    }
    
    suspend fun saveScanner(address: String, name: String) {
        dataStore.edit { preferences ->
            preferences[SCANNER_ADDRESS] = address
            preferences[SCANNER_NAME] = name
        }
    }
    
    suspend fun clearScanner() {
        dataStore.edit { preferences ->
            preferences.remove(SCANNER_ADDRESS)
            preferences.remove(SCANNER_NAME)
        }
    }
}
