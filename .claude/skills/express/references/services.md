# Services Reference

## Contents
- Service layer contract
- Redis cache-aside pattern
- Transaction pattern
- Multi-tenant isolation
- Anti-patterns

---

## Service Layer Contract

Services contain all business logic. Routes validate input, call a service, return the result.
Services must never touch `req` or `res` — they receive plain objects and return plain objects.

```javascript
'use strict';

const pool = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

async function createBooking({ client_id, call_id, caller_name, caller_phone, service_type, scheduled_date, scheduled_time }) {
  // All business logic here: FSM verify → DB write → Redis cleanup → n8n webhook
  const result = await pool.query(
    `INSERT INTO bookings (client_id, call_id, caller_name, caller_phone, service_type, scheduled_date, scheduled_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [client_id, call_id, caller_name, caller_phone, service_type, scheduled_date, scheduled_time]
  );

  logger.info('Booking created', { client_id, booking_id: result.rows[0].id });
  return { booking_id: result.rows[0].id, status: 'confirmed' };
}

module.exports = { createBooking };
```

---

## Redis Cache-Aside Pattern

Used in `src/middleware/tenantResolver.js` for client config. PostgreSQL is truth; Redis is a 5-minute read cache.
Always try Redis first, fall through to PostgreSQL on miss or error. Swallow Redis errors — Redis is ephemeral.

```javascript
async function getClientConfig(clientId) {
  const cacheKey = `client_config:${clientId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {} // Redis down → fall through, not a fatal error

  const client = await loadClientFromDb(clientId);
  if (!client) return null;

  try {
    await redis.set(cacheKey, JSON.stringify(client), 'EX', 300);
  } catch {} // Redis write failure is non-fatal

  return client;
}
```

NEVER throw on Redis read/write failures. If Redis dies, the app must keep running from PostgreSQL.

---

## Transaction Pattern

Used in `PUT /api/v1/dashboard/hours` for replacing all 7 business_hours rows atomically.
Always `ROLLBACK` on error, always `release()` in `finally`.

```javascript
async function replaceBusinessHours(clientId, hours) {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query('DELETE FROM business_hours WHERE client_id = $1', [clientId]);

    for (const h of hours) {
      await conn.query(
        `INSERT INTO business_hours (client_id, day_of_week, is_open, open_time, close_time, after_hours_mode)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [clientId, h.day_of_week, h.is_open, h.open_time || null, h.close_time || null, h.after_hours_mode || 'voicemail']
      );
    }

    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err; // re-throw so the route handler's next(err) fires
  } finally {
    conn.release(); // ALWAYS — leaking connections exhausts the pool
  }
}
```

---

## Parallel Queries

When two independent queries are needed (e.g., count + data), run them in parallel with `Promise.all`:

```javascript
const [countResult, dataResult] = await Promise.all([
  pool.query(`SELECT COUNT(*) FROM call_logs WHERE client_id = $1`, [clientId]),
  pool.query(`SELECT * FROM call_logs WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [clientId, limit, offset]),
]);
```

Sequential awaits here would double latency for no reason.

---

## Cache Invalidation After Writes

Any service that mutates client config must invalidate the Redis cache AND recompile the system prompt if the change affects agent behavior:

```javascript
async function updateSchedulingConfig(clientId, config) {
  await pool.query(
    `INSERT INTO scheduling_config (client_id, buffer_minutes, max_daily_bookings, advance_days, slot_duration_min)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id) DO UPDATE SET
       buffer_minutes = COALESCE($2, scheduling_config.buffer_minutes),
       updated_at = NOW()`,
    [clientId, config.buffer_minutes, config.max_daily_bookings, config.advance_days, config.slot_duration_min]
  );

  await invalidateCache(clientId); // flush Redis so next call reads fresh config
  // If this affects the system prompt, also call: await promptCompiler.compile(clientId)
}
```

Changes to `agent_name`, `greeting_script`, `tone_tags`, `phrases_use/avoid`, `business_hours`, or appointment types
all require `promptCompiler.compile(clientId)` after the DB write.

---

### WARNING: Shared State in Services

**The Problem:**

```javascript
// BAD - module-level mutable state
let currentClientConfig = null;

async function getConfig(clientId) {
  if (currentClientConfig) return currentClientConfig; // wrong! shared across all tenants
  currentClientConfig = await loadClientFromDb(clientId);
  return currentClientConfig;
}
```

**Why This Breaks:**
1. This is a multi-tenant system — one client's config bleeds into another client's request
2. Railway may run multiple replicas; even in-process caching creates inconsistency across pods
3. Config updates never take effect because the stale value is cached in memory forever

**The Fix:** Use Redis with `client_id`-namespaced keys (`client_config:{clientId}`). Redis is shared, keyed, and TTL-controlled.

---

### WARNING: Currency as Floats

**The Problem:**

```javascript
// BAD - floating point arithmetic for money
const charge = durationMinutes * 0.40; // $0.40/min
await pool.query('UPDATE wallets SET balance = balance - $1 WHERE client_id = $2', [charge, clientId]);
```

**Why This Breaks:**
1. `0.1 + 0.2 === 0.30000000000000004` — rounding errors accumulate across transactions
2. PostgreSQL NUMERIC columns lose precision when you pass JavaScript floats

**The Fix:** Store and compute in cents (integers). `$0.40/min = 40 cents/min`.

```javascript
// GOOD
const RATE_CENTS_PER_MIN = { standard: 40, growth: 32, scale: 27, enterprise: 23 };
const chargeCents = durationMinutes * RATE_CENTS_PER_MIN[tier];
await pool.query('UPDATE wallets SET balance_cents = balance_cents - $1 WHERE client_id = $2', [chargeCents, clientId]);
```
