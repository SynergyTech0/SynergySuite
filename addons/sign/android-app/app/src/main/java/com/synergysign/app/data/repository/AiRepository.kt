package com.synergysign.app.data.repository

import com.synergysign.app.presentation.ai.ExtractedSigner
import com.synergysign.app.presentation.ai.SuggestedField
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AiRepository @Inject constructor() {
    
    suspend fun analyzeDocument(documentId: String): DocumentAnalysis {
        // In production, call AI analysis API
        return DocumentAnalysis(
            classification = "Contract",
            confidence = 0.92f,
            summary = "This is a software development agreement between Company A and Contractor B, outlining the terms of service, payment schedule, and intellectual property rights for a 6-month project.",
            keyPoints = listOf(
                "Contract duration: 6 months",
                "Payment: $50,000 in monthly installments",
                "Intellectual property transfers to Company A upon completion",
                "30-day termination notice required"
            ),
            signers = listOf(
                ExtractedSigner("John Smith", "john.smith@companya.com", "Company Representative"),
                ExtractedSigner("Jane Doe", "jane.doe@contractor.com", "Contractor")
            ),
            fields = listOf(
                SuggestedField("sig_1", "SIGNATURE", "Client Signature", 3, 72.0, 580.0, 200.0, 50.0),
                SuggestedField("sig_2", "SIGNATURE", "Contractor Signature", 3, 72.0, 680.0, 200.0, 50.0),
                SuggestedField("date_1", "DATE", "Date", 3, 400.0, 580.0, 100.0, 30.0),
                SuggestedField("date_2", "DATE", "Date", 3, 400.0, 680.0, 100.0, 30.0)
            ),
            keywords = listOf("contract", "software", "development", "intellectual property", "payment", "termination")
        )
    }
    
    suspend fun addSigner(name: String, email: String) {
        // In production, call API to add signer
    }
    
    suspend fun applyField(field: SuggestedField) {
        // In production, call API to add field to document
    }
}

data class DocumentAnalysis(
    val classification: String,
    val confidence: Float,
    val summary: String,
    val keyPoints: List<String>,
    val signers: List<ExtractedSigner>,
    val fields: List<SuggestedField>,
    val keywords: List<String>
)
