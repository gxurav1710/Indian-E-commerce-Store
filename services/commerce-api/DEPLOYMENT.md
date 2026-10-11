# Commerce API — Service Deployment Guide

## Service Overview
- **Service Name**: Unified Commerce REST API
- **Port**: `5001`
- **Protocol**: HTTP/REST
- **Role**: Central catalogue, SKU asset manager, cart, checkout, order lifecycle, payment webhook receiver, and support engine.

## Prerequisites
- Node.js >= 20.0.0
- SQLite database (`data/unified_ecommerce.sqlite`) or Supabase PostgreSQL
- Product asset warehouse directory (`data/product_assets`)

## Environment Variables
```env
COMMERCE_API_PORT=5001
COMMERCE_API_URL=http://localhost:5001
STOREFRONT_URL=http://localhost:5000
BASE_PAYMENT_API_URL=http://localhost:6100
BASE_CHECKOUT_URL=http://localhost:7000
MERCHANT_ID=00000000-0000-0000-0000-000000000001
MERCHANT_WEBHOOK_SECRET=unified_store_webhook_secret_for_payment_verification
PRODUCT_ASSETS_DIR=./data/product_assets
```

## Systemd Production Service Setup (`/etc/systemd/system/commerce-api.service`)
```ini
[Unit]
Description=Unified Commerce REST API
After=network.target core-handler.service

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/services/commerce-api
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=commerce-api

[Install]
WantedBy=multi-user.target
```

## Health Endpoints
- **Liveness Probe**: `GET http://localhost:5001/health`
- **Deep Health Probe**: `GET http://localhost:5001/health/deep` (verifies DB, asset directory, and payment API)

## Key REST Endpoints
- **Products**: `GET /api/v1/products`, `POST /api/v1/products` (auto-creates SKU directory)
- **Product Assets**: `GET /api/v1/products/:sku/assets`
- **Cart**: `GET /api/v1/cart`, `POST /api/v1/cart/items`, `POST /api/v1/cart/merge`
- **Checkout & Order**: `POST /api/v1/checkout/create-order` (handles UPI via YouPi and CASH mode)
- **Orders**: `GET /api/v1/orders`, `GET /api/v1/orders/:id`, `POST /api/v1/orders/:id/status`
- **Payment Webhook**: `POST /api/v1/webhooks/payment`
- **Support**: `GET /api/v1/support/tickets`, `POST /api/v1/support/tickets`
- **Admin**: `POST /api/v1/admin/login`, `GET /api/v1/admin/dashboard`, `GET /api/v1/admin/audit-logs`
