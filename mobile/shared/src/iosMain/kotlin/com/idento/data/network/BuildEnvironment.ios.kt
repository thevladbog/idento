package com.idento.data.network

import kotlin.experimental.ExperimentalNativeApi

@OptIn(ExperimentalNativeApi::class)
actual fun isDebugBuild(): Boolean = kotlin.native.Platform.isDebugBinary
