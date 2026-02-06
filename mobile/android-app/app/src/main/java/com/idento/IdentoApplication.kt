package com.idento

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class IdentoApplication : Application() {
    
    override fun onCreate() {
        super.onCreate()
        // Initialize any app-wide configurations here
    }
}
