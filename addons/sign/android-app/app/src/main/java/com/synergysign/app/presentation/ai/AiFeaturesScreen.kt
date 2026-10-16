package com.synergysign.app.presentation.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * AI Features Screen
 * Document analysis, smart field detection, summarization, and classification
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiFeaturesScreen(
    documentId: String,
    viewModel: AiFeaturesViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onApplyFields: (List<SuggestedField>) -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    
    LaunchedEffect(documentId) {
        viewModel.analyzeDocument(documentId)
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AI Analysis") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        if (uiState.isAnalyzing) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Analyzing document with AI...", style = MaterialTheme.typography.bodyLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        uiState.analysisStep,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Document Classification
                item {
                    Text("Document Type", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                
                item {
                    ClassificationCard(
                        classification = uiState.classification,
                        confidence = uiState.classificationConfidence
                    )
                }
                
                // AI Summary
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("AI Summary", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                
                item {
                    SummaryCard(
                        summary = uiState.summary,
                        keyPoints = uiState.keyPoints
                    )
                }
                
                // Extracted Signers
                if (uiState.extractedSigners.isNotEmpty()) {
                    item {
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Detected Signers", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            TextButton(onClick = { viewModel.addAllSigners() }) {
                                Text("Add All")
                            }
                        }
                    }
                    
                    items(uiState.extractedSigners) { signer ->
                        ExtractedSignerCard(
                            signer = signer,
                            onAdd = { viewModel.addSigner(signer) }
                        )
                    }
                }
                
                // Smart Field Detection
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Suggested Fields", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        TextButton(onClick = { onApplyFields(uiState.suggestedFields) }) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Apply All")
                        }
                    }
                }
                
                if (uiState.suggestedFields.isEmpty()) {
                    item {
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(32.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Icon(
                                        Icons.Default.AutoFixHigh,
                                        contentDescription = null,
                                        modifier = Modifier.size(48.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Spacer(modifier = Modifier.height(8.dp))
                                    Text("No fields detected", style = MaterialTheme.typography.bodyLarge)
                                    Text(
                                        "Add fields manually",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                } else {
                    items(uiState.suggestedFields) { field ->
                        SuggestedFieldCard(
                            field = field,
                            onApply = { viewModel.applyField(field) },
                            onDismiss = { viewModel.dismissField(field) }
                        )
                    }
                }
                
                // Keywords
                if (uiState.keywords.isNotEmpty()) {
                    item {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Keywords", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    }
                    
                    item {
                        KeywordsChips(keywords = uiState.keywords)
                    }
                }
            }
        }
    }
}

@Composable
private fun ClassificationCard(
    classification: String,
    confidence: Float
) {
    val (icon, color) = when (classification.lowercase()) {
        "contract" -> Icons.Default.Handshake to Color(0xFF2196F3)
        "nda" -> Icons.Default.Security to Color(0xFF9C27B0)
        "invoice" -> Icons.Default.Receipt to Color(0xFF4CAF50)
        "agreement" -> Icons.Default.Description to Color(0xFFFF9800)
        "letter" -> Icons.Default.Email to Color(0xFF607D8B)
        else -> Icons.Default.Article to MaterialTheme.colorScheme.primary
    }
    
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(color.copy(alpha = 0.1f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(32.dp))
            }
            Spacer(modifier = Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = classification.replaceFirstChar { it.uppercase() },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(4.dp))
                LinearProgressIndicator(
                    progress = { confidence },
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp))
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "${(confidence * 100).toInt()}% confidence",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun SummaryCard(
    summary: String,
    keyPoints: List<String>
) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(summary, style = MaterialTheme.typography.bodyMedium)
            
            if (keyPoints.isNotEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                HorizontalDivider()
                Spacer(modifier = Modifier.height(12.dp))
                Text("Key Points", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
                keyPoints.forEach { point ->
                    Row(
                        modifier = Modifier.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = Color(0xFF4CAF50),
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(point, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun ExtractedSignerCard(
    signer: ExtractedSigner,
    onAdd: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(signer.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                if (signer.email != null) {
                    Text(signer.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (signer.role != null) {
                    Surface(
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = RoundedCornerShape(4.dp),
                        modifier = Modifier.padding(top = 4.dp)
                    ) {
                        Text(
                            signer.role,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                }
            }
            FilledTonalButton(onClick = onAdd) {
                Icon(Icons.Default.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("Add")
            }
        }
    }
}

@Composable
private fun SuggestedFieldCard(
    field: SuggestedField,
    onApply: () -> Unit,
    onDismiss: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = when (field.type) {
                    "SIGNATURE" -> Icons.Default.Draw
                    "INITIALS" -> Icons.Default.Abc
                    "DATE" -> Icons.Default.CalendarToday
                    "TEXT" -> Icons.Default.TextFields
                    "CHECKBOX" -> Icons.Default.CheckBox
                    else -> Icons.Default.Input
                },
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(field.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(
                    "Page ${field.pageNumber} • ${field.type}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Row {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Dismiss", tint = MaterialTheme.colorScheme.error)
                }
                IconButton(onClick = onApply) {
                    Icon(Icons.Default.Check, contentDescription = "Apply", tint = Color(0xFF4CAF50))
                }
            }
        }
    }
}

@Composable
private fun KeywordsChips(keywords: List<String>) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
        Column(modifier = Modifier.padding(12.dp)) {
            var rowIndex = 0
            var currentRow = mutableListOf<String>()
            
            keywords.chunked(4).forEach { chunk ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    chunk.forEach { keyword ->
                        SuggestionChip(
                            onClick = {},
                            label = { Text(keyword) }
                        )
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
            }
        }
    }
}

// Data classes
data class ExtractedSigner(
    val name: String,
    val email: String?,
    val role: String?
)

data class SuggestedField(
    val id: String,
    val type: String,
    val label: String,
    val pageNumber: Int,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double
)
