package com.synergysign.app.presentation.viewer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.synergysign.app.data.model.DocumentField
import com.synergysign.app.data.model.DocumentSigner
import com.synergysign.app.presentation.theme.*
import kotlin.math.roundToInt

data class FieldType(
    val type: String,
    val label: String,
    val icon: ImageVector,
    val color: Color
)

val fieldTypes = listOf(
    FieldType("SIGNATURE", "Signature", Icons.Default.Draw, Blue500),
    FieldType("INITIALS", "Initials", Icons.Default.TextFields, Color(0xFF8B5CF6)),
    FieldType("DATE", "Date", Icons.Default.CalendarToday, Color(0xFF10B981)),
    FieldType("TEXT", "Text", Icons.Default.ShortText, Color(0xFFF59E0B)),
    FieldType("CHECKBOX", "Checkbox", Icons.Default.CheckBox, Color(0xFFEC4899))
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FieldPlacementScreen(
    fields: List<DocumentField>,
    signers: List<DocumentSigner>,
    currentPage: Int,
    pageWidth: Float,
    pageHeight: Float,
    onAddField: (type: String, x: Float, y: Float, assignedToId: String?) -> Unit,
    onUpdateField: (fieldId: String, x: Float, y: Float) -> Unit,
    onRemoveField: (fieldId: String) -> Unit,
    onSave: () -> Unit,
    onBack: () -> Unit,
    isSaving: Boolean = false
) {
    var selectedFieldType by remember { mutableStateOf(fieldTypes.first()) }
    var selectedSigner by remember { mutableStateOf<DocumentSigner?>(signers.firstOrNull()) }
    var showSignerPicker by remember { mutableStateOf(false) }

    // Filter fields for current page
    val currentPageFields = fields.filter { it.pageNumber == currentPage }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Place Fields") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    Button(
                        onClick = onSave,
                        enabled = !isSaving
                    ) {
                        if (isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text("Save")
                        }
                    }
                }
            )
        },
        bottomBar = {
            Column {
                // Signer selector
                if (signers.isNotEmpty()) {
                    Surface(
                        tonalElevation = 2.dp
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Assign to:",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(end = 8.dp)
                            )
                            FilterChip(
                                selected = true,
                                onClick = { showSignerPicker = true },
                                label = {
                                    Text(selectedSigner?.name ?: selectedSigner?.email ?: "Select signer")
                                },
                                trailingIcon = {
                                    Icon(
                                        Icons.Default.ArrowDropDown,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            )
                        }
                    }
                }

                // Field type selector
                Surface(
                    tonalElevation = 4.dp
                ) {
                    LazyRow(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(fieldTypes) { fieldType ->
                            FieldTypeChip(
                                fieldType = fieldType,
                                isSelected = selectedFieldType == fieldType,
                                onClick = { selectedFieldType = fieldType }
                            )
                        }
                    }
                }
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(Color(0xFF525659))
        ) {
            // Document area placeholder
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color.White)
                    .clickable {
                        // Add field at center when tapped (simplified)
                        onAddField(
                            selectedFieldType.type,
                            0.5f, // center X
                            0.5f, // center Y
                            selectedSigner?.id
                        )
                    }
            ) {
                // Render placed fields
                currentPageFields.forEach { field ->
                    DraggableField(
                        field = field,
                        fieldType = fieldTypes.find { it.type == field.fieldType.uppercase() } ?: fieldTypes.first(),
                        onDrag = { x, y -> onUpdateField(field.id, x, y) },
                        onRemove = { onRemoveField(field.id) }
                    )
                }

                // Instructions when no fields
                if (currentPageFields.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                Icons.Default.TouchApp,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.outline
                            )
                            Text(
                                "Tap to add fields",
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.outline
                            )
                            Text(
                                "Select a field type below, then tap here",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    }
                }
            }
        }
    }

    // Signer picker dialog
    if (showSignerPicker) {
        AlertDialog(
            onDismissRequest = { showSignerPicker = false },
            title = { Text("Select Signer") },
            text = {
                Column {
                    signers.forEach { signer ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selectedSigner = signer
                                    showSignerPicker = false
                                }
                                .padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = selectedSigner?.id == signer.id,
                                onClick = {
                                    selectedSigner = signer
                                    showSignerPicker = false
                                }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Column {
                                Text(
                                    text = signer.name ?: "Unknown",
                                    fontWeight = FontWeight.Medium
                                )
                                Text(
                                    text = signer.email,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showSignerPicker = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun FieldTypeChip(
    fieldType: FieldType,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    FilterChip(
        selected = isSelected,
        onClick = onClick,
        label = { Text(fieldType.label) },
        leadingIcon = {
            Icon(
                fieldType.icon,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = if (isSelected) MaterialTheme.colorScheme.onSecondaryContainer else fieldType.color
            )
        },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = fieldType.color.copy(alpha = 0.2f),
            selectedLabelColor = fieldType.color
        )
    )
}

@Composable
private fun BoxScope.DraggableField(
    field: DocumentField,
    fieldType: FieldType,
    onDrag: (x: Float, y: Float) -> Unit,
    onRemove: () -> Unit
) {
    var offsetX by remember { mutableFloatStateOf(field.x.toFloat() * 300) } // Simplified positioning
    var offsetY by remember { mutableFloatStateOf(field.y.toFloat() * 500) }
    var showMenu by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .offset { IntOffset(offsetX.roundToInt(), offsetY.roundToInt()) }
            .width(field.width.dp.coerceAtLeast(100.dp))
            .height(field.height.dp.coerceAtLeast(40.dp))
            .clip(RoundedCornerShape(4.dp))
            .border(2.dp, fieldType.color, RoundedCornerShape(4.dp))
            .background(fieldType.color.copy(alpha = 0.1f))
            .pointerInput(Unit) {
                detectDragGestures { change, dragAmount ->
                    change.consume()
                    offsetX += dragAmount.x
                    offsetY += dragAmount.y
                }
            }
            .clickable { showMenu = true },
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(
                fieldType.icon,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = fieldType.color
            )
            Text(
                text = field.label ?: fieldType.label,
                style = MaterialTheme.typography.labelSmall,
                color = fieldType.color,
                fontWeight = FontWeight.Medium
            )
        }

        // Dropdown menu for field actions
        DropdownMenu(
            expanded = showMenu,
            onDismissRequest = { showMenu = false }
        ) {
            DropdownMenuItem(
                text = { Text("Remove") },
                onClick = {
                    showMenu = false
                    onRemove()
                },
                leadingIcon = {
                    Icon(Icons.Default.Delete, contentDescription = null)
                }
            )
        }
    }
}
