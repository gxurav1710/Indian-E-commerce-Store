# Notification Service — Service Deployment Guide

## Service Overview
- **Service Name**: Dynamic Customer WhatsApp Notification Service
- **Port**: `5002`
- **Protocol**: HTTP/REST + EventBus Consumer
- **Role**: Listens to commerce lifecycle events, resolves customer -> WhatsApp identity, formats dynamic templates, and dispatches verified WhatsApp notifications.

## Prerequisites
- Node.js >= 20.0.0
- Database with `notification_templates` seeded
- WhatsApp Worker API running or Mock adapter enabled

## Environment Variables
```env
NOTIFICATION_SERVICE_PORT=5002
WHATSAPP_WORKER_URL=http://localhost:4001
WORKER_INTERNAL_SECRET=worker_secret_key_change_me_in_prod_abcde
STOREFRONT_URL=http://localhost:5000
```

## Systemd Production Service Setup (`/etc/systemd/system/notifications.service`)
```ini
[Unit]
Description=Unified E-Commerce WhatsApp Notification Service
After=network.target core-handler.service

[Service]
Type=simple
User=ecommerce
WorkingDirectory=/opt/ecommerce/services/notifications
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=notification-service

[Install]
WantedBy=multi-user.target
```

## Monitored Events & Templates
| Event Type | Template ID | Trigger | Description |
| :--- | :--- | :--- | :--- |
| `order.created` | `order_placed` | Customer places order | Confirmation with items & total |
| `payment.success` | `payment_success` | Verified payment received | Payment confirmation with Txn ID |
| `payment.failed` | `payment_failed` | Payment rejected/expired | Alert with retry URL |
| `order.confirmed` | `order_confirmed` | Admin confirms order | Warehouse preparation notice |
| `order.shipped` | `order_shipped` | Order dispatched | Courier & tracking number details |
| `order.delayed` | `order_delayed` | Courier transit delay | Revised delivery estimate notice |
| `order.delivered` | `order_delivered` | Package delivered | Delivery confirmation |
| `order.cancelled` | `order_cancelled` | Order cancelled | Cancellation & refund details |
| `payment.refunded` | `refund` | Refund completed | Refund amount & reference notice |

## API Endpoints
- **Liveness Probe**: `GET http://localhost:5002/health`
- **Deep Health Probe**: `GET http://localhost:5002/health/deep`
- **Templates List**: `GET http://localhost:5002/api/v1/templates`
- **Template Update**: `PUT http://localhost:5002/api/v1/templates/:id`
- **Notification History**: `GET http://localhost:5002/api/v1/notifications`
- **Manual Notify**: `POST http://localhost:5002/api/v1/notify`
