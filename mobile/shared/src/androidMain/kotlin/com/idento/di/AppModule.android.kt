package com.idento.di

import android.content.Context
import com.idento.data.storage.DataStoreFactory
import com.idento.platform.camera.CameraService
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService
import org.koin.android.ext.koin.androidContext
import org.koin.core.component.KoinComponent

actual fun createDataStoreFactory(): DataStoreFactory {
    return DataStoreFactory(object : KoinComponent {}.getKoin().get())
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

/**
 * Android-specific Koin module
 */
val androidModule = org.koin.dsl.module {
    single<Context> { androidContext() }
    single { DataStoreFactory(get()) }
    single { BluetoothPrinterService(get()) }
    single { EthernetPrinterService() }
    single { CameraService(get()) }
}
