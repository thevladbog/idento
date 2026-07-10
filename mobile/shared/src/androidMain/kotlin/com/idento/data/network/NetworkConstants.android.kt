package com.idento.data.network

actual fun getDefaultBaseUrl(): String =
    resolveBaseUrl(isDebugBuild(), NetworkConstants.DEV_BASE_URL, NetworkConstants.PROD_BASE_URL)
