package com.synergysign.app.data.repository

import android.content.Context
import android.net.Uri
import com.synergysign.app.data.api.ApiService
import com.synergysign.app.data.model.User
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepository @Inject constructor(
    private val apiService: ApiService,
    private val tokenRepository: TokenRepository
) {
    private var cachedUser: UserProfile? = null
    
    suspend fun getCurrentUser(): UserProfile? {
        if (cachedUser != null) return cachedUser
        
        // In production, fetch from API
        // For now, return from token repository user data
        return cachedUser
    }
    
    suspend fun updateProfile(
        firstName: String,
        lastName: String,
        email: String,
        companyName: String?
    ) {
        // In production, call API to update profile
        cachedUser = cachedUser?.copy(
            firstName = firstName,
            lastName = lastName,
            email = email,
            companyName = companyName
        )
    }
    
    suspend fun uploadProfilePhoto(context: Context, uri: Uri): String {
        // In production, upload to server and return URL
        return uri.toString()
    }
    
    suspend fun changePassword(currentPassword: String, newPassword: String) {
        // In production, call API to change password
    }
    
    suspend fun deleteAccount() {
        // In production, call API to delete account
        cachedUser = null
        tokenRepository.clearToken()
    }
}

data class UserProfile(
    val id: String,
    val email: String,
    val firstName: String?,
    val lastName: String?,
    val companyName: String?,
    val image: String?,
    val role: String
)
