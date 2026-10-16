package com.synergysign.app.data.repository

import com.synergysign.app.data.api.ApiService
import com.synergysign.app.presentation.analytics.ActivityDataPoint
import com.synergysign.app.presentation.analytics.ActivityType
import com.synergysign.app.presentation.analytics.RecentActivity
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AnalyticsRepository @Inject constructor(
    private val apiService: ApiService
) {
    suspend fun getAnalytics(days: Int): AnalyticsData {
        // In production, this would call the actual API
        // For now, return sample data structure
        val stats = apiService.getDashboardStats().body()
        
        return AnalyticsData(
            totalDocuments = stats?.totalDocuments ?: 0,
            totalSignatures = stats?.completedDocuments ?: 0,
            completionRate = if ((stats?.totalDocuments ?: 0) > 0) {
                ((stats?.completedDocuments ?: 0) * 100) / (stats?.totalDocuments ?: 1)
            } else 0,
            avgTurnaroundDays = 2,
            documentsChange = 12f,
            signaturesChange = 8f,
            completionRateChange = 5f,
            turnaroundChange = -10f,
            draftCount = stats?.totalDocuments?.minus(stats.pendingSignatures)?.minus(stats.completedDocuments) ?: 0,
            sentCount = stats?.pendingSignatures ?: 0,
            completedCount = stats?.completedDocuments ?: 0,
            declinedCount = 0,
            activityData = generateActivityData(days),
            recentActivity = emptyList()
        )
    }
    
    private fun generateActivityData(days: Int): List<ActivityDataPoint> {
        val calendar = Calendar.getInstance()
        return (0 until minOf(days, 7)).map { i ->
            calendar.add(Calendar.DAY_OF_YEAR, -1)
            ActivityDataPoint(
                date = calendar.time,
                sent = (1..5).random(),
                completed = (0..3).random()
            )
        }.reversed()
    }
}

data class AnalyticsData(
    val totalDocuments: Int,
    val totalSignatures: Int,
    val completionRate: Int,
    val avgTurnaroundDays: Int,
    val documentsChange: Float,
    val signaturesChange: Float,
    val completionRateChange: Float,
    val turnaroundChange: Float,
    val draftCount: Int,
    val sentCount: Int,
    val completedCount: Int,
    val declinedCount: Int,
    val activityData: List<ActivityDataPoint>,
    val recentActivity: List<RecentActivity>
)
