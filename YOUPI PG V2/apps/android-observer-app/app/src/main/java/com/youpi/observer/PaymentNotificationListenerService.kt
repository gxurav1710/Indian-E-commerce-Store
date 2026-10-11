package com.youpi.observer

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.util.concurrent.Executors

class PaymentNotificationListenerService : NotificationListenerService() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var apiClient: ApiClient

    override fun onCreate() {
        super.onCreate()
        apiClient = ApiClient(applicationContext)
        Log.i(TAG, "YOUPI Payment Notification Listener Service created.")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val packageName = sbn.packageName ?: return

        // 1. Check if notification is from a banking / payment app
        if (!NotificationParser.isRelevantPackage(packageName)) {
            return
        }

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val title = extras.getString(Notification.EXTRA_TITLE)
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
            ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()

        Log.d(TAG, "Observed notification from $packageName: $title - $text")

        // 2. Parse credit amount, reference, and sender
        val parsed = NotificationParser.parse(
            packageName = packageName,
            title = title,
            text = text,
            postTime = sbn.postTime
        ) ?: return

        Log.i(TAG, "Extracted payment observation: ₹${parsed.amountRupees} (${parsed.amountPaise} paise) Ref: ${parsed.bankReferenceNumber}")

        // 3. Dispatch observation asynchronously to self-hosted backend
        executor.execute {
            try {
                val success = apiClient.sendObservation(parsed)
                if (success) {
                    Log.i(TAG, "Observation successfully transmitted to YOUPI PG backend.")
                } else {
                    Log.w(TAG, "Backend did not acknowledge observation transmission.")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to transmit observation: ${e.message}", e)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        executor.shutdown()
        Log.i(TAG, "YOUPI Payment Notification Listener Service destroyed.")
    }

    companion object {
        private const val TAG = "YoupiObserverService"
    }
}
