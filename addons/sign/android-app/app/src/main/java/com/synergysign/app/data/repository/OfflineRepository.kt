package com.synergysign.app.data.repository

import com.synergysign.app.data.local.*
import com.synergysign.app.data.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for offline data storage and sync
 */
@Singleton
class OfflineRepository @Inject constructor(
    private val documentDao: DocumentDao,
    private val signerDao: SignerDao,
    private val fieldDao: FieldDao,
    private val pendingActionDao: PendingActionDao,
    private val cachedPdfDao: CachedPdfDao
) {
    // ==================== Documents ====================

    fun getOfflineDocuments(): Flow<List<Document>> {
        return documentDao.getAllDocuments().map { entities ->
            entities.map { it.toDocument() }
        }
    }

    fun getOfflineDocumentsByStatus(status: String): Flow<List<Document>> {
        return documentDao.getDocumentsByStatus(status).map { entities ->
            entities.map { it.toDocument() }
        }
    }

    suspend fun getOfflineDocument(id: String): Document? {
        return documentDao.getDocument(id)?.toDocument()
    }

    suspend fun cacheDocuments(documents: List<Document>) {
        val entities = documents.map { it.toEntity() }
        documentDao.insertDocuments(entities)
        
        // Also cache signers
        documents.forEach { doc ->
            val signerEntities = doc.signers.map { it.toEntity(doc.id) }
            signerDao.deleteSignersForDocument(doc.id)
            signerDao.insertSigners(signerEntities)
        }
    }

    suspend fun cacheDocument(document: Document) {
        documentDao.insertDocument(document.toEntity())
        
        val signerEntities = document.signers.map { it.toEntity(document.id) }
        signerDao.deleteSignersForDocument(document.id)
        signerDao.insertSigners(signerEntities)
    }

    suspend fun clearDocumentCache() {
        documentDao.clearAll()
    }

    // ==================== Fields ====================

    fun getOfflineFields(documentId: String): Flow<List<DocumentField>> {
        return fieldDao.getFieldsForDocument(documentId).map { entities ->
            entities.map { it.toField() }
        }
    }

    suspend fun cacheFields(documentId: String, fields: List<DocumentField>) {
        val entities = fields.map { it.toEntity(documentId) }
        fieldDao.deleteFieldsForDocument(documentId)
        fieldDao.insertFields(entities)
    }

    // ==================== Pending Actions ====================

    fun getPendingActions(): Flow<List<PendingActionEntity>> {
        return pendingActionDao.getAllPendingActions()
    }

    suspend fun queuePendingAction(actionType: String, documentId: String?, payload: String) {
        pendingActionDao.insertAction(
            PendingActionEntity(
                actionType = actionType,
                documentId = documentId,
                payload = payload
            )
        )
    }

    suspend fun getNextPendingAction(): PendingActionEntity? {
        return pendingActionDao.getNextPendingAction()
    }

    suspend fun completePendingAction(action: PendingActionEntity) {
        pendingActionDao.deleteAction(action)
    }

    suspend fun retryPendingAction(action: PendingActionEntity) {
        pendingActionDao.incrementRetryCount(action.id)
    }

    // ==================== Cached PDFs ====================

    suspend fun getCachedPdfPath(documentId: String): String? {
        return cachedPdfDao.getCachedPdf(documentId)?.localPath
    }

    suspend fun cachePdfPath(documentId: String, localPath: String) {
        cachedPdfDao.insertCachedPdf(
            CachedPdfEntity(documentId = documentId, localPath = localPath)
        )
    }

    suspend fun clearOldPdfCache(maxAgeDays: Int = 7) {
        val cutoffTime = System.currentTimeMillis() - (maxAgeDays * 24 * 60 * 60 * 1000L)
        cachedPdfDao.deleteOldCachedPdfs(cutoffTime)
    }
}

// ==================== Extension Functions ====================

private fun DocumentEntity.toDocument(): Document {
    return Document(
        id = id,
        title = title,
        description = description,
        status = status,
        signingOrder = signingOrder,
        createdAt = createdAt,
        updatedAt = updatedAt,
        deadline = deadline,
        archived = archived,
        sender = UserSummary(
            id = senderId,
            name = senderName,
            email = senderEmail
        ),
        signers = emptyList() // Will be loaded separately
    )
}

private fun Document.toEntity(): DocumentEntity {
    return DocumentEntity(
        id = id,
        title = title,
        description = description,
        status = status,
        signingOrder = signingOrder,
        createdAt = createdAt,
        updatedAt = updatedAt,
        deadline = deadline,
        archived = archived,
        senderId = sender.id,
        senderName = sender.name,
        senderEmail = sender.email
    )
}

private fun SignerEntity.toSigner(): DocumentSigner {
    return DocumentSigner(
        id = id,
        email = email,
        name = name,
        userId = userId,
        status = status,
        signedAt = signedAt,
        order = order
    )
}

private fun DocumentSigner.toEntity(documentId: String): SignerEntity {
    return SignerEntity(
        id = id,
        documentId = documentId,
        email = email,
        name = name,
        userId = userId,
        status = status,
        signedAt = signedAt,
        order = order
    )
}

private fun FieldEntity.toField(): DocumentField {
    return DocumentField(
        id = id,
        fieldType = fieldType,
        label = label,
        required = required,
        pageNumber = pageNumber,
        x = x,
        y = y,
        width = width,
        height = height,
        value = value,
        assignedToId = assignedToId
    )
}

private fun DocumentField.toEntity(documentId: String): FieldEntity {
    return FieldEntity(
        id = id,
        documentId = documentId,
        fieldType = fieldType,
        label = label,
        required = required,
        pageNumber = pageNumber,
        x = x,
        y = y,
        width = width,
        height = height,
        value = value,
        assignedToId = assignedToId
    )
}
