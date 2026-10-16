package com.synergysign.app.presentation.signature

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.DocumentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SignatureState(
    val documentId: String = "",
    val fieldId: String = "",
    val isSubmitting: Boolean = false,
    val submitSuccess: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class SignatureViewModel @Inject constructor(
    private val documentRepository: DocumentRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _state = MutableStateFlow(SignatureState())
    val state: StateFlow<SignatureState> = _state.asStateFlow()

    init {
        val documentId = savedStateHandle.get<String>("documentId") ?: ""
        val fieldId = savedStateHandle.get<String>("fieldId") ?: ""
        _state.value = _state.value.copy(
            documentId = documentId,
            fieldId = fieldId
        )
    }

    fun submitSignature(signatureBase64: String) {
        val documentId = _state.value.documentId
        val fieldId = _state.value.fieldId
        
        if (documentId.isBlank() || fieldId.isBlank()) {
            _state.value = _state.value.copy(error = "Invalid document or field")
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(isSubmitting = true, error = null)

            documentRepository.signField(documentId, fieldId, signatureBase64)
                .onSuccess {
                    _state.value = _state.value.copy(
                        isSubmitting = false,
                        submitSuccess = true
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        isSubmitting = false,
                        error = e.message ?: "Failed to submit signature"
                    )
                }
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }
}
