package com.idento.di

import com.idento.data.network.ApiClient
import com.idento.data.network.AttendeeApiService
import com.idento.data.network.AuthApiService
import com.idento.data.network.EventApiService
import com.idento.data.network.ZoneApiService
import com.idento.data.network.getDefaultBaseUrl
import com.idento.data.preferences.AppPreferences
import com.idento.data.preferences.AuthPreferences
import com.idento.data.preferences.DisplayTemplatePreferences
import com.idento.data.repository.AttendeeRepository
import com.idento.data.repository.AuthRepository
import com.idento.data.repository.EventRepository
import com.idento.data.repository.ZoneRepository
import com.idento.data.repository.OfflineCheckInRepository
import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.OfflineDatabaseImpl
import com.idento.data.sync.SyncService
import com.idento.data.sync.NetworkMonitorImpl
import com.idento.platform.camera.CameraService
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService
import org.koin.core.module.Module
import org.koin.core.module.dsl.singleOf
import org.koin.dsl.module

/**
 * Koin DI Module - Shared across platforms
 */
val appModule = module {
    // DataStore Factory (platform-specific)
    single { createDataStoreFactory() }
    
    // Preferences (lazy - don't initialize until needed)
    single { AppPreferences(get()) }
    single { AuthPreferences(get()) }
    single { DisplayTemplatePreferences(get()) }
    
    // API Client
    single { 
        val authPreferences: AuthPreferences = get()
        ApiClient(
            baseUrl = getDefaultBaseUrl(),
            tokenProvider = { 
                // Get token from in-memory cache (synchronous access)
                authPreferences.getTokenSync()
            }
        )
    }
    
    // API Services
    single { AuthApiService(get()) }
    single { EventApiService(get()) }
    single { AttendeeApiService(get()) }
    single { ZoneApiService(get()) }
    
    // Repositories
    single { AuthRepository(get(), get()) }
    single { EventRepository(get()) }
    single { AttendeeRepository(get()) }
    single { ZoneRepository(get()) }
    single { OfflineCheckInRepository(get(), get()) }
    
    // Offline storage
    single { OfflineDatabaseImpl() }
    
    // Network monitoring
    single { NetworkMonitorImpl() }
    
    // Sync service
    single { SyncService(get(), get()) }
    
    // Platform Services (expect/actual)
    single { createBluetoothPrinterService() }
    single { createEthernetPrinterService() }
    single { createCameraService() }
}

/**
 * Platform-specific service creation
 */
expect fun createDataStoreFactory(): DataStoreFactory
expect fun createBluetoothPrinterService(): BluetoothPrinterService
expect fun createEthernetPrinterService(): EthernetPrinterService
expect fun createCameraService(): CameraService
