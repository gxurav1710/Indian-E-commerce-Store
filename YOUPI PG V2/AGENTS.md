# AGENTS.md — Integration Guide for AI Coding Agents

> **Audience**: AI Coding Agents & Pair Programmers integrating YOUPI PG V2 into developer applications.  
> **Purpose**: Authoritative reference on the YOUPI payment lifecycle, one-script frontend integration, browser events, and server-to-server webhook verification.

---

## 1. High-Level Architecture

YOUPI PG V2 is a self-hosted, sovereign payment gateway designed for zero-fee UPI and counter payments with automated banking observation (SMS & Gmail parsing).

```
  [ Merchant Website / App ]
              │
    (1) Adds one script: <script src=".../youpi.js" data-youpi-key="...">
              │
    (2) Maps payment button: <button data-youpi-pay data-order-id="..." data-amount="...">
              │
    (3) YOUPI JS dims/blurs background & renders centered responsive modal (or mobile sheet)
              │
    (4) Existing iframe loads /checkout/:id with dynamic single-use QR and UPI intent
              │
    (5) Customer pays via any UPI app (GPay, PhonePe, Paytm, CRED, BHIM)
              │
    (6) Banking Observers detect SMS / Gmail credit notification
              │
    (7) Verification Engine verifies amount, UTR, and timestamps
              │
    (8) Payment State Machine transitions session to SUCCESS
              │
     ┌────────┴──────────────────────────┐
     ▼                                   ▼
 [ Browser CustomEvents ]      [ Signed Webhook Delivery ]
 youpi:payment:success          POST /api/webhook (HMAC-SHA256)
 (For instant UI feedback)      (AUTHORITATIVE PROOF OF PAYMENT)
```

---

## 2. Universal One-Script Integration

### Step 1: Script Inclusion
Place the script tag in the page's HTML `<head>` or `<body>`:

```html
<script 
  src="https://<youpi-checkout-host>/youpi.js" 
  data-youpi-key="YOUR_MERCHANT_KEY">
</script>
```

- When running locally, `<youpi-checkout-host>` is `http://localhost:7000`.
- In production, it is your canonical checkout portal domain (e.g., `https://pay.yourdomain.com`).

### Step 2: One-Button Zero-JS Configuration
Tag any clickable button with `data-youpi-pay`:

```html
<button 
  data-youpi-pay 
  data-order-id="ORDER-1001" 
  data-amount="499"
  data-currency="INR"
  data-customer-name="Mohit"
  data-customer-email="mohit@example.com"
  data-customer-phone="9876543210"
  data-metadata='{"sku":"TSHIRT-01"}'>
  Buy Now
</button>
```

The script automatically binds click events to elements with `[data-youpi-pay]`, including elements created dynamically at runtime.

### Step 3: Programmatic API (`Youpi.pay`)
For single-page apps (React, Next.js, Vue, Nuxt, Svelte), use the programmatic interface:

```javascript
Youpi.pay({
  order_id: "ORDER-1001",
  amount: 499.00,
  currency: "INR",
  customer: {
    name: "Mohit",
    email: "mohit@example.com",
    phone: "9876543210"
  },
  metadata: {
    sku: "TSHIRT-01",
    cart_id: "CART-99"
  },
  handler: function(response) {
    console.log("Payment confirmed in modal:", response);
    // response: { status: "SUCCESS", order_id, amount_received, utr, payment_mode }
  },
  onClose: function() {
    console.log("Modal closed by customer");
  }
});
```

---

## 3. Normalized Browser Events

The frontend script emits normalized DOM `CustomEvent`s on `window`:

| Event Name | Trigger Condition |
| :--- | :--- |
| `youpi:payment:success` | Payment verified by banking observers |
| `youpi:payment:failed` | Payment declined, wrong amount, or verification timeout |
| `youpi:payment:suspicious` | Payment flagged by security/risk engine |
| `youpi:payment:expired` | 5-minute active payment window expired |
| `youpi:payment:cancelled` | Customer cancelled or dismissed the checkout |
| `youpi:payment:result` | Unified event dispatched on any outcome |

### Payload Contract (`event.detail`):
```javascript
{
  "status": "SUCCESS",              // 'SUCCESS' | 'FAILED' | 'SUSPICIOUS' | 'EXPIRED' | 'CANCELLED'
  "order_id": "ORDER-1001",
  "amount_received": 499.00,
  "payment_mode": "UPI",            // 'UPI' | 'COD' | 'CASH_COUNTER' | 'CARD_COUNTER'
  "utr": "123456789012",            // 12-digit bank reference number
  "timestamp": "2026-10-07T12:00:00.000Z",
  "metadata": { "sku": "TSHIRT-01" }
}
```

---

## 4. Authoritative Server-to-Server Webhooks

> **CRITICAL RULE**: Browser events are strictly for user interface updates.  
> **NEVER** mark orders as fulfilled or deliver digital goods based on browser events. Only fulfill orders after verifying the server-to-server webhook!

### Webhook Request Specifications:
- **HTTP Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `X-Gateway-Event: SUCCESS`
  - `X-Gateway-Signature: sha256=<hex_hmac_sha256>`
  - `X-Gateway-Delivery-Id: <uuid>`
  - `X-Gateway-Timestamp: <ms>`

### Webhook Verification Snippet (Node.js):
```javascript
import crypto from 'node:crypto';

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signatureHeader = req.headers['x-gateway-signature']; // 'sha256=...'
  const webhookSecret = process.env.YOUPI_WEBHOOK_SECRET;

  const expectedHash = crypto
    .createHmac('sha256', webhookSecret)
    .update(req.body)
    .digest('hex');

  if (signatureHeader !== `sha256=${expectedHash}`) {
    return res.status(401).send('Signature verification failed');
  }

  const payload = JSON.parse(req.body.toString());
  if (payload.event === 'SUCCESS') {
    // Authoritatively mark order as PAID in merchant database
    db.orders.markPaid(payload.orderId, {
      utr: payload.utr,
      amount: payload.amount
    });
  }

  res.status(200).json({ received: true });
});
```

---

## 5. Security & Architectural Invariants

1. **No Public Force-Success Endpoint**:
   - There is no endpoint that allows a client or developer to arbitrarily declare `SUCCESS`.
   - `SUCCESS` is generated solely by the internal verification engine after matching a genuine bank SMS/Gmail observation.
2. **Never Expose Secret API Keys in Frontend**:
   - Only publishable public keys (e.g., `data-youpi-key`) may appear in HTML/JS.
   - `webhookSecret`, database credentials, and observer tokens must remain strictly on the backend.
3. **Idempotency & Deduplication**:
   - Webhook deliveries include unique `X-Gateway-Delivery-Id` and `orderId`. Merchants must ensure their webhook processing is idempotent.
4. **Preserve Customer Metadata**:
   - Unrecognized fields in `metadata` are passed through untouched and included in webhooks and API responses.

---

## 6. Service Ports (Local Development Reference)

| Service | Port | Description |
| :--- | :--- | :--- |
| **Coin Wallet Demo Store** | `5000` | Reference merchant implementation & store |
| **Payment Core REST API** | `6100` | Core gateway engine, state machine, queue |
| **Checkout Portal** | `7000` | Serves `youpi.js`, iframe `/checkout/:id`, API proxy |
| **Merchant Admin** | `6001` | Dashboard for slots, receiving VPAs, observers |
| **SMS Observer** | `6002` | Android SMS banking webhook ingester |
| **Gmail Observer** | `6003` | Push notification / Gmail observation ingester |
