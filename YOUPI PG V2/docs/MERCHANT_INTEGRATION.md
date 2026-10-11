# Merchant Integration & Webhook Guide

## 1. Overview
The YOUPI PG public contract is designed to be minimal and robust. Merchant systems do not need to understand queue mechanics, five-minute timers, 30-second verification windows, or multi-channel observation.

Merchants interact with only **four public outcomes**:
- `SUCCESS`: Payment observed and verified.
- `FAILED`: 30-second verification window elapsed with no matching observation.
- `EXPIRED`: 5-minute payment window elapsed without customer initiating verification.
- `CANCELLED`: Customer explicitly cancelled checkout.

---

## 2. Using `@youpi/merchant-sdk`

### Installation
```bash
npm install @youpi/merchant-sdk
```

### Initialize Client
```javascript
import { YoupiPaymentClient } from '@youpi/merchant-sdk';

const client = new YoupiPaymentClient({
  apiUrl: 'https://pay.yourbusiness.com',
  merchantId: 'your-merchant-uuid',
  webhookSecret: 'your-webhook-secret-key'
});
```

### 1. Create a Payment
```javascript
// Merchant initiates payment with order details.
// Customer identity and authentication are fully owned and handled by the Payment Gateway.
const payment = await client.createPayment({
  orderId: 'ORD-98765',
  amount: '200.00',           // Exact INR amount
  currency: 'INR',
  returnUrl: 'https://store.example.com/checkout/complete',
  metadata: {
    productId: 'SUBSCRIPTION_YEARLY'
  }
});

// Redirect customer immediately to hosted checkout portal
res.redirect(payment.checkoutUrl);
```

> **Customer Identity Note**: The merchant developer does **not** collect customer passwords, sessions, or credentials. When the customer reaches the hosted checkout portal, the Payment Gateway securely authenticates the customer (supporting Sign In, Sign Up with 4 profile fields, and 2 remembered accounts) before starting the payment session.

### 2. Verify Signed Webhook
```javascript
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-gateway-signature']; // 'sha256=abcdef...'
  const rawBody = req.body.toString('utf8');

  try {
    const event = client.verifyWebhook(rawBody, signature);

    switch (event.event) {
      case 'SUCCESS':
        // Fulfill customer order
        unlockServiceForCustomer(event.orderId, event.metadata);
        break;
      case 'FAILED':
        // Mark order as failed, notify customer to retry
        break;
      case 'EXPIRED':
        // Handle abandoned checkout
        break;
      case 'CANCELLED':
        // Return customer items to cart
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Invalid webhook signature:', err.message);
    res.status(400).send('Invalid signature');
  }
});
```

---

## 3. Direct REST API Integration (Without SDK)

If integrating from Python, Go, PHP, or Java:

### 1. Create Payment
- **`POST /api/v1/payments`**
- **Headers:** `Content-Type: application/json`, `X-Merchant-Id: <UUID>`
- **Payload:**
  ```json
  {
    "orderId": "ORD-12345",
    "amount": "200.00",
    "currency": "INR",
    "returnUrl": "https://store.example.com/complete"
  }
  ```
- **Response:**
  ```json
  {
    "paymentId": "...",
    "orderId": "ORD-12345",
    "amount": "200.00",
    "status": "ACTIVE",
    "checkoutUrl": "https://pay.yourbusiness.com/checkout/..."
  }
  ```

### 2. Webhook Signature Verification Algorithm
- Compute `expectedSig = HMAC-SHA256(merchant.webhookSecret, rawBodyString)`.
- Compare against header `X-Gateway-Signature` (strip `sha256=` prefix) using a constant-time comparison function to prevent timing attacks.
