# Errors Reference

## Contents
- Global error handler
- next(err) contract
- Attaching status codes to errors
- Structured logging
- Anti-patterns

---

## Global Error Handler

`src/middleware/errorHandler.js` is the last middleware in `src/index.js`. It catches anything passed via
`next(err)` from any route. It logs structured JSON and returns a consistent `{ error: message }` shape:

```javascript
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  logger.error(message, {
    status,
    method: req.method,
    path: req.path,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  res.status(status).json({ error: message });
}
```

Stack traces are suppressed in production — Railway sets `NODE_ENV=production`. This prevents
internal file paths, query text, and library internals from leaking to API consumers.

---

## next(err) Contract

Every async route handler MUST wrap its body in `try/catch` and call `next(err)` on failure.
No exceptions:

```javascript
router.post('/booking/create', vapiAuth, async (req, res, next) => {
  try {
    const result = await bookingService.createBooking(req.body);
    res.json(result);
  } catch (err) {
    next(err); // always — never handle inline
  }
});
```

If you forget `next(err)` in an async handler, Express will not catch the rejection and the request
will hang until it times out. The client gets no response; the error is invisible in logs.

---

## Attaching Status Codes to Errors

Services can signal specific HTTP status codes by attaching `.status` or `.statusCode` to the thrown error.
The global handler reads these:

```javascript
// In a service — signal a 409 Conflict
async function holdSlot(clientId, date, time) {
  const key = `hold:${clientId}:${date}:${time}`;
  const held = await redis.set(key, '1', 'NX', 'EX', 300);

  if (!held) {
    const err = new Error('Slot already held by another caller');
    err.status = 409;
    throw err;
  }
}
```

```javascript
// In a route — 404 for missing resources
router.get('/wallet', async (req, res, next) => {
  try {
    const wallet = await getWalletInfo(req.clientId);
    if (!wallet) return res.status(404).json({ error: 'No wallet found' });
    res.json(wallet);
  } catch (err) {
    next(err);
  }
});
```

Return early with `res.status(4xx)` for known-invalid inputs. Throw with `.status` for error conditions
detected deep in services.

---

## Structured Logging

NEVER use `console.log` for application events. Use `src/utils/logger.js` with JSON structure:

```javascript
const logger = require('../utils/logger');

// Info with context
logger.info('Booking created', { client_id: clientId, booking_id: id, duration_ms: 234 });

// Warning (non-fatal — Redis down, Clerk auth failed)
logger.warn('Redis cache miss', { client_id: clientId, key: cacheKey });

// Error (always include error message; include stack only in dev)
logger.error('FSM verification failed', { client_id: clientId, error: err.message });
```

Structured logging makes Railway's log search useful. `console.log('Booking created for ' + clientId)`
produces an unsearchable string — useless in production.

---

## Error Handling Checklist

Copy this checklist when writing a new route or service:

- [ ] Route handler has `try/catch` wrapping all async work
- [ ] Catch block calls `next(err)` — not `res.status(500).json(...)`
- [ ] Validation failures use early `return res.status(400).json({ error: '...' })`
- [ ] Missing resources use `return res.status(404).json({ error: '...' })`
- [ ] Service throws errors with `.status` attached for non-500 conditions
- [ ] All errors logged with `logger.error(msg, { error: err.message, client_id: ... })`
- [ ] No `err.stack` or internal paths in error messages returned to callers

---

### WARNING: Inline Error Handling in Routes

**The Problem:**

```javascript
// BAD - bypasses global handler, leaks internals, ignores err.status
router.post('/hold', vapiAuth, async (req, res, next) => {
  try {
    const result = await availabilityService.holdSlot(data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message }); // exposes internal error details
  }
});
```

**Why This Breaks:**
1. `err.message` may contain DB connection strings, query text, or file paths — security risk
2. A 409 thrown by the service (slot conflict) becomes a 500 — wrong status code returned
3. The error is never logged, making Railway log search useless for debugging

**The Fix:** `next(err)` and let `errorHandler` do its job.

---

### WARNING: Unhandled Promise Rejections

**The Problem:**

```javascript
// BAD - missing await, rejection is unhandled
router.post('/complete', vapiAuth, (req, res, next) => {
  // forgot async keyword — try/catch does nothing for the promise
  try {
    const result = walletService.deductBalance(data); // Promise, not awaited
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});
```

**Why This Breaks:**
Node.js logs `UnhandledPromiseRejection` warnings and in Node 18+ may terminate the process.
The route responds immediately with `{ status: 'ok' }` while the deduction runs asynchronously and fails silently.

**The Fix:** Every route that calls async code MUST be `async` and MUST `await` every Promise.

---

### WARNING: Missing Error Handler Registration Order

**The Problem:**

```javascript
// BAD - error handler registered before routes
app.use(require('./middleware/errorHandler'));
app.use('/api/v1/booking', require('./routes/booking'));
```

**Why This Breaks:**
Express processes middleware in registration order. An error handler registered before routes never
receives errors from those routes — they fall through to Express's default error handler.

**The Fix:** Register all routes, then the 404 handler, then the error handler — in that order (as in `src/index.js`).
