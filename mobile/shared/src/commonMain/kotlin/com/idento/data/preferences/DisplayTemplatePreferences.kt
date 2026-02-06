package com.idento.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.idento.data.model.DisplayTemplate
import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.DataStoreNames
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Preferences for display templates
 * Stores templates per event
 */
class DisplayTemplatePreferences(dataStoreFactory: DataStoreFactory) {
    
    private val dataStore: DataStore<Preferences> = 
        dataStoreFactory.createDataStore(DataStoreNames.DISPLAY_TEMPLATES)
    
    private val json = Json { 
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    
    companion object {
        private fun templateKey(eventId: String) = stringPreferencesKey("template_$eventId")
    }
    
    /**
     * Get display template for event
     */
    fun getTemplate(eventId: String): Flow<DisplayTemplate?> {
        return dataStore.data.map { preferences ->
            preferences[templateKey(eventId)]?.let { jsonString ->
                try {
                    json.decodeFromString<DisplayTemplate>(jsonString)
                } catch (e: Exception) {
                    null
                }
            }
        }
    }
    
    /**
     * Save display template for event
     */
    suspend fun saveTemplate(template: DisplayTemplate) {
        dataStore.edit { preferences ->
            preferences[templateKey(template.eventId)] = json.encodeToString(template)
        }
    }
    
    /**
     * Delete template for event
     */
    suspend fun deleteTemplate(eventId: String) {
        dataStore.edit { preferences ->
            preferences.remove(templateKey(eventId))
        }
    }
    
    /**
     * Get template or default
     */
    fun getTemplateOrDefault(eventId: String): Flow<DisplayTemplate> {
        return getTemplate(eventId).map { template ->
            template ?: DisplayTemplate.default(eventId)
        }
    }
}
