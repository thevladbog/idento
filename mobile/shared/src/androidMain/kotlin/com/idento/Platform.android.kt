package com.idento

import android.os.Build

class AndroidPlatform : Platform {
    override val name: String = "Android ${Build.VERSION.SDK_INT}"
    override val osVersion: String = "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
}

actual fun getPlatform(): Platform = AndroidPlatform()
