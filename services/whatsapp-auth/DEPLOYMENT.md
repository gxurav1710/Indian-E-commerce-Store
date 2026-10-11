# WhatsApp Auth — Service Deployment Guide

## Service Overview
- **Service Name**: Native WhatsApp Passwordless Authentication Core API
- **Port**: `4000`
- **Protocol**: HTTP/REST + Server-Sent Events (SSE)
- **Runtime Model (Section 47)**: **100% Native Host / Non-Docker Execution**. Completely decoupled from Docker containers, running natively on Node.js with embedded SQLite / Supabase PostgreSQL database support.

## Prerequisites
- Node.js >= 20.0.0
- WhatsApp Worker Service running on port `4001` or mock adapter enabled

## Environment Variables
```env
WHATSAPP_AUTH_API_PORT=4000
WHATSAPP_WORKER_URL=http://localhost:4001
WORKER_INTERNAL_SECRET=worker_secret_key_change_me_in_prod_abcde
ADMIN_API_KEY=admin_super_secret_key_change_me_in_prod_12345
WHATSAPP_BOT_PHONE=+14155550199
```

## Systemd Production Service Setup (`/etc/systemd/system/whatsapp-auth.service`)
```ini
[Unit]
Description=Unified E-Commerce WhatsApp Auth Core API
After=network.target core-handler.service

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/services/whatsapp-auth
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=whatsapp-auth

[Install]
WantedBy=multi-user.target
```

## Health Endpoints
- **Liveness Probe**: `GET http://localhost:4000/health`
- **Deep Health Probe**: `GET http://localhost:4000/health/deep` (verifies DB and worker connection status)

## Core REST Endpoints
- `POST /api/v1/auth/initiate`: Generates `AUTH-XXXX-XXXX` challenge string and WhatsApp deep link.
- `GET /api/v1/auth/events/:attemptId`: Server-Sent Events (SSE) live updates.
- `GET /continue/:token`: Single-use continuation link clicked by customer in WhatsApp. Burns token, generates authorization code, redirects to Storefront callback.
- `POST /api/v1/auth/token`: Exchanges authorization code for verified canonical user identity.
- `POST /api/v1/internal/whatsapp/webhook`: Receives incoming message events from worker daemon.
- `POST /api/v1/internal/whatsapp/status`: Receives connection status updates from worker.
