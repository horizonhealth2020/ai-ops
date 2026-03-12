# Routes Reference

## Contents
- Route structure and registration
- Input validation
- Auth middleware application
- Pagination pattern
- Anti-patterns

---

## Route Structure

Every route file follows this exact pattern:

```javascript
'use strict';

const router = require('express').Router();
const { vapiAuth } = require('../middleware/auth');  // or clerkAuth
const myService = require('../services/myService');

router.post('/action', vapiAuth, async (req, res, next) => {
  try {
    // 1. Extract + validate inputs
    // 2. Call service
    // 3. Return result
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

Register in `src/index.js`:

```javascript
app.use('/api/v1/myresource', require('./routes/myResource'));
```

---

## Input Validation

Do manual field checks at the top of each handler. No validation library is installed — keep it inline:

```javascript
router.post('/create', vapiAuth, async (req, res, next) => {
  try {
    const { client_id, call_id, caller_name, caller_phone, service_type, scheduled_date, scheduled_time } = req.body;

    if (!client_id || !call_id || !caller_name || !caller_phone || !service_type || !scheduled_date || !scheduled_time) {
      return res.status(400).json({
        error: 'client_id, call_id, caller_name, caller_phone, service_type, scheduled_date, and scheduled_time are required',
      });
    }

    const result = await bookingService.createBooking({ client_id, call_id, ...rest });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

Return early on validation failure — never let the handler proceed with missing data.

---

## Dashboard Routes (router-level auth)

Apply `clerkAuth` once at the router level instead of per-route. After auth, `req.clientId` is available on all handlers:

```javascript
const router = require('express').Router();
const { clerkAuth } = require('../middleware/auth');

router.use(clerkAuth); // all routes below are protected

router.get('/config', async (req, res, next) => {
  // req.clientId is set by clerkAuth
  const client = await loadClientFromDb(req.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});
```

---

## Pagination Pattern

Used in `GET /api/v1/dashboard/calls` — cap `limit` to prevent abuse, run count and data queries in parallel:

```javascript
router.get('/calls', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const conditions = ['client_id = $1'];
    const params = [req.clientId];
    let idx = 2;

    if (req.query.intent) { conditions.push(`intent = $${idx}`); params.push(req.query.intent); idx++; }

    const where = conditions.join(' AND ');

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM call_logs WHERE ${where}`, params),
      pool.query(`SELECT * FROM call_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]),
    ]);

    res.json({ total: parseInt(countResult.rows[0].count), limit, offset, calls: dataResult.rows });
  } catch (err) {
    next(err);
  }
});
```

---

## Rate Limiting

Apply the rate limiter middleware to Vapi routes that are called frequently during live calls:

```javascript
const rateLimiter = require('../middleware/rateLimiter');

// 30 requests per minute per client
router.post('/check', vapiAuth, rateLimiter(30, 60), async (req, res, next) => { ... });
```

The limiter keys by `client_id:endpoint`. If Redis is down it fails open (requests are allowed).

---

### WARNING: Business Logic in Route Handlers

**The Problem:**

```javascript
// BAD - FSM call, DB write, and cache invalidation all in the route handler
router.post('/booking/create', vapiAuth, async (req, res, next) => {
  try {
    const fsm = require('../integrations/housecallpro');
    const available = await fsm.verifySlotAvailability(...);
    if (!available) return res.status(409).json({ error: 'Slot taken' });
    await pool.query('INSERT INTO bookings ...', [...]);
    await redis.del(`held_slots:${client_id}`);
    res.json({ status: 'booked' });
  } catch (err) { next(err); }
});
```

**Why This Breaks:**
1. The route becomes untestable — you can't unit test it without a live FSM, PostgreSQL, and Redis
2. Any route that needs to reuse this logic must duplicate it
3. Transactions spanning FSM + DB calls are impossible to manage cleanly

**The Fix:**

```javascript
// GOOD - route just validates input and delegates
router.post('/booking/create', vapiAuth, async (req, res, next) => {
  try {
    const { client_id, ...bookingData } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const result = await bookingService.createBooking({ client_id, ...bookingData });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

---

### WARNING: Missing `next(err)` in Catch

**The Problem:**

```javascript
// BAD - error swallowed, client hangs or gets wrong status
router.post('/hold', vapiAuth, async (req, res, next) => {
  try {
    const result = await availabilityService.holdSlot(data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message }); // leaks stack details, bypasses error handler
  }
});
```

**Why This Breaks:**
1. Internal error details (DB connection strings, query text) may leak to the caller
2. Bypasses the global `errorHandler` which controls logging format and stack trace visibility
3. `err.status` from upstream services (e.g., 409 conflict) is ignored — always returns 500

**The Fix:** Always `next(err)`. The global handler in `src/middleware/errorHandler.js` does the right thing.
