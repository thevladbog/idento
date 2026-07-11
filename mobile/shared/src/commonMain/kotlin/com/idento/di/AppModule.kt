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
    
    // Offline storage (SQLDelight-backed, persistent). A single `IdentoDatabase` instance —
    // and therefore a single `SqlDriver`/connection to the "idento.db" file — is registered
    // here and shared by every consumer below (both `SqlDelightOfflineDatabase`'s zone
    // check-in queue and `RegistrationOfflineQueueRepository`'s registration check-in queue),
    // rather than each opening its own separate connection to the same physical file. Neither
    // `SqlDriverFactory.android.kt` nor `.ios.kt` configures WAL mode, so multiple concurrent
    // connections to the same file would otherwise rely on SQLite's default rollback-journal
    // locking; sharing one connection avoids that risk entirely once `SyncService` drives
    // concurrent flush operations from a background dispatcher alongside foreground writes.
    single { createSqlDriverFactory() }
    single { IdentoDatabase(get<SqlDriverFactory>().createDriver()) }
    single { SqlDelightOfflineDatabase(get()) as OfflineDatabase }

    // Registration check-in offline queue (SQLDelight-backed, persistent). Resolves the same
    // `IdentoDatabase` singleton registered above via Koin's `get()` rather than constructing
    // its own.
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
