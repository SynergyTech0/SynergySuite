package com.synergysign.app.presentation.viewer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.model.DocumentDetail
import com.synergysign.app.data.model.DocumentField
import com.synergysign.app.data.repository.DocumentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.net.URL
import javax.inject.Inject

data class PdfViewerState(
    val documentId: String? = null,
    val documentTitle: String? = null,
    val document: DocumentDetail? = null,
    val pages: List<Bitmap> = emptyList(),
    val pageCount: Int = 0,
    val currentPage: Int = 1,
    val fields: List<DocumentField> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class PdfViewerViewModel @Inject constructor(
    private val documentRepository: DocumentRepository,
    @ApplicationContext private val context: Context,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _state = MutableStateFlow(PdfViewerState())
    val state: StateFlow<PdfViewerState> = _state.asStateFlow()

    private var pdfRenderer: PdfRenderer? = null
    private var parcelFileDescriptor: ParcelFileDescriptor? = null

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

            // First, get document details
            documentRepository.getDocument(documentId)
                .onSuccess { document ->
                    _state.value = _state.value.copy(
                        document = document,
                        documentTitle = document.title,
                        fields = document.fields ?: emptyList()
                    )

                    // Get secure URL and download PDF
                    documentRepository.getSecureUrl(documentId)
                        .onSuccess { url ->
                            loadPdfFromUrl(url)
                        }
                        .onFailure { e ->
                            _state.value = _state.value.copy(
                                isLoading = false,
                                error = "Failed to get document URL: ${e.message}"
                            )
                        }
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = "Failed to load document: ${e.message}"
                    )
                }
        }
    }

    private suspend fun loadPdfFromUrl(url: String) {
        withContext(Dispatchers.IO) {
            try {
                // Download PDF to temp file
                val tempFile = File.createTempFile("pdf_", ".pdf", context.cacheDir)
                URL(url).openStream().use { input ->
                    FileOutputStream(tempFile).use { output ->
                        input.copyTo(output)
                    }
                }

                // Open PDF renderer
                parcelFileDescriptor = ParcelFileDescriptor.open(
                    tempFile,
                    ParcelFileDescriptor.MODE_READ_ONLY
                )
                
                val renderer = parcelFileDescriptor?.let { PdfRenderer(it) }
                if (renderer == null) {
                    withContext(Dispatchers.Main) {
                        _state.value = _state.value.copy(
                            isLoading = false,
                            error = "Failed to open PDF"
                        )
                    }
                    return@withContext
                }
                pdfRenderer = renderer

                val pageCount = renderer.pageCount
                val pages = mutableListOf<Bitmap>()

                // Render each page
                for (i in 0 until pageCount) {
                    val page = renderer.openPage(i)
                    
                    // Calculate scaled dimensions (2x for better quality)
                    val scale = 2f
                    val width = (page.width * scale).toInt()
                    val height = (page.height * scale).toInt()
                    
                    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    pages.add(bitmap)
                    page.close()
                }

                withContext(Dispatchers.Main) {
                    _state.value = _state.value.copy(
                        pages = pages,
                        pageCount = pageCount,
                        isLoading = false
                    )
                }

                // Clean up temp file
                tempFile.delete()

            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = "Failed to load PDF: ${e.message}"
                    )
                }
            }
        }
    }

    fun setCurrentPage(page: Int) {
        _state.value = _state.value.copy(currentPage = page)
    }

    override fun onCleared() {
        super.onCleared()
        pdfRenderer?.close()
        parcelFileDescriptor?.close()
    }
}
