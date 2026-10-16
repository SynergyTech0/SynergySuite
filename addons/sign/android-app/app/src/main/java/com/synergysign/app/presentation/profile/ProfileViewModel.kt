package com.synergysign.app.presentation.profile

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val userRepository: UserRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()
    
    private var originalState: ProfileUiState? = null
    
    init {
        loadProfile()
    }
    
    private fun loadProfile() {
        viewModelScope.launch {
            try {
                val user = userRepository.getCurrentUser()
                val state = ProfileUiState(
                    firstName = user?.firstName ?: "",
                    lastName = user?.lastName ?: "",
                    email = user?.email ?: "",
                    companyName = user?.companyName ?: "",
                    profilePhotoUrl = user?.image
                )
                _uiState.value = state
                originalState = state
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun updateFirstName(value: String) {
        _uiState.update { it.copy(firstName = value, hasChanges = hasChanges(it.copy(firstName = value))) }
    }
    
    fun updateLastName(value: String) {
        _uiState.update { it.copy(lastName = value, hasChanges = hasChanges(it.copy(lastName = value))) }
    }
    
    fun updateEmail(value: String) {
        _uiState.update { it.copy(email = value, hasChanges = hasChanges(it.copy(email = value))) }
    }
    
    fun updateCompanyName(value: String) {
        _uiState.update { it.copy(companyName = value, hasChanges = hasChanges(it.copy(companyName = value))) }
    }
    
    private fun hasChanges(state: ProfileUiState): Boolean {
        return originalState?.let { original ->
            state.firstName != original.firstName ||
            state.lastName != original.lastName ||
            state.email != original.email ||
            state.companyName != original.companyName
        } ?: false
    }
    
    fun updateProfilePhoto(context: Context, uri: Uri) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }
            try {
                val photoUrl = userRepository.uploadProfilePhoto(context, uri)
                _uiState.update { it.copy(profilePhotoUrl = photoUrl, isSaving = false, successMessage = "Profile photo updated") }
            } catch (e: Exception) {
                _uiState.update { it.copy(isSaving = false, error = e.message) }
            }
        }
    }
    
    fun saveProfile() {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null, successMessage = null) }
            try {
                val state = _uiState.value
                userRepository.updateProfile(
                    firstName = state.firstName,
                    lastName = state.lastName,
                    email = state.email,
                    companyName = state.companyName.takeIf { it.isNotBlank() }
                )
                originalState = state.copy(hasChanges = false)
                _uiState.update { it.copy(isSaving = false, hasChanges = false, successMessage = "Profile updated successfully") }
            } catch (e: Exception) {
                _uiState.update { it.copy(isSaving = false, error = e.message) }
            }
        }
    }
    
    fun changePassword(currentPassword: String, newPassword: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null, successMessage = null) }
            try {
                userRepository.changePassword(currentPassword, newPassword)
                _uiState.update { it.copy(isSaving = false, successMessage = "Password changed successfully") }
            } catch (e: Exception) {
                _uiState.update { it.copy(isSaving = false, error = e.message) }
            }
        }
    }
    
    fun deleteAccount() {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null) }
            try {
                userRepository.deleteAccount()
                _uiState.update { it.copy(accountDeleted = true) }
            } catch (e: Exception) {
                _uiState.update { it.copy(isSaving = false, error = e.message) }
            }
        }
    }
}

data class ProfileUiState(
    val firstName: String = "",
    val lastName: String = "",
    val email: String = "",
    val companyName: String = "",
    val profilePhotoUrl: String? = null,
    val hasChanges: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val successMessage: String? = null,
    val accountDeleted: Boolean = false
)
