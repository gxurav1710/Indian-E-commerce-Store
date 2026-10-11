package com.youpi.observer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log

/**
 * BroadcastReceiver listening for incoming SMS on the Android device.
 * Automatically extracts the bank SMS body, sender, and timestamp,
 * and securely forwards it to the paired YouPI PG Merchant Gateway.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            if (messages.isNullOrEmpty()) return

            val apiClient = ApiClient(context)
            if (!apiClient.isPaired()) {
                Log.w("SmsReceiver", "App not paired with merchant panel. Ignoring SMS.")
                return
            }

            for (sms in messages) {
                val sender = sms.originatingAddress ?: "UNKNOWN"
                val body = sms.messageBody ?: ""
                val timestamp = sms.timestampMillis

                Log.d("SmsReceiver", "Captured incoming bank SMS from $sender: length=${body.length}")

                Thread {
                    val success = apiClient.sendSms(sender, body, timestamp)
                    Log.d("SmsReceiver", "Dispatched SMS to YouPI Gateway: success=$success")
                }.start()
            }
        }
    }
}
