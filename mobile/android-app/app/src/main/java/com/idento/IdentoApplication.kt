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
import org.koin.core.component.KoinComponent

@HiltAndroidApp
class IdentoApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        doInitKoin(androidModule) {
            androidLogger()
            androidContext(this@IdentoApplication)
        }
        // Best-effort: a failure here (e.g. Keystore unavailable) must not crash app startup
        // for every user just to migrate a legacy session for upgrading users.
        try {
            val authPreferences = object : KoinComponent {}.getKoin().get<AuthPreferences>()
            CoroutineScope(Dispatchers.Default).launch {
                migrateLegacyAndroidSession(this@IdentoApplication, authPreferences)
            }
        } catch (e: Exception) {
            // Nothing to migrate, or the graph isn't ready — safe to ignore.
        }
    }
}
