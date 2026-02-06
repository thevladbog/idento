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

private val Context.templateDataStore: DataStore<Preferences> by preferencesDataStore(name = "template_settings")

@Singleton
class TemplatePreferences @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val dataStore = context.templateDataStore
    
    /**
     * Получает локальный шаблон success screen для события
     * Если не задан локально, возвращает null
     */
    fun getSuccessScreenTemplate(eventId: String): Flow<String?> {
        val key = stringPreferencesKey("success_screen_template_$eventId")
        return dataStore.data.map { preferences ->
            preferences[key]
        }
    }
    
    /**
     * Сохраняет локальный шаблон success screen для события
     */
    suspend fun saveSuccessScreenTemplate(eventId: String, template: String) {
        val key = stringPreferencesKey("success_screen_template_$eventId")
        dataStore.edit { preferences ->
            preferences[key] = template
        }
    }
    
    /**
     * Удаляет локальный шаблон success screen (вернется к серверному)
     */
    suspend fun clearSuccessScreenTemplate(eventId: String) {
        val key = stringPreferencesKey("success_screen_template_$eventId")
        dataStore.edit { preferences ->
            preferences.remove(key)
        }
    }
    
    /**
     * Получает локальный шаблон бейджа для события
     */
    fun getBadgeTemplate(eventId: String): Flow<String?> {
        val key = stringPreferencesKey("badge_template_$eventId")
        return dataStore.data.map { preferences ->
            preferences[key]
        }
    }
    
    /**
     * Сохраняет локальный шаблон бейджа для события
     */
    suspend fun saveBadgeTemplate(eventId: String, template: String) {
        val key = stringPreferencesKey("badge_template_$eventId")
        dataStore.edit { preferences ->
            preferences[key] = template
        }
    }
    
    /**
     * Удаляет локальный шаблон бейджа (вернется к серверному или стандартному)
     */
    suspend fun clearBadgeTemplate(eventId: String) {
        val key = stringPreferencesKey("badge_template_$eventId")
        dataStore.edit { preferences ->
            preferences.remove(key)
        }
    }
    
    /**
     * Очищает все шаблоны для события
     */
    suspend fun clearAllTemplates(eventId: String) {
        clearSuccessScreenTemplate(eventId)
        clearBadgeTemplate(eventId)
    }
}
