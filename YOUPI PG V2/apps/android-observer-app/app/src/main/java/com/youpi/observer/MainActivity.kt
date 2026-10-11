package com.youpi.observer

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat

class MainActivity : AppCompatActivity() {
    private lateinit var apiClient: ApiClient
    private lateinit var heartbeatScheduler: HeartbeatScheduler

    private lateinit var tvStatus: TextView
    private lateinit var tvDeviceId: TextView
    private lateinit var etBaseUrl: EditText
    private lateinit var etToken: EditText
    private lateinit var btnPair: Button
    private lateinit var btnPermission: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        apiClient = ApiClient(this)
        heartbeatScheduler = HeartbeatScheduler(this)

        // Programmatic lightweight UI layout
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        val title = TextView(this).apply {
            text = "YOUPI Payment Observer"
            textSize = 22f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        layout.addView(title)

        tvStatus = TextView(this).apply {
            text = "Status: Checking..."
            textSize = 16f
            setPadding(0, 24, 0, 12)
        }
        layout.addView(tvStatus)

        tvDeviceId = TextView(this).apply {
            text = "Device ID: -"
            textSize = 12f
            setPadding(0, 0, 0, 24)
        }
        layout.addView(tvDeviceId)

        btnPermission = Button(this).apply {
            text = "Grant Notification Listener Access"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }
        layout.addView(btnPermission)

        etBaseUrl = EditText(this).apply {
            hint = "Gateway URL (e.g. http://192.168.1.100:6100)"
            setText(apiClient.getBaseUrl())
        }
        layout.addView(etBaseUrl)

        etToken = EditText(this).apply {
            hint = "Enrollment Token"
        }
        layout.addView(etToken)

        btnPair = Button(this).apply {
            text = "Pair with Merchant Gateway"
            setOnClickListener {
                performPairing()
            }
        }
        layout.addView(btnPair)

        setContentView(layout)
        updateStatus()
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun updateStatus() {
        val hasPermission = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
        btnPermission.isEnabled = !hasPermission
        btnPermission.text = if (hasPermission) "✓ Notification Access Granted" else "Grant Notification Listener Access"

        if (apiClient.isPaired()) {
            tvStatus.text = "Status: CONNECTED (Active Observer)"
            tvStatus.setTextColor(android.graphics.Color.parseColor("#047857"))
            heartbeatScheduler.start()
        } else {
            tvStatus.text = "Status: NOT PAIRED"
            tvStatus.setTextColor(android.graphics.Color.parseColor("#b91c1c"))
            heartbeatScheduler.stop()
        }
    }

    private fun performPairing() {
        val url = etBaseUrl.text.toString().trim()
        val token = etToken.text.toString().trim()

        if (url.isEmpty() || token.isEmpty()) {
            Toast.makeText(this, "Please enter Gateway URL and Token", Toast.LENGTH_SHORT).show()
            return
        }

        Thread {
            val success = apiClient.pair(url, token, android.os.Build.MODEL)
            runOnUiThread {
                if (success) {
                    Toast.makeText(this, "Device Paired Successfully!", Toast.LENGTH_LONG).show()
                    updateStatus()
                } else {
                    Toast.makeText(this, "Pairing Failed. Check URL and Token.", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }
}
