package com.idento.di

import com.idento.data.storage.DataStoreFactory
import com.idento.platform.camera.CameraService
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService

actual fun createDataStoreFactory(): DataStoreFactory {
    return DataStoreFactory()
}

actual fun createBluetoothPrinterService(): BluetoothPrinterService {
    return BluetoothPrinterService()
}

actual fun createEthernetPrinterService(): EthernetPrinterService {
    return EthernetPrinterService()
}

actual fun createCameraService(): CameraService {
    return CameraService()
}

/**
 * iOS-specific Koin module (if needed)
 */
val iosModule = org.koin.dsl.module {
    single { DataStoreFactory() }
    single { BluetoothPrinterService() }
    single { EthernetPrinterService() }
    single { CameraService() }
}
