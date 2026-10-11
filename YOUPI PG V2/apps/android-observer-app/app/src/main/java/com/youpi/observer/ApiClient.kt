package com.youpi.observer

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class ApiClient(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
    private val prefs = EncryptedSharedPreferences.create(
        "youpi_observer_secure_prefs",
        masterKeyAlias,
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun isPaired(): Boolean {
        return prefs.getString("device_id", null) != null && prefs.getString("signing_key", null) != null
    }

    fun getBaseUrl(): String {
        return prefs.getString("base_url", "http://10.0.2.2:6100") ?: "http://10.0.2.2:6100"
    }

    fun pair(baseUrl: String, enrollmentToken: String, deviceName: String): Boolean {
        val cleanUrl = baseUrl.trimEnd('/')
        val url = "$cleanUrl/api/v1/pollers/android/pair"

        val bodyJson = JSONObject().apply {
            put("enrollmentToken", enrollmentToken)
            put("deviceName", deviceName)
            put("deviceModel", android.os.Build.MODEL)
        }

        val request = Request.Builder()
            .url(url)
            .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return false
                val respBody = response.body?.string() ?: return false
                val json = JSONObject(respBody)

                if (json.optBoolean("paired", false)) {
                    val deviceId = json.getString("deviceId")
                    val signingKey = json.getString("signingKey")

                    prefs.edit()
                        .putString("base_url", cleanUrl)
                        .putString("device_id", deviceId)
                        .putString("signing_key", signingKey)
                        .apply()

                    return true
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return false
    }

    fun sendObservation(parsed: ParsedNotification): Boolean {
        if (!isPaired()) return false

        val deviceId = prefs.getString("device_id", null) ?: return false
        val signingKey = prefs.getString("signing_key", null) ?: return false
        val baseUrl = getBaseUrl()

        val timestamp = System.currentTimeMillis().toString()
        val url = "$baseUrl/api/v1/pollers/android/events"

        val rawNotification = JSONObject().apply {
            put("title", parsed.rawTitle)
            put("text", parsed.rawText)
            put("package", parsed.packageName)
        }

        val bodyJson = JSONObject().apply {
            put("deviceId", deviceId)
            put("amountPaise", parsed.amountPaise)
            put("amount", parsed.amountRupees)
            put("observedAt", parsed.timestamp)
            put("bankReferenceNumber", parsed.bankReferenceNumber)
            put("senderVpa", parsed.senderVpa)
            put("rawNotification", rawNotification)
        }

        val bodyString = bodyJson.toString()
        val sigPayload = "$bodyString:$timestamp"
        val signature = calculateHmac(sigPayload, signingKey)

        val request = Request.Builder()
            .url(url)
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Timestamp", timestamp)
            .addHeader("X-Signature", signature)
            .post(bodyString.toRequestBody("application/json".toMediaType()))
            .build()

        try {
            client.newCall(request).execute().use { res ->
                return res.isSuccessful
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return false
    }

    fun sendHeartbeat(): Boolean {
        if (!isPaired()) return false

        val deviceId = prefs.getString("device_id", null) ?: return false
        val baseUrl = getBaseUrl()
        val url = "$baseUrl/api/v1/pollers/android/heartbeat"

        val bodyJson = JSONObject().apply {
            put("deviceId", deviceId)
            put("timestamp", System.currentTimeMillis())
        }

        val request = Request.Builder()
            .url(url)
            .addHeader("X-Device-Id", deviceId)
            .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
            .build()

        try {
            client.newCall(request).execute().use { res ->
                return res.isSuccessful
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return false
    }

    fun sendSms(sender: String, body: String, timestamp: Long): Boolean {
        if (!isPaired()) return false

        val deviceId = prefs.getString("device_id", null) ?: return false
        val signingKey = prefs.getString("signing_key", null) ?: return false
        val baseUrl = getBaseUrl()

        val tsStr = timestamp.toString()
        val url = "$baseUrl/api/v1/observers/sms"

        val bodyJson = JSONObject().apply {
            put("deviceId", deviceId)
            put("sender", sender)
            put("body", body)
            put("timestamp", timestamp)
        }

        val bodyString = bodyJson.toString()
        val sigPayload = "$bodyString:$tsStr"
        val signature = calculateHmac(sigPayload, signingKey)

        val request = Request.Builder()
            .url(url)
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Timestamp", tsStr)
            .addHeader("X-Signature", signature)
            .post(bodyString.toRequestBody("application/json".toMediaType()))
            .build()

        try {
            client.newCall(request).execute().use { res ->
                return res.isSuccessful
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return false
    }

    private fun calculateHmac(data: String, keyHex: String): String {
        val secret = SecretKeySpec(keyHex.toByteArray(Charsets.UTF_8), "HmacSHA256")
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(secret)
        val hmacData = mac.doFinal(data.toByteArray(Charsets.UTF_8))
        return hmacData.joinToString("") { "%02x".format(it) }
    }
}
