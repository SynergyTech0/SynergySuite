package com.synergysign.app.presentation.documents

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.model.Document
import com.synergysign.app.data.model.Pagination
import com.synergysign.app.data.repository.DocumentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DocumentListState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isLoadingMore: Boolean = false,
    val documents: List<Document> = emptyList(),
    val pagination: Pagination? = null,
    val selectedStatus: String? = null,
    val searchQuery: String? = null,
    val error: String? = null
)

@HiltViewModel
class DocumentListViewModel @Inject constructor(
    private val documentRepository: DocumentRepository
) : ViewModel() {

    private val _state = MutableStateFlow(DocumentListState())
    val state: StateFlow<DocumentListState> = _state.asStateFlow()

    init {
        loadDocuments()
    }

    fun loadDocuments(refresh: Boolean = false) {
        viewModelScope.launch {
            _state.value = _state.value.copy(
                isLoading = !refresh,
                isRefreshing = refresh,
                error = null
            )

            documentRepository.getDocuments(
                status = _state.value.selectedStatus,
                query = _state.value.searchQuery,
                page = 1,
                limit = 20
            ).onSuccess { response ->
                _state.value = _state.value.copy(
                    isLoading = false,
                    isRefreshing = false,
                    documents = response.documents,
                    pagination = response.pagination
                )
            }.onFailure { e ->
                _state.value = _state.value.copy(
                    isLoading = false,
                    isRefreshing = false,
                    error = e.message
                )
            }
        }
    }

    fun loadMore() {
        val pagination = _state.value.pagination ?: return
        if (pagination.page >= pagination.totalPages) return
        if (_state.value.isLoadingMore) return

        viewModelScope.launch {
            _state.value = _state.value.copy(isLoadingMore = true)

            documentRepository.getDocuments(
                status = _state.value.selectedStatus,
                query = _state.value.searchQuery,
                page = pagination.page + 1,
                limit = 20
            ).onSuccess { response ->
                _state.value = _state.value.copy(
                    isLoadingMore = false,
                    documents = _state.value.documents + response.documents,
                    pagination = response.pagination
                )
            }.onFailure { e ->
                _state.value = _state.value.copy(
                    isLoadingMore = false,
                    error = e.message
                )
            }
        }
    }

    fun setStatusFilter(status: String?) {
        _state.value = _state.value.copy(selectedStatus = status)
        loadDocuments()
    }

    fun setSearchQuery(query: String?) {
        _state.value = _state.value.copy(searchQuery = query)
        loadDocuments()
    }

    fun refresh() {
        loadDocuments(refresh = true)
    }
}
