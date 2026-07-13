package com.idento.di

import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.SecureStore
import com.idento.data.storage.SqlDriverFactory
import com.idento.platform.camera.CameraService
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService
import com.idento.platform.scanner.AndroidScanSource
import com.idento.platform.scanner.ScanSource
import org.koin.core.component.KoinComponent

actual fun createDataStoreFactory(): DataStoreFactory {
    return DataStoreFactory(object : KoinComponent {}.getKoin().get())
}

actual fun createSecureStore(): SecureStore {
    return SecureStore(object : KoinComponent {}.getKoin().get())
}

actual fun createSqlDriverFactory(): SqlDriverFactory {
    return SqlDriverFactory(object : KoinComponent {}.getKoin().get())
}

actual fun createBluetoothPrinterService(): BluetoothPrinterService {
    return BluetoothPrinterService(object : KoinComponent {}.getKoin().get())
}

actual fun createEthernetPrinterService(): EthernetPrinterService {
    return EthernetPrinterService()
}

actual fun createCameraService(): CameraService {
    return CameraService(object : KoinComponent {}.getKoin().get())
}

actual fun createScanSource(cameraService: CameraService): ScanSource {
    return AndroidScanSource(cameraService, object : KoinComponent {}.getKoin().get())
}

/**
 * Android-specific Koin module.
 *
 * Deliberately does NOT define `single<Context> { androidContext() }` here — the real Context
 * binding is already registered once via `androidContext(this@IdentoApplication)` inside
 * `IdentoApplication.onCreate()`'s `startKoin { }` builder (`org.koin.android.ext.koin`'s
 * top-level `KoinApplication.androidContext(Context)`, a DIFFERENT overload from the `Scope`
 * extension of the same name). A `single<Context> { androidContext() }` here would silently
 * override that correct binding (Koin allows redefinition by default; last-registered module
 * wins, and this module loads after `appModule`) with one that calls the `Scope.androidContext()`
 * extension — which itself resolves via `get<Context>()`, i.e. this exact definition — an
 * infinite loop that StackOverflows on the very first Context resolution (DataStoreFactory below
 * is typically first, so this crashed on every single app launch, both debug and release).
 */
val androidModule = org.koin.dsl.module {
    single { DataStoreFactory(get()) }
    single { SecureStore(get()) }
    single { BluetoothPrinterService(get()) }
    single { EthernetPrinterService() }
    single { CameraService(get()) }
}
