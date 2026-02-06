package com.idento.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.checkinDataStore: DataStore<Preferences> by preferencesDataStore(name = "checkin_settings")

@Singleton
class CheckinPreferences @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val dataStore = context.checkinDataStore
    
    companion object {
        private val AUTO_PRINT_BADGE = booleanPreferencesKey("auto_print_badge")
        private val PRINT_ON_BUTTON = booleanPreferencesKey("print_on_button")
    }
    
    val autoPrintBadge: Flow<Boolean> = dataStore.data.map { preferences ->
        preferences[AUTO_PRINT_BADGE] ?: false
    }
    
    val printOnButton: Flow<Boolean> = dataStore.data.map { preferences ->
        preferences[PRINT_ON_BUTTON] ?: true // По умолчанию по кнопке
    }
    
    suspend fun setAutoPrintBadge(enabled: Boolean) {
        dataStore.edit { preferences ->
            preferences[AUTO_PRINT_BADGE] = enabled
        }
    }
    
    suspend fun setPrintOnButton(enabled: Boolean) {
        dataStore.edit { preferences ->
            preferences[PRINT_ON_BUTTON] = enabled
        }
    }
}
