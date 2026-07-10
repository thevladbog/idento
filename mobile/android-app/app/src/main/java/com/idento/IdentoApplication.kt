package com.idento

import android.app.Application
import com.idento.data.preferences.AuthPreferences
import com.idento.di.androidModule
import com.idento.di.doInitKoin
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.mp.KoinPlatform

@HiltAndroidApp
class IdentoApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        doInitKoin(androidModule) {
            androidLogger()
            androidContext(this@IdentoApplication)
        }
        val authPreferences = KoinPlatform.getKoin().get<AuthPreferences>()
        CoroutineScope(Dispatchers.Default).launch {
            migrateLegacyAndroidSession(this@IdentoApplication, authPreferences)
        }
    }
}
