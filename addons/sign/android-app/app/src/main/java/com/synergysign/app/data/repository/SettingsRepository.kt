package com.synergysign.app.data.repository

import com.synergysign.app.presentation.settings.AppTheme
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository @Inject constructor() {
    
    private var settings = Settings()
    
    suspend fun getSettings(): Settings {
        return settings
    }
    
    suspend fun setEmailNotifications(enabled: Boolean) {
        settings = settings.copy(emailNotifications = enabled)
    }
    
    suspend fun setPushNotifications(enabled: Boolean) {
        settings = settings.copy(pushNotifications = enabled)
    }
    
    suspend fun setDeadlineReminders(enabled: Boolean) {
        settings = settings.copy(deadlineReminders = enabled)
    }
    
    suspend fun setDefaultSignature(signature: String?) {
        settings = settings.copy(defaultSignature = signature)
    }
    
    suspend fun setTimezone(timezone: String) {
        settings = settings.copy(timezone = timezone)
    }
    
    suspend fun setTheme(theme: String) {
        settings = settings.copy(theme = AppTheme.valueOf(theme))
    }
    
    suspend fun setOfflineMode(enabled: Boolean) {
        settings = settings.copy(offlineMode = enabled)
    }
    
    suspend fun clearCache() {
        // Clear cached data
    }
}

data class Settings(
    val emailNotifications: Boolean = true,
    val pushNotifications: Boolean = true,
    val deadlineReminders: Boolean = true,
    val defaultSignature: String? = null,
    val timezone: String = "America/New_York",
    val theme: AppTheme = AppTheme.SYSTEM,
    val offlineMode: Boolean = false,
    val biometricEnabled: Boolean = false,
    val cacheSize: String = "12.5 MB",
    val appVersion: String = "1.0.0"
)
