package com.synergysign.app.presentation.signers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.SignersRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SignersViewModel @Inject constructor(
    private val signersRepository: SignersRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(SignersUiState())
    val uiState: StateFlow<SignersUiState> = _uiState.asStateFlow()
    
    init {
        loadSigners()
    }
    
    private fun loadSigners() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val contacts = signersRepository.getContacts()
                val groups = signersRepository.getGroups()
                
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        contacts = contacts,
                        groups = groups,
                        filteredContacts = contacts,
                        filteredGroups = groups
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }
    
    fun search(query: String) {
        _uiState.update { state ->
            val lowerQuery = query.lowercase()
            state.copy(
                searchQuery = query,
                filteredContacts = state.contacts.filter {
                    it.name.lowercase().contains(lowerQuery) || it.email.lowercase().contains(lowerQuery)
                },
                filteredGroups = state.groups.filter {
                    it.name.lowercase().contains(lowerQuery)
                }
            )
        }
    }
    
    fun toggleSelection(contactId: String) {
        _uiState.update { state ->
            val newSelection = if (contactId in state.selectedSigners) {
                state.selectedSigners - contactId
            } else {
                state.selectedSigners + contactId
            }
            state.copy(selectedSigners = newSelection)
        }
    }
    
    fun selectGroup(group: SignerGroup) {
        _uiState.update { state ->
            val memberIds = group.members.map { it.id }.toSet()
            state.copy(selectedSigners = state.selectedSigners + memberIds)
        }
    }
    
    fun addContact(name: String, email: String) {
        viewModelScope.launch {
            try {
                signersRepository.addContact(name, email)
                loadSigners()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun editContact(contact: Contact) {
        _uiState.update { it.copy(editingContact = contact) }
    }
    
    fun deleteContact(contact: Contact) {
        viewModelScope.launch {
            try {
                signersRepository.deleteContact(contact.id)
                loadSigners()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun addGroup(name: String, memberIds: List<String>) {
        viewModelScope.launch {
            try {
                signersRepository.createGroup(name, memberIds)
                loadSigners()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun editGroup(group: SignerGroup) {
        _uiState.update { it.copy(editingGroup = group) }
    }
    
    fun deleteGroup(group: SignerGroup) {
        viewModelScope.launch {
            try {
                signersRepository.deleteGroup(group.id)
                loadSigners()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun bulkInvite() {
        viewModelScope.launch {
            _uiState.update { it.copy(bulkInviteReady = true) }
        }
    }
    
    fun clearSelection() {
        _uiState.update { it.copy(selectedSigners = emptySet()) }
    }
}

data class SignersUiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val searchQuery: String = "",
    val contacts: List<Contact> = emptyList(),
    val groups: List<SignerGroup> = emptyList(),
    val filteredContacts: List<Contact> = emptyList(),
    val filteredGroups: List<SignerGroup> = emptyList(),
    val selectedSigners: Set<String> = emptySet(),
    val editingContact: Contact? = null,
    val editingGroup: SignerGroup? = null,
    val bulkInviteReady: Boolean = false
)
