package com.synergysign.app.presentation.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.model.DashboardStats
import com.synergysign.app.data.model.Document
import com.synergysign.app.data.repository.DocumentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val stats: DashboardStats? = null,
    val recentDocuments: List<Document> = emptyList(),
    val error: String? = null
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val documentRepository: DocumentRepository
) : ViewModel() {

    private val _state = MutableStateFlow(DashboardState())
    val state: StateFlow<DashboardState> = _state.asStateFlow()

    init {
        loadDashboard()
    }

    fun loadDashboard() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            
            // Load stats
            documentRepository.getDashboardStats()
                .onSuccess { stats ->
                    _state.value = _state.value.copy(stats = stats)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(error = e.message)
                }
            
            // Load recent documents
            documentRepository.getDocuments(limit = 5)
                .onSuccess { response ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        recentDocuments = response.documents
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isRefreshing = true)
            loadDashboard()
            _state.value = _state.value.copy(isRefreshing = false)
        }
    }
}
