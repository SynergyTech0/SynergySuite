package com.synergysign.app.data.api

import com.synergysign.app.data.repository.TokenRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp Interceptor for adding Authorization header
 * Automatically injects JWT token into requests
 * 
 * Note: While runBlocking is generally discouraged, OkHttp interceptors
 * run on their own thread pool and the token is cached in memory after
 * first access, making subsequent calls very fast.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenRepository: TokenRepository
) : Interceptor {

    // Cache token in memory to avoid repeated DataStore reads
    @Volatile
    private var cachedToken: String? = null

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        
        // Use cached token if available, otherwise fetch from DataStore
        val token = cachedToken ?: runBlocking { 
            tokenRepository.getAccessToken()?.also { cachedToken = it }
        }
        
        // If no token, proceed without auth header
        if (token.isNullOrEmpty()) {
            return chain.proceed(originalRequest)
        }
        
        // Add Authorization header
        val authenticatedRequest = originalRequest.newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        
        return chain.proceed(authenticatedRequest)
    }

    /**
     * Clear cached token (call when user logs out)
     */
    fun clearCachedToken() {
        cachedToken = null
    }

    /**
     * Update cached token (call after login)
     */
    fun updateCachedToken(token: String) {
        cachedToken = token
    }
}

/**
 * OkHttp Interceptor for handling 401 Unauthorized responses
 * Clears tokens and triggers re-authentication
 */
@Singleton
class UnauthorizedInterceptor @Inject constructor(
    private val tokenRepository: TokenRepository,
    private val authInterceptor: AuthInterceptor
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        
        if (response.code == 401) {
            // Token expired or invalid - clear stored tokens and cache
            authInterceptor.clearCachedToken()
            runBlocking { tokenRepository.clearTokens() }
        }
        
        return response
    }
}
