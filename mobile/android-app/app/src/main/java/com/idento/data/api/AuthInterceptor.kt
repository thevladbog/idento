package com.idento.data.api

import com.idento.data.local.TokenManager
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject

class AuthInterceptor @Inject constructor(
    private val tokenManager: TokenManager
) : Interceptor {
    
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        
        // Не добавляем токен для auth endpoints
        val url = request.url.toString()
        if (url.contains("/auth/")) {
            return chain.proceed(request)
        }
        
        // Получаем токен синхронно (внутри interceptor'а)
        val token = runBlocking {
            tokenManager.authToken.first()
        }
        
        // Если токен есть, добавляем его в заголовок
        val newRequest = if (token != null) {
            request.newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        } else {
            request
        }
        
        return chain.proceed(newRequest)
    }
}
