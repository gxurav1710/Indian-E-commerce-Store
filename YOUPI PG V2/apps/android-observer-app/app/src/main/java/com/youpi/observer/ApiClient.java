package com.youpi.observer;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public class ApiClient {
    private static final String TAG = "YoupiApiClient";
    private static final String PREFS_NAME = "youpi_gateway_prefs";
    private final SharedPreferences prefs;
    private final Context context;

    public ApiClient(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public boolean isPaired() {
        return prefs.getString("device_id", null) != null && prefs.getString("signing_key", null) != null;
    }

    public String getBaseUrl() {
        return prefs.getString("base_url", "http://10.0.2.2:6100");
    }

    public String getDeviceId() {
        return prefs.getString("device_id", "-");
    }

    public boolean pair(String baseUrl, String enrollmentToken, String deviceName) {
        return pair(baseUrl, enrollmentToken, deviceName, "00000000-0000-0000-0000-000000000001", "v1", 0);
    }

    public boolean pair(String baseUrl, String enrollmentToken, String deviceName, String merchantId, String version, long expiresAt) {
        String cleanUrl = baseUrl.replaceAll("/+$", "");
        String endpoint = cleanUrl + "/api/v1/pollers/android/pair";

        try {
            JSONObject body = new JSONObject();
            body.put("version", version != null ? version : "v1");
            body.put("enrollmentToken", enrollmentToken);
            body.put("merchantId", merchantId != null ? merchantId : "00000000-0000-0000-0000-000000000001");
            if (expiresAt > 0) body.put("expiresAt", expiresAt);
            body.put("deviceName", deviceName != null && !deviceName.isEmpty() ? deviceName : Build.MODEL);
            body.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);

            String response = postJson(endpoint, body.toString(), null, null, null);
            if (response == null) return false;

            JSONObject json = new JSONObject(response);
            if (json.optBoolean("paired", false) || json.has("deviceId")) {
                String deviceId = json.getString("deviceId");
                String signingKey = json.getString("signingKey");

                prefs.edit()
                    .putString("base_url", cleanUrl)
                    .putString("device_id", deviceId)
                    .putString("signing_key", signingKey)
                    .putString("merchant_id", merchantId)
                    .apply();

                Log.i(TAG, "Device paired successfully: " + deviceId);
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "Pairing error: " + e.getMessage(), e);
        }
        return false;
    }

    public boolean sendSms(String sender, String body, long timestamp) {
        if (!isPaired()) return false;

        String deviceId = prefs.getString("device_id", null);
        String signingKey = prefs.getString("signing_key", null);
        String baseUrl = getBaseUrl();
        String endpoint = baseUrl + "/api/v1/observers/sms";

        try {
            String tsStr = String.valueOf(timestamp > 0 ? timestamp : System.currentTimeMillis());
            JSONObject json = new JSONObject();
            json.put("deviceId", deviceId);
            json.put("sender", sender != null ? sender : "UNKNOWN");
            json.put("body", body != null ? body : "");
            json.put("timestamp", Long.parseLong(tsStr));

            String bodyString = json.toString();
            String sigPayload = bodyString + ":" + tsStr;
            String signature = calculateHmacSha256(sigPayload, signingKey);

            String response = postJson(endpoint, bodyString, deviceId, tsStr, signature);
            Log.i(TAG, "SMS dispatched to YouPI Gateway: " + (response != null ? "OK" : "FAILED"));
            return response != null;
        } catch (Exception e) {
            Log.e(TAG, "sendSms error: " + e.getMessage(), e);
        }
        return false;
    }

    public boolean sendHeartbeat() {
        if (!isPaired()) return false;

        String deviceId = prefs.getString("device_id", null);
        String baseUrl = getBaseUrl();
        String endpoint = baseUrl + "/api/v1/pollers/android/heartbeat";

        try {
            JSONObject json = new JSONObject();
            json.put("deviceId", deviceId);
            json.put("timestamp", System.currentTimeMillis());
            json.put("batteryPercent", 100);
            json.put("isCharging", true);

            String response = postJson(endpoint, json.toString(), deviceId, null, null);
            return response != null;
        } catch (Exception e) {
            Log.e(TAG, "Heartbeat error: " + e.getMessage());
        }
        return false;
    }

    public boolean sendObservation(long amountPaise, double amount, String bankRef, String senderVpa, String title, String text) {
        if (!isPaired()) return false;

        String deviceId = prefs.getString("device_id", null);
        String signingKey = prefs.getString("signing_key", null);
        String baseUrl = getBaseUrl();
        String endpoint = baseUrl + "/api/v1/pollers/android/events";

        try {
            String tsStr = String.valueOf(System.currentTimeMillis());
            JSONObject raw = new JSONObject();
            raw.put("title", title != null ? title : "");
            raw.put("text", text != null ? text : "");

            JSONObject json = new JSONObject();
            json.put("deviceId", deviceId);
            json.put("amountPaise", amountPaise);
            json.put("amount", amount);
            json.put("bankReferenceNumber", bankRef);
            json.put("senderVpa", senderVpa);
            json.put("observedAt", System.currentTimeMillis());
            json.put("rawNotification", raw);

            String bodyString = json.toString();
            String sigPayload = bodyString + ":" + tsStr;
            String signature = calculateHmacSha256(sigPayload, signingKey);

            String response = postJson(endpoint, bodyString, deviceId, tsStr, signature);
            return response != null;
        } catch (Exception e) {
            Log.e(TAG, "sendObservation error: " + e.getMessage());
        }
        return false;
    }

    public void unpair() {
        prefs.edit().remove("device_id").remove("signing_key").apply();
    }

    private String postJson(String urlString, String jsonBody, String deviceId, String timestamp, String signature) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);

            if (deviceId != null) {
                conn.setRequestProperty("X-Device-Id", deviceId);
            }
            if (timestamp != null) {
                conn.setRequestProperty("X-Timestamp", timestamp);
            }
            if (signature != null) {
                conn.setRequestProperty("X-Signature", signature);
            }

            byte[] input = jsonBody.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(input, 0, input.length);
            }

            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) return null;

            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
            }

            return (code >= 200 && code < 300) ? sb.toString() : null;
        } catch (Exception e) {
            Log.e(TAG, "postJson to " + urlString + " failed: " + e.getMessage());
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String calculateHmacSha256(String data, String key) throws Exception {
        Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
        SecretKeySpec secret_key = new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        sha256_HMAC.init(secret_key);
        byte[] rawHmac = sha256_HMAC.doFinal(data.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte b : rawHmac) {
            result.append(String.format("%02x", b));
        }
        return result.toString();
    }
}
