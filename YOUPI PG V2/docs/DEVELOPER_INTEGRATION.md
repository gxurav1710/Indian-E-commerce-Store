# YOUPI PG V2 — Developer Integration Guide

Welcome to the official developer integration guide for **YOUPI PG V2**.

YOUPI PG V2 provides a **Universal One-Script Integration** that allows any web application to accept UPI payments with zero aggregator fees, sub-second QR rendering, and automated SMS/Gmail observation verification.

---

## 1. Quick Start (5-Minute Integration)

### Step 1: Add the Script
Include the official script in your HTML:

```html
<script 
  src="https://<checkout-portal-host>/youpi.js" 
  data-youpi-key="YOUR_MERCHANT_KEY">
</script>
```

*(For local testing, `<checkout-portal-host>` is `http://localhost:7000`)*

### Step 2: Add Your Payment Button
Add the `data-youpi-pay` attribute to your payment button:

```html
<button 
  data-youpi-pay 
  data-order-id="ORDER-1001" 
  data-amount="499">
  Pay ₹499
</button>
```

When clicked, the script automatically dims and blurs the page, pops up the centered 2-column modal (or fluid bottom sheet on mobile), and loads the checkout session.

---

## 2. Button Attributes Reference

| Attribute | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `data-youpi-pay` | **Yes** | Flags element as a YOUPI checkout trigger | *(boolean)* |
| `data-amount` | **Yes** | Amount in INR | `"499.00"` |
| `data-order-id` | Optional | Merchant order ID (auto-generated if omitted) | `"ORD-9988"` |
| `data-currency` | Optional | Currency (defaults to `INR`) | `"INR"` |
| `data-name` | Optional | Brand / Store display name | `"Acme Store"` |
| `data-description` | Optional | Order description in checkout | `"Digital Coins"` |
| `data-customer-name` | Optional | Customer full name | `"Mohit Kumar"` |
| `data-customer-email` | Optional | Customer email | `"mohit@example.com"` |
| `data-customer-phone` | Optional | Customer mobile number (WhatsApp auth) | `"9876543210"` |
| `data-metadata` | Optional | JSON string of custom developer metadata | `'{"plan":"pro"}'` |
| `data-success-url` | Optional | Redirect URL on payment success | `"/order-success"` |
| `data-failed-url` | Optional | Redirect URL on payment failure | `"/order-failed"` |
| `data-suspicious-url`| Optional | Redirect URL if flagged as suspicious | `"/order-suspicious"` |
| `data-expired-url` | Optional | Redirect URL on session expiry | `"/order-expired"` |
| `data-cancelled-url`| Optional | Redirect URL on user cancellation | `"/order-cancelled"` |

---

## 3. Programmatic Usage (`Youpi.pay`)

For Single Page Applications (React, Vue, Angular, Svelte, Next.js):

```javascript
Youpi.pay({
  order_id: "ORDER-1001",
  amount: 499.00,
  currency: "INR",
  customer: {
    name: "Mohit Kumar",
    email: "mohit@example.com",
    phone: "9876543210"
  },
  metadata: {
    sku: "SUBSCRIPTION-YEARLY",
    user_id: "usr_42"
  },
  handler: function(response) {
    console.log("Payment Confirmed:", response);
    // { status: "SUCCESS", order_id: "ORDER-1001", amount_received: 499.00, utr: "123456789012", payment_mode: "UPI" }
  },
  onFailed: function(response) {
    console.warn("Payment Failed:", response.reason);
  },
  onClose: function() {
    console.log("Customer closed the checkout modal");
  }
});
```

---

## 4. Frontend Browser Payment Events

The script emits standard DOM `CustomEvent`s on `window`:

```javascript
// 1. Success Event
window.addEventListener('youpi:payment:success', (e) => {
  const { order_id, amount_received, utr, payment_mode } = e.detail;
  console.log(`Order ${order_id} verified! Bank UTR: ${utr}`);
});

// 2. Failed Event
window.addEventListener('youpi:payment:failed', (e) => {
  console.log(`Order ${e.detail.order_id} failed: ${e.detail.reason}`);
});

// 3. Suspicious / Security Review Event
window.addEventListener('youpi:payment:suspicious', (e) => {
  console.warn(`Order ${e.detail.order_id} held for security review.`);
});

// 4. Session Expired Event
window.addEventListener('youpi:payment:expired', (e) => {
  console.log(`Order ${e.detail.order_id} active window expired.`);
});

// 5. Cancelled Event
window.addEventListener('youpi:payment:cancelled', (e) => {
  console.log(`Order ${e.detail.order_id} cancelled by customer.`);
});
```

> **SECURITY NOTICE**: Browser events are designed strictly to update frontend user interfaces. Never mark an order fulfilled solely based on client-side events.

---

## 5. Authoritative Backend Webhooks

The only authoritative confirmation of payment is the **HMAC-SHA256 signed server-to-server webhook**.

### Webhook Delivery Format:
- **Headers**:
  - `Content-Type: application/json`
  - `X-Gateway-Event: SUCCESS`
  - `X-Gateway-Signature: sha256=<hex_hmac_sha256>`
  - `X-Gateway-Delivery-Id: <uuid>`
  - `X-Gateway-Timestamp: <timestamp_ms>`
- **Payload**:
  ```json
  {
    "event": "SUCCESS",
    "paymentId": "c7942127-14e3-469a-9e4a-9359a16f903a",
    "orderId": "ORDER-1001",
    "amount": "499.00",
    "amountPaise": 49900,
    "currency": "INR",
    "method": "UPI",
    "utr": "123456789012",
    "completedAt": "2026-10-07T12:00:00.000Z",
    "metadata": { "sku": "SUBSCRIPTION-YEARLY" }
  }
  ```

### Verification Implementations:

#### Node.js / Express
```javascript
import crypto from 'node:crypto';

app.post('/api/youpi-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-gateway-signature'];
  const secret = process.env.YOUPI_WEBHOOK_SECRET;

  const expectedSig = 'sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  if (signature !== expectedSig) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString());
  if (event.event === 'SUCCESS') {
    // Fulfill order in your database
    fulfillOrder(event.orderId, event.utr);
  }

  res.status(200).json({ received: true });
});
```

#### Python / FastAPI
```python
import hmac
import hashlib
import json
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

@app.post("/api/youpi-webhook")
async def youpi_webhook(request: Request):
    raw_body = await request.body()
    signature = request.headers.get("X-Gateway-Signature", "")
    secret = "your_webhook_secret".encode("utf-8")
    
    expected = "sha256=" + hmac.new(secret, raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    payload = json.loads(raw_body.decode("utf-8"))
    if payload.get("event") == "SUCCESS":
        fulfill_order(payload.get("orderId"), payload.get("utr"))
        
    return {"received": True}
```

#### PHP
```php
<?php
$rawPayload = file_get_contents('php://input');
$signatureHeader = $_SERVER['HTTP_X_GATEWAY_SIGNATURE'] ?? '';
$secret = getenv('YOUPI_WEBHOOK_SECRET');

$expectedSignature = 'sha256=' . hash_hmac('sha256', $rawPayload, $secret);

if (!hash_equals($expectedSignature, $signatureHeader)) {
    http_response_code(401);
    exit('Invalid signature');
}

$event = json_decode($rawPayload, true);
if ($event['event'] === 'SUCCESS') {
    fulfillOrder($event['orderId'], $event['utr']);
}

http_response_code(200);
echo json_encode(['received' => true]);
?>
```
