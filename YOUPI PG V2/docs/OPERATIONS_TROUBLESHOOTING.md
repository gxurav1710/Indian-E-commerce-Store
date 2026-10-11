# Operations, Crash Recovery & Troubleshooting Guide

## 1. Crash Recovery Mechanics

YOUPI PG's `RecoveryEngine` executes automatically whenever the Payment API process boots:

### Automatic Reconciliation Actions
1. **Overdue `PROCESSING` Sessions:**
   Any session where `status = 'PROCESSING'` and `processing_expires_at < NOW()` is safely transitioned to `FAILED`, the slot is released, and the next queued session is promoted.
2. **Overdue `ACTIVE` Sessions:**
   Any session where `status = 'ACTIVE'` and `expires_at < NOW()` is transitioned to `EXPIRED`, the slot is released, and the next queued session is promoted.
3. **Ongoing Sessions:**
   For ongoing `ACTIVE` and `PROCESSING` sessions where `expires_at >= NOW()`, high-precision Node.js timer handles are automatically re-registered for the exact remaining milliseconds:
   $$\Delta t = \text{expires\_at} - \text{NOW}()$$
4. **Vacant Slot Backlog Drain:**
   Any vacant receiving account with waiting `QUEUED` sessions is automatically activated.

---

## 2. Late Observations & Merchant Reconciliation

### What is a Late Observation?
A customer pays via their UPI app near the end of their 5-minute payment window, but their mobile network lags or they fail to click "Payment Done" before the timer expires. Later, a delayed bank notification arrives for that exact amount.

### Handling Policy
- **Absolute Invariant:** The delayed observation is **never** attributed to a newer, different customer currently paying in the queue.
- The observation is matched against recent expired/failed sessions on that receiving account within the last 30 minutes.
- If a match is found:
  1. The observation status is marked `LATE_UNMATCHED`.
  2. A High-Priority Support Ticket is automatically opened for the customer.
  3. A `PAYMENT.LATE_DETECTED` webhook is emitted to the merchant.
  4. The merchant operator can inspect the ticket in **Merchant Admin** and manually fulfill the order or issue a store refund.

---

## 3. Database Backup & Disaster Recovery

### PostgreSQL Production Backup
```bash
# Automated Daily Backup Script
pg_dump -U youpi -d youpi_pg -F c -b -v -f "/var/backups/youpi_pg_$(date +\%Y\%m\%d).dump"

# Restore from Backup
pg_restore -U youpi -d youpi_pg -v "/var/backups/youpi_pg_20260908.dump"
```

### SQLite Local Backup
For embedded/small deployments using SQLite:
```bash
# Atomic SQLite Online Backup
sqlite3 ./data/youpi_pg.sqlite ".backup './data/youpi_pg_backup.sqlite'"
```

---

## 4. Health Inspection & Endpoints

| Service | Port | Health URL | Expected Response |
| :--- | :--- | :--- | :--- |
| Payment API | 6100 | `http://localhost:6100/health` | `{"status":"UP","service":"payment-api"}` |
| Checkout Portal | 7000 | `http://localhost:7000/health` | `{"status":"UP","service":"checkout-portal"}` |
| Merchant Admin | 6001 | `http://localhost:6001/health` | `{"status":"UP","service":"merchant-admin"}` |
| Payment Help | 3000 | `http://localhost:3000/health` | `{"status":"UP","service":"payment-help"}` |
| Gmail Observer | 6003 | `http://localhost:6003/health` | `{"status":"UP","service":"gmail-observer"}` |
| SMS Observer | 6002 | `http://localhost:6002/health` | `{"status":"UP","service":"sms-observer"}` |
| Control Center | 8090 | `http://localhost:8090/health` | `{"status":"UP","service":"control-center"}` |
