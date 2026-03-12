# Node Modules Reference

## Contents
- Module Loading Patterns
- Service Layer Structure
- Config Module Pattern
- Circular Dependency Prevention
- WARNING: No ORM / Raw pg Queries

---

## Module Loading Patterns

Use CommonJS `require` at the top of each file. Never dynamic `require()` inside request handlers (causes module cache misses and blocks).

```javascript
'use strict';

// GOOD — static requires at top
const pool = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../services/encryption');

// BAD — dynamic require in request path
router.post('/booking/create', async (req, res, next) => {
  const bookingService = require('../services/bookingService'); // re-resolved every call
  ...
});
```

**Exception:** FSM adapters use lazy requires intentionally to avoid loading all SDKs at startup:

```javascript
// bookingService.js — lazy FSM adapter loading by design
const FSM_ADAPTERS = {
  housecall_pro: () => require('../integrations/housecallpro'),
  jobber:        () => require('../integrations/jobber'),
  servicetitan:  () => require('../integrations/servicetitan'),
};

const adapter = FSM_ADAPTERS[client.fsm_type]?.();
```

## Service Layer Structure

Routes call services. Services call integrations/config. Integrations call external APIs. Never skip layers.

```
routes/booking.js
  └── services/bookingService.js
        ├── config/database.js      (PostgreSQL)
        ├── config/redis.js         (Redis)
        ├── integrations/housecallpro.js (FSM)
        └── utils/logger.js
```

```javascript
// routes/booking.js — thin, only HTTP concerns
router.post('/create', async (req, res, next) => {
  try {
    const result = await bookingService.create(req.tenant.clientId, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// services/bookingService.js — business logic lives here
async function create(clientId, data) {
  const adapter = FSM_ADAPTERS[data.fsmType]?.();
  if (!adapter) throw new Error(`Unknown FSM type: ${data.fsmType}`);
  const verified = await adapter.verifySlotAvailability(creds, clientId, data.date, data.time);
  if (!verified) throw new Error('Slot no longer available');
  // write to postgres, clear redis hold, fire n8n webhook
}
```

## Config Module Pattern

Config modules validate env vars at startup (fail fast) and export typed values.

```javascript
// src/config/env.js
'use strict';

const REQUIRED = ['PGBOUNCER_URL', 'REDIS_URL', 'VAPI_API_KEY', 'OPENAI_API_KEY'];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    // Crash at startup — better than cryptic runtime errors
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  pgBouncerUrl: process.env.PGBOUNCER_URL,
  redisUrl: process.env.REDIS_URL,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
  encryptionKey: process.env.ENCRYPTION_KEY,
};
```

Load `env.js` before any other config module in `src/index.js`.

## Circular Dependency Prevention

Services must NOT require other services. If two services need shared logic, extract to `utils/`.

```
// BAD — circular
bookingService.js  →  walletService.js
walletService.js   →  bookingService.js  ← circular

// GOOD — shared logic in utils
bookingService.js  →  utils/billingUtils.js
walletService.js   →  utils/billingUtils.js
```

Detect circulars: `node --trace-warnings src/index.js` — Node will warn on circular requires.

## WARNING: No ORM / Raw pg Queries

**Detected:** No Prisma, Drizzle, or Kysely in dependencies — only raw `pg`.

**Impact:** SQL injection risk if parameterization is ever skipped. No compile-time query validation. Schema changes require manual audit of all queries.

**Mitigation (without adding an ORM):**

1. **Always use parameterized queries** — `$1, $2` placeholders, never string interpolation.
2. **Centralize table names as constants** — avoid typos.
3. **Tag queries with comments** for pg_stat_statements visibility:

```javascript
// GOOD — parameterized + tagged
const { rows } = await pool.query(
  /* bookingService.create */
  'INSERT INTO bookings (client_id, date, time, caller_phone) VALUES ($1, $2, $3, $4) RETURNING *',
  [clientId, date, time, callerPhone]
);

// BAD — injection vulnerability
const { rows } = await pool.query(
  `INSERT INTO bookings (client_id) VALUES ('${clientId}')`
);
```

See the **postgresql** skill for pool configuration and transaction patterns.

## New Route Checklist

Copy this checklist when adding a new route:

- [ ] File starts with `'use strict';`
- [ ] All database queries include `client_id = $N` parameter
- [ ] All async handlers wrapped in `try/catch` → `next(err)`
- [ ] Structured logging with `logger.info/error` (not `console.log`)
- [ ] Route registered in `src/index.js`
- [ ] Auth middleware applied (`requireVapi` or `requireClerk`)
- [ ] Input validated before service call
- [ ] Added to README.md API endpoints table
