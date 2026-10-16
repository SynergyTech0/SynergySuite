package com.synergysign.app.presentation.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Settings Screen
 * Notification preferences, default signature, timezone, appearance
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onNavigateToProfile: () -> Unit,
    onNavigateToBilling: () -> Unit,
    onNavigateToBiometric: () -> Unit,
    onLogout: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var showTimezoneDialog by remember { mutableStateOf(false) }
    var showSignatureDialog by remember { mutableStateOf(false) }
    var showLogoutDialog by remember { mutableStateOf(false) }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Account Section
            item {
                Text("Account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.Person,
                    title = "Profile",
                    subtitle = "Edit your personal information",
                    onClick = onNavigateToProfile
                )
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.CreditCard,
                    title = "Billing & Subscription",
                    subtitle = "Manage your plan and payment methods",
                    onClick = onNavigateToBilling
                )
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.Fingerprint,
                    title = "Biometric Login",
                    subtitle = if (uiState.biometricEnabled) "Enabled" else "Disabled",
                    onClick = onNavigateToBiometric
                )
            }
            
            // Notifications Section
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Text("Notifications", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            item {
                SettingsSwitchItem(
                    icon = Icons.Default.Email,
                    title = "Email Notifications",
                    subtitle = "Document updates and reminders",
                    checked = uiState.emailNotifications,
                    onCheckedChange = { viewModel.setEmailNotifications(it) }
                )
            }
            
            item {
                SettingsSwitchItem(
                    icon = Icons.Default.Notifications,
                    title = "Push Notifications",
                    subtitle = "Real-time alerts on your device",
                    checked = uiState.pushNotifications,
                    onCheckedChange = { viewModel.setPushNotifications(it) }
                )
            }
            
            item {
                SettingsSwitchItem(
                    icon = Icons.Default.Schedule,
                    title = "Deadline Reminders",
                    subtitle = "Notify before document deadlines",
                    checked = uiState.deadlineReminders,
                    onCheckedChange = { viewModel.setDeadlineReminders(it) }
                )
            }
            
            // Preferences Section
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Text("Preferences", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.Draw,
                    title = "Default Signature",
                    subtitle = uiState.defaultSignature ?: "Not set",
                    onClick = { showSignatureDialog = true }
                )
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.Schedule,
                    title = "Timezone",
                    subtitle = uiState.timezone,
                    onClick = { showTimezoneDialog = true }
                )
            }
            
            // Appearance Section
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Text("Appearance", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.DarkMode,
                    title = "Theme",
                    subtitle = uiState.theme.displayName,
                    onClick = { viewModel.cycleTheme() }
                )
            }
            
            // Storage Section
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Text("Storage", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.Storage,
                    title = "Clear Cache",
                    subtitle = "Free up ${uiState.cacheSize}",
                    onClick = { viewModel.clearCache() }
                )
            }
            
            item {
                SettingsSwitchItem(
                    icon = Icons.Default.OfflinePin,
                    title = "Offline Mode",
                    subtitle = "Download documents for offline access",
                    checked = uiState.offlineMode,
                    onCheckedChange = { viewModel.setOfflineMode(it) }
                )
            }
            
            // About Section
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Text("About", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.Info,
                    title = "App Version",
                    subtitle = uiState.appVersion,
                    onClick = {}
                )
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.Description,
                    title = "Terms of Service",
                    subtitle = "View our terms",
                    onClick = { viewModel.openTerms() }
                )
            }
            
            item {
                SettingsItem(
                    icon = Icons.Default.PrivacyTip,
                    title = "Privacy Policy",
                    subtitle = "View our privacy policy",
                    onClick = { viewModel.openPrivacy() }
                )
            }
            
            // Logout
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                    onClick = { showLogoutDialog = true }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Logout,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            "Log Out",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        }
    }
    
    if (showTimezoneDialog) {
        TimezonePickerDialog(
            currentTimezone = uiState.timezone,
            onDismiss = { showTimezoneDialog = false },
            onSelect = {
                viewModel.setTimezone(it)
                showTimezoneDialog = false
            }
        )
    }
    
    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            icon = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null) },
            title = { Text("Log Out?") },
            text = { Text("Are you sure you want to log out of your account?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLogoutDialog = false
                        onLogout()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text("Log Out") }
            },
            dismissButton = { TextButton(onClick = { showLogoutDialog = false }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun SettingsItem(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        onClick = onClick
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SettingsSwitchItem(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = checked, onCheckedChange = onCheckedChange)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimezonePickerDialog(
    currentTimezone: String,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit
) {
    val timezones = listOf(
        "America/New_York" to "Eastern Time (ET)",
        "America/Chicago" to "Central Time (CT)",
        "America/Denver" to "Mountain Time (MT)",
        "America/Los_Angeles" to "Pacific Time (PT)",
        "America/Phoenix" to "Arizona (AZ)",
        "Pacific/Honolulu" to "Hawaii (HT)",
        "America/Anchorage" to "Alaska (AKT)",
        "Europe/London" to "London (GMT)",
        "Europe/Paris" to "Paris (CET)",
        "Asia/Tokyo" to "Tokyo (JST)",
        "Asia/Shanghai" to "Beijing (CST)",
        "Australia/Sydney" to "Sydney (AEST)"
    )
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Select Timezone") },
        text = {
            LazyColumn {
                items(timezones.size) { index ->
                    val (id, name) = timezones[index]
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(id) }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = id == currentTimezone,
                            onClick = { onSelect(id) }
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(name)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

enum class AppTheme(val displayName: String) {
    SYSTEM("System Default"),
    LIGHT("Light"),
    DARK("Dark")
}
