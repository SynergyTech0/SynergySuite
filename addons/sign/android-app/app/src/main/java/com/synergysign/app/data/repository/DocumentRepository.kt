package com.synergysign.app.data.repository

import com.synergysign.app.data.api.ApiService
import com.synergysign.app.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for document operations
 */
@Singleton
class DocumentRepository @Inject constructor(
    private val apiService: ApiService
) {
    
    /**
     * Get dashboard statistics
     */
    suspend fun getDashboardStats(): Result<DashboardStats> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getDashboardStats()
            
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Failed to fetch stats"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Get paginated list of documents
     */
    suspend fun getDocuments(
        status: String? = null,
        query: String? = null,
        page: Int = 1,
        limit: Int = 10,
        archived: Boolean = false
    ): Result<DocumentsResponse> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getDocuments(status, query, page, limit, archived)
            
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Failed to fetch documents"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Get single document details
     */
    suspend fun getDocument(id: String): Result<DocumentDetail> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getDocument(id)
            
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Failed to fetch document"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Upload a new document
     */
    suspend fun uploadDocument(
        file: File,
        title: String,
        description: String? = null
    ): Result<UploadResponse> = withContext(Dispatchers.IO) {
        try {
            val requestFile = file.asRequestBody("application/pdf".toMediaTypeOrNull())
            val filePart = MultipartBody.Part.createFormData("file", file.name, requestFile)
            val titleBody = title.toRequestBody("text/plain".toMediaTypeOrNull())
            val descriptionBody = description?.toRequestBody("text/plain".toMediaTypeOrNull())
            
            val response = apiService.uploadDocument(filePart, titleBody, descriptionBody)
            
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Upload failed"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Get secure URL for document viewing
     */
    suspend fun getSecureUrl(documentId: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getSecureUrl(documentId)
            
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.url)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Failed to get URL"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Archive a document
     */
    suspend fun archiveDocument(documentId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.archiveDocument(documentId)
            
            if (response.isSuccessful && response.body()?.success == true) {
                Result.success(true)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Archive failed"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Delete a document
     */
    suspend fun deleteDocument(documentId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.deleteDocument(documentId)
            
            if (response.isSuccessful && response.body()?.success == true) {
                Result.success(true)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Delete failed"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Add signers to a document
     */
    suspend fun addSigners(
        documentId: String,
        signers: List<SignerData>
    ): Result<List<DocumentSigner>> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.addSigners(documentId, AddSignersRequest(signers))
            
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.signers)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Failed to add signers"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Get document fields
     */
    suspend fun getFields(documentId: String): Result<List<DocumentField>> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getFields(documentId)
            
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.fields)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Failed to get fields"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Save/update document fields
     */
    suspend fun saveFields(
        documentId: String,
        fields: List<FieldData>
    ): Result<List<DocumentField>> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.saveFields(documentId, SaveFieldsRequest(fields))
            
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.fields)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Failed to save fields"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Sign a field with signature image
     */
    suspend fun signField(
        documentId: String,
        fieldId: String,
        signatureImage: String // Base64 encoded
    ): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.signField(
                documentId,
                SignFieldRequest(fieldId, signatureImage)
            )
            
            if (response.isSuccessful && response.body()?.success == true) {
                Result.success(true)
            } else {
                val errorMessage = response.errorBody()?.string() ?: "Failed to sign"
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
