# Telegram Monitoring Bot — Service Deployment Guide

## Service Overview
- **Service Name**: Operator Security & Infrastructure Telegram Monitoring Bot
- **Role**: Dedicated monitoring and alerting channel for platform infrastructure and security events.
- **Important Distinction (Section 35)**: Telegram is for **operator/security/infrastructure monitoring ONLY**. It does NOT alert on routine customer activity (logins, orders, signups). Routine customer updates are delivered via **WhatsApp**.

## Prerequisites
- Node.js >= 20.0.0
- Telegram Bot Token created via `@BotFather`
- Initial Admin Chat ID (obtained by messaging the bot and sending `/start`)

## Environment Variables
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_from_botfather
TELEGRAM_ADMIN_CHAT_ID=100000001
TELEGRAM_POLL_INTERVAL_MS=3000
CORE_HANDLER_URL=http://localhost:8085
```

## Systemd Production Service Setup (`/etc/systemd/system/telegram-bot.service`)
```ini
[Unit]
Description=Unified E-Commerce Telegram Monitoring Bot
After=network.target core-handler.service

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/services/telegram-bot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=telegram-bot

[Install]
WantedBy=multi-user.target
```

## Supported Bot Commands (Whitelisted Only)
- `/health` — Gathers real-time application health of all services, CPU/RAM/Uptime metrics, and returns a formatted report.
- `/status` — Displays quick table of all services and their port status.
- `/restart <service>` — Requests a service restart. For safety (Section 38), requires explicit confirmation before executing.
- `/confirm <service>` — Confirms and executes the requested restart via Core Handler.
- `/cancel` — Cancels a pending restart request.
- `/start` — Registers the user in the `telegram_subscribers` database table.

## Automated Security & Infrastructure Alerts
1. **Admin Login Success**:
   - Trigger: Successful login to the Business Admin Panel (`/api/v1/admin/login`).
   - Alert: `ADMIN LOGIN: SUCCESS`, admin account, IP address, timestamp.
2. **Admin Login Failed**:
   - Trigger: Incorrect password attempt on the Business Admin Panel.
   - Alert: `ADMIN LOGIN FAILED: Invalid credentials`, account name, IP address, timestamp.
3. **Service Down**:
   - Trigger: Any service crashes or fails health checks.
   - Alert: `🔴 SERVICE DOWN`, service name, timestamp, exit code, recovery attempt count.
4. **Service Recovered**:
   - Trigger: Previously failed service resumes healthy status.
   - Alert: `🟢 SERVICE RECOVERED`, service name, operational status.
