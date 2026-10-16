package com.synergysign.app.presentation.viewer

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.synergysign.app.data.model.DocumentField
import com.synergysign.app.presentation.theme.Blue500
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfViewerScreen(
    state: PdfViewerState,
    onBack: () -> Unit,
    onFieldClick: (DocumentField) -> Unit,
    onAddField: (pageNumber: Int, x: Float, y: Float) -> Unit,
    onPageChange: (Int) -> Unit,
    isEditMode: Boolean = false
) {
    val listState = rememberLazyListState()
    var scale by remember { mutableFloatStateOf(1f) }
    
    // Track current page
    LaunchedEffect(listState.firstVisibleItemIndex) {
        onPageChange(listState.firstVisibleItemIndex + 1)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Column {
                        Text(state.documentTitle ?: "Document Viewer")
                        if (state.pageCount > 0) {
                            Text(
                                text = "Page ${state.currentPage} of ${state.pageCount}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    // Zoom controls
                    IconButton(onClick = { scale = (scale - 0.25f).coerceAtLeast(0.5f) }) {
                        Icon(Icons.Default.ZoomOut, contentDescription = "Zoom Out")
                    }
                    IconButton(onClick = { scale = (scale + 0.25f).coerceAtMost(3f) }) {
                        Icon(Icons.Default.ZoomIn, contentDescription = "Zoom In")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(Color(0xFF525659))
        ) {
            when {
                state.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            CircularProgressIndicator(color = Color.White)
                            Text(
                                "Loading PDF...",
                                color = Color.White
                            )
                        }
                    }
                }
                
                state.error != null -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.Error,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(48.dp)
                            )
                            Text(
                                state.error,
                                color = Color.White
                            )
                        }
                    }
                }
                
                state.pages.isNotEmpty() -> {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer(
                                scaleX = scale,
                                scaleY = scale
                            ),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(16.dp)
                    ) {
                        itemsIndexed(state.pages) { index, bitmap ->
                            PdfPage(
                                bitmap = bitmap,
                                pageNumber = index + 1,
                                fields = state.fields.filter { it.pageNumber == index + 1 },
                                isEditMode = isEditMode,
                                onFieldClick = onFieldClick,
                                onAddField = { x, y -> onAddField(index + 1, x, y) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PdfPage(
    bitmap: Bitmap,
    pageNumber: Int,
    fields: List<DocumentField>,
    isEditMode: Boolean,
    onFieldClick: (DocumentField) -> Unit,
    onAddField: (x: Float, y: Float) -> Unit
) {
    val density = LocalDensity.current

    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(4.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .pointerInput(isEditMode) {
                    if (isEditMode) {
                        detectTapGestures { offset ->
                            // Convert tap position to relative coordinates (0-1)
                            val relativeX = offset.x / size.width
                            val relativeY = offset.y / size.height
                            onAddField(relativeX, relativeY)
                        }
                    }
                }
        ) {
            // PDF page image
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Page $pageNumber",
                modifier = Modifier.fillMaxWidth(),
                contentScale = ContentScale.FillWidth
            )
            
            // Field overlays
            fields.forEach { field ->
                FieldOverlay(
                    field = field,
                    onClick = { onFieldClick(field) }
                )
            }
        }
    }
}

@Composable
private fun BoxScope.FieldOverlay(
    field: DocumentField,
    onClick: () -> Unit
) {
    val fieldColor = when (field.fieldType.uppercase()) {
        "SIGNATURE" -> Blue500
        "DATE" -> Color(0xFF10B981)
        "TEXT" -> Color(0xFFF59E0B)
        "CHECKBOX" -> Color(0xFF8B5CF6)
        else -> Color.Gray
    }

    Box(
        modifier = Modifier
            .offset(
                x = (field.x * 100).dp,
                y = (field.y * 100).dp
            )
            .size(
                width = field.width.dp,
                height = field.height.dp
            )
            .background(fieldColor.copy(alpha = 0.2f))
            .pointerInput(Unit) {
                detectTapGestures { onClick() }
            },
        contentAlignment = Alignment.Center
    ) {
        if (field.value == null) {
            Text(
                text = field.label ?: field.fieldType,
                style = MaterialTheme.typography.labelSmall,
                color = fieldColor,
                fontWeight = FontWeight.Medium
            )
        }
    }
}
