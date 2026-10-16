package com.synergysign.app.presentation.signature

import android.graphics.Bitmap
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.synergysign.app.presentation.theme.Blue500
import java.io.ByteArrayOutputStream

data class SignaturePath(
    val points: List<Offset> = emptyList()
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignatureCaptureScreen(
    onSignatureComplete: (String) -> Unit, // Base64 encoded signature
    onCancel: () -> Unit,
    fieldLabel: String? = null
) {
    var paths by remember { mutableStateOf(listOf<SignaturePath>()) }
    var currentPath by remember { mutableStateOf(SignaturePath()) }
    var strokeWidth by remember { mutableFloatStateOf(5f) }
    var strokeColor by remember { mutableStateOf(Color.Black) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }

    val colors = listOf(
        Color.Black,
        Color(0xFF1E40AF), // Blue
        Color(0xFF047857), // Green
        Color(0xFF7C3AED)  // Purple
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(fieldLabel ?: "Sign Here") },
                navigationIcon = {
                    IconButton(onClick = onCancel) {
                        Icon(Icons.Default.Close, contentDescription = "Cancel")
                    }
                },
                actions = {
                    // Clear button
                    IconButton(
                        onClick = {
                            paths = emptyList()
                            currentPath = SignaturePath()
                        }
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "Clear")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Instructions
            Text(
                text = "Draw your signature below",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            // Signature canvas
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .border(
                        width = 2.dp,
                        color = MaterialTheme.colorScheme.outline,
                        shape = RoundedCornerShape(12.dp)
                    )
                    .background(Color.White)
            ) {
                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectDragGestures(
                                onDragStart = { offset ->
                                    currentPath = SignaturePath(listOf(offset))
                                },
                                onDrag = { change, _ ->
                                    currentPath = currentPath.copy(
                                        points = currentPath.points + change.position
                                    )
                                },
                                onDragEnd = {
                                    if (currentPath.points.isNotEmpty()) {
                                        paths = paths + currentPath
                                        currentPath = SignaturePath()
                                    }
                                }
                            )
                        }
                ) {
                    canvasSize = IntSize(size.width.toInt(), size.height.toInt())

                    // Draw completed paths
                    paths.forEach { path ->
                        if (path.points.size > 1) {
                            val pathToDraw = Path().apply {
                                moveTo(path.points.first().x, path.points.first().y)
                                for (i in 1 until path.points.size) {
                                    val prev = path.points[i - 1]
                                    val curr = path.points[i]
                                    quadraticBezierTo(
                                        prev.x, prev.y,
                                        (prev.x + curr.x) / 2, (prev.y + curr.y) / 2
                                    )
                                }
                            }
                            drawPath(
                                path = pathToDraw,
                                color = strokeColor,
                                style = Stroke(
                                    width = strokeWidth,
                                    cap = StrokeCap.Round,
                                    join = StrokeJoin.Round
                                )
                            )
                        }
                    }

                    // Draw current path
                    if (currentPath.points.size > 1) {
                        val pathToDraw = Path().apply {
                            moveTo(currentPath.points.first().x, currentPath.points.first().y)
                            for (i in 1 until currentPath.points.size) {
                                val prev = currentPath.points[i - 1]
                                val curr = currentPath.points[i]
                                quadraticBezierTo(
                                    prev.x, prev.y,
                                    (prev.x + curr.x) / 2, (prev.y + curr.y) / 2
                                )
                            }
                        }
                        drawPath(
                            path = pathToDraw,
                            color = strokeColor,
                            style = Stroke(
                                width = strokeWidth,
                                cap = StrokeCap.Round,
                                join = StrokeJoin.Round
                            )
                        )
                    }
                }

                // Sign here indicator when empty
                if (paths.isEmpty() && currentPath.points.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                Icons.Default.Draw,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.outline
                            )
                            Text(
                                "Sign here",
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    }
                }
            }

            // Stroke options
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Color selection
                    Text(
                        text = "Ink Color",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Medium
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        colors.forEach { color ->
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(RoundedCornerShape(20.dp))
                                    .background(color)
                                    .border(
                                        width = if (strokeColor == color) 3.dp else 1.dp,
                                        color = if (strokeColor == color) Blue500 else Color.Gray,
                                        shape = RoundedCornerShape(20.dp)
                                    )
                                    .clickable { strokeColor = color }
                            ) {
                                if (strokeColor == color) {
                                    Icon(
                                        Icons.Default.Check,
                                        contentDescription = "Selected",
                                        tint = Color.White,
                                        modifier = Modifier
                                            .align(Alignment.Center)
                                            .size(20.dp)
                                    )
                                }
                            }
                        }
                    }

                    // Stroke width
                    Text(
                        text = "Stroke Width",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Medium
                    )
                    Slider(
                        value = strokeWidth,
                        onValueChange = { strokeWidth = it },
                        valueRange = 2f..15f,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = onCancel,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Cancel")
                }

                Button(
                    onClick = {
                        // Generate signature bitmap and convert to base64
                        val base64 = generateSignatureBase64(
                            paths = paths,
                            canvasSize = canvasSize,
                            strokeWidth = strokeWidth,
                            strokeColor = strokeColor
                        )
                        onSignatureComplete(base64)
                    },
                    enabled = paths.isNotEmpty(),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Check, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Apply")
                }
            }
        }
    }
}

private fun generateSignatureBase64(
    paths: List<SignaturePath>,
    canvasSize: IntSize,
    strokeWidth: Float,
    strokeColor: Color
): String {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) {
        return ""
    }

    val bitmap = Bitmap.createBitmap(
        canvasSize.width,
        canvasSize.height,
        Bitmap.Config.ARGB_8888
    )
    val canvas = android.graphics.Canvas(bitmap)
    canvas.drawColor(android.graphics.Color.TRANSPARENT)

    val paint = android.graphics.Paint().apply {
        color = strokeColor.toArgb()
        this.strokeWidth = strokeWidth
        style = android.graphics.Paint.Style.STROKE
        strokeCap = android.graphics.Paint.Cap.ROUND
        strokeJoin = android.graphics.Paint.Join.ROUND
        isAntiAlias = true
    }

    paths.forEach { path ->
        if (path.points.size > 1) {
            val androidPath = android.graphics.Path().apply {
                moveTo(path.points.first().x, path.points.first().y)
                for (i in 1 until path.points.size) {
                    val prev = path.points[i - 1]
                    val curr = path.points[i]
                    quadTo(
                        prev.x, prev.y,
                        (prev.x + curr.x) / 2, (prev.y + curr.y) / 2
                    )
                }
            }
            canvas.drawPath(androidPath, paint)
        }
    }

    // Convert to base64
    val outputStream = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
    val byteArray = outputStream.toByteArray()
    return "data:image/png;base64," + Base64.encodeToString(byteArray, Base64.NO_WRAP)
}
