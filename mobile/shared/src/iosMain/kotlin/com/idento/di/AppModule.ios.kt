package com.idento.di

import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.SecureStore
import com.idento.data.storage.SqlDriverFactory
import com.idento.platform.camera.CameraService
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService
import com.idento.platform.scanner.IosScanSource
import com.idento.platform.scanner.ScanSource

actual fun createDataStoreFactory(): DataStoreFactory {
    return DataStoreFactory()
}

actual fun createSecureStore(): SecureStore {
    return SecureStore()
}

actual fun createSqlDriverFactory(): SqlDriverFactory {
    return SqlDriverFactory()
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

actual fun createScanSource(cameraService: CameraService): ScanSource {
    return IosScanSource(cameraService)
}

/**
 * iOS-specific Koin module (if needed)
 */
val iosModule = org.koin.dsl.module {
    single { DataStoreFactory() }
    single { SecureStore() }
    single { BluetoothPrinterService() }
    single { EthernetPrinterService() }
    single { CameraService() }
}
