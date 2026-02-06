package com.idento.data.storage

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import okio.Path.Companion.toPath
import java.io.File

actual class DataStoreFactory(private val context: Context) {
    
    private val dataStores = mutableMapOf<String, DataStore<Preferences>>()
    
    actual fun createDataStore(fileName: String): DataStore<Preferences> {
        return dataStores.getOrPut(fileName) {
            PreferenceDataStoreFactory.createWithPath {
                File(context.filesDir, "datastore/$fileName.preferences_pb").absolutePath.toPath()
            }
        }
    }
}
