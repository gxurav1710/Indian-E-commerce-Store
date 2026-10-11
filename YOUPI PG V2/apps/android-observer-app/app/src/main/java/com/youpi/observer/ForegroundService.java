package com.youpi.observer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

public class ForegroundService extends Service {
    public static final String CHANNEL_ID = "youpi_gateway_foreground_channel";
    public static final int NOTIFICATION_ID = 1001;
    private static final String TAG = "YoupiForegroundService";

    private PowerManager.WakeLock wakeLock;
    private ApiClient apiClient;
    private Handler heartbeatHandler;
    private Runnable heartbeatRunnable;

    @Override
    public void onCreate() {
        super.onCreate();
        apiClient = new ApiClient(this);

        // 1. Acquire WakeLock to prevent CPU sleeping during deep background
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "YoupiGateway::ForegroundWakeLock");
                wakeLock.acquire(24 * 60 * 60 * 1000L); // 24 hours safeguard
            }
        } catch (Exception e) {
            Log.w(TAG, "WakeLock acquisition notice: " + e.getMessage());
        }

        // 2. Create notification channel and start foreground service with persistent sticky notification
        createNotificationChannel();
        Notification notification = buildPersistentNotification();
        startForeground(NOTIFICATION_ID, notification);

        // 3. Heartbeat loop (every 30 seconds)
        heartbeatHandler = new Handler(Looper.getMainLooper());
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                if (apiClient.isPaired()) {
                    new Thread(new Runnable() {
                        @Override
                        public void run() {
                            apiClient.sendHeartbeat();
                        }
                    }).start();
                }
                heartbeatHandler.postDelayed(this, 30000);
            }
        };
        heartbeatHandler.postDelayed(heartbeatRunnable, 5000);
        Log.i(TAG, "YOUPI Foreground Service started successfully.");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY; // Tell Android to recreate service if killed
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "YOUPI SMS & UPI Gateway Daemon",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Maintains continuous background listening for bank credit SMS and UPI payments.");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildPersistentNotification() {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openApp, flags);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        builder.setContentTitle("YOUPI Gateway Active")
               .setContentText("24/7 background listener active for Bank SMS & UPI payments")
               .setSmallIcon(android.R.drawable.stat_notify_chat)
               .setContentIntent(pendingIntent)
               .setOngoing(true); // Persistent notification cannot be swiped away

        return builder.build();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (heartbeatHandler != null && heartbeatRunnable != null) {
            heartbeatHandler.removeCallbacks(heartbeatRunnable);
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
        Log.i(TAG, "YOUPI Foreground Service stopped.");
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void start(Context context) {
        try {
            Intent serviceIntent = new Intent(context, ForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to start ForegroundService: " + e.getMessage());
        }
    }
}
