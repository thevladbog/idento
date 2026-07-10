package com.idento

import android.app.Application
import com.idento.di.androidModule
import com.idento.di.doInitKoin
import dagger.hilt.android.HiltAndroidApp
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger

@HiltAndroidApp
class IdentoApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        doInitKoin(androidModule) {
            androidLogger()
            androidContext(this@IdentoApplication)
        }
    }
}
