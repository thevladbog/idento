package com.idento.data.storage

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.cinterop.ExperimentalForeignApi
import okio.Path.Companion.toPath
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory

@OptIn(ExperimentalForeignApi::class)
actual class DataStoreFactory {
    
    // Cache DataStore instances to prevent multiple instances for same file
    private val dataStoreCache = mutableMapOf<String, DataStore<Preferences>>()
    
    actual fun createDataStore(fileName: String): DataStore<Preferences> {
        return dataStoreCache.getOrPut(fileName) {
            val homeDir = NSHomeDirectory()
            val documentsPath = "$homeDir/Documents"
            
            // Ensure Documents directory exists
            val fileManager = NSFileManager.defaultManager
            if (!fileManager.fileExistsAtPath(documentsPath)) {
                fileManager.createDirectoryAtPath(
                    path = documentsPath,
                    withIntermediateDirectories = true,
                    attributes = null,
                    error = null
                )
            }
            
            PreferenceDataStoreFactory.createWithPath(
                produceFile = { "$documentsPath/$fileName".toPath() }
            )
        }
    }
}
