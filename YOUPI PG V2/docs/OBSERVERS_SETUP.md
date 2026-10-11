# Payment Observers Setup & Configuration Guide

YOUPI PG employs a **Tri-Channel Observation Engine** where all three methods operate simultaneously to capture payment credit alerts across channels without creating duplicate payments.

---

## Method 1: Gmail Payment Observer

### How It Works
1. Merchant connects their Gmail account via standard Google OAuth2.
2. The Gmail Observer polls messages using Gmail API with filter:
   `subject:(credited OR "UPI" OR "received") is:unread`
3. Extracts amount, bank reference number (UTR), and sender VPA.
4. Normalizes and submits to `POST /api/v1/pollers/events`.

### Setup Steps
1. Create a Google Cloud Project in Google Cloud Console.
2. Enable the **Gmail API**.
3. Create OAuth 2.0 Credentials:
   - Application type: Web application
   - Authorized redirect URI: `http://localhost:6003/oauth/callback` (or your domain)
4. Add credentials to `.env`:
   ```env
   GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GMAIL_CLIENT_SECRET=your-client-secret
   GMAIL_REDIRECT_URI=http://localhost:6003/oauth/callback
   ```
5. Navigate to `http://localhost:6003/oauth/url` or Merchant Admin to authorize your Gmail account.

---

## Method 2: Android Payment Observer

### How It Works
1. An Android phone with your business receiving SIM/banking apps (PhonePe, GPay, Paytm, BHIM, Bank Apps) runs the native Kotlin app `apps/android-observer-app`.
2. The app uses Android's `NotificationListenerService` to capture incoming status bar notifications.
3. Automatically extracts the amount and UTR.
4. Cryptographically signs the payload with `HMAC-SHA256(signingKey, body + ":" + timestamp)`.
5. Transmits observation to `POST /api/v1/pollers/android/events`.
6. Submits heartbeat to `POST /api/v1/pollers/android/heartbeat` every 60s.

### Pairing Procedure
1. Open Merchant Admin (`http://localhost:6001`).
2. Go to **Observers & Pairing** tab -> Click **+ Pair Android Device**.
3. Open the YOUPI Observer app on your Android device.
4. Enter or scan the Gateway URL and Enrollment Token.
5. Tap **Pair with Merchant Gateway**. The device will receive its permanent `deviceId` and `signingKey` stored in `EncryptedSharedPreferences`.
6. Grant Notification Listener Access in Android System Settings.

---

## Method 3: Google Messages / SMS Observer

### How It Works
1. Connects to incoming bank SMS credit alerts via Google Messages Web automation session or SMS gateway forwarder.
2. `apps/sms-observer` parses SMS text:
   - Identifies credit alerts from `VK-SBIUPI`, `VM-HDFCBK`, `AXISBK`, `ICICIB`, etc.
   - Extracts amount and reference number.
3. Submits normalized canonical observation to `POST /api/v1/pollers/events`.
4. Filters out all debits and unrelated notifications.
