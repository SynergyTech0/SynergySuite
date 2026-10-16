package com.synergysign.app.presentation.billing

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import java.text.SimpleDateFormat
import java.util.*

/**
 * Billing & Subscription Screen
 * Manage subscription plans, payment methods, and view invoices
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BillingScreen(
    viewModel: BillingViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Billing & Subscription") },
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
                // Current Plan
                item {
                    Text("Current Plan", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                
                item {
                    CurrentPlanCard(
                        subscription = uiState.subscription,
                        onManage = { viewModel.openCustomerPortal() }
                    )
                }
                
                // Available Plans
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Available Plans", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                
                items(uiState.plans) { plan ->
                    PlanCard(
                        plan = plan,
                        isCurrentPlan = plan.tier == uiState.subscription.tier,
                        onSelect = { viewModel.selectPlan(plan) }
                    )
                }
                
                // Payment Method
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Payment Method", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                
                item {
                    PaymentMethodCard(
                        paymentMethod = uiState.paymentMethod,
                        onUpdate = { viewModel.updatePaymentMethod() }
                    )
                }
                
                // Billing History
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Billing History", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        TextButton(onClick = { viewModel.viewAllInvoices() }) {
                            Text("View All")
                        }
                    }
                }
                
                items(uiState.invoices.take(5)) { invoice ->
                    InvoiceItem(invoice = invoice, onDownload = { viewModel.downloadInvoice(invoice) })
                }
            }
        }
    }
}

@Composable
private fun CurrentPlanCard(
    subscription: SubscriptionInfo,
    onManage: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = subscription.tier.uppercase(),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Text(
                        text = subscription.status,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                    )
                }
                FilledTonalButton(onClick = onManage) {
                    Text("Manage")
                }
            }
            
            if (subscription.currentPeriodEnd != null) {
                Spacer(modifier = Modifier.height(12.dp))
                val dateFormat = remember { SimpleDateFormat("MMM d, yyyy", Locale.getDefault()) }
                Text(
                    text = "Renews on ${dateFormat.format(subscription.currentPeriodEnd)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
            }
            
            if (subscription.cancelAtPeriodEnd) {
                Spacer(modifier = Modifier.height(8.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(modifier = Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Subscription will be canceled at period end", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
private fun PlanCard(
    plan: PricingPlan,
    isCurrentPlan: Boolean,
    onSelect: () -> Unit
) {
    val borderColor = if (plan.isPopular) MaterialTheme.colorScheme.primary else Color.Transparent
    
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(if (plan.isPopular) 2.dp else 0.dp, borderColor, RoundedCornerShape(12.dp)),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(plan.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        if (plan.isPopular) {
                            Spacer(modifier = Modifier.width(8.dp))
                            Surface(
                                color = MaterialTheme.colorScheme.primary,
                                shape = RoundedCornerShape(4.dp)
                            ) {
                                Text("POPULAR", modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimary)
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            text = "$${plan.price}",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "/month",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                
                if (isCurrentPlan) {
                    OutlinedButton(onClick = {}, enabled = false) {
                        Text("Current Plan")
                    }
                } else {
                    Button(onClick = onSelect) {
                        Text(if (plan.price == 0) "Downgrade" else "Upgrade")
                    }
                }
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            
            plan.features.forEach { feature ->
                Row(
                    modifier = Modifier.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = if (feature.included) Icons.Default.Check else Icons.Default.Close,
                        contentDescription = null,
                        tint = if (feature.included) Color(0xFF4CAF50) else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = feature.name,
                        style = MaterialTheme.typography.bodyMedium,
                        textDecoration = if (!feature.included) TextDecoration.LineThrough else null,
                        color = if (feature.included) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun PaymentMethodCard(
    paymentMethod: PaymentMethod?,
    onUpdate: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (paymentMethod != null) {
                Icon(Icons.Default.CreditCard, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("${paymentMethod.brand} •••• ${paymentMethod.last4}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    Text("Expires ${paymentMethod.expMonth}/${paymentMethod.expYear}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = onUpdate) { Text("Update") }
            } else {
                Icon(Icons.Default.AddCard, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(32.dp))
                Spacer(modifier = Modifier.width(12.dp))
                Text("No payment method", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Button(onClick = onUpdate) { Text("Add") }
            }
        }
    }
}

@Composable
private fun InvoiceItem(
    invoice: Invoice,
    onDownload: () -> Unit
) {
    val dateFormat = remember { SimpleDateFormat("MMM d, yyyy", Locale.getDefault()) }
    
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Receipt, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(invoice.description, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(dateFormat.format(invoice.date), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("$${String.format("%.2f", invoice.amount)}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Spacer(modifier = Modifier.width(8.dp))
            Surface(
                color = if (invoice.paid) Color(0xFF4CAF50).copy(alpha = 0.1f) else MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(4.dp)
            ) {
                Text(
                    text = if (invoice.paid) "Paid" else "Pending",
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (invoice.paid) Color(0xFF4CAF50) else MaterialTheme.colorScheme.error
                )
            }
            IconButton(onClick = onDownload) {
                Icon(Icons.Default.Download, contentDescription = "Download")
            }
        }
    }
}

// Data classes
data class SubscriptionInfo(
    val tier: String = "FREE",
    val status: String = "Active",
    val currentPeriodEnd: Date? = null,
    val cancelAtPeriodEnd: Boolean = false
)

data class PricingPlan(
    val id: String,
    val name: String,
    val tier: String,
    val price: Int,
    val isPopular: Boolean = false,
    val features: List<PlanFeature>
)

data class PlanFeature(
    val name: String,
    val included: Boolean = true
)

data class PaymentMethod(
    val brand: String,
    val last4: String,
    val expMonth: Int,
    val expYear: Int
)

data class Invoice(
    val id: String,
    val description: String,
    val amount: Double,
    val date: Date,
    val paid: Boolean,
    val pdfUrl: String? = null
)
