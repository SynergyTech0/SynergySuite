package com.synergysign.app.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.synergysign.app.R
import com.synergysign.app.data.repository.TokenRepository
import com.synergysign.app.presentation.MainActivity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class SynergySignFirebaseMessagingService : FirebaseMessagingService() {

    @Inject
    lateinit var tokenRepository: TokenRepository

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    companion object {
        const val CHANNEL_ID = "synergysign_notifications"
        const val CHANNEL_NAME = "SynergySign Notifications"
        const val CHANNEL_DESCRIPTION = "Notifications for document signing requests"
        
        // Notification types
        const val TYPE_SIGN_REQUEST = "sign_request"
        const val TYPE_DOCUMENT_COMPLETED = "document_completed"
        const val TYPE_DOCUMENT_VIEWED = "document_viewed"
        const val TYPE_REMINDER = "reminder"
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // Save the new FCM token to send to server
        serviceScope.launch {
            tokenRepository.saveFcmToken(token)
            // TODO: Send token to backend server
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        // Create notification channel (required for Android 8.0+)
        createNotificationChannel()

        // Handle notification payload
        remoteMessage.notification?.let { notification ->
            showNotification(
                title = notification.title ?: "SynergySign",
                body = notification.body ?: "",
                data = remoteMessage.data
            )
        }

        // Handle data payload
        if (remoteMessage.data.isNotEmpty()) {
            handleDataMessage(remoteMessage.data)
        }
    }

    private fun handleDataMessage(data: Map<String, String>) {
        val type = data["type"]
        val documentId = data["documentId"]
        val title = data["title"] ?: "SynergySign"
        val body = data["body"] ?: ""

        when (type) {
            TYPE_SIGN_REQUEST -> {
                showNotification(
                    title = "Signature Request",
                    body = body.ifEmpty { "You have a new document to sign" },
                    data = data,
                    documentId = documentId
                )
            }
            TYPE_DOCUMENT_COMPLETED -> {
                showNotification(
                    title = "Document Completed",
                    body = body.ifEmpty { "A document has been fully signed" },
                    data = data,
                    documentId = documentId
                )
            }
            TYPE_DOCUMENT_VIEWED -> {
                showNotification(
                    title = "Document Viewed",
                    body = body.ifEmpty { "Someone viewed your document" },
                    data = data,
                    documentId = documentId
                )
            }
            TYPE_REMINDER -> {
                showNotification(
                    title = "Signing Reminder",
                    body = body.ifEmpty { "Don't forget to sign your pending document" },
                    data = data,
                    documentId = documentId
                )
            }
            else -> {
                showNotification(title = title, body = body, data = data)
            }
        }
    }

    private fun showNotification(
        title: String,
        body: String,
        data: Map<String, String> = emptyMap(),
        documentId: String? = null
    ) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            documentId?.let { putExtra("documentId", it) }
            data.forEach { (key, value) -> putExtra(key, value) }
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notificationBuilder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(System.currentTimeMillis().toInt(), notificationBuilder.build())
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = CHANNEL_DESCRIPTION
                enableVibration(true)
                enableLights(true)
            }

            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }
}
