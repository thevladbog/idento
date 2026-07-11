package com.idento.di

import com.idento.data.model.StationConfig
import com.idento.data.preferences.AuthPreferences
import com.idento.data.preferences.StationConfigPreferences
import com.idento.data.repository.AuthRepository
import com.idento.data.repository.EventRepository
import com.idento.data.repository.StationRepository
import com.idento.data.repository.ZoneRepository
import com.idento.platform.camera.CameraService
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService
import com.idento.presentation.attendees.AttendeesListViewModel
import com.idento.presentation.checkin.CheckinViewModel
import com.idento.presentation.events.EventsViewModel
import com.idento.presentation.login.LoginViewModel
import com.idento.presentation.qrscanner.QRScannerViewModel
import com.idento.presentation.settings.SettingsViewModel
import com.idento.presentation.setup.AuthLogoutGateway
import com.idento.presentation.setup.AuthTokenSaver
import com.idento.presentation.setup.BluetoothPrinterGateway
import com.idento.presentation.setup.CurrentUserIdProvider
import com.idento.presentation.setup.EthernetPrinterGateway
import com.idento.presentation.setup.EventDaysCalculator
import com.idento.presentation.setup.EventLister
import com.idento.presentation.setup.EventLoader
import com.idento.presentation.setup.ManagerAuthenticator
import com.idento.presentation.setup.ProvisioningTokenMinter
import com.idento.presentation.setup.SetupCompleteViewModel
import com.idento.presentation.setup.SetupDayZoneViewModel
import com.idento.presentation.setup.SetupEventViewModel
import com.idento.presentation.setup.SetupLoginViewModel
import com.idento.presentation.setup.SetupModeViewModel
import com.idento.presentation.setup.SetupPrinterViewModel
import com.idento.presentation.setup.StationConfigGateway
import com.idento.presentation.setup.StationProvisioner
import com.idento.presentation.setup.ZoneLister
import com.idento.presentation.template.DisplayTemplateViewModel
import com.idento.presentation.template.TemplateEditorViewModel
import org.koin.dsl.module

/**
 * ViewModel Koin Module
 * Replaces Hilt ViewModelModule
 */
val viewModelModule = module {
    factory { LoginViewModel(get()) }
    factory { EventsViewModel(get(), get()) }
    factory { CheckinViewModel(get(), get(), get(), get()) }
    factory { SettingsViewModel(get()) }
    factory { QRScannerViewModel(get()) }
    factory { AttendeesListViewModel(get()) }
    factory { TemplateEditorViewModel(get()) }
    factory { DisplayTemplateViewModel(get(), get(), get()) }
    factory {
        // SetupLoginViewModel takes narrow fun-interface seams (see SetupLoginViewModel.kt)
        // instead of these concrete classes directly, so it stays unit-testable with plain
        // fakes — adapt the real singletons into them here via method references.
        val stationRepository: StationRepository = get()
        val authRepository: AuthRepository = get()
        val authPreferences: AuthPreferences = get()
        SetupLoginViewModel(
            cameraService = get<CameraService>(),
            stationProvisioner = StationProvisioner(stationRepository::provisionStation),
            managerAuthenticator = ManagerAuthenticator(authRepository::login),
            authTokenSaver = AuthTokenSaver(authPreferences::saveAuthToken),
            draft = get(),
        )
    }
    factory {
        // Same rationale as SetupLoginViewModel above — SetupEventViewModel takes narrow
        // fun-interface seams (see SetupEventViewModel.kt) instead of these concrete classes
        // directly. StationProvisioner/AuthTokenSaver are the exact same seams reused from
        // SetupLoginViewModel.kt (same shape, same underlying method references).
        val eventRepository: EventRepository = get()
        val stationRepository: StationRepository = get()
        val authRepository: AuthRepository = get()
        val authPreferences: AuthPreferences = get()
        SetupEventViewModel(
            eventLister = EventLister(eventRepository::getEvents),
            provisioningTokenMinter = ProvisioningTokenMinter(stationRepository::createProvisioningToken),
            stationProvisioner = StationProvisioner(stationRepository::provisionStation),
            authTokenSaver = AuthTokenSaver(authPreferences::saveAuthToken),
            currentUserIdProvider = CurrentUserIdProvider(authRepository::getUserId),
            draft = get(),
        )
    }
    factory { SetupModeViewModel(draft = get()) }
    factory {
        // Same rationale as SetupEventViewModel above — SetupDayZoneViewModel takes narrow
        // fun-interface seams (see SetupDayZoneViewModel.kt) instead of EventRepository/
        // ZoneRepository directly. EventDaysCalculator wraps ZoneRepository.getEventDays, a
        // plain non-suspend pure function, purely to keep the concrete repository type out of
        // the ViewModel's constructor (see that file's kdoc).
        val eventRepository: EventRepository = get()
        val zoneRepository: ZoneRepository = get()
        SetupDayZoneViewModel(
            eventLoader = EventLoader(eventRepository::getEvent),
            zoneLister = ZoneLister(zoneRepository::getStaffZones),
            eventDaysCalculator = EventDaysCalculator(zoneRepository::getEventDays),
            draft = get(),
        )
    }
    factory {
        // Same rationale as the seams above — SetupPrinterViewModel takes narrow interface seams
        // (see SetupPrinterViewModel.kt) instead of BluetoothPrinterService/EthernetPrinterService
        // directly. Both are `expect class` themselves (rather than a plain class wrapping one)
        // but the effect is identical: no `actual` exists outside androidMain/iosMain, so neither
        // can be constructed from commonTest. BluetoothPrinterGateway needs two methods, so it's
        // adapted via an anonymous object rather than a single method reference.
        val bluetoothPrinterService: BluetoothPrinterService = get()
        val ethernetPrinterService: EthernetPrinterService = get()
        SetupPrinterViewModel(
            bluetoothPrinterService = object : BluetoothPrinterGateway {
                override suspend fun getPairedPrinters() = bluetoothPrinterService.getPairedPrinters()
                override suspend fun printTest(address: String) = bluetoothPrinterService.printTest(address)
            },
            ethernetPrinterService = EthernetPrinterGateway(ethernetPrinterService::printTest),
            draft = get(),
        )
    }
    factory {
        // Same rationale as the seams above — SetupCompleteViewModel takes narrow seams (see
        // SetupCompleteViewModel.kt) instead of StationConfigPreferences/AuthPreferences directly.
        val stationConfigPreferences: StationConfigPreferences = get()
        val authPreferences: AuthPreferences = get()
        SetupCompleteViewModel(
            draft = get(),
            stationConfigPreferences = object : StationConfigGateway {
                override suspend fun save(config: StationConfig) = stationConfigPreferences.save(config)
                override suspend fun clear() = stationConfigPreferences.clear()
            },
            authPreferences = AuthLogoutGateway(authPreferences::clearAuth),
        )
    }
}
