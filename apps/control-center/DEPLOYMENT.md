# Central Control Center — Service Deployment Guide

## Service Overview
- **Service Name**: Technical Infrastructure & Service Operator Control Center
- **Port**: `8090`
- **Protocol**: HTTP / Realtime SSE / SPA
- **Architectural Boundary (Section 25)**: The Control Center is strictly for **technical infrastructure and service operations**. It is deliberately separated from the Business Admin Panel (`5050`).
- **Operator Security (Section 26)**: Operates with its own privileged session management, 60-minute automated session timeouts, and isolated operator credentials (`operator`).

## Prerequisites
- Node.js >= 20.0.0
- Core Handler running on port `8085`

## Environment Variables
```env
CONTROL_CENTER_PORT=8090
CORE_HANDLER_URL=http://localhost:8085
OPERATOR_USERNAME=operator
OPERATOR_PASSWORD=OperatorMasterPass2026!
```

## Systemd Production Service Setup (`/etc/systemd/system/control-center.service`)
```ini
[Unit]
Description=Unified E-Commerce Central Control Center
After=network.target core-handler.service

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/apps/control-center
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=control-center

[Install]
WantedBy=multi-user.target
```

## Health Endpoints
- **Liveness Probe**: `GET http://localhost:8090/health`
- **Deep Health Probe**: `GET http://localhost:8090/health/deep` (verifies Core Handler connectivity)

## Console Capabilities
1. **Host Telemetry (Section 31)**: Real-time CPU core count & load, RAM usage %, Host uptime, Platform specs.
2. **Service Grid (Section 31)**: Status badges for all 10 services (`HEALTHY`, `STARTING`, `STOPPED`, `UNHEALTHY`, `RESTARTING`, `FAILED`, `DEGRADED`), PID tracking, restart counts, health check timestamps.
3. **Disruptive Action Guardrails (Section 29)**: Starting, stopping, and restarting services require explicit confirmation modals with clear impact explanations before execution.
4. **Centralized Log Streaming (Section 32)**: Live Server-Sent Events (SSE) streaming logs with category filtering (`All`, `Errors`, `Warnings`, `Auth`, `Payments`, `Orders`, `WhatsApp`, `System`) and automatic secret redaction.
