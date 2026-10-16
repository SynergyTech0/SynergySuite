package com.synergysign.app.presentation.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()
    
    init {
        loadSettings()
    }
    
    private fun loadSettings() {
        viewModelScope.launch {
            try {
                val settings = settingsRepository.getSettings()
                _uiState.update {
                    it.copy(
                        emailNotifications = settings.emailNotifications,
                        pushNotifications = settings.pushNotifications,
                        deadlineReminders = settings.deadlineReminders,
                        defaultSignature = settings.defaultSignature,
                        timezone = settings.timezone,
                        theme = settings.theme,
                        offlineMode = settings.offlineMode,
                        biometricEnabled = settings.biometricEnabled,
                        cacheSize = settings.cacheSize,
                        appVersion = settings.appVersion
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun setEmailNotifications(enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.setEmailNotifications(enabled)
            _uiState.update { it.copy(emailNotifications = enabled) }
        }
    }
    
    fun setPushNotifications(enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.setPushNotifications(enabled)
            _uiState.update { it.copy(pushNotifications = enabled) }
        }
    }
    
    fun setDeadlineReminders(enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.setDeadlineReminders(enabled)
            _uiState.update { it.copy(deadlineReminders = enabled) }
        }
    }
    
    fun setTimezone(timezone: String) {
        viewModelScope.launch {
            settingsRepository.setTimezone(timezone)
            _uiState.update { it.copy(timezone = timezone) }
        }
    }
    
    fun cycleTheme() {
        val nextTheme = when (_uiState.value.theme) {
            AppTheme.SYSTEM -> AppTheme.LIGHT
            AppTheme.LIGHT -> AppTheme.DARK
            AppTheme.DARK -> AppTheme.SYSTEM
        }
        viewModelScope.launch {
            settingsRepository.setTheme(nextTheme.name)
            _uiState.update { it.copy(theme = nextTheme) }
        }
    }
    
    fun setOfflineMode(enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.setOfflineMode(enabled)
            _uiState.update { it.copy(offlineMode = enabled) }
        }
    }
    
    fun clearCache() {
        viewModelScope.launch {
            settingsRepository.clearCache()
            _uiState.update { it.copy(cacheSize = "0 MB") }
        }
    }
    
    fun openTerms() {
        _uiState.update { it.copy(openUrl = "https://synergysign.app/terms") }
    }
    
    fun openPrivacy() {
        _uiState.update { it.copy(openUrl = "https://synergysign.app/privacy") }
    }
    
    fun clearOpenUrl() {
        _uiState.update { it.copy(openUrl = null) }
    }
}

data class SettingsUiState(
    val error: String? = null,
    val emailNotifications: Boolean = true,
    val pushNotifications: Boolean = true,
    val deadlineReminders: Boolean = true,
    val defaultSignature: String? = null,
    val timezone: String = "America/New_York",
    val theme: AppTheme = AppTheme.SYSTEM,
    val offlineMode: Boolean = false,
    val biometricEnabled: Boolean = false,
    val cacheSize: String = "0 MB",
    val appVersion: String = "1.0.0",
    val openUrl: String? = null
)
