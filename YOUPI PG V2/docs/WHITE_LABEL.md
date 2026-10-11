# White-Label Branding System Guide

YOUPI PG is built from the ground up to be 100% white-label. No hardcoded brand names, logos, or client-specific colors exist in core payment components.

---

## 1. Dynamic Branding Parameters

Every merchant can configure custom branding in the `merchants` table via the Merchant Admin or API:

```json
{
  "appName": "QuickPay Store",
  "primaryColor": "#2563eb",
  "logoUrl": "https://cdn.example.com/logo.png",
  "supportEmail": "support@example.com",
  "supportPhone": "+91 98765 43210"
}
```

### CSS Variables Injection
The Checkout Portal and Help Portal dynamically map merchant branding to native CSS custom properties:

```css
:root {
  --primary-color: {{PRIMARY_COLOR}};
  --primary-hover: /* derived brightness or hover color */;
  --card-bg: #ffffff;
  --text-main: #0f172a;
  --text-muted: #475569;
  --border-color: #cbd5e1;
}
```

---

## 2. Setting Branding via Merchant Admin

1. Open **Merchant Admin** (`http://localhost:6001`).
2. Navigate to **Settings** tab.
3. Update:
   - **Business Name:** Displays on the top header of the checkout page.
   - **Receiving UPI VPA:** The UPI receiving address encoded in generated QR codes (`upi://pay?pa=...`).
   - **Primary Color:** Custom brand hex code (e.g. `#059669` for emerald, `#7c3aed` for purple, `#dc2626` for crimson).
4. Click **Save Settings**. The changes take effect immediately across all active checkout sessions.

---

## 3. Custom Domain Routing (Nginx / Caddy Reverse Proxy)

To run YOUPI PG on production domains:

```nginx
# Checkout Portal
server {
    server_name pay.yourbrand.com;
    location / {
        proxy_pass http://127.0.0.1:7000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Merchant Admin Dashboard
server {
    server_name admin.yourbrand.com;
    location / {
        proxy_pass http://127.0.0.1:6001;
        proxy_set_header Host $host;
    }
}

# Customer Payment Help Portal
server {
    server_name help.yourbrand.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}

# Central Payment Core API
server {
    server_name api-pay.yourbrand.com;
    location / {
        proxy_pass http://127.0.0.1:6100;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```
