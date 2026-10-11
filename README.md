<p align="center">
  <img src="https://img.shields.io/badge/Sovereign-E--Commerce_Platform-6366f1?style=for-the-badge&logo=shopify&logoColor=white" alt="Sovereign E-Commerce" />
  <img src="https://img.shields.io/badge/Payments-YouPi_PG_V2-10b981?style=for-the-badge&logo=upi&logoColor=white" alt="YouPi PG V2" />
  <img src="https://img.shields.io/badge/WhatsApp-Berry_Protocol-22c55e?style=for-the-badge&logo=whatsapp&logoColor=white" alt="Berry Protocol" />
  <img src="https://img.shields.io/badge/Database-Native_SQLite_WAL-0284c7?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite WAL" />
  <img src="https://img.shields.io/badge/Zero--Fee-100%25_Decentralized-f59e0b?style=for-the-badge" alt="Zero Fee" />
</p>

<h1 align="center">Unified Sovereign E-Commerce Platform</h1>

<p align="center">
  <strong>Enterprise-Grade, Zero-Aggregator E-Commerce Ecosystem with Embedded YouPi PG V2 UPI Payment Gateway & Berry Protocol WhatsApp Automation Engine.</strong>
</p>

<p align="center">
  <a href="#-architectural-overview">Architecture</a> •
  <a href="#-the-sovereign-trinity">The Sovereign Trinity</a> •
  <a href="#-deep-attribution--core-engines">Attributions</a> •
  <a href="#-microservices--port-matrix">Port Matrix</a> •
  <a href="#-quickstart-guide">Quickstart</a> •
  <a href="#-operator--merchant-walkthrough">Operator Walkthrough</a> •
  <a href="#-production-deployment">Production</a>
</p>

---

## 🌟 Executive Summary

The **Unified Sovereign E-Commerce Platform** is a complete, self-hosted, commercial-grade digital retail infrastructure built from the ground up to free merchants from SaaS monopolies, aggregator transaction levies, and compliance lockdowns.

Unlike conventional store stacks that depend on Shopify subscriptions, 2–3% payment gateway surcharges (Razorpay, Cashfree, Stripe), and costly WhatsApp Business Cloud API per-conversation billing, this platform operates **100% self-hosted on your own host** with native `node:sqlite` WAL persistence, instant peer-to-peer UPI settlements, and native WhatsApp socket automation.

```
                              ┌────────────────────────────────────────┐
                              │     UNIFIED SOVEREIGN E-COMMERCE       │
                              │           PLATFORM CLUSTER             │
                              └──────────────────┬─────────────────────┘
                                                 │
          ┌──────────────────────────────────────┼──────────────────────────────────────┐
          ▼                                      ▼                                      ▼
┌───────────────────┐                  ┌───────────────────┐                  ┌───────────────────┐
│  RETAIL ENGINE    │                  │  PAYMENT ENGINE   │                  │ AUTOMATION ENGINE │
│   (Storefront &   │                  │   (YouPi PG V2    │                  │ (Berry Protocol   │
│  Business Admin)  │                  │  Payment Gateway) │                  │  WhatsApp Stack)  │
└─────────┬─────────┘                  └─────────┬─────────┘                  └─────────┬─────────┘
          │                                      │                                      │
          │ • Customer Store (Port 5000)         │ • UPI Payment API (Port 6100)        │ • Socket Daemon (Port 4001)
          │ • Business Admin (Port 5050)         │ • Dynamic Portal (Port 7000)         │ • Pair Dashboard (Port 4002)
          │ • Commerce API (Port 5001)           │ • Merchant Portal (Port 6001)        │ • Customer Phone OTP Auth
          │ • Matrix Variant Engine              │ • SMS Observer (Port 6002)           │ • Instant Order Alerts
          │ • Cart Auto-Merge                    │ • Gmail Observer (Port 6003)         │ • Payment Receipt Dispatches
          │ • Operator Supervisor (8090)         │ • Vector SVG QR & Intents            │ • Live Dispatch Tracking
          └──────────────────────────────────────┴──────────────────────────────────────┘
                                                 │
                              ┌──────────────────┴─────────────────────┐
                              │       CORE HANDLER DAEMON SUPERVISOR   │
                              │  Process Manager • Health Heartbeats   │
                              │      Telegram Alerts • Auto-Restart    │
                              └────────────────────────────────────────┘
```

---

## 🔱 The Sovereign Trinity

The platform is designed around three tightly integrated, autonomous engines that work harmoniously as a unified collective:

