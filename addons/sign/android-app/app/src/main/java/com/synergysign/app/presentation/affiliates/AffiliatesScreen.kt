package com.synergysign.app.presentation.affiliates

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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import java.text.SimpleDateFormat
import java.util.*

/**
 * Affiliate Dashboard Screen
 * Track referrals, earnings, and request payouts
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AffiliatesScreen(
    viewModel: AffiliatesViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val clipboardManager = LocalClipboardManager.current
    var showPayoutDialog by remember { mutableStateOf(false) }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Affiliate Program") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        if (uiState.isLoading) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Referral Link
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text("Your Referral Link", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Spacer(modifier = Modifier.height(8.dp))
                            
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = uiState.referralLink,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.weight(1f)
                                )
                                IconButton(onClick = {
                                    clipboardManager.setText(AnnotatedString(uiState.referralLink))
                                }) {
                                    Icon(Icons.Default.ContentCopy, contentDescription = "Copy")
                                }
                            }
                            
                            Spacer(modifier = Modifier.height(12.dp))
                            
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(
                                    onClick = { viewModel.shareLink() },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Share")
                                }
                                OutlinedButton(
                                    onClick = { viewModel.shareQrCode() },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Icon(Icons.Default.QrCode, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("QR Code")
                                }
                            }
                        }
                    }
                }
                
                // Earnings Summary
                item {
                    Text("Earnings", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        EarningsCard(
                            modifier = Modifier.weight(1f),
                            title = "Total Earnings",
                            amount = uiState.totalEarnings,
                            icon = Icons.Default.AttachMoney,
                            color = Color(0xFF4CAF50)
                        )
                        EarningsCard(
                            modifier = Modifier.weight(1f),
                            title = "Pending",
                            amount = uiState.pendingEarnings,
                            icon = Icons.Default.Schedule,
                            color = Color(0xFFFF9800)
                        )
                    }
                }
                
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        EarningsCard(
                            modifier = Modifier.weight(1f),
                            title = "This Month",
                            amount = uiState.thisMonthEarnings,
                            icon = Icons.Default.CalendarMonth,
                            color = Color(0xFF2196F3)
                        )
                        EarningsCard(
                            modifier = Modifier.weight(1f),
                            title = "Referrals",
                            amount = uiState.totalReferrals.toDouble(),
                            icon = Icons.Default.People,
                            color = Color(0xFF9C27B0),
                            isCount = true
                        )
                    }
                }
                
                // Request Payout
                if (uiState.pendingEarnings >= 50.0) {
                    item {
                        Button(
                            onClick = { showPayoutDialog = true },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.AccountBalance, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Request Payout")
                        }
                    }
                }
                
                // Referral History
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Referral History", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                
                if (uiState.referrals.isEmpty()) {
                    item {
                        Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(32.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Icon(
                                        Icons.Default.PersonAdd,
                                        contentDescription = null,
                                        modifier = Modifier.size(48.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Spacer(modifier = Modifier.height(8.dp))
                                    Text("No referrals yet", style = MaterialTheme.typography.bodyLarge)
                                    Text(
                                        "Share your link to start earning",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                } else {
                    items(uiState.referrals) { referral ->
                        ReferralItem(referral = referral)
                    }
                }
                
                // Payout History
                if (uiState.payouts.isNotEmpty()) {
                    item {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Payout History", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    }
                    
                    items(uiState.payouts) { payout ->
                        PayoutItem(payout = payout)
                    }
                }
            }
        }
    }
    
    if (showPayoutDialog) {
        PayoutRequestDialog(
            pendingAmount = uiState.pendingEarnings,
            payoutMethod = uiState.payoutMethod,
            payoutEmail = uiState.payoutEmail,
            onDismiss = { showPayoutDialog = false },
            onConfirm = { method, email ->
                viewModel.requestPayout(method, email)
                showPayoutDialog = false
            }
        )
    }
}

@Composable
private fun EarningsCard(
    modifier: Modifier = Modifier,
    title: String,
    amount: Double,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    color: Color,
    isCount: Boolean = false
) {
    Card(modifier = modifier, shape = RoundedCornerShape(12.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(24.dp))
                Spacer(modifier = Modifier.weight(1f))
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = if (isCount) amount.toInt().toString() else "$${String.format("%.2f", amount)}",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = title,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ReferralItem(referral: Referral) {
    val dateFormat = remember { SimpleDateFormat("MMM d, yyyy", Locale.getDefault()) }
    
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = referral.name.take(1).uppercase(),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(referral.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(dateFormat.format(referral.joinedAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = "+$${String.format("%.2f", referral.earning)}",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF4CAF50)
                )
                Surface(
                    color = when (referral.status) {
                        "active" -> Color(0xFF4CAF50).copy(alpha = 0.1f)
                        "trial" -> Color(0xFFFF9800).copy(alpha = 0.1f)
                        else -> MaterialTheme.colorScheme.surfaceVariant
                    },
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text(
                        text = referral.status.replaceFirstChar { it.uppercase() },
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = when (referral.status) {
                            "active" -> Color(0xFF4CAF50)
                            "trial" -> Color(0xFFFF9800)
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun PayoutItem(payout: Payout) {
    val dateFormat = remember { SimpleDateFormat("MMM d, yyyy", Locale.getDefault()) }
    
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = when (payout.status) {
                    "completed" -> Icons.Default.CheckCircle
                    "pending" -> Icons.Default.Schedule
                    "processing" -> Icons.Default.Sync
                    else -> Icons.Default.Error
                },
                contentDescription = null,
                tint = when (payout.status) {
                    "completed" -> Color(0xFF4CAF50)
                    "pending" -> Color(0xFFFF9800)
                    "processing" -> Color(0xFF2196F3)
                    else -> MaterialTheme.colorScheme.error
                }
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("${payout.method} Payout", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(dateFormat.format(payout.requestedAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                text = "$${String.format("%.2f", payout.amount)}",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun PayoutRequestDialog(
    pendingAmount: Double,
    payoutMethod: String?,
    payoutEmail: String?,
    onDismiss: () -> Unit,
    onConfirm: (method: String, email: String) -> Unit
) {
    var method by remember { mutableStateOf(payoutMethod ?: "paypal") }
    var email by remember { mutableStateOf(payoutEmail ?: "") }
    var expanded by remember { mutableStateOf(false) }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Request Payout") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Available for payout: $${String.format("%.2f", pendingAmount)}")
                
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it }
                ) {
                    OutlinedTextField(
                        value = method.replaceFirstChar { it.uppercase() },
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Payout Method") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                        modifier = Modifier.menuAnchor().fillMaxWidth()
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        listOf("paypal", "bank_transfer", "venmo").forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option.replace("_", " ").replaceFirstChar { it.uppercase() }) },
                                onClick = {
                                    method = option
                                    expanded = false
                                }
                            )
                        }
                    }
                }
                
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Payout Email") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(method, email) },
                enabled = email.isNotBlank() && email.contains("@")
            ) {
                Text("Request")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

// Data classes
data class Referral(
    val id: String,
    val name: String,
    val email: String,
    val joinedAt: Date,
    val status: String,
    val earning: Double
)

data class Payout(
    val id: String,
    val amount: Double,
    val method: String,
    val status: String,
    val requestedAt: Date,
    val processedAt: Date? = null
)
