# Node Patterns Reference

## Contents
- Async/Await Conventions
- CommonJS Module Patterns
- Concurrency Patterns
- WARNING: Blocking the Event Loop
- WARNING: Module-Level Mutable State
- WARNING: Missing Input Validation Library

---

## Async/Await Conventions

Always `async/await` — never raw `.then()/.catch()` chains in route handlers.

```javascript
// GOOD — errors propagate to global handler
router.post('/booking/create', async (req, res, next) => {
  try {
    const booking = await bookingService.create(req.tenant.clientId, req.body);
    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

// BAD — inline error responses bypass structured logging and consistent format
router.post('/booking/create', (req, res) => {
  bookingService.create(req.body)
    .then(b => res.json(b))
    .catch(err => res.status(500).json({ error: err.message }));
});
```

## CommonJS Module Patterns

Every file: `'use strict';` at top. Export at bottom.

```javascript
'use strict';

const pool = require('../config/database');
const logger = require('../utils/logger');

async function checkAvailability(clientId, date) {
  const { rows } = await pool.query(
    'SELECT * FROM cached_availability WHERE client_id = $1 AND date = $2',
    [clientId, date]
  );
  return rows;
}

module.exports = { checkAvailability };
```

Named exports over default exports — easier to grep and tree-shake if needed later.

## Concurrency Patterns

### Parallel I/O

Use `Promise.all` for independent async operations. Sequential `await` kills throughput.

```javascript
// GOOD — ~150ms total (parallel)
const [config, faqs, callerHistory] = await Promise.all([
  getClientConfig(clientId),
  faqSearch.query(clientId, userMessage),
  callerMemory.lookup(clientId, callerPhone),
]);

// BAD — ~450ms total (sequential)
const config = await getClientConfig(clientId);
const faqs = await faqSearch.query(clientId, userMessage);
const callerHistory = await callerMemory.lookup(clientId, callerPhone);
```

### Atomic Redis Operations

For the 3-phase soft-lock booking flow, `SETNX` is the only safe approach:

```javascript
// GOOD — atomic, exactly one caller wins
const held = await redis.set(
  `hold:${clientId}:${date}:${time}`,
  callId,
  'NX',   // only set if not exists
  'EX',   // with expiry
  300
);
if (!held) {
  // slot taken — return alternatives
}

// BAD — race condition between GET and SET
const existing = await redis.get(key);
if (!existing) {
  await redis.set(key, callId, 'EX', 300); // another call wins here
}
```

---

## WARNING: Blocking the Event Loop

**The Problem:**

```javascript
// BAD — synchronous crypto blocks all concurrent requests
const iv = crypto.randomBytes(16); // synchronous, but OK at startup
// BAD in hot path:
const hash = crypto.createHash('sha256').update(bigData).digest('hex');
```

**Why This Breaks:**
1. Node.js is single-threaded. One slow sync operation stalls every in-flight call.
2. Under load (multiple simultaneous Vapi calls), latency spikes cascade — one 50ms block can delay 10 concurrent requests.
3. Railway health checks can fail if the event loop is blocked during a check.

**The Fix:**

```javascript
// GOOD — use async crypto for large operations
const { promisify } = require('util');
const randomBytes = promisify(crypto.randomBytes);
const iv = await randomBytes(16);

// GOOD — offload CPU-heavy work to worker_threads if needed
const { Worker } = require('worker_threads');
```

---

## WARNING: Module-Level Mutable State

**The Problem:**

```javascript
// BAD — shared state across all requests, breaks on Railway multi-replica
let currentClientConfig = null;

async function getConfig(clientId) {
  if (!currentClientConfig) {
    currentClientConfig = await pool.query(...);
  }
  return currentClientConfig;
}
```

**Why This Breaks:**
1. With Railway horizontal scaling, each replica has its own memory — state is inconsistent.
2. Config updates made by one request are invisible to others.
3. Memory leaks if objects accumulate.

**The Fix:** All config caching belongs in Redis (`client_config:{clientId}` with 300s TTL). See the **redis** skill.

---

## WARNING: Missing Input Validation Library

**Detected:** No zod, joi, or yup in dependencies.

**Impact:** Manual validation is error-prone and inconsistent across routes. Missing fields cause cryptic downstream errors instead of clean 400 responses.

**Recommended:**

```bash
npm install zod
```

```javascript
'use strict';

const { z } = require('zod');

const BookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  service_type: z.string().min(1),
  caller_phone: z.string().regex(/^\+1\d{10}$/),
});

router.post('/booking/create', async (req, res, next) => {
  try {
    const body = BookingSchema.parse(req.body); // throws ZodError on invalid
    const booking = await bookingService.create(req.tenant.clientId, body);
    res.status(201).json(booking);
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', issues: err.issues });
    }
    next(err);
  }
});
```

See the **zod** skill for full validation patterns.
