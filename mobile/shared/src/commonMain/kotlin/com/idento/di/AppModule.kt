package com.idento.di

import com.idento.data.network.ApiClient
import com.idento.data.network.AttendeeApiService
import com.idento.data.network.AuthApiService
import com.idento.data.network.EventApiService
import com.idento.data.network.StationApiService
import com.idento.data.network.ZoneApiService
import com.idento.data.network.getDefaultBaseUrl
import com.idento.data.preferences.AppPreferences
import com.idento.data.preferences.AuthPreferences
import com.idento.data.preferences.DisplayTemplatePreferences
import com.idento.data.preferences.StationConfigPreferences
import com.idento.data.registration.RegistrationOfflineQueue
import com.idento.data.registration.RegistrationOfflineQueueRepository
import com.idento.data.repository.AttendeeRepository
import com.idento.data.repository.AuthRepository
import com.idento.data.repository.EventRepository
import com.idento.data.repository.StationRepository
import com.idento.data.repository.ZoneRepository
import com.idento.data.repository.OfflineCheckInRepository
import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.SecureStore
import com.idento.data.storage.SqlDriverFactory
import com.idento.data.storage.SqlDelightOfflineDatabase
import com.idento.data.storage.OfflineDatabase
import com.idento.data.sync.SyncService
import com.idento.data.sync.NetworkMonitorImpl
import com.idento.db.IdentoDatabase
import com.idento.platform.camera.CameraService
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService
import com.idento.presentation.setup.SetupWizardDraft
import org.koin.core.module.Module
import org.koin.core.module.dsl.singleOf
import org.koin.dsl.module

/**
 * Koin DI Module - Shared across platforms
 */
val appModule = module {
    // DataStore Factory (platform-specific)
    single { createDataStoreFactory() }

    // Secure store (platform-specific: iOS Keychain / Android Keystore)
    single { createSecureStore() }

    // Preferences (lazy - don't initialize until needed)
    single { AppPreferences(get()) }
    single { AuthPreferences(get(), get()) }
    single { DisplayTemplatePreferences(get()) }
    single { StationConfigPreferences(get()) }
    single { SetupWizardDraft() }

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
    single { StationApiService(get()) }

    // Repositories
    single { AuthRepository(get(), get()) }
    single { EventRepository(get()) }
    single { AttendeeRepository(get()) }
    single { ZoneRepository(get()) }
    single { StationRepository(get()) }
    single { OfflineCheckInRepository(get(), get()) }
    
    // Offline storage (SQLDelight-backed, persistent)
    single { createSqlDriverFactory() }
    single { SqlDelightOfflineDatabase(get()) as OfflineDatabase }

    // Registration check-in offline queue (SQLDelight-backed, persistent).
    // `SqlDelightOfflineDatabase` above already constructs its own private `IdentoDatabase`
    // internally (see its constructor) rather than taking one in, and that constructor is
    // already-shipped/already-tested — so rather than change its signature to share a single
    // `IdentoDatabase` instance, this registers a second `IdentoDatabase`, backed by the same
    // "idento.db" file via the same `SqlDriverFactory`. SQLite supports multiple connections to
    // one file, so this is correct, just one extra (cheap) connection rather than a fully shared
    // instance.
    single { IdentoDatabase(get<SqlDriverFactory>().createDriver()) }
    single { RegistrationOfflineQueueRepository(get<IdentoDatabase>().pendingRegistrationCheckInQueries, get<AttendeeRepository>()::submitBatchCheckins) }
    single<RegistrationOfflineQueue> { get<RegistrationOfflineQueueRepository>() }

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
expect fun createSecureStore(): SecureStore
expect fun createSqlDriverFactory(): SqlDriverFactory
expect fun createBluetoothPrinterService(): BluetoothPrinterService
expect fun createEthernetPrinterService(): EthernetPrinterService
expect fun createCameraService(): CameraService
