package com.youpi.observer

import android.content.Context
import android.os.Handler
import android.os.Looper

class HeartbeatScheduler(private val context: Context) {
    private val apiClient = ApiClient(context)
    private val handler = Handler(Looper.getMainLooper())
    private var isRunning = false

    private val runnable = object : Runnable {
        override fun run() {
            if (!isRunning) return
            Thread {
                apiClient.sendHeartbeat()
            }.start()
            handler.postDelayed(this, 60000) // Every 60 seconds
        }
    }

    fun start() {
        if (isRunning) return
        isRunning = true
        handler.post(runnable)
    }

    fun stop() {
        isRunning = false
        handler.removeCallbacks(runnable)
    }
}
