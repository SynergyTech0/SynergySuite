package com.synergysign.app.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

// ==================== Entities ====================

@Entity(tableName = "documents")
data class DocumentEntity(
    @PrimaryKey val id: String,
    val title: String,
    val description: String?,
    val status: String,
    val signingOrder: String,
    val createdAt: String,
    val updatedAt: String,
    val deadline: String?,
    val archived: Boolean,
    val senderId: String,
    val senderName: String?,
    val senderEmail: String,
    val lastSyncedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "signers")
data class SignerEntity(
    @PrimaryKey val id: String,
    val documentId: String,
    val email: String,
    val name: String?,
    val userId: String?,
    val status: String,
    val signedAt: String?,
    val order: Int
)

@Entity(tableName = "fields")
data class FieldEntity(
    @PrimaryKey val id: String,
    val documentId: String,
    val fieldType: String,
    val label: String?,
    val required: Boolean,
    val pageNumber: Int,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val value: String?,
    val assignedToId: String?
)

@Entity(tableName = "pending_actions")
data class PendingActionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val actionType: String, // "SIGN", "UPLOAD", "UPDATE_FIELD"
    val documentId: String?,
    val payload: String, // JSON encoded data
    val createdAt: Long = System.currentTimeMillis(),
    val retryCount: Int = 0
)

@Entity(tableName = "cached_pdfs")
data class CachedPdfEntity(
    @PrimaryKey val documentId: String,
    val localPath: String,
    val downloadedAt: Long = System.currentTimeMillis()
)

// ==================== DAOs ====================

@Dao
interface DocumentDao {
    @Query("SELECT * FROM documents ORDER BY updatedAt DESC")
    fun getAllDocuments(): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE status = :status ORDER BY updatedAt DESC")
    fun getDocumentsByStatus(status: String): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE id = :id")
    suspend fun getDocument(id: String): DocumentEntity?

    @Query("SELECT * FROM documents WHERE title LIKE '%' || :query || '%'")
    fun searchDocuments(query: String): Flow<List<DocumentEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDocuments(documents: List<DocumentEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDocument(document: DocumentEntity)

    @Delete
    suspend fun deleteDocument(document: DocumentEntity)

    @Query("DELETE FROM documents WHERE id = :id")
    suspend fun deleteDocumentById(id: String)

    @Query("DELETE FROM documents")
    suspend fun clearAll()
}

@Dao
interface SignerDao {
    @Query("SELECT * FROM signers WHERE documentId = :documentId ORDER BY `order`")
    fun getSignersForDocument(documentId: String): Flow<List<SignerEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSigners(signers: List<SignerEntity>)

    @Query("DELETE FROM signers WHERE documentId = :documentId")
    suspend fun deleteSignersForDocument(documentId: String)
}

@Dao
interface FieldDao {
    @Query("SELECT * FROM fields WHERE documentId = :documentId ORDER BY pageNumber, y")
    fun getFieldsForDocument(documentId: String): Flow<List<FieldEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFields(fields: List<FieldEntity>)

    @Query("DELETE FROM fields WHERE documentId = :documentId")
    suspend fun deleteFieldsForDocument(documentId: String)

    @Query("UPDATE fields SET value = :value WHERE id = :fieldId")
    suspend fun updateFieldValue(fieldId: String, value: String)
}

@Dao
interface PendingActionDao {
    @Query("SELECT * FROM pending_actions ORDER BY createdAt ASC")
    fun getAllPendingActions(): Flow<List<PendingActionEntity>>

    @Query("SELECT * FROM pending_actions WHERE retryCount < 3 ORDER BY createdAt ASC LIMIT 1")
    suspend fun getNextPendingAction(): PendingActionEntity?

    @Insert
    suspend fun insertAction(action: PendingActionEntity)

    @Delete
    suspend fun deleteAction(action: PendingActionEntity)

    @Query("UPDATE pending_actions SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetryCount(id: Long)

    @Query("DELETE FROM pending_actions WHERE id = :id")
    suspend fun deleteActionById(id: Long)
}

@Dao
interface CachedPdfDao {
    @Query("SELECT * FROM cached_pdfs WHERE documentId = :documentId")
    suspend fun getCachedPdf(documentId: String): CachedPdfEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCachedPdf(cachedPdf: CachedPdfEntity)

    @Query("DELETE FROM cached_pdfs WHERE documentId = :documentId")
    suspend fun deleteCachedPdf(documentId: String)

    @Query("DELETE FROM cached_pdfs WHERE downloadedAt < :olderThan")
    suspend fun deleteOldCachedPdfs(olderThan: Long)
}

// ==================== Database ====================

@Database(
    entities = [
        DocumentEntity::class,
        SignerEntity::class,
        FieldEntity::class,
        PendingActionEntity::class,
        CachedPdfEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class SynergySignDatabase : RoomDatabase() {
    abstract fun documentDao(): DocumentDao
    abstract fun signerDao(): SignerDao
    abstract fun fieldDao(): FieldDao
    abstract fun pendingActionDao(): PendingActionDao
    abstract fun cachedPdfDao(): CachedPdfDao
}
