package com.idento.data.network

actual fun getDefaultBaseUrl(): String =
    resolveBaseUrl(isDebugBuild(), NetworkConstants.IOS_DEV_BASE_URL, NetworkConstants.PROD_BASE_URL)
