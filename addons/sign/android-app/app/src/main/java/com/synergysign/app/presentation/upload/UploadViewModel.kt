package com.synergysign.app.presentation.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.DocumentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import javax.inject.Inject

data class UploadState(
    val selectedFileUri: Uri? = null,
    val selectedFileName: String? = null,
    val title: String = "",
    val description: String = "",
    val isUploading: Boolean = false,
    val uploadProgress: Float = 0f,
    val uploadSuccess: Boolean = false,
    val uploadedDocumentId: String? = null,
    val error: String? = null
)

@HiltViewModel
class UploadViewModel @Inject constructor(
    private val documentRepository: DocumentRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _state = MutableStateFlow(UploadState())
    val state: StateFlow<UploadState> = _state.asStateFlow()

    fun selectFile(uri: Uri) {
        val fileName = getFileName(uri)
        _state.value = _state.value.copy(
            selectedFileUri = uri,
            selectedFileName = fileName,
            title = fileName?.removeSuffix(".pdf") ?: ""
        )
    }

    fun setTitle(title: String) {
        _state.value = _state.value.copy(title = title)
    }

    fun setDescription(description: String) {
        _state.value = _state.value.copy(description = description)
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun upload() {
        val uri = _state.value.selectedFileUri ?: return
        val title = _state.value.title.ifBlank { return }
        
        viewModelScope.launch {
            _state.value = _state.value.copy(isUploading = true, uploadProgress = 0.1f, error = null)
            
            try {
                // Copy file from URI to temp file
                val tempFile = copyUriToTempFile(uri)
                
                if (tempFile == null) {
                    _state.value = _state.value.copy(
                        isUploading = false,
                        error = "Failed to read file"
                    )
                    return@launch
                }

                _state.value = _state.value.copy(uploadProgress = 0.3f)

                // Upload document
                documentRepository.uploadDocument(
                    file = tempFile,
                    title = title,
                    description = _state.value.description.ifBlank { null }
                ).onSuccess { response ->
                    _state.value = _state.value.copy(
                        isUploading = false,
                        uploadProgress = 1f,
                        uploadSuccess = true,
                        uploadedDocumentId = response.document?.id
                    )
                    // Clean up temp file
                    tempFile.delete()
                }.onFailure { e ->
                    _state.value = _state.value.copy(
                        isUploading = false,
                        error = e.message ?: "Upload failed"
                    )
                    tempFile.delete()
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    isUploading = false,
                    error = e.message ?: "Upload failed"
                )
            }
        }
    }

    private fun getFileName(uri: Uri): String? {
        var name: String? = null
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (cursor.moveToFirst() && nameIndex >= 0) {
                name = cursor.getString(nameIndex)
            }
        }
        return name
    }

    private fun copyUriToTempFile(uri: Uri): File? {
        return try {
            val inputStream = context.contentResolver.openInputStream(uri) ?: return null
            val tempFile = File.createTempFile("upload_", ".pdf", context.cacheDir)
            FileOutputStream(tempFile).use { output ->
                inputStream.copyTo(output)
            }
            inputStream.close()
            tempFile
        } catch (e: Exception) {
            null
        }
    }

    fun reset() {
        _state.value = UploadState()
    }
}
