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

private val Context.appDataStore: DataStore<Preferences> by preferencesDataStore(name = "app_settings")

@Singleton
class AppPreferences @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val dataStore = context.appDataStore

    companion object {
        private val THEME_MODE = stringPreferencesKey("theme_mode")
        private val LANGUAGE = stringPreferencesKey("language")

        // Theme modes
        const val THEME_SYSTEM = "system"
        const val THEME_LIGHT = "light"
        const val THEME_DARK = "dark"

        // Languages
        const val LANG_SYSTEM = "system"
        const val LANG_EN = "en"
        const val LANG_RU = "ru"
    }

    val themeMode: Flow<String> = dataStore.data.map { preferences ->
        preferences[THEME_MODE] ?: THEME_SYSTEM
    }

    val language: Flow<String> = dataStore.data.map { preferences ->
        preferences[LANGUAGE] ?: LANG_SYSTEM
    }

    suspend fun setThemeMode(mode: String) {
        dataStore.edit { preferences ->
            preferences[THEME_MODE] = mode
        }
    }

    suspend fun setLanguage(language: String) {
        dataStore.edit { preferences ->
            preferences[LANGUAGE] = language
        }
    }
}
