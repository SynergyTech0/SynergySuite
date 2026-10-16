package com.synergysign.app.presentation.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import java.text.SimpleDateFormat
import java.util.*

/**
 * Analytics Dashboard Screen
 * Shows charts and metrics for document activity
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsScreen(
    viewModel: AnalyticsViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Analytics") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    var expanded by remember { mutableStateOf(false) }
                    TextButton(onClick = { expanded = true }) {
                        Text(uiState.selectedPeriod.displayName)
                        Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                    }
                    DropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        TimePeriod.entries.forEach { period ->
                            DropdownMenuItem(
                                text = { Text(period.displayName) },
                                onClick = {
                                    viewModel.setPeriod(period)
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            )
        }
    ) { padding ->
        if (uiState.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    Text(
                        text = "Overview",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                }
                
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        StatCard(
                            modifier = Modifier.weight(1f),
                            title = "Documents",
                            value = uiState.totalDocuments.toString(),
                            change = uiState.documentsChange,
                            icon = Icons.Default.Description
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            title = "Signatures",
                            value = uiState.totalSignatures.toString(),
                            change = uiState.signaturesChange,
                            icon = Icons.Default.Draw
                        )
                    }
                }
                
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        StatCard(
                            modifier = Modifier.weight(1f),
                            title = "Completion Rate",
                            value = "${uiState.completionRate}%",
                            change = uiState.completionRateChange,
                            icon = Icons.Default.CheckCircle
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            title = "Avg. Turnaround",
                            value = "${uiState.avgTurnaroundDays}d",
                            change = uiState.turnaroundChange,
                            icon = Icons.Default.Schedule
                        )
                    }
                }
                
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Document Activity",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                }
                
                item {
                    DocumentActivityChart(
                        data = uiState.activityData,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp)
                    )
                }
                
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Status Breakdown",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                }
                
                item {
                    StatusBreakdownChart(
                        draft = uiState.draftCount,
                        sent = uiState.sentCount,
                        completed = uiState.completedCount,
                        declined = uiState.declinedCount,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp)
                    )
                }
                
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Recent Activity",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                }
                
                items(uiState.recentActivity) { activity ->
                    ActivityItem(activity = activity)
                }
            }
        }
    }
}

@Composable
private fun StatCard(
    modifier: Modifier = Modifier,
    title: String,
    value: String,
    change: Float,
    icon: ImageVector
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.weight(1f))
                if (change != 0f) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = if (change > 0) Icons.AutoMirrored.Filled.TrendingUp 
                                         else Icons.Default.TrendingDown,
                            contentDescription = null,
                            tint = if (change > 0) Color(0xFF4CAF50) else Color(0xFFF44336),
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "${if (change > 0) "+" else ""}${change.toInt()}%",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (change > 0) Color(0xFF4CAF50) else Color(0xFFF44336)
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = value,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun DocumentActivityChart(
    data: List<ActivityDataPoint>,
    modifier: Modifier = Modifier
) {
    Card(modifier = modifier, shape = RoundedCornerShape(12.dp)) {
        Box(modifier = Modifier.fillMaxSize().padding(16.dp)) {
            if (data.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No data available")
                }
            } else {
                val primaryColor = MaterialTheme.colorScheme.primary
                val secondaryColor = MaterialTheme.colorScheme.secondary
                
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val maxValue = data.maxOfOrNull { maxOf(it.sent, it.completed) } ?: 1
                    val stepX = size.width / (data.size - 1).coerceAtLeast(1)
                    val stepY = size.height / maxValue
                    
                    val sentPath = Path()
                    data.forEachIndexed { index, point ->
                        val x = index * stepX
                        val y = size.height - (point.sent * stepY)
                        if (index == 0) sentPath.moveTo(x, y) else sentPath.lineTo(x, y)
                    }
                    drawPath(sentPath, primaryColor, style = Stroke(width = 3f))
                    
                    val completedPath = Path()
                    data.forEachIndexed { index, point ->
                        val x = index * stepX
                        val y = size.height - (point.completed * stepY)
                        if (index == 0) completedPath.moveTo(x, y) else completedPath.lineTo(x, y)
                    }
                    drawPath(completedPath, secondaryColor, style = Stroke(width = 3f))
                    
                    data.forEachIndexed { index, point ->
                        val x = index * stepX
                        drawCircle(primaryColor, 6f, Offset(x, size.height - (point.sent * stepY)))
                        drawCircle(secondaryColor, 6f, Offset(x, size.height - (point.completed * stepY)))
                    }
                }
            }
            
            Row(
                modifier = Modifier.align(Alignment.TopEnd),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                LegendItem(color = MaterialTheme.colorScheme.primary, label = "Sent")
                LegendItem(color = MaterialTheme.colorScheme.secondary, label = "Completed")
            }
        }
    }
}

@Composable
private fun LegendItem(color: Color, label: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Box(modifier = Modifier.size(12.dp).background(color, RoundedCornerShape(2.dp)))
        Text(text = label, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun StatusBreakdownChart(
    draft: Int,
    sent: Int,
    completed: Int,
    declined: Int,
    modifier: Modifier = Modifier
) {
    Card(modifier = modifier, shape = RoundedCornerShape(12.dp)) {
        Row(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            val total = (draft + sent + completed + declined).coerceAtLeast(1)
            
            Box(modifier = Modifier.size(150.dp), contentAlignment = Alignment.Center) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    var startAngle = -90f
                    val segments = listOf(
                        draft to Color(0xFF9E9E9E),
                        sent to Color(0xFF2196F3),
                        completed to Color(0xFF4CAF50),
                        declined to Color(0xFFF44336)
                    )
                    
                    segments.forEach { (value, color) ->
                        val sweepAngle = (value.toFloat() / total) * 360f
                        drawArc(
                            color = color,
                            startAngle = startAngle,
                            sweepAngle = sweepAngle,
                            useCenter = true,
                            size = Size(size.minDimension, size.minDimension),
                            topLeft = Offset(
                                (size.width - size.minDimension) / 2,
                                (size.height - size.minDimension) / 2
                            )
                        )
                        startAngle += sweepAngle
                    }
                }
                
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = total.toString(),
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(text = "Total", style = MaterialTheme.typography.bodySmall)
                }
            }
            
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusLegendItem("Draft", draft, Color(0xFF9E9E9E))
                StatusLegendItem("Sent", sent, Color(0xFF2196F3))
                StatusLegendItem("Completed", completed, Color(0xFF4CAF50))
                StatusLegendItem("Declined", declined, Color(0xFFF44336))
            }
        }
    }
}

@Composable
private fun StatusLegendItem(label: String, count: Int, color: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Box(modifier = Modifier.size(16.dp).background(color, RoundedCornerShape(4.dp)))
        Text(text = "$label: $count", style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ActivityItem(activity: RecentActivity) {
    val dateFormat = remember { SimpleDateFormat("MMM d, h:mm a", Locale.getDefault()) }
    
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp)) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = when (activity.type) {
                    ActivityType.DOCUMENT_CREATED -> Icons.Default.Add
                    ActivityType.DOCUMENT_SENT -> Icons.Default.Send
                    ActivityType.DOCUMENT_SIGNED -> Icons.Default.Draw
                    ActivityType.DOCUMENT_COMPLETED -> Icons.Default.CheckCircle
                    ActivityType.DOCUMENT_DECLINED -> Icons.Default.Cancel
                },
                contentDescription = null,
                tint = when (activity.type) {
                    ActivityType.DOCUMENT_CREATED -> Color(0xFF9E9E9E)
                    ActivityType.DOCUMENT_SENT -> Color(0xFF2196F3)
                    ActivityType.DOCUMENT_SIGNED -> Color(0xFF9C27B0)
                    ActivityType.DOCUMENT_COMPLETED -> Color(0xFF4CAF50)
                    ActivityType.DOCUMENT_DECLINED -> Color(0xFFF44336)
                },
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = activity.title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = activity.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                text = dateFormat.format(activity.timestamp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

enum class TimePeriod(val displayName: String, val days: Int) {
    LAST_7_DAYS("Last 7 days", 7),
    LAST_30_DAYS("Last 30 days", 30),
    LAST_90_DAYS("Last 90 days", 90),
    THIS_YEAR("This year", 365)
}

data class ActivityDataPoint(val date: Date, val sent: Int, val completed: Int)

enum class ActivityType {
    DOCUMENT_CREATED, DOCUMENT_SENT, DOCUMENT_SIGNED, DOCUMENT_COMPLETED, DOCUMENT_DECLINED
}

data class RecentActivity(
    val id: String,
    val type: ActivityType,
    val title: String,
    val description: String,
    val timestamp: Date
)
