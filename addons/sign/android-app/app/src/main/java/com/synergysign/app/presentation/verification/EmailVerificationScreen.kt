package com.synergysign.app.presentation.verification

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.synergysign.app.presentation.theme.Blue500

data class EmailVerificationState(
    val email: String = "",
    val isLoading: Boolean = false,
    val isVerified: Boolean = false,
    val error: String? = null,
    val resendCooldown: Int = 0
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmailVerificationScreen(
    state: EmailVerificationState,
    onVerifyCode: (String) -> Unit,
    onResendCode: () -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit
) {
    var code by remember { mutableStateOf("") }
    val focusRequesters = remember { List(6) { FocusRequester() } }
    var codeDigits by remember { mutableStateOf(List(6) { "" }) }

    // Show error dialog
    if (state.error != null) {
        AlertDialog(
            onDismissRequest = { },
            title = { Text("Verification Failed") },
            text = { Text(state.error) },
            confirmButton = {
                TextButton(onClick = { }) {
                    Text("OK")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Verify Email") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(32.dp))

            if (state.isVerified) {
                // Success state
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(80.dp),
                    tint = Blue500
                )
                
                Spacer(modifier = Modifier.height(24.dp))
                
                Text(
                    text = "Email Verified!",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold
                )
                
                Spacer(modifier = Modifier.height(8.dp))
                
                Text(
                    text = "Your email has been successfully verified. You can now access all features.",
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                
                Spacer(modifier = Modifier.weight(1f))
                
                Button(
                    onClick = onContinue,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Continue to Dashboard")
                }
            } else {
                // Verification code entry
                Icon(
                    Icons.Default.Email,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = Blue500
                )
                
                Spacer(modifier = Modifier.height(24.dp))
                
                Text(
                    text = "Check Your Email",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold
                )
                
                Spacer(modifier = Modifier.height(8.dp))
                
                Text(
                    text = "We sent a verification code to",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                
                Text(
                    text = state.email,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium
                )
                
                Spacer(modifier = Modifier.height(32.dp))
                
                // Code input boxes
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    codeDigits.forEachIndexed { index, digit ->
                        OutlinedTextField(
                            value = digit,
                            onValueChange = { newValue ->
                                if (newValue.length <= 1 && newValue.all { it.isDigit() }) {
                                    val newDigits = codeDigits.toMutableList()
                                    newDigits[index] = newValue
                                    codeDigits = newDigits
                                    code = newDigits.joinToString("")
                                    
                                    // Auto-focus next field
                                    if (newValue.isNotEmpty() && index < 5) {
                                        focusRequesters[index + 1].requestFocus()
                                    }
                                    
                                    // Auto-submit when complete
                                    if (newDigits.all { it.isNotEmpty() }) {
                                        onVerifyCode(newDigits.joinToString(""))
                                    }
                                }
                            },
                            modifier = Modifier
                                .width(48.dp)
                                .focusRequester(focusRequesters[index]),
                            textStyle = MaterialTheme.typography.headlineSmall.copy(
                                textAlign = TextAlign.Center
                            ),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Number
                            )
                        )
                    }
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                // Resend code button
                if (state.resendCooldown > 0) {
                    Text(
                        text = "Resend code in ${state.resendCooldown}s",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    TextButton(onClick = onResendCode) {
                        Text("Didn't receive the code? Resend")
                    }
                }
                
                Spacer(modifier = Modifier.weight(1f))
                
                // Verify button
                Button(
                    onClick = { onVerifyCode(code) },
                    enabled = code.length == 6 && !state.isLoading,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    if (state.isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Text("Verify Email")
                    }
                }
            }
        }
    }
}
