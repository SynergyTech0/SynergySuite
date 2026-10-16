package com.synergysign.app.presentation.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.AnalyticsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.*
import javax.inject.Inject

@HiltViewModel
class AnalyticsViewModel @Inject constructor(
    private val analyticsRepository: AnalyticsRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(AnalyticsUiState())
    val uiState: StateFlow<AnalyticsUiState> = _uiState.asStateFlow()
    
    init {
        loadAnalytics()
    }
    
    fun setPeriod(period: TimePeriod) {
        _uiState.update { it.copy(selectedPeriod = period) }
        loadAnalytics()
    }
    
    private fun loadAnalytics() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            
            try {
                val period = _uiState.value.selectedPeriod
                val analytics = analyticsRepository.getAnalytics(period.days)
                
                _uiState.update { state ->
                    state.copy(
                        isLoading = false,
                        totalDocuments = analytics.totalDocuments,
                        totalSignatures = analytics.totalSignatures,
                        completionRate = analytics.completionRate,
                        avgTurnaroundDays = analytics.avgTurnaroundDays,
                        documentsChange = analytics.documentsChange,
                        signaturesChange = analytics.signaturesChange,
                        completionRateChange = analytics.completionRateChange,
                        turnaroundChange = analytics.turnaroundChange,
                        draftCount = analytics.draftCount,
                        sentCount = analytics.sentCount,
                        completedCount = analytics.completedCount,
                        declinedCount = analytics.declinedCount,
                        activityData = analytics.activityData,
                        recentActivity = analytics.recentActivity
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }
}

data class AnalyticsUiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val selectedPeriod: TimePeriod = TimePeriod.LAST_30_DAYS,
    val totalDocuments: Int = 0,
    val totalSignatures: Int = 0,
    val completionRate: Int = 0,
    val avgTurnaroundDays: Int = 0,
    val documentsChange: Float = 0f,
    val signaturesChange: Float = 0f,
    val completionRateChange: Float = 0f,
    val turnaroundChange: Float = 0f,
    val draftCount: Int = 0,
    val sentCount: Int = 0,
    val completedCount: Int = 0,
    val declinedCount: Int = 0,
    val activityData: List<ActivityDataPoint> = emptyList(),
    val recentActivity: List<RecentActivity> = emptyList()
)
