package com.synergysign.app.presentation.history

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.synergysign.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.*

data class AuditEvent(
    val id: String,
    val type: AuditEventType,
    val documentId: String,
    val documentTitle: String,
    val actorName: String?,
    val actorEmail: String,
    val description: String,
    val timestamp: String,
    val ipAddress: String? = null,
    val metadata: Map<String, String> = emptyMap()
)

enum class AuditEventType {
    DOCUMENT_CREATED,
    DOCUMENT_VIEWED,
    DOCUMENT_UPDATED,
    DOCUMENT_DELETED,
    SIGNER_ADDED,
    SIGNER_REMOVED,
    FIELD_ADDED,
    FIELD_SIGNED,
    DOCUMENT_SENT,
    DOCUMENT_COMPLETED,
    DOCUMENT_DECLINED,
    DOCUMENT_EXPIRED
}

data class AuditHistoryState(
    val events: List<AuditEvent> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val hasMore: Boolean = false
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuditHistoryScreen(
    state: AuditHistoryState,
    documentTitle: String?,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Column {
                        Text("Audit Trail")
                        if (documentTitle != null) {
                            Text(
                                text = documentTitle,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                state.isLoading && state.events.isEmpty() -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }

                state.events.isEmpty() -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            Icons.Default.History,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.outline
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "No Activity Yet",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = "Activity will appear here as events occur",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        items(state.events) { event ->
                            AuditEventItem(event = event)
                        }

                        if (state.hasMore) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (state.isLoading) {
                                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                    } else {
                                        TextButton(onClick = onLoadMore) {
                                            Text("Load More")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AuditEventItem(event: AuditEvent) {
    val eventInfo = getEventInfo(event.type)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
    ) {
        // Timeline indicator
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Surface(
                modifier = Modifier.size(40.dp),
                shape = CircleShape,
                color = eventInfo.color.copy(alpha = 0.1f)
            ) {
                Box(
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        eventInfo.icon,
                        contentDescription = null,
                        tint = eventInfo.color,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
            // Timeline line
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height(48.dp)
                    .clip(RoundedCornerShape(1.dp))
            ) {
                Divider(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.outlineVariant
                )
            }
        }

        Spacer(modifier = Modifier.width(16.dp))

        // Event details
        Column(
            modifier = Modifier.weight(1f)
        ) {
            Text(
                text = eventInfo.title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = event.description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(
                modifier = Modifier.padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = event.actorName ?: event.actorEmail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "•",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Text(
                    text = formatTimestamp(event.timestamp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
            if (event.ipAddress != null) {
                Text(
                    text = "IP: ${event.ipAddress}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}

private data class EventInfo(
    val title: String,
    val icon: ImageVector,
    val color: Color
)

private fun getEventInfo(type: AuditEventType): EventInfo {
    return when (type) {
        AuditEventType.DOCUMENT_CREATED -> EventInfo(
            "Document Created",
            Icons.Default.Add,
            Blue500
        )
        AuditEventType.DOCUMENT_VIEWED -> EventInfo(
            "Document Viewed",
            Icons.Default.Visibility,
            Color(0xFF6366F1)
        )
        AuditEventType.DOCUMENT_UPDATED -> EventInfo(
            "Document Updated",
            Icons.Default.Edit,
            Color(0xFFF59E0B)
        )
        AuditEventType.DOCUMENT_DELETED -> EventInfo(
            "Document Deleted",
            Icons.Default.Delete,
            Color(0xFFEF4444)
        )
        AuditEventType.SIGNER_ADDED -> EventInfo(
            "Signer Added",
            Icons.Default.PersonAdd,
            Color(0xFF10B981)
        )
        AuditEventType.SIGNER_REMOVED -> EventInfo(
            "Signer Removed",
            Icons.Default.PersonRemove,
            Color(0xFFF59E0B)
        )
        AuditEventType.FIELD_ADDED -> EventInfo(
            "Field Added",
            Icons.Default.AddBox,
            Color(0xFF8B5CF6)
        )
        AuditEventType.FIELD_SIGNED -> EventInfo(
            "Field Signed",
            Icons.Default.Draw,
            Color(0xFF10B981)
        )
        AuditEventType.DOCUMENT_SENT -> EventInfo(
            "Document Sent",
            Icons.Default.Send,
            Blue500
        )
        AuditEventType.DOCUMENT_COMPLETED -> EventInfo(
            "Document Completed",
            Icons.Default.CheckCircle,
            Color(0xFF10B981)
        )
        AuditEventType.DOCUMENT_DECLINED -> EventInfo(
            "Document Declined",
            Icons.Default.Cancel,
            Color(0xFFEF4444)
        )
        AuditEventType.DOCUMENT_EXPIRED -> EventInfo(
            "Document Expired",
            Icons.Default.Schedule,
            Color(0xFF6B7280)
        )
    }
}

private fun formatTimestamp(timestamp: String): String {
    return try {
        val inputFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        val now = Date()
        val date = inputFormat.parse(timestamp) ?: return timestamp
        
        val diff = now.time - date.time
        val minutes = diff / (1000 * 60)
        val hours = diff / (1000 * 60 * 60)
        val days = diff / (1000 * 60 * 60 * 24)
        
        when {
            minutes < 1 -> "Just now"
            minutes < 60 -> "$minutes min ago"
            hours < 24 -> "$hours hours ago"
            days < 7 -> "$days days ago"
            else -> {
                val outputFormat = SimpleDateFormat("MMM d, yyyy", Locale.getDefault())
                outputFormat.format(date)
            }
        }
    } catch (e: Exception) {
        timestamp
    }
}
