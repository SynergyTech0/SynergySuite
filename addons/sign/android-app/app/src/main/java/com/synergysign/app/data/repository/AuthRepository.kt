package com.synergysign.app.data.repository

import com.synergysign.app.data.api.ApiService
import com.synergysign.app.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for authentication operations
 */
@Singleton
class AuthRepository @Inject constructor(
    private val apiService: ApiService,
    private val tokenRepository: TokenRepository
) {
    
    /**
     * Login with email and password
     */
    suspend fun login(email: String, password: String): Result<User> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.login(LoginRequest(email, password))
            
            if (response.isSuccessful && response.body() != null) {
                val loginResponse = response.body()!!
                
                // Save token and user info
                tokenRepository.saveAccessToken(loginResponse.accessToken)
                tokenRepository.saveUserInfo(
                    userId = loginResponse.user.id,
                    email = loginResponse.user.email,
                    name = loginResponse.user.name,
                    role = loginResponse.user.role
                )
                
                Result.success(loginResponse.user)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Login failed"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Register a new user
     */
    suspend fun signup(
        email: String,
        password: String,
        firstName: String,
        lastName: String,
        companyName: String? = null,
        referralCode: String? = null
    ): Result<User> = withContext(Dispatchers.IO) {
        try {
            val request = SignupRequest(
                email = email,
                password = password,
                firstName = firstName,
                lastName = lastName,
                companyName = companyName,
                referralCode = referralCode
            )
            
            val response = apiService.signup(request)
            
            if (response.isSuccessful && response.body() != null) {
                val signupResponse = response.body()!!
                Result.success(signupResponse.user)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Signup failed"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Verify email with code
     */
    suspend fun verifyEmail(code: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.verifyEmail(VerifyEmailRequest(code))
            
            if (response.isSuccessful && response.body()?.success == true) {
                Result.success(true)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Verification failed"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Logout - clear stored tokens
     */
    suspend fun logout() {
        tokenRepository.clearTokens()
    }
    
    /**
     * Check if user is authenticated
     */
    suspend fun isAuthenticated(): Boolean {
        return tokenRepository.isAuthenticated()
    }
}