### 1. 🛍️ Sovereign Commerce Suite
- **High-Converting Customer Storefront (`:5000`)**: Fluid product catalogs, instant cart persistence, matrix SKU variant switching, customer review galleries with media-misuse guardrails, and one-script checkout trigger.
- **Merchant Business Admin Panel (`:5050`)**: Real-time order management, dynamic product inventory matrix, discount coupons, return policies, and live store branding customization.
- **Commerce REST API (`:5001`)**: High-throughput catalog, cart merging, order lifecycle handling, and HMAC-SHA256 signature verification.
- **Central Operator Control Center (`:8090`)**: Live process clustering, cluster restart triggers, environment switcher (Localhost ↔ Cloudflare Production), and real-time host telemetry.

### 2. ⚡ YouPi PG V2 — Sovereign UPI Payment Gateway
- **Zero-Fee Peer-to-Peer Settlements**: Payments go directly from the buyer's UPI app to the store owner's bank account with **0.0% gateway commission**.
- **Vector SVG QR Code Generation**: Pure vector mathematical SVG QR generation with instant mobile deep-linking for Google Pay, PhonePe, Paytm, CRED, and BHIM.
- **Automated Banking Observers**: Android cellular SMS and Gmail IMAP credit observers verify incoming transactions in real time without official banking licenses.
- **Decoupled Dual Timers**: 5-minute immutable payment window and a high-frequency 30-second verification countdown.
- **Authoritative Server-to-Server Webhooks**: Cryptographically signed HMAC-SHA256 webhooks guarantee that orders are marked paid strictly upon bank-verified credits.

### 3. 💬 Berry Protocol — Autonomous WhatsApp Lifecycle Engine
- **Zero-Cost Conversational Rail**: Eliminates per-template and per-conversation fees charged by Meta / WhatsApp Business API providers.
- **QR Socket Multi-Device Pairing**: Connects any standard WhatsApp business number via instant multi-device QR scan (`:4002`).
- **Autonomous OTP Verification**: Pre-checkout customer telephone validation prevents fake orders and cart abandonment.
- **Automated Customer Communications**:
  - 📦 *Order Placed*: Instant confirmation message with order summary and items.
  - 💳 *Payment Confirmed*: Official verified digital receipt with bank UTR and timestamp.
  - 🚚 *Out for Delivery*: Live shipment tracking link and courier notifications.
  - 🔔 *Store Owner Alerts*: Instant real-time alerts to the merchant's personal WhatsApp on every completed sale.

---

## 🛡️ Deep Technical Attribution

### 💳 Attribution to YouPi PG V2
The payment infrastructure of this platform is powered by the **YouPi PG V2** payment gateway engine (embedded in `YOUPI PG V2/` and also distributed as a standalone package). 

Key architectural components provided by YouPi PG V2:
- **`@youpi/core`**: Houses the **Attribution Engine**, **Timing Engine**, **Queue Engine**, and **Payment Verification Pipeline** which prevent race conditions on receiving accounts through a strict Single-Active-Slot FIFO queue.
- **`@youpi/db`**: High-performance SQLite schema models governing payment sessions, receiving account VPAs, transaction observations, support tickets, and audit logs.
- **`youpi.js` Universal Script SDK**: The client-side one-script checkout library hosted on the checkout portal (`:7000`) and storefront (`:5000`), emitting normalized DOM `CustomEvent`s (`youpi:payment:success`, `youpi:payment:failed`, `youpi:payment:cancelled`, `youpi:payment:expired`).
- **Banking Observer Subsystem**:
  - `sms-observer` (`:6002`): Parses incoming cellular bank SMS alerts forwarded from merchant Android devices.
  - `gmail-observer` (`:6003`): Polls and validates incoming bank credit notification emails.

### 💬 Attribution to Berry Protocol
The customer communication, verification, and automated notification subsystem is driven by the **Berry Protocol** WhatsApp socket automation stack.

Key architectural components provided by Berry Protocol:
- **`whatsapp-worker` (`:4001`)**: The headless daemon maintaining persistent encrypted WebSocket sessions with WhatsApp servers, managing session credentials, and driving the message queue.
- **`whatsapp-dashboard` (`:4002`)**: The visual browser terminal allowing merchants to pair their WhatsApp device in 5 seconds via dynamic QR scanning.
- **Automated Lifecycle Dispatcher**: Seamlessly connects with the commerce platform's `notification-service` (`:5002`) to render localized notification templates with dynamic variables (`{{customer_name}}`, `{{order_id}}`, `{{amount}}`, `{{tracking_url}}`).

---

## 🌐 Microservices & Port Matrix

The platform orchestrates 15 decoupled microservices concurrently under the **Core Handler** supervisor. Every service runs on its own isolated loopback port with zero port conflicts:

