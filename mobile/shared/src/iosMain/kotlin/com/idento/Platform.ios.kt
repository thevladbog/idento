package com.idento

import platform.UIKit.UIDevice

class IOSPlatform: Platform {
    override val name: String = 
        UIDevice.currentDevice.systemName() + " " + UIDevice.currentDevice.systemVersion
    override val osVersion: String = UIDevice.currentDevice.systemVersion
}

actual fun getPlatform(): Platform = IOSPlatform()
