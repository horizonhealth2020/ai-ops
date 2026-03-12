# Database Reference

## Contents
- Connection (PgBouncer, not PostgreSQL direct)
- Parameterized queries
- Multi-tenant isolation
- Transactions
- Upsert pattern
- N+1 prevention
- Anti-patterns

---

## Connection

ALWAYS connect via PgBouncer. Never use `DATABASE_URL` in app code — that is for migration scripts only.

```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PGBOUNCER_URL });
```

`PGBOUNCER_URL` uses port 6432 (PgBouncer) vs the raw PostgreSQL port (5432). PgBouncer multiplexes
connections — the app can open many logical connections without overwhelming PostgreSQL.

---

## Parameterized Queries — ALWAYS

NEVER interpolate user input into SQL strings. Use `$1`, `$2`, `$N` placeholders:

```javascript
// GOOD - parameterized
const result = await pool.query(
  'SELECT * FROM clients WHERE client_id = $1 AND status = $2',
  [clientId, 'active']
);

// GOOD - INSERT
await pool.query(
  `INSERT INTO bookings (client_id, caller_phone, service_type, scheduled_date)
   VALUES ($1, $2, $3, $4) RETURNING id`,
  [clientId, callerPhone, serviceType, scheduledDate]
);
```

```javascript
// BAD - SQL injection vector, NEVER do this
const result = await pool.query(
  `SELECT * FROM clients WHERE client_id = '${clientId}'`
);
```

---

## Multi-Tenant Isolation

Every single query MUST include `client_id` in the WHERE clause. Data isolation is non-negotiable.

```javascript
// GOOD - always scoped
const result = await pool.query(
  `SELECT * FROM call_logs WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
  [clientId, 20]
);

// BAD - returns all tenants' data
const result = await pool.query(`SELECT * FROM call_logs LIMIT 20`);
```

If you're writing a query that touches `bookings`, `call_logs`, `wallets`, `business_hours`, or any other
tenant-scoped table and there's no `client_id = $N` in the WHERE clause, stop — it's wrong.

---

## Transactions

Use transactions for any multi-step write. The `hours` update is the canonical example — DELETE all rows,
then INSERT 7 new ones. If any INSERT fails, the whole thing rolls back:

```javascript
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
  throw err;
} finally {
  conn.release(); // CRITICAL — never skip this
}
```

`conn.release()` in `finally` is mandatory. A leaked connection means one fewer slot in the pool.
Under load, this cascades into all requests timing out.

---

## Upsert Pattern

Used for `scheduling_config` where each client has exactly one row. `ON CONFLICT` + `DO UPDATE` atomically
creates-or-updates without a separate SELECT:

```javascript
await pool.query(
  `INSERT INTO scheduling_config (client_id, buffer_minutes, max_daily_bookings, advance_days, slot_duration_min)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (client_id) DO UPDATE SET
     buffer_minutes = COALESCE($2, scheduling_config.buffer_minutes),
     max_daily_bookings = COALESCE($3, scheduling_config.max_daily_bookings),
     advance_days = COALESCE($4, scheduling_config.advance_days),
     slot_duration_min = COALESCE($5, scheduling_config.slot_duration_min),
     updated_at = NOW()`,
  [clientId, buffer_minutes, max_daily_bookings, advance_days, slot_duration_min]
);
```

`COALESCE($N, column)` means "use the new value if provided, otherwise keep the existing value".
This allows partial updates without overwriting fields the caller didn't send.

---

## N+1 Prevention — JSON Aggregation in PostgreSQL

The client config query aggregates child rows (business_hours, appointment_types) in SQL, not in JavaScript.
One query, not 1 + N queries:

```javascript
const result = await pool.query(
  `SELECT c.*,
     (SELECT json_agg(json_build_object(
       'day_of_week', bh.day_of_week,
       'is_open', bh.is_open,
       'open_time', bh.open_time::text,
       'close_time', bh.close_time::text
     )) FROM business_hours bh WHERE bh.client_id = c.id) AS business_hours,
     (SELECT json_agg(json_build_object(
       'id', at.id, 'name', at.name, 'duration_min', at.duration_min
     )) FROM appointment_types at WHERE at.client_id = c.id AND at.is_active = true) AS appointment_types
   FROM clients c
   WHERE c.id = $1 AND c.status = 'active'`,
  [clientId]
);
```

Without `json_agg`, you'd need 3 round trips. With it: 1 query, all related data returned.

---

### WARNING: Direct PostgreSQL in App Code

**The Problem:**

```javascript
// BAD - using DATABASE_URL in a route or service
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

**Why This Breaks:**
1. `DATABASE_URL` bypasses PgBouncer — each Pool connection holds a dedicated PostgreSQL backend process
2. Under load (50 concurrent calls), you'd exhaust PostgreSQL's `max_connections` limit
3. Railway managed PostgreSQL has a hard connection cap — hitting it drops all new connections immediately

**The Fix:** Use `PGBOUNCER_URL` everywhere in app code. `DATABASE_URL` is only for `scripts/migrate.js`.

See the **postgresql** skill for schema and migration patterns.

---

### WARNING: Floating Point for Money

Store wallet balances and charges as integers (cents), never floats. See [services.md](services.md) for the pattern.