| Service Name | Port | Access URL | Engine / Subsystem | Primary Responsibility |
| :--- | :---: | :--- | :--- | :--- |
| **Storefront** | `5000` | `http://localhost:5000` | Commerce Suite | High-converting customer-facing web store |
| **Business Admin Panel** | `5050` | `http://localhost:5050` | Commerce Suite | Catalog, variants, orders, branding settings |
| **Commerce REST API** | `5001` | `http://localhost:5001` | Commerce Suite | Carts, checkout creation, signed webhook ingestion |
| **Operator Control Center** | `8090` | `http://localhost:8090` | Core Supervisor | Cluster process manager & host monitor |
| **Core Handler / Health** | `8085` | `http://localhost:8085` | Core Supervisor | Central health check API & supervisor daemon |
| **Notification Service** | `5002` | `http://localhost:5002` | Notification Stack | WhatsApp/Telegram/SMS alert router |
| **Shipping & Logistics** | `5003` | `http://localhost:5003` | Logistics Stack | Rate calculations & Shiprocket integration |
| **WhatsApp Auth API** | `4000` | `http://localhost:4000` | Berry Protocol | Customer WhatsApp OTP issuance & validation |
| **WhatsApp Worker Engine** | `4001` | `http://localhost:4001` | Berry Protocol | Headless WhatsApp session manager & socket |
| **WhatsApp Pairing Console** | `4002` | `http://localhost:4002` | Berry Protocol | Interactive QR device pairing dashboard |
| **YouPi Payment Core API** | `6100` | `http://localhost:6100` | YouPi PG V2 | Payment state machine, attribution & queue |
| **YouPi Checkout Portal** | `7000` | `http://localhost:7000` | YouPi PG V2 | Dynamic vector SVG QR codes & UPI intent links |
| **YouPi Merchant Admin** | `6001` | `http://localhost:6001` | YouPi PG V2 | Merchant UPI receiving accounts (VPAs) & audit |
| **YouPi SMS Observer** | `6002` | `http://localhost:6002` | YouPi PG V2 | Android bank SMS notification receiver |
| **YouPi Gmail Observer** | `6003` | `http://localhost:6003` | YouPi PG V2 | Bank email credit notification ingester |

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- **Node.js**: Version `>= 20.0.0` (Node 22 LTS or Node 24 recommended).
- **Native Operating System**: Fully supported on Windows, Linux, and macOS.
- **Zero External Database Requirement**: Ships with native `node:sqlite` in Write-Ahead Logging (WAL) mode. Zero PostgreSQL, Redis, or Docker containers required.

### 2. Configure Credentials (`.env`)
Copy `.env.example` to `.env` (or customize the existing `.env`):

```bash
# 1. Administrator Password
ADMIN_PASSWORD=YourSecurePassword123!
UNIVERSAL_ADMIN_PASSWORD=YourSecurePassword123!

# 2. WhatsApp Numbers (International E.164 format with country code)
STORE_OWNER_WHATSAPP=+919876543210
WHATSAPP_BOT_PHONE=+919876543211

# 3. Environment & Domain
ENVIRONMENT_MODE=DEVELOPMENT
PRIMARY_DOMAIN=localhost
DOMAIN_EXTENSION=.shop

# 4. Payment Gateway Webhook Secret
MERCHANT_WEBHOOK_SECRET=unified_store_webhook_secret_for_payment_verification
```

