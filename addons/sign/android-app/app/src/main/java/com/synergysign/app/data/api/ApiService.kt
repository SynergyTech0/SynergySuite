package com.synergysign.app.data.api

import com.synergysign.app.data.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

/**
 * SynergySign API Service
 * Retrofit interface for all API endpoints
 */
interface ApiService {

    // ==================== Authentication ====================

    @POST("auth/signup")
    suspend fun signup(@Body request: SignupRequest): Response<SignupResponse>

    @POST("auth/callback/credentials")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("auth/verify")
    suspend fun verifyEmail(@Body request: VerifyEmailRequest): Response<VerifyResponse>

    // ==================== Dashboard ====================

    @GET("dashboard/stats")
    suspend fun getDashboardStats(): Response<DashboardStats>

    // ==================== Documents ====================

    @GET("documents")
    suspend fun getDocuments(
        @Query("status") status: String? = null,
        @Query("query") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 10,
        @Query("archived") archived: Boolean = false
    ): Response<DocumentsResponse>

    @GET("documents/{id}")
    suspend fun getDocument(@Path("id") id: String): Response<DocumentDetail>

    @Multipart
    @POST("documents/upload")
    suspend fun uploadDocument(
        @Part file: MultipartBody.Part,
        @Part("title") title: RequestBody,
        @Part("description") description: RequestBody?
    ): Response<UploadResponse>

    @GET("documents/{id}/secure-url")
    suspend fun getSecureUrl(@Path("id") id: String): Response<SecureUrlResponse>

    @POST("documents/{id}/archive")
    suspend fun archiveDocument(@Path("id") id: String): Response<SuccessResponse>

    @DELETE("documents/{id}/delete")
    suspend fun deleteDocument(@Path("id") id: String): Response<SuccessResponse>

    // ==================== Signers ====================

    @POST("documents/{id}/signers")
    suspend fun addSigners(
        @Path("id") documentId: String,
        @Body request: AddSignersRequest
    ): Response<SignersResponse>

    @HTTP(method = "DELETE", path = "documents/{id}/signers", hasBody = true)
    suspend fun removeSigners(
        @Path("id") documentId: String,
        @Body request: RemoveSignersRequest
    ): Response<SuccessResponse>

    // ==================== Fields ====================

    @GET("documents/{id}/fields")
    suspend fun getFields(@Path("id") documentId: String): Response<FieldsResponse>

    @POST("documents/{id}/fields")
    suspend fun saveFields(
        @Path("id") documentId: String,
        @Body request: SaveFieldsRequest
    ): Response<FieldsResponse>

    @POST("documents/{id}/sign")
    suspend fun signField(
        @Path("id") documentId: String,
        @Body request: SignFieldRequest
    ): Response<SuccessResponse>

    // ==================== Templates ====================

    @GET("templates")
    suspend fun getTemplates(): Response<TemplatesResponse>

    @POST("templates/create-document")
    suspend fun createFromTemplate(@Body request: CreateFromTemplateRequest): Response<DocumentDetail>
}
