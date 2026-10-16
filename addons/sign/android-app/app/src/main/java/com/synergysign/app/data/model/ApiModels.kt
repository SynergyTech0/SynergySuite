package com.synergysign.app.data.model

import com.google.gson.annotations.SerializedName

// ==================== Authentication Models ====================

data class SignupRequest(
    val email: String,
    val password: String,
    val firstName: String,
    val lastName: String,
    val companyName: String? = null,
    val referralCode: String? = null,
    val invitationToken: String? = null
)

data class SignupResponse(
    val message: String,
    val user: User
)

data class LoginRequest(
    val email: String,
    val password: String
)

data class LoginResponse(
    val user: User,
    val accessToken: String
)

data class VerifyEmailRequest(
    val code: String
)

data class VerifyResponse(
    val success: Boolean,
    val message: String? = null
)

// ==================== User Model ====================

data class User(
    val id: String,
    val email: String,
    val name: String?,
    val firstName: String? = null,
    val lastName: String? = null,
    val role: String,
    val verified: Boolean = false,
    val subscription: Subscription? = null,
    val enterpriseId: String? = null,
    val isEnterpriseAdmin: Boolean = false,
    val companyName: String? = null,
    val referralCode: String? = null
)

data class Subscription(
    val tier: String,
    val status: String,
    val currentPeriodEnd: String? = null,
    val trialEndsAt: String? = null
)

// ==================== Dashboard Models ====================

data class DashboardStats(
    val totalDocuments: Int,
    val pendingSignatures: Int,
    val completedDocuments: Int,
    val activeSigners: Int
)

// ==================== Document Models ====================

data class DocumentsResponse(
    val documents: List<Document>,
    val pagination: Pagination
)

data class Pagination(
    val page: Int,
    val limit: Int,
    val total: Int,
    val totalPages: Int
)

data class Document(
    val id: String,
    val title: String,
    val description: String?,
    val status: String,
    val signingOrder: String = "SEQUENTIAL",
    val createdAt: String,
    val updatedAt: String,
    val deadline: String? = null,
    val archived: Boolean = false,
    val sender: UserSummary,
    val signers: List<DocumentSigner>,
    @SerializedName("_count")
    val count: FieldCount? = null
)

data class UserSummary(
    val id: String,
    val name: String?,
    val email: String
)

data class DocumentSigner(
    val id: String,
    val email: String,
    val name: String?,
    val userId: String? = null,
    val status: String,
    val signedAt: String? = null,
    val order: Int = 0
)

data class FieldCount(
    val fields: Int = 0
)

// ==================== Document Detail ====================

data class DocumentDetail(
    val id: String,
    val title: String,
    val description: String?,
    val status: String,
    val signingOrder: String,
    val createdAt: String,
    val updatedAt: String,
    val deadline: String? = null,
    val cloudStoragePath: String? = null,
    val cloudProvider: String? = null,
    val sender: UserSummary,
    val signers: List<DocumentSigner>,
    val fields: List<DocumentField>? = null
)

data class DocumentField(
    val id: String,
    val fieldType: String,
    val label: String?,
    val required: Boolean = false,
    val pageNumber: Int = 1,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val value: String? = null,
    val assignedToId: String? = null
)

// ==================== Upload Response ====================

data class UploadResponse(
    val success: Boolean,
    val document: Document? = null,
    val ocr: String? = null,
    val summary: String? = null,
    val fields: List<DocumentField>? = null
)

data class SecureUrlResponse(
    val url: String
)

// ==================== Signers ====================

data class AddSignersRequest(
    val signers: List<SignerData>
)

data class SignerData(
    val email: String,
    val name: String,
    val order: Int = 0,
    val message: String? = null
)

data class RemoveSignersRequest(
    val signerIds: List<String>
)

data class SignersResponse(
    val signers: List<DocumentSigner>
)

// ==================== Fields ====================

data class FieldsResponse(
    val fields: List<DocumentField>
)

data class SaveFieldsRequest(
    val fields: List<FieldData>
)

data class FieldData(
    val fieldType: String,
    val label: String?,
    val required: Boolean = false,
    val pageNumber: Int = 1,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val assignedToId: String? = null
)

data class SignFieldRequest(
    val fieldId: String,
    val signatureImage: String  // Base64 encoded
)

// ==================== Templates ====================

data class TemplatesResponse(
    val templates: List<Template>
)

data class Template(
    val id: String,
    val name: String,
    val description: String?,
    val createdAt: String
)

data class CreateFromTemplateRequest(
    val templateId: String,
    val title: String
)

// ==================== Generic Responses ====================

data class SuccessResponse(
    val success: Boolean,
    val message: String? = null
)

data class ErrorResponse(
    val error: String,
    val message: String? = null,
    val details: String? = null
)
