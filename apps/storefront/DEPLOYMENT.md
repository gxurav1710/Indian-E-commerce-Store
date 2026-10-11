# Storefront — Service Deployment Guide

## Service Overview
- **Service Name**: Commercial E-Commerce Storefront Web Application
- **Port**: `5000`
- **Protocol**: HTTP / Single Page Application (SPA)
- **Role**: Customer-facing commercial store featuring catalog browsing, live search, variant selector, persistent cart with guest-to-auth merge, native WhatsApp Auth modal, and seamless redirect to YouPi Payment Gateway.

## Prerequisites
- Node.js >= 20.0.0
- Commerce API running on port `5001`
- Checkout Portal running on port `7000`

## Environment Variables
```env
STOREFRONT_PORT=5000
COMMERCE_API_URL=http://localhost:5001
BASE_CHECKOUT_URL=http://localhost:7000
WHATSAPP_AUTH_API_URL=http://localhost:4000
```

## Systemd Production Service Setup (`/etc/systemd/system/storefront.service`)
```ini
[Unit]
Description=Unified E-Commerce Storefront
After=network.target core-handler.service commerce-api.service

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/apps/storefront
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=storefront

[Install]
WantedBy=multi-user.target
```

## Health Endpoints
- **Liveness Probe**: `GET http://localhost:5000/health`
- **Deep Health Probe**: `GET http://localhost:5000/health/deep` (verifies Commerce API connectivity)

## Customer Flows Implemented
1. **Catalog & Search**: Live filtering by category, brand, and query strings.
2. **Cart Survival (Section 16)**: Guest cart survives authentication and is merged upon WhatsApp login.
3. **Native WhatsApp Modal (Section 17)**: In-place popup for login & signup without leaving the store.
4. **Preserved Payment Gateway UI (Section 18)**: Smooth handover to YouPi Checkout Portal for UPI payments.
5. **Cash on Delivery (Section 22)**: Instant order placement in CASH mode.
6. **Support Tickets (Section 23)**: Customer inquiries linked to orders with structured message logs.
