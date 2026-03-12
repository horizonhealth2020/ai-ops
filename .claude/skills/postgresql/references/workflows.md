# PostgreSQL Workflows Reference

## Contents
- Adding a New Table (Migration)
- Multi-Step Booking Transaction
- Availability + Hold + Confirm Flow
- Wallet Deduction with Audit Trail
- Health Check Query
- Checklist: New Feature with DB Changes

---

## Adding a New Table (Migration)

Migrations are numbered SQL files in `migrations/`. They run sequentially via `scripts/migrate.js`.

**Step 1:** Create the file with the next number:

```sql
-- migrations/013_create_notifications.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  call_id     UUID        REFERENCES call_logs(id) ON DELETE SET NULL,
  type        TEXT        NOT NULL CHECK (type IN ('sms', 'email', 'webhook')),
  status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  payload     JSONB       NOT NULL DEFAULT '{}',
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_client ON notifications(client_id);
CREATE INDEX idx_notifications_client_status ON notifications(client_id, status);
```

**Step 2:** Run it:

```bash
npm run migrate
```

Migrations are idempotent due to `IF NOT EXISTS`. Re-running is safe.

### WARNING: NEVER Modify Existing Migration Files

**The Problem:** Editing `migrations/005_create_appointment_types.sql` after it has run in production does nothing — `migrate.js` tracks which files ran by filename. Your change silently skips.

**The Fix:** Always create a new numbered file for schema changes. To add a column:

```sql
-- migrations/013_add_duration_to_notifications.sql
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
```

---

## Multi-Step Booking Transaction

The booking flow writes to three tables: `cached_availability`, `bookings`, and clears the Redis hold.
PostgreSQL writes are not wrapped in an explicit transaction here because the Redis hold acts as the
distributed lock — but the DB writes themselves should be sequenced to avoid partial state.

```javascript
// src/services/bookingService.js
'use strict';
const pool = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

async function confirmBooking({ clientId, callId, callerName, callerPhone, date, time, serviceType }) {
  // 1. Write booking record
  const bookingResult = await pool.query(
    `INSERT INTO bookings
       (client_id, call_id, caller_name, caller_phone,
        scheduled_date, scheduled_time, service_type, status, fsm_sync_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'pending')
     RETURNING id`,
    [clientId, callId, callerName, callerPhone, date, time, serviceType]
  );
  const bookingId = bookingResult.rows[0].id;

  // 2. Mark slot as booked in availability cache
  await pool.query(
    `UPDATE cached_availability
     SET status = 'booked'
     WHERE client_id = $1 AND date = $2 AND start_time = $3::time`,
    [clientId, date, time]
  );

  // 3. Release Redis hold (Redis is ephemeral — DB is truth)
  const holdKey = `hold:${clientId}:${date}:${time}`;
  await redis.del(holdKey);
  await redis.srem(`held_slots:${clientId}`, `${date}:${time}`);

  logger.info('Booking confirmed', { client_id: clientId, booking_id: bookingId, date, time });
  return bookingId;
}
```

See the **redis** skill for hold key patterns and TTL conventions.

---

## Availability + Hold + Confirm Flow

Three separate HTTP calls from Vapi; each hits a different service method.

**Phase 1 — Check** (reads PostgreSQL + filters Redis):

```javascript
// src/services/availabilityService.js
async function checkAvailability(clientId, date) {
  const result = await pool.query(
    `SELECT id, start_time::text, end_time::text
     FROM cached_availability
     WHERE client_id = $1 AND date = $2 AND status = 'open'
     ORDER BY start_time`,
    [clientId, date]
  );

  // Filter out Redis-held slots (soft locks from concurrent calls)
  const heldSlots = await redis.smembers(`held_slots:${clientId}`);
  const heldSet = new Set(heldSlots);

  return result.rows.filter(row => !heldSet.has(`${date}:${row.start_time}`));
}
```

**Phase 2 — Hold** (atomic Redis SETNX, no PostgreSQL write):

```javascript
const holdKey = `hold:${clientId}:${date}:${time}`;
const acquired = await redis.set(holdKey, callId, 'EX', 300, 'NX');
// acquired === 'OK' means success; null means another call already holds it
```

**Phase 3 — Confirm** (PostgreSQL INSERT + UPDATE + Redis cleanup): see Multi-Step section above.

---

## Wallet Deduction with Audit Trail

Two writes must stay consistent: deduct from `wallets`, append to `wallet_transactions`.

```javascript
// src/services/walletService.js
async function deductCallCost(clientId, callId, durationMinutes) {
  // Fetch tier rate
  const walletResult = await pool.query(
    'SELECT id, balance_cents, billing_tier FROM wallets WHERE client_id = $1',
    [clientId]
  );
  const wallet = walletResult.rows[0];

  const RATES = { standard: 40, growth: 32, scale: 27, enterprise: 23 }; // cents per minute
  const rate = RATES[wallet.billing_tier] ?? RATES.standard;
  const costCents = Math.ceil(durationMinutes * rate);

  // Atomic deduction — WHERE guard prevents overdraft
  const updateResult = await pool.query(
    `UPDATE wallets
     SET balance_cents = balance_cents - $1, updated_at = NOW()
     WHERE client_id = $2 AND balance_cents >= $1
     RETURNING balance_cents`,
    [costCents, clientId]
  );

  if (updateResult.rowCount === 0) {
    logger.warn('Wallet deduction skipped — insufficient balance', { client_id: clientId });
    return { success: false, balanceCents: wallet.balance_cents };
  }

  const balanceAfter = updateResult.rows[0].balance_cents;

  // Audit trail
  await pool.query(
    `INSERT INTO wallet_transactions
       (wallet_id, client_id, type, amount_cents, balance_after_cents, description, reference_id)
     VALUES ($1, $2, 'usage', $3, $4, $5, $6)`,
    [wallet.id, clientId, -costCents, balanceAfter, `Call charge: ${durationMinutes}min`, callId]
  );

  return { success: true, balanceCents: balanceAfter, chargedCents: costCents };
}
```

---

## Health Check Query

The `/health` route verifies PgBouncer connectivity:

```javascript
// src/routes/health.js
async function checkDatabaseHealth() {
  const start = Date.now();
  await pool.query('SELECT 1');
  return { status: 'ok', latency_ms: Date.now() - start };
}
```

A `SELECT 1` through PgBouncer confirms the pooler is alive and can reach PostgreSQL. It does NOT confirm that your application tables exist — add a table-level check if you need schema validation on startup.

---

## Checklist: New Feature with DB Changes

Copy this checklist when adding a feature that requires schema changes:

- [ ] Create `migrations/NNN_describe_change.sql` with the next sequential number
- [ ] Use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- [ ] Add `client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE`
- [ ] Add `CREATE INDEX idx_tablename_client ON tablename(client_id)`
- [ ] Add composite indexes for any columns used in WHERE with `client_id`
- [ ] Run `npm run migrate` locally and verify no errors
- [ ] Add seed data to `seeds/` if the feature needs demo data
- [ ] Every service query must include `WHERE client_id = $X`
- [ ] Money columns must be `INTEGER` (cents), not `DECIMAL` or `FLOAT`
- [ ] Validate: run `npm run migrate && npm run seed && npm run dev` — server starts clean

**Iterate until clean:**
1. Edit migration file
2. Drop and recreate local DB: `docker rm -f pg && docker run --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15`
3. Run `npm run migrate`
4. If errors, fix migration and repeat from step 2
5. Only proceed when migrate exits 0
