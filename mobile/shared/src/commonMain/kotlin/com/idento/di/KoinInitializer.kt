package com.idento.di

import org.koin.core.context.startKoin
import org.koin.core.module.Module
import org.koin.dsl.KoinAppDeclaration

/**
 * Initialize Koin DI
 * Called from iOS
 */
fun doInitKoin(appDeclaration: KoinAppDeclaration = {}) {
    startKoin {
        appDeclaration()
        modules(appModule, viewModelModule)
    }
}

/**
 * Initialize Koin with additional modules
 * Called from Android or custom setups
 */
fun doInitKoin(vararg modules: Module, appDeclaration: KoinAppDeclaration = {}) {
    startKoin {
        appDeclaration()
        modules(appModule, viewModelModule, *modules)
    }
}
