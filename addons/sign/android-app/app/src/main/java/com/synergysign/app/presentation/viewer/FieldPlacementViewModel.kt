package com.synergysign.app.presentation.viewer

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.model.*
import com.synergysign.app.data.repository.DocumentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class FieldPlacementState(
    val documentId: String = "",
    val document: DocumentDetail? = null,
    val fields: List<DocumentField> = emptyList(),
    val signers: List<DocumentSigner> = emptyList(),
    val currentPage: Int = 1,
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val saveSuccess: Boolean = false
)

@HiltViewModel
class FieldPlacementViewModel @Inject constructor(
    private val documentRepository: DocumentRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _state = MutableStateFlow(FieldPlacementState())
    val state: StateFlow<FieldPlacementState> = _state.asStateFlow()

    // Local list of fields being edited
    private val editableFields = mutableListOf<FieldData>()

    init {
        savedStateHandle.get<String>("documentId")?.let { documentId ->
            loadDocument(documentId)
        }
    }

    fun loadDocument(documentId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(
                documentId = documentId,
                isLoading = true,
                error = null
            )

            documentRepository.getDocument(documentId)
                .onSuccess { document ->
                    _state.value = _state.value.copy(
                        document = document,
                        fields = document.fields ?: emptyList(),
                        signers = document.signers,
                        isLoading = false
                    )
                    // Initialize editable fields
                    editableFields.clear()
                    document.fields?.forEach { field ->
                        editableFields.add(
                            FieldData(
                                fieldType = field.fieldType,
                                label = field.label,
                                required = field.required,
                                pageNumber = field.pageNumber,
                                x = field.x,
                                y = field.y,
                                width = field.width,
                                height = field.height,
                                assignedToId = field.assignedToId
                            )
                        )
                    }
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
        }
    }

    fun addField(type: String, x: Float, y: Float, assignedToId: String?) {
        val newField = DocumentField(
            id = UUID.randomUUID().toString(), // Temporary local ID
            fieldType = type,
            label = null,
            required = true,
            pageNumber = _state.value.currentPage,
            x = x.toDouble(),
            y = y.toDouble(),
            width = 150.0,
            height = 50.0,
            value = null,
            assignedToId = assignedToId
        )
        
        _state.value = _state.value.copy(
            fields = _state.value.fields + newField
        )

        // Add to editable fields
        editableFields.add(
            FieldData(
                fieldType = type,
                label = null,
                required = true,
                pageNumber = _state.value.currentPage,
                x = x.toDouble(),
                y = y.toDouble(),
                width = 150.0,
                height = 50.0,
                assignedToId = assignedToId
            )
        )
    }

    fun updateFieldPosition(fieldId: String, x: Float, y: Float) {
        val fieldIndex = _state.value.fields.indexOfFirst { it.id == fieldId }
        if (fieldIndex >= 0) {
            val updatedField = _state.value.fields[fieldIndex].copy(
                x = x.toDouble(),
                y = y.toDouble()
            )
            val updatedFields = _state.value.fields.toMutableList()
            updatedFields[fieldIndex] = updatedField
            _state.value = _state.value.copy(fields = updatedFields)

            // Update editable fields
            if (fieldIndex < editableFields.size) {
                editableFields[fieldIndex] = editableFields[fieldIndex].copy(
                    x = x.toDouble(),
                    y = y.toDouble()
                )
            }
        }
    }

    fun removeField(fieldId: String) {
        val fieldIndex = _state.value.fields.indexOfFirst { it.id == fieldId }
        if (fieldIndex >= 0) {
            val updatedFields = _state.value.fields.toMutableList()
            updatedFields.removeAt(fieldIndex)
            _state.value = _state.value.copy(fields = updatedFields)

            if (fieldIndex < editableFields.size) {
                editableFields.removeAt(fieldIndex)
            }
        }
    }

    fun setCurrentPage(page: Int) {
        _state.value = _state.value.copy(currentPage = page)
    }

    fun saveFields() {
        val documentId = _state.value.documentId
        if (documentId.isBlank()) return

        viewModelScope.launch {
            _state.value = _state.value.copy(isSaving = true, error = null)

            documentRepository.saveFields(documentId, editableFields.toList())
                .onSuccess { fields ->
                    _state.value = _state.value.copy(
                        isSaving = false,
                        saveSuccess = true,
                        fields = fields
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        isSaving = false,
                        error = e.message
                    )
                }
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }
}
