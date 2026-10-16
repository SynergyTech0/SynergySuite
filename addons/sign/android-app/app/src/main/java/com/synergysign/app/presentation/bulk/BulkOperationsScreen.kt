package com.synergysign.app.presentation.bulk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Bulk Operations Screen
 * Send multiple documents at once, bulk actions
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BulkOperationsScreen(
    viewModel: BulkOperationsViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onSelectDocuments: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var showSignersDialog by remember { mutableStateOf(false) }
    var showConfirmDialog by remember { mutableStateOf(false) }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Bulk Send") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        floatingActionButton = {
            if (uiState.selectedDocuments.isNotEmpty() && uiState.signers.isNotEmpty()) {
                ExtendedFloatingActionButton(
                    onClick = { showConfirmDialog = true },
                    icon = { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null) },
                    text = { Text("Send ${uiState.selectedDocuments.size} Documents") }
                )
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Step 1: Select Documents
            item {
                StepHeader(
                    stepNumber = 1,
                    title = "Select Documents",
                    isCompleted = uiState.selectedDocuments.isNotEmpty()
                )
            }
            
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    onClick = onSelectDocuments
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Description,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                if (uiState.selectedDocuments.isEmpty()) "Choose documents to send"
                                else "${uiState.selectedDocuments.size} documents selected",
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium
                            )
                            Text(
                                "Select from your draft documents",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Icon(Icons.Default.ChevronRight, contentDescription = null)
                    }
                }
            }
            
            if (uiState.selectedDocuments.isNotEmpty()) {
                items(uiState.selectedDocuments) { doc ->
                    SelectedDocumentItem(
                        document = doc,
                        onRemove = { viewModel.removeDocument(doc) }
                    )
                }
            }
            
            // Step 2: Add Signers
            item {
                Spacer(modifier = Modifier.height(8.dp))
                StepHeader(
                    stepNumber = 2,
                    title = "Add Signers",
                    isCompleted = uiState.signers.isNotEmpty()
                )
            }
            
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    onClick = { showSignersDialog = true }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.PersonAdd,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                if (uiState.signers.isEmpty()) "Add signers"
                                else "${uiState.signers.size} signers added",
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium
                            )
                            Text(
                                "Same signers will receive all documents",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Icon(Icons.Default.ChevronRight, contentDescription = null)
                    }
                }
            }
            
            if (uiState.signers.isNotEmpty()) {
                items(uiState.signers) { signer ->
                    SignerItem(
                        signer = signer,
                        onRemove = { viewModel.removeSigner(signer) }
                    )
                }
            }
            
            // Step 3: Options
            item {
                Spacer(modifier = Modifier.height(8.dp))
                StepHeader(
                    stepNumber = 3,
                    title = "Options",
                    isCompleted = true
                )
            }
            
            item {
                Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("Send Email Notifications", style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    "Notify signers via email",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Switch(
                                checked = uiState.sendNotifications,
                                onCheckedChange = { viewModel.setSendNotifications(it) }
                            )
                        }
                        
                        HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
                        
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("Set Deadline", style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    uiState.deadline ?: "No deadline",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            TextButton(onClick = { viewModel.showDeadlinePicker() }) {
                                Text("Set")
                            }
                        }
                        
                        HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
                        
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("Signing Order", style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    if (uiState.sequentialSigning) "Sequential" else "Parallel",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Switch(
                                checked = uiState.sequentialSigning,
                                onCheckedChange = { viewModel.setSequentialSigning(it) }
                            )
                        }
                    }
                }
            }
            
            // Progress (when sending)
            if (uiState.isSending) {
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    SendingProgressCard(
                        total = uiState.selectedDocuments.size,
                        completed = uiState.sentCount,
                        failed = uiState.failedCount,
                        currentDocument = uiState.currentSendingDocument
                    )
                }
            }
            
            // Results
            if (uiState.sendComplete) {
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    ResultsCard(
                        sentCount = uiState.sentCount,
                        failedCount = uiState.failedCount,
                        onDone = onNavigateBack
                    )
                }
            }
        }
    }
    
    if (showSignersDialog) {
        AddSignersDialog(
            onDismiss = { showSignersDialog = false },
            onAdd = { name, email ->
                viewModel.addSigner(name, email)
                showSignersDialog = false
            }
        )
    }
    
    if (showConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showConfirmDialog = false },
            icon = { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null) },
            title = { Text("Confirm Bulk Send") },
            text = {
                Text(
                    "You are about to send ${uiState.selectedDocuments.size} documents to ${uiState.signers.size} signers. This action cannot be undone."
                )
            },
            confirmButton = {
                Button(onClick = {
                    showConfirmDialog = false
                    viewModel.sendAll()
                }) { Text("Send All") }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmDialog = false }) { Text("Cancel") }
            }
        )
    }
}

@Composable
private fun StepHeader(
    stepNumber: Int,
    title: String,
    isCompleted: Boolean
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(
                    if (isCompleted) Color(0xFF4CAF50)
                    else MaterialTheme.colorScheme.primaryContainer
                ),
            contentAlignment = Alignment.Center
        ) {
            if (isCompleted) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp)
                )
            } else {
                Text(
                    stepNumber.toString(),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun SelectedDocumentItem(
    document: BulkDocument,
    onRemove: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Description, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(document.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(
                    "${document.pageCount} pages",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            IconButton(onClick = onRemove) {
                Icon(Icons.Default.Close, contentDescription = "Remove", tint = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun SignerItem(
    signer: BulkSigner,
    onRemove: () -> Unit
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
                Text(signer.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onRemove) {
                Icon(Icons.Default.Close, contentDescription = "Remove", tint = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun SendingProgressCard(
    total: Int,
    completed: Int,
    failed: Int,
    currentDocument: String?
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
                Spacer(modifier = Modifier.width(12.dp))
                Text("Sending documents...", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(12.dp))
            LinearProgressIndicator(
                progress = { (completed + failed).toFloat() / total },
                modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp))
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "${completed + failed} of $total documents processed",
                style = MaterialTheme.typography.bodySmall
            )
            if (currentDocument != null) {
                Text(
                    "Currently sending: $currentDocument",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
            }
        }
    }
}

@Composable
private fun ResultsCard(
    sentCount: Int,
    failedCount: Int,
    onDone: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (failedCount == 0) Color(0xFF4CAF50).copy(alpha = 0.1f)
                            else MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                if (failedCount == 0) Icons.Default.CheckCircle else Icons.Default.Warning,
                contentDescription = null,
                tint = if (failedCount == 0) Color(0xFF4CAF50) else MaterialTheme.colorScheme.error,
                modifier = Modifier.size(48.dp)
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                if (failedCount == 0) "All documents sent successfully!"
                else "$sentCount sent, $failedCount failed",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(onClick = onDone) {
                Text("Done")
            }
        }
    }
}

@Composable
private fun AddSignersDialog(
    onDismiss: () -> Unit,
    onAdd: (name: String, email: String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Signer") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onAdd(name, email) },
                enabled = name.isNotBlank() && email.contains("@")
            ) { Text("Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

// Data classes
data class BulkDocument(
    val id: String,
    val title: String,
    val pageCount: Int
)

data class BulkSigner(
    val id: String,
    val name: String,
    val email: String
)
