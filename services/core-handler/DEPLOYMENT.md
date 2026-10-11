# Core Handler — Service Deployment Guide

## Service Overview
- **Service Name**: Core Handler & Process Orchestrator
- **Port**: `8085`
- **Protocol**: HTTP/REST + Server-Sent Events (SSE)
- **Role**: Persistent host-level service manager that monitors, spawns, restarts, and health-checks all platform services.

## Prerequisites
- Node.js >= 20.0.0
- SQLite / Supabase database initialized
- Ports configured via `.env`

## Environment Variables
```env
CORE_HANDLER_PORT=8085
NODE_ENV=production
```

## Systemd Production Service Setup (`/etc/systemd/system/core-handler.service`)
```ini
[Unit]
Description=Unified E-Commerce Core Handler Service Manager
After=network.target

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/services/core-handler
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=core-handler

[Install]
WantedBy=multi-user.target
```

## Health Endpoints
- **Liveness Probe**: `GET http://localhost:8085/health`
- **Deep Health & Telemetry Probe**: `GET http://localhost:8085/health/deep`
- **Live Event & Log SSE Stream**: `GET http://localhost:8085/api/v1/events/stream`
- **Services State API**: `GET http://localhost:8085/api/v1/services`
- **System Metrics API**: `GET http://localhost:8085/api/v1/metrics`

## Service Control Endpoints
- Start Service: `POST /api/v1/services/:id/start`
- Stop Service: `POST /api/v1/services/:id/stop`
- Restart Service: `POST /api/v1/services/:id/restart`

## CLI Commands
```bash
node services/core-handler/src/cli.js status
node services/core-handler/src/cli.js restart <service-id>
node services/core-handler/src/cli.js start <service-id>
node services/core-handler/src/cli.js stop <service-id>
```
