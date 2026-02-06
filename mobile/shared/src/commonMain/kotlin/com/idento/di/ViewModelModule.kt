package com.idento.di

import com.idento.presentation.attendees.AttendeesListViewModel
import com.idento.presentation.checkin.CheckinViewModel
import com.idento.presentation.events.EventsViewModel
import com.idento.presentation.login.LoginViewModel
import com.idento.presentation.qrscanner.QRScannerViewModel
import com.idento.presentation.settings.SettingsViewModel
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
}