### 3. Launch the Entire Platform
- **Windows**: Double-click [`START_PLATFORM.bat`](file:///d:/ECOM%20AND%20YOUPI%20PG%20INTEGRATION/E-Commerce%20PACKAGE/START_PLATFORM.bat) or execute:
  ```cmd
  START_PLATFORM.bat
  ```
- **Linux / macOS / VPS**: Run:
  ```bash
  bash start_platform.sh
  ```

All 15 microservices will boot concurrently, initialize their SQLite databases automatically, and begin health monitoring.

---

## 🛠️ Operator & Merchant Walkthrough

### Step 1: Log in to Business Admin
1. Open `http://localhost:5050` in your browser.
2. Enter your password from `.env` (Default: `AdminPassword123!`).
3. You can now add products, configure multi-tier variants (Size, Color, Material), manage coupons, and track customer orders.

### Step 2: Configure Your Payment Receiving UPI VPA
1. Navigate to the **YouPi Merchant Portal** at `http://localhost:6001`.
2. Click **UPI Receiving Accounts** in the sidebar.
3. Click **+ Add Receiving Account**:
   - **UPI ID / VPA**: Enter your actual bank UPI ID (e.g. `yourbusiness@okhdfcbank` or `merchant@paytm`).
   - **Payee Name**: Enter your legal merchant display name (e.g. `Acme Enterprises`).
4. Toggle **Active** to enabled.
5. All storefront checkouts will now generate dynamic vector QR codes and deep links paying directly into your bank account with zero intermediary deductions.

### Step 3: Pair Your Store's WhatsApp Number
1. Navigate to the **WhatsApp Dashboard** at `http://localhost:4002`.
2. Open WhatsApp on your phone → **Linked Devices** → **Link a Device**.
3. Scan the QR code displayed on the screen.
4. Once paired, the Berry Protocol engine will automatically handle customer OTP validations, order updates, payment confirmations, and owner purchase notifications.

### Step 4: Access Operator Control Center
1. Open `http://localhost:8090` in your browser.
2. Username: `operator` | Password: `OperatorPassword123!` (from `.env`).
3. View real-time cluster memory metrics, service health statuses, logs, and toggle between local testing and Cloudflare production domain routing.

---

## 💳 Payment Gateway Integration & Webhook Security

The storefront communicates with YouPi PG V2 via two redundant, secure channels:

```
[ Customer Browser ] ────(1) Youpi.pay() Modal────► [ YouPi Checkout Portal :7000 ]
         │                                                        │
   (2) UI Events                                            (3) UPI Payment
(youpi:payment:success)                                     via Bank Rails
         │                                                        │
         ▼                                                        ▼
[ Storefront UI Updates ]                              [ Bank SMS / Gmail Observers ]
(Clear Cart & Show Screen)                                        │
                                                            (4) Verification
                                                                  │
[ Commerce API :5001 ] ◄──(5) POST /api/v1/webhooks/payment ─────┘
  • Verifies HMAC-SHA256 (Constant-Time)
  • Authoritatively Marks Order PAID
  • Decrements Stock
  • Triggers Berry Protocol WhatsApp Receipt
```

### Webhook Verification Specification
The payment gateway delivers signed webhooks to `http://localhost:5001/api/v1/webhooks/payment`:
- **Header**: `X-Gateway-Signature: sha256=<hex_hmac_sha256>`
- **Payload**:
  ```json
  {
    "event": "SUCCESS",
    "paymentId": "pay_v2_987654321",
    "orderId": "ORD-1001",
    "amount": "799.00",
    "amountPaise": 79900,
    "currency": "INR",
    "method": "UPI",
    "utr": "123456789012",
    "completedAt": "2026-10-11T12:00:00.000Z",
    "metadata": { "sku": "TSHIRT-01" }
  }
  ```
- **Security Invariant**: The signature is verified using constant-time equality (`crypto.timingSafeEqual`) against the raw unparsed request bytes to prevent timing attacks and serialization drift.

---

## 🌐 Production & VPS Deployment

### 1. Process Supervision (Systemd on Ubuntu VPS)
To run the platform as an indestructible background daemon on Linux:
```bash
# Copy systemd service unit
sudo cp systemd/unified-ecommerce.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now unified-ecommerce

# Check platform status
sudo systemctl status unified-ecommerce
```

### 2. Built-in Core Handler CLI
You can also manage processes directly from the terminal:
```bash
# View live status of all 15 services
node services/core-handler/src/cli.js status

# Gracefully restart all microservices
node services/core-handler/src/cli.js restart all

# Restart an individual service
node services/core-handler/src/cli.js restart commerce-api
```

### 3. Cloudflare Tunnel / Production Domain Mapping
Set `ENVIRONMENT_MODE=PRODUCTION` and `PRIMARY_DOMAIN=yourbrand` in `.env`.
All subdomains automatically map to their respective loopback ports:
- `yourbrand.shop` ➔ `:5000` *(Storefront)*
- `admin.yourbrand.shop` ➔ `:5050` *(Business Admin)*
- `api.yourbrand.shop` ➔ `:5001` *(Commerce API)*
- `pay.yourbrand.shop` ➔ `:7000` *(YouPi Checkout Portal)*
- `merchant.yourbrand.shop` ➔ `:6001` *(YouPi Merchant Admin)*
- `control.yourbrand.shop` ➔ `:8090` *(Control Center)*

---

## 🧪 Automated Test Verification

The platform ships with comprehensive automated test suites verifying end-to-end functionality across commerce, payments, and messaging:

```bash
# Run Master Platform & Integration Test Suite (22/22 Tests)
npm test

# Run YouPi PG V2 Gateway Test Suite (31/31 Test Suites)
npm run test:pg
```

---

## 📦 Distribution Package Integrity
- **Zero Customer Records**: Delivered with pristine, clean SQLite databases ready for immediate distribution.
- **Pre-Migrated Schemas**: Tables, foreign keys, and indexes initialize automatically on first boot.
- **Sanitized Configurations**: Clear environment templates with safe, descriptive placeholders.
- **Production-Ready White-Labeling**: Ready for instant brand customization, catalog loading, and commercial launch.

---

<p align="center">
  <strong>Built with pride for sovereign independent merchants.</strong><br/>
  <sub>Powered by Node.js, native SQLite WAL, YouPi PG V2, and Berry Protocol.</sub>
</p>
