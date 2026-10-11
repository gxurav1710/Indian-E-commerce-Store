package com.youpi.observer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Sticky Foreground Service ensuring the Android OS never terminates
 * the payment notification observation daemon, even under strict battery optimization.
 */
class ForegroundService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private lateinit var heartbeatScheduler: HeartbeatScheduler

    override fun onCreate() {
        super.onCreate()
        heartbeatScheduler = HeartbeatScheduler(applicationContext)

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "YoupiObserver::WakeLock").apply {
            setReferenceCounted(false)
        }

        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildForegroundNotification())
        heartbeatScheduler.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY // Automatically restart if killed by OS
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "YOUPI Payment Observer Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitors incoming UPI payment notifications in real time."
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): android.app.Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("YOUPI Observer Active")
            .setContentText("Listening for incoming bank & UPI credit notifications...")
            .setSmallIcon(android.R.drawable.ic_lock_idle_charging)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        heartbeatScheduler.stop()
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "youpi_observer_foreground_channel"
        const val NOTIFICATION_ID = 1001

        fun start(context: Context) {
            val intent = Intent(context, ForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
