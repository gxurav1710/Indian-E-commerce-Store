# Google Cloud Console & Gmail Direct API Setup Guide for YouPI PG

This guide provides step-by-step instructions to configure your Google Cloud Console project, enable the Gmail API, configure OAuth 2.0 credentials, and obtain a persistent **Refresh Token** to connect your Gmail account directly to the YouPI PG Merchant Admin panel.

---

## Architecture Overview

YouPI PG introduces a **2-Level Verification Architecture**:
- **Level 1 Verification**: First incoming credit match detected via **Direct Gmail API** or **Android SMS Gateway** in the 5-minute payment window. Starts a 5-second dual-verification grace window.
- **Level 2 Verification**: Dual confirmation (`DUAL_VERIFIED_L2`) when **both** Gmail and SMS Gateway confirm the credit within 5 seconds.
- **Aggressive 1-Second Polling**: Background poller checks both channels every 1 second without requiring an active browser tab or manual click.

---

## Required Credentials Summary

To connect Gmail in the Merchant Admin panel (`http://localhost:5000`), you will need:
1. **Google OAuth Client ID**: e.g., `<YOUR_CLIENT_ID_FROM_GOOGLE_CONSOLE>`
2. **Google OAuth Client Secret**: e.g., `<YOUR_CLIENT_SECRET_FROM_GOOGLE_CONSOLE>`
3. **Google Refresh Token**: e.g., `<YOUR_OBTAINED_REFRESH_TOKEN>`

---

## Step-by-Step Configuration

### Step 1: Create a Google Cloud Project
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Log in with the Google Account that receives your bank credit notification emails (or your merchant admin account).
3. At the top navigation bar, click the project selection dropdown and click **"New Project"**.
4. Set **Project Name** to: `YouPI-PG-Observer`.
5. Leave Organization as *No organization* (or select your organization).
6. Click **Create** and wait a few seconds for project provisioning.

---

### Step 2: Enable the Gmail API
1. In the Google Cloud Console navigation menu (☰), go to **APIs & Services > Library**.
2. In the search box, search for: `Gmail API`.
3. Click on the **Gmail API** tile.
4. Click the blue **Enable** button.

---

### Step 3: Configure the OAuth Consent Screen
1. In the sidebar, navigate to **APIs & Services > OAuth consent screen**.
2. Under **User Type**, select **External** (or **Internal** if using Google Workspace).
3. Click **Create**.
4. Fill in the required application information:
   - **App name**: `YouPI Payment Observer`
   - **User support email**: Your Gmail address
   - **Developer contact information**: Your email address
5. Click **Save and Continue**.
6. On the **Scopes** page:
   - Click **Add or Remove Scopes**.
   - Search for `gmail.readonly` or check `.../auth/gmail.readonly` (Read all resources and their metadata).
   - Alternatively, you can use `https://mail.google.com/` for full access if restricted scopes are accepted.
   - Click **Update** and then **Save and Continue**.
7. On the **Test Users** page:
   - Click **+ Add Users**.
   - Enter your bank-linked Gmail address (the email that receives transaction alerts).
   - Click **Add**, then click **Save and Continue**.
8. Review the summary and click **Back to Dashboard**.

---

### Step 4: Create OAuth 2.0 Client Credentials
1. In the sidebar, navigate to **APIs & Services > Credentials**.
2. Click **+ Create Credentials** at the top and select **OAuth client ID**.
3. Under **Application type**, select **Web application**.
4. Under **Name**, enter: `YouPI PG Web Client`.
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5000`
   - `http://localhost:6100`
   - `https://developers.google.com`
6. Under **Authorized redirect URIs**, add **both** of the following URIs:
   - `https://developers.google.com/oauthplayground` *(Required for generating the initial Refresh Token)*
   - `http://localhost:5000/oauth2callback`
7. Click **Create**.
8. A modal will appear displaying:
   - **Your Client ID**
   - **Your Client Secret**
9. Copy both values to a safe location.

---

### Step 5: Obtain the Persistent Refresh Token using OAuth Playground
Google OAuth access tokens expire after 1 hour, but a **Refresh Token** allows the YouPI PG server to automatically fetch fresh access tokens indefinitely in the background.

1. Open [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the **Gear Icon (⚙️)** in the top right corner to open configuration settings:
   - Check the box: **"Use your own OAuth credentials"**.
   - In **OAuth Client ID**, paste your **Client ID** from Step 4.
   - In **OAuth Client secret**, paste your **Client Secret** from Step 4.
3. On the left pane under **Step 1 Select & authorize APIs**:
   - Scroll down to **Gmail API v1**.
   - Check `https://www.googleapis.com/auth/gmail.readonly` (or in the text box below, type `https://mail.google.com/`).
   - Click the blue **Authorize APIs** button.
4. Google will display a sign-in screen:
   - Select your bank-linked Gmail account.
   - If prompted with *"Google hasn't verified this app"*, click **Advanced** > **Go to YouPI Payment Observer (unsafe)**.
   - Review the requested permission and click **Continue**.
5. You will be redirected back to the OAuth Playground under **Step 2 Exchange authorization code for tokens**:
   - The authorization code will be populated automatically.
   - Click the blue button: **"Exchange authorization code for tokens"**.
6. The right panel will display the JSON response containing:
   - `refresh_token: "1//04..."`
7. Copy the **Refresh Token** string.

---

### Step 6: Connect Gmail in YouPI Merchant Panel
1. Open the YouPI Merchant Admin dashboard at `http://localhost:5000`.
2. Navigate to **📡 Payment Observers (SMS & Gmail)** (Tab 3).
3. In the **📧 Gmail Direct API** card:
   - Paste your **Google OAuth Client ID**.
   - Paste your **Google OAuth Client Secret**.
   - Paste your **Google Refresh Token**.
4. Click **💾 Save Gmail Credentials**.
5. Click **🔑 Test Connection**:
   - YouPI PG will exchange the refresh token with Google's OAuth server and query `users.getProfile`.
   - The badge will turn green: `CONFIGURED` with confirmation:
     `Connected! Authorized as yourname@gmail.com. Total messages: 1,420.`

---

## Automated Polling & Verification Flow

Once configured:
1. When a customer initiates a UPI payment, the session enters the **5-minute payment window**.
2. YouPI PG launches aggressive **1-second background pollers** across both the **Android SMS Gateway** and the **Gmail Direct API**.
3. When your bank sends an email credit alert (e.g. from HDFC, SBI, ICICI, Axis, Paytm, or Kotak):
   - The poller extracts the amount, payer VPA, and bank reference/UTR.
   - The payment is attributed as **Level 1 Verified**.
   - A **5-second grace window** starts to inspect for the companion Android SMS.
   - If Android SMS also confirms within 5s, upgraded to **Level 2 Dual Verified** (`DUAL_VERIFIED_L2`).
   - Payment is finalized as `SUCCESS` and customer checkout updates in real-time.
