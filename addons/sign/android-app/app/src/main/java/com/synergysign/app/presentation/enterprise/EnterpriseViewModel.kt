package com.synergysign.app.presentation.enterprise

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.EnterpriseRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EnterpriseViewModel @Inject constructor(
    private val enterpriseRepository: EnterpriseRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(EnterpriseUiState())
    val uiState: StateFlow<EnterpriseUiState> = _uiState.asStateFlow()
    
    init {
        loadEnterpriseData()
    }
    
    private fun loadEnterpriseData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val data = enterpriseRepository.getEnterpriseData()
                
                if (data != null) {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            hasEnterprise = true,
                            isAdmin = data.isAdmin,
                            members = data.members,
                            invitations = data.invitations,
                            branding = data.branding
                        )
                    }
                } else {
                    _uiState.update { it.copy(isLoading = false, hasEnterprise = false) }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }
    
    fun inviteMember(email: String, role: String) {
        viewModelScope.launch {
            try {
                enterpriseRepository.inviteMember(email, role)
                loadEnterpriseData()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun updateMemberRole(member: TeamMember, newRole: String) {
        viewModelScope.launch {
            try {
                enterpriseRepository.updateMemberRole(member.id, newRole)
                loadEnterpriseData()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun removeMember(member: TeamMember) {
        viewModelScope.launch {
            try {
                enterpriseRepository.removeMember(member.id)
                loadEnterpriseData()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun resendInvitation(invitation: TeamInvitation) {
        viewModelScope.launch {
            try {
                enterpriseRepository.resendInvitation(invitation.id)
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun cancelInvitation(invitation: TeamInvitation) {
        viewModelScope.launch {
            try {
                enterpriseRepository.cancelInvitation(invitation.id)
                loadEnterpriseData()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun updateBranding(branding: TeamBranding) {
        viewModelScope.launch {
            try {
                enterpriseRepository.updateBranding(branding)
                _uiState.update { it.copy(branding = branding) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun requestEnterprise() {
        _uiState.update { it.copy(showEnterpriseRequest = true) }
    }
}

data class EnterpriseUiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val hasEnterprise: Boolean = false,
    val isAdmin: Boolean = false,
    val members: List<TeamMember> = emptyList(),
    val invitations: List<TeamInvitation> = emptyList(),
    val branding: TeamBranding = TeamBranding(),
    val showEnterpriseRequest: Boolean = false
)
