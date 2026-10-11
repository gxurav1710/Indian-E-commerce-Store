# Admin Panel — Service Deployment Guide

## Service Overview
- **Service Name**: Business Operations Administration Panel
- **Port**: `5050`
- **Protocol**: HTTP / Single Page Application (SPA)
- **Role**: Business administrative console for managing orders, catalog, automated SKU directory generation, customer profiles, payments, shipments, customer support tickets, and WhatsApp notification history.
- **Security Distinction (Section 36)**: Admin logins trigger an immediate security alert to the Telegram monitoring bot channel.

## Prerequisites
- Node.js >= 20.0.0
- Commerce API running on port `5001`

## Environment Variables
```env
ADMIN_PANEL_PORT=5050
COMMERCE_API_URL=http://localhost:5001
ADMIN_EMAIL=admin@store.local
ADMIN_PASSWORD=AdminPassword123!
```

## Systemd Production Service Setup (`/etc/systemd/system/admin-panel.service`)
```ini
[Unit]
Description=Unified E-Commerce Business Admin Panel
After=network.target core-handler.service commerce-api.service

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/apps/admin
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=admin-panel

[Install]
WantedBy=multi-user.target
```

## Health Endpoints
- **Liveness Probe**: `GET http://localhost:5050/health`
- **Deep Health Probe**: `GET http://localhost:5050/health/deep` (verifies Commerce API connectivity)

## Operations Modules Implemented
1. **Operations Dashboard**: KPIs (Revenue, Order volume, low stock warnings, recent dispatches).
2. **Order Lifecycle Management (Section 12 & 13)**: Consolidated master order view, order status transitions (`CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELAYED`, `DELIVERED`, `CANCELLED`) with automatic dynamic WhatsApp customer alerts.
3. **Automated SKU Asset Architecture (Section 9 & 10)**: "Add Product" workflow automatically provisions the dedicated filesystem asset tree `products/<SKU>/{images, videos, documents, metadata}`.
4. **Customer Support Chat (Section 23 & 24)**: Live threaded conversation with customers directly from the admin panel.
5. **WhatsApp Notification Log (Section 14 & 15)**: Full audit of dispatched customer notifications with delivery timestamps.
6. **Security Audit Trail (Section 43)**: Immutable audit logs recording actor, action, resource, and data diffs.
