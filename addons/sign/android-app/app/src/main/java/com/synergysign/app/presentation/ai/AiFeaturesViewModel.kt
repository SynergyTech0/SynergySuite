package com.synergysign.app.presentation.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.AiRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AiFeaturesViewModel @Inject constructor(
    private val aiRepository: AiRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(AiFeaturesUiState())
    val uiState: StateFlow<AiFeaturesUiState> = _uiState.asStateFlow()
    
    fun analyzeDocument(documentId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isAnalyzing = true, analysisStep = "Extracting text...") }
            
            try {
                // Simulate analysis steps
                delay(500)
                _uiState.update { it.copy(analysisStep = "Classifying document...") }
                
                delay(500)
                _uiState.update { it.copy(analysisStep = "Generating summary...") }
                
                delay(500)
                _uiState.update { it.copy(analysisStep = "Detecting signers...") }
                
                delay(500)
                _uiState.update { it.copy(analysisStep = "Finding signature fields...") }
                
                // Get actual results
                val analysis = aiRepository.analyzeDocument(documentId)
                
                _uiState.update {
                    it.copy(
                        isAnalyzing = false,
                        classification = analysis.classification,
                        classificationConfidence = analysis.confidence,
                        summary = analysis.summary,
                        keyPoints = analysis.keyPoints,
                        extractedSigners = analysis.signers,
                        suggestedFields = analysis.fields,
                        keywords = analysis.keywords
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isAnalyzing = false, error = e.message) }
            }
        }
    }
    
    fun addSigner(signer: ExtractedSigner) {
        _uiState.update { state ->
            state.copy(extractedSigners = state.extractedSigners - signer)
        }
        // Trigger actual add via repository
        viewModelScope.launch {
            try {
                aiRepository.addSigner(signer.name, signer.email ?: "")
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun addAllSigners() {
        val signers = _uiState.value.extractedSigners
        _uiState.update { it.copy(extractedSigners = emptyList()) }
        viewModelScope.launch {
            signers.forEach { signer ->
                try {
                    aiRepository.addSigner(signer.name, signer.email ?: "")
                } catch (e: Exception) {
                    // Continue with other signers
                }
            }
        }
    }
    
    fun applyField(field: SuggestedField) {
        _uiState.update { state ->
            state.copy(
                suggestedFields = state.suggestedFields - field,
                appliedFields = state.appliedFields + field
            )
        }
    }
    
    fun dismissField(field: SuggestedField) {
        _uiState.update { state ->
            state.copy(suggestedFields = state.suggestedFields - field)
        }
    }
}

data class AiFeaturesUiState(
    val isAnalyzing: Boolean = false,
    val analysisStep: String = "",
    val error: String? = null,
    val classification: String = "",
    val classificationConfidence: Float = 0f,
    val summary: String = "",
    val keyPoints: List<String> = emptyList(),
    val extractedSigners: List<ExtractedSigner> = emptyList(),
    val suggestedFields: List<SuggestedField> = emptyList(),
    val appliedFields: List<SuggestedField> = emptyList(),
    val keywords: List<String> = emptyList()
)
