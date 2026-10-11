# WhatsApp Worker — Service Deployment Guide

## Service Overview
- **Service Name**: WhatsApp WebSocket & Notification Worker Daemon
- **Port**: `4001`
- **Protocol**: HTTP/REST + WebSockets (Baileys)
- **Role**: Maintains persistent multi-device connection to WhatsApp, provides outbound message dispatching for customer notifications, pairs devices via QR code, and feeds inbound challenge messages to the Auth API.
- **Runtime Model (Section 47)**: Native host Node.js runtime with pluggable adapter (`mock` or `baileys`).

## Prerequisites
- Node.js >= 20.0.0
- Storage folder for Baileys auth keys (`./data/baileys_auth`)
- WhatsApp Auth API running on port `4000`

## Environment Variables
```env
WHATSAPP_WORKER_PORT=4001
AUTH_API_URL=http://localhost:4000
WORKER_INTERNAL_SECRET=worker_secret_key_change_me_in_prod_abcde
WHATSAPP_ADAPTER=mock
# Set WHATSAPP_ADAPTER=baileys for live multi-device WhatsApp pairing
WHATSAPP_SESSION_PATH=./data/baileys_auth
WHATSAPP_BOT_PHONE=+14155550199
```

## Systemd Production Service Setup (`/etc/systemd/system/whatsapp-worker.service`)
```ini
[Unit]
Description=Unified E-Commerce WhatsApp Worker Daemon
After=network.target core-handler.service whatsapp-auth.service

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/services/whatsapp-worker
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=whatsapp-worker

[Install]
WantedBy=multi-user.target
```

## Health Endpoints
- **Liveness Probe**: `GET http://localhost:4001/health`
- **Deep Health Probe**: `GET http://localhost:4001/health/deep` (returns adapter status and client info)

## REST Endpoints
- `POST /api/v1/messages/send`: Dispatches outbound WhatsApp message to customer.
- `GET /api/v1/status`: Queries current adapter connection status (`CONNECTED`, `QR_READY`, `DISCONNECTED`).
- `GET /api/v1/qr`: Retrieves current QR code string for device pairing.
- `POST /api/v1/simulate/message`: Simulates customer message for offline testing.
