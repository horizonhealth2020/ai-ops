# PostgreSQL Patterns Reference

## Contents
- Connection Setup
- Multi-Tenant Query Isolation
- Schema Conventions
- Currency and Money
- Anti-Patterns

---

## Connection Setup

Application code always uses PgBouncer. Direct PostgreSQL is for migrations only.

```javascript
// src/config/database.js — correct pattern
'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.PGBOUNCER_URL,  // NOT DATABASE_URL
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
```

```javascript
// scripts/migrate.js — only exception for direct connection
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
```

**Why two URLs:** PgBouncer uses connection pooling (transaction mode) which breaks `PREPARE`/`SET` statements. Migrations need a persistent session — use the direct URL.

---

## Multi-Tenant Query Isolation

Every query against a client-scoped table MUST filter by `client_id`. No exceptions.

```javascript
// GOOD — tenant-scoped query
const result = await pool.query(
  `SELECT id, caller_name, scheduled_date, status
   FROM bookings
   WHERE client_id = $1 AND scheduled_date = $2
   ORDER BY scheduled_date DESC`,
  [clientId, date]
);
```

```javascript
// GOOD — lookup returning caller with aggregation
const result = await pool.query(
  `SELECT
     caller_name,
     COUNT(*) AS previous_calls,
     MAX(created_at) AS last_call_at,
     (SELECT intent FROM call_logs
      WHERE client_id = $1 AND caller_phone = $2
      ORDER BY created_at DESC LIMIT 1) AS last_intent
   FROM call_logs
   WHERE client_id = $1 AND caller_phone = $2
   GROUP BY caller_name
   LIMIT 1`,
  [clientId, callerPhone]
);
```

### WARNING: Missing client_id Filter

**The Problem:**
```javascript
// BAD — returns data for ALL tenants
const result = await pool.query(
  'SELECT * FROM bookings WHERE scheduled_date = $1',
  [date]
);
```

**Why This Breaks:**
1. Data leaks across clients — HVAC client sees spa bookings
2. Performance — full table scan with no index hit
3. All indexes are composite on `(client_id, ...)` — queries without `client_id` skip them entirely

**The Fix:** Always include `client_id = $X` in the WHERE clause. Middleware in `tenantResolver.js` sets `req.clientId` — use it.

---

## Schema Conventions

Standard column set for every new table:

```sql
CREATE TABLE IF NOT EXISTS your_table (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- your columns here
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Always index on client_id for multi-tenant performance
CREATE INDEX idx_your_table_client ON your_table(client_id);

-- Composite indexes for frequent filter combos
CREATE INDEX idx_your_table_client_date ON your_table(client_id, some_date_column);
```

**Column types:**
- Primary keys: `UUID DEFAULT uuid_generate_v4()`
- Timestamps: `TIMESTAMPTZ` (never `TIMESTAMP` — loses timezone info)
- Money: `INTEGER` (cents, never `DECIMAL` or `FLOAT`)
- Flexible config: `JSONB` (not `JSON` — JSONB is indexed and compressed)
- Encrypted secrets: `BYTEA` (see `client_integrations.credentials_encrypted`)
- Enums: `TEXT` with a `CHECK` constraint, not PostgreSQL ENUM type (ENUM alters are painful)

---

## Currency and Money

**NEVER use floating point for money.** IEEE 754 floats cause rounding errors that compound across billing cycles.

```sql
-- GOOD — integer cents
balance_cents  INTEGER NOT NULL DEFAULT 0,
amount_cents   INTEGER NOT NULL,
```

```javascript
// GOOD — atomic deduction with balance guard
const result = await pool.query(
  `UPDATE wallets
   SET balance_cents = balance_cents - $1, updated_at = NOW()
   WHERE client_id = $2 AND balance_cents >= $1
   RETURNING balance_cents`,
  [costCents, clientId]
);

if (result.rowCount === 0) {
  throw new Error('Insufficient wallet balance');
}
```

The `WHERE balance_cents >= $1` guard makes the deduction atomic — no race condition possible between check and update. If two concurrent calls both deduct at the same moment, only one succeeds per available balance.

---

## RETURNING for Confirmed Inserts

Always use `RETURNING` when you need the generated ID or computed defaults after an insert.

```javascript
// GOOD — get generated UUID and server-computed timestamp
const result = await pool.query(
  `INSERT INTO bookings
     (client_id, call_id, caller_name, caller_phone, scheduled_date, scheduled_time, status)
   VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
   RETURNING id, status, created_at`,
  [clientId, callId, callerName, callerPhone, date, time]
);
const { id, status } = result.rows[0];
```

```javascript
// BAD — separate SELECT after INSERT risks race conditions and extra round-trip
await pool.query('INSERT INTO bookings (...) VALUES (...)', [...]);
const found = await pool.query('SELECT id FROM bookings WHERE call_id = $1', [callId]); // avoid
```

---

## JSONB for Flexible Config

```sql
-- Schema: raw_data for extensible call metadata
raw_data JSONB DEFAULT '{}'
```

```javascript
// Query inside JSONB
const result = await pool.query(
  `SELECT * FROM call_logs
   WHERE client_id = $1
   AND raw_data->>'vapi_call_id' = $2`,
  [clientId, vapiCallId]
);
```

Use `JSONB` (not `JSON`) for columns you might query or index. `JSONB` stores binary-parsed data; `JSON` stores raw text and re-parses on every access.

---

## WARNING: String Interpolation in Queries

**The Problem:**
```javascript
// BAD — SQL injection vulnerability
const result = await pool.query(
  `SELECT * FROM clients WHERE business_phone = '${phone}'`
);
```

**Why This Breaks:**
1. SQL injection — attacker sends `'; DROP TABLE clients; --` as phone number
2. Breaks PgBouncer's query deduplication (unique query string per value = no plan caching)

**The Fix:**
```javascript
// GOOD — parameterized
const result = await pool.query(
  'SELECT * FROM clients WHERE business_phone = $1',
  [phone]
);
```

See the **express** skill for how route handlers should pass validated input into queries.
