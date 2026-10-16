package com.synergysign.app.presentation.bulk

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.DocumentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class BulkOperationsViewModel @Inject constructor(
    private val documentRepository: DocumentRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(BulkOperationsUiState())
    val uiState: StateFlow<BulkOperationsUiState> = _uiState.asStateFlow()
    
    fun addDocument(document: BulkDocument) {
        _uiState.update { state ->
            if (state.selectedDocuments.none { it.id == document.id }) {
                state.copy(selectedDocuments = state.selectedDocuments + document)
            } else {
                state
            }
        }
    }
    
    fun removeDocument(document: BulkDocument) {
        _uiState.update { state ->
            state.copy(selectedDocuments = state.selectedDocuments - document)
        }
    }
    
    fun addSigner(name: String, email: String) {
        val signer = BulkSigner(
            id = UUID.randomUUID().toString(),
            name = name,
            email = email
        )
        _uiState.update { state ->
            if (state.signers.none { it.email == email }) {
                state.copy(signers = state.signers + signer)
            } else {
                state
            }
        }
    }
    
    fun removeSigner(signer: BulkSigner) {
        _uiState.update { state ->
            state.copy(signers = state.signers - signer)
        }
    }
    
    fun setSendNotifications(enabled: Boolean) {
        _uiState.update { it.copy(sendNotifications = enabled) }
    }
    
    fun setSequentialSigning(enabled: Boolean) {
        _uiState.update { it.copy(sequentialSigning = enabled) }
    }
    
    fun showDeadlinePicker() {
        _uiState.update { it.copy(showDeadlinePicker = true) }
    }
    
    fun setDeadline(deadline: String?) {
        _uiState.update { it.copy(deadline = deadline, showDeadlinePicker = false) }
    }
    
    fun sendAll() {
        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, sentCount = 0, failedCount = 0) }
            
            val documents = _uiState.value.selectedDocuments
            val signers = _uiState.value.signers
            
            documents.forEach { document ->
                _uiState.update { it.copy(currentSendingDocument = document.title) }
                
                try {
                    // Add signers to each document
                    signers.forEach { signer ->
                        documentRepository.addSigner(
                            documentId = document.id,
                            name = signer.name,
                            email = signer.email
                        )
                    }
                    
                    // Send the document
                    documentRepository.sendDocument(document.id)
                    
                    _uiState.update { it.copy(sentCount = it.sentCount + 1) }
                } catch (e: Exception) {
                    _uiState.update { it.copy(failedCount = it.failedCount + 1) }
                }
                
                // Small delay between documents
                delay(500)
            }
            
            _uiState.update { it.copy(isSending = false, sendComplete = true, currentSendingDocument = null) }
        }
    }
    
    fun reset() {
        _uiState.value = BulkOperationsUiState()
    }
}

data class BulkOperationsUiState(
    val selectedDocuments: List<BulkDocument> = emptyList(),
    val signers: List<BulkSigner> = emptyList(),
    val sendNotifications: Boolean = true,
    val sequentialSigning: Boolean = false,
    val deadline: String? = null,
    val showDeadlinePicker: Boolean = false,
    val isSending: Boolean = false,
    val sendComplete: Boolean = false,
    val sentCount: Int = 0,
    val failedCount: Int = 0,
    val currentSendingDocument: String? = null,
    val error: String? = null
)
