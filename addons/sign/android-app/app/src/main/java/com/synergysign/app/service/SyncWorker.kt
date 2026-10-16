package com.synergysign.app.service

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.google.gson.Gson
import com.synergysign.app.data.local.PendingActionEntity
import com.synergysign.app.data.repository.DocumentRepository
import com.synergysign.app.data.repository.OfflineRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * WorkManager worker for syncing offline changes when connectivity is restored
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val offlineRepository: OfflineRepository,
    private val documentRepository: DocumentRepository,
    private val gson: Gson
) : CoroutineWorker(context, workerParams) {

    companion object {
        const val WORK_NAME = "sync_worker"
        
        fun createOneTimeRequest(): OneTimeWorkRequest {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            return OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    30,
                    TimeUnit.SECONDS
                )
                .build()
        }

        fun createPeriodicRequest(): PeriodicWorkRequest {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            return PeriodicWorkRequestBuilder<SyncWorker>(
                15, TimeUnit.MINUTES,
                5, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build()
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            var processedCount = 0
            var failedCount = 0

            // Process pending actions
            while (true) {
                val action = offlineRepository.getNextPendingAction() ?: break

                val success = processAction(action)
                if (success) {
                    offlineRepository.completePendingAction(action)
                    processedCount++
                } else {
                    offlineRepository.retryPendingAction(action)
                    failedCount++
                    
                    // If too many failures, stop processing
                    if (failedCount >= 3) break
                }
            }

            // Clean up old PDF cache
            offlineRepository.clearOldPdfCache(7)

            if (failedCount > 0 && processedCount == 0) {
                Result.retry()
            } else {
                Result.success()
            }
        } catch (e: Exception) {
            Result.retry()
        }
    }

    private suspend fun processAction(action: PendingActionEntity): Boolean {
        return when (action.actionType) {
            "SIGN" -> processSignAction(action)
            "UPLOAD" -> processUploadAction(action)
            "UPDATE_FIELD" -> processUpdateFieldAction(action)
            else -> {
                // Unknown action, remove it
                true
            }
        }
    }

    private suspend fun processSignAction(action: PendingActionEntity): Boolean {
        return try {
            val payload = gson.fromJson(action.payload, SignActionPayload::class.java)
            val result = documentRepository.signField(
                documentId = payload.documentId,
                fieldId = payload.fieldId,
                signatureImage = payload.signatureImage
            )
            result.isSuccess
        } catch (e: Exception) {
            false
        }
    }

    private suspend fun processUploadAction(action: PendingActionEntity): Boolean {
        // Upload actions are more complex, handled separately
        return false
    }

    private suspend fun processUpdateFieldAction(action: PendingActionEntity): Boolean {
        return try {
            val payload = gson.fromJson(action.payload, UpdateFieldPayload::class.java)
            // Process field update
            true
        } catch (e: Exception) {
            false
        }
    }
}

// Payload data classes
data class SignActionPayload(
    val documentId: String,
    val fieldId: String,
    val signatureImage: String
)

data class UpdateFieldPayload(
    val documentId: String,
    val fieldId: String,
    val value: String
)
