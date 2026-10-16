package com.synergysign.app.presentation.sharing

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.synergysign.app.data.model.Document
import com.synergysign.app.presentation.theme.Blue500

/**
 * Deep link handler utility
 */
object DeepLinkHandler {
    private const val SCHEME = "synergysign"
    private const val HOST = "synergysign.app"
    private const val HTTPS_SCHEME = "https"

    // Deep link paths
    const val PATH_DOCUMENT = "/document"
    const val PATH_SIGN = "/sign"
    const val PATH_VERIFY = "/verify"

    /**
     * Parse deep link intent and extract document ID
     */
    fun parseDeepLink(intent: Intent?): DeepLinkData? {
        val uri = intent?.data ?: return null
        
        return when {
            // Handle custom scheme: synergysign://document/123
            uri.scheme == SCHEME -> parseCustomScheme(uri)
            // Handle https: https://synergysign.app/document/123
            uri.scheme == HTTPS_SCHEME && uri.host == HOST -> parseHttpsScheme(uri)
            else -> null
        }
    }

    private fun parseCustomScheme(uri: Uri): DeepLinkData? {
        val path = uri.path ?: return null
        val segments = path.split("/").filter { it.isNotEmpty() }
        
        return when {
            segments.size >= 2 && segments[0] == "document" -> {
                DeepLinkData(
                    type = DeepLinkType.DOCUMENT,
                    documentId = segments[1],
                    additionalParams = uri.queryParameterNames.associateWith { 
                        uri.getQueryParameter(it) ?: "" 
                    }
                )
            }
            segments.size >= 2 && segments[0] == "sign" -> {
                DeepLinkData(
                    type = DeepLinkType.SIGN,
                    documentId = segments[1],
                    additionalParams = uri.queryParameterNames.associateWith { 
                        uri.getQueryParameter(it) ?: "" 
                    }
                )
            }
            segments.isNotEmpty() && segments[0] == "verify" -> {
                DeepLinkData(
                    type = DeepLinkType.VERIFY,
                    documentId = null,
                    additionalParams = mapOf(
                        "code" to (uri.getQueryParameter("code") ?: "")
                    )
                )
            }
            else -> null
        }
    }

    private fun parseHttpsScheme(uri: Uri): DeepLinkData? {
        val segments = uri.pathSegments
        
        return when {
            segments.size >= 2 && segments[0] == "document" -> {
                DeepLinkData(
                    type = DeepLinkType.DOCUMENT,
                    documentId = segments[1]
                )
            }
            segments.size >= 2 && segments[0] == "sign" -> {
                DeepLinkData(
                    type = DeepLinkType.SIGN,
                    documentId = segments[1]
                )
            }
            else -> null
        }
    }

    /**
     * Create share intent for document
     */
    fun createShareIntent(document: Document): Intent {
        val shareUrl = "$HTTPS_SCHEME://$HOST/document/${document.id}"
        
        return Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Sign: ${document.title}")
            putExtra(Intent.EXTRA_TEXT, """
                You've been invited to sign "${document.title}"
                
                Click here to view and sign: $shareUrl
            """.trimIndent())
        }
    }

    /**
     * Create signing request deep link
     */
    fun createSigningLink(documentId: String): String {
        return "$HTTPS_SCHEME://$HOST/sign/$documentId"
    }
}

data class DeepLinkData(
    val type: DeepLinkType,
    val documentId: String?,
    val additionalParams: Map<String, String> = emptyMap()
)

enum class DeepLinkType {
    DOCUMENT,
    SIGN,
    VERIFY
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareDocumentSheet(
    document: Document,
    onDismiss: () -> Unit,
    onCopyLink: () -> Unit,
    onShareViaEmail: () -> Unit,
    onShareViaApp: () -> Unit
) {
    val context = LocalContext.current

    ModalBottomSheet(
        onDismissRequest = onDismiss
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
        ) {
            Text(
                text = "Share Document",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            
            Text(
                text = document.title,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Share options
            ShareOption(
                icon = Icons.Default.Link,
                title = "Copy Link",
                subtitle = "Copy signing link to clipboard",
                onClick = onCopyLink
            )

            ShareOption(
                icon = Icons.Default.Email,
                title = "Share via Email",
                subtitle = "Send document link by email",
                onClick = onShareViaEmail
            )

            ShareOption(
                icon = Icons.Default.Share,
                title = "Share via App",
                subtitle = "Share using other apps",
                onClick = {
                    val intent = DeepLinkHandler.createShareIntent(document)
                    context.startActivity(Intent.createChooser(intent, "Share Document"))
                    onShareViaApp()
                }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // QR Code section
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        Icons.Default.QrCode2,
                        contentDescription = null,
                        modifier = Modifier.size(100.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Scan to view document",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun ShareOption(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        onClick = onClick,
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(48.dp),
                shape = RoundedCornerShape(12.dp),
                color = Blue500.copy(alpha = 0.1f)
            ) {
                Box(
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = Blue500
                    )
                }
            }

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.outline
            )
        }
    }
}
