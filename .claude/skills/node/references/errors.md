# Node Errors Reference

## Contents
- Global Error Handler
- Error Classification
- WARNING: Exposing Internal Errors
- WARNING: Swallowing Errors Silently
- Common Runtime Errors and Fixes
- External API Error Handling

---

## Global Error Handler

All route errors must reach the global handler in `src/middleware/errorHandler.js` via `next(err)`. Never respond inline with `res.status(500)`.

```javascript
// src/middleware/errorHandler.js
'use strict';

const logger = require('../utils/logger');

module.exports = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const clientMessage = status < 500
    ? err.message
    : 'An internal error occurred'; // NEVER leak internal errors to clients

  logger.error('Request error', {
    status,
    message: err.message,
    stack: err.stack,
    path: req.path,
    client_id: req.tenant?.clientId,
  });

  res.status(status).json({ error: clientMessage });
};
```

Attach status to errors before throwing to control response codes:

```javascript
const err = new Error('Slot no longer available');
err.status = 409; // Conflict
throw err;

const err = new Error('client_id required');
err.status = 400; // Bad Request
throw err;
```

## Error Classification

| Category | Status | When |
|----------|--------|------|
| Validation | 400 | Missing/invalid request fields |
| Auth | 401 | Missing or invalid API key / JWT |
| Forbidden | 403 | Valid auth, wrong client_id scope |
| Not Found | 404 | Unknown client, booking, or slot |
| Conflict | 409 | Slot already held (SETNX failed) |
| Unprocessable | 422 | Business rule violation (zero wallet) |
| Internal | 500 | Unhandled exceptions — log, don't expose |

## WARNING: Exposing Internal Errors

**The Problem:**

```javascript
// BAD — leaks stack traces, DB schema, internal paths
router.post('/booking/create', async (req, res) => {
  try {
    ...
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});
```

**Why This Breaks:**
1. Reveals PostgreSQL table names, column names — aids SQL injection targeting.
2. Exposes FSM credentials structure, service architecture.
3. PCI DSS / SOC2 violation if error leaks payment context.

**The Fix:** Let the global handler respond. It maps 5xx to a generic message while logging the full error server-side.

---

## WARNING: Swallowing Errors Silently

**The Problem:**

```javascript
// BAD — n8n webhook failure is invisible
async function fireWebhook(data) {
  try {
    await axios.post(webhookUrl, data);
  } catch (err) {
    // swallowed — no log, no rethrow
  }
}
```

**Why This Breaks:**
1. Post-call workflow (SMS confirmation, CRM sync) silently fails.
2. No alerting, no way to detect systematic failures.
3. Debugging becomes archaeology — "when did this start failing?"

**The Fix:**

```javascript
async function fireWebhook(data) {
  try {
    await axios.post(process.env.N8N_WEBHOOK_BASE_URL + '/post-call', data);
  } catch (err) {
    // Log and continue — webhook failure is non-fatal for the call
    logger.error('n8n webhook failed', {
      error: err.message,
      call_id: data.callId,
      client_id: data.clientId,
    });
    // Do NOT rethrow — call completion should still succeed
  }
}
```

Distinguish between fatal errors (rethrow) and non-fatal background operations (log and continue).

---

## Common Runtime Errors and Fixes

### `Cannot read properties of undefined (reading 'clientId')`

**Cause:** `req.tenant` not populated — tenantResolver middleware not applied to the route.

**Fix:**

```javascript
// src/index.js — ensure tenantResolver runs before Vapi routes
app.use('/api/v1', tenantResolver, vapiRoutes);
```

### `Redis SETNX race condition — slot booked twice`

**Cause:** Using GET + SET instead of atomic `SET NX`.

**Fix:** Use ioredis `set(key, val, 'NX', 'EX', ttl)` — returns `'OK'` if set, `null` if key exists.

### `PgBouncer: prepared statement already exists`

**Cause:** Using `pg` with named prepared statements in transaction mode PgBouncer.

**Fix:** Use simple query protocol — never pass `name` to pool.query:

```javascript
// GOOD — unnamed parameterized query (PgBouncer safe)
await pool.query('SELECT * FROM clients WHERE client_id = $1', [clientId]);

// BAD — named prepared statements fail with PgBouncer in transaction mode
await pool.query({ name: 'get-client', text: '...', values: [...] });
```

### `UnhandledPromiseRejectionWarning`

**Cause:** Async function called without await and without `.catch()`.

**Fix:** Audit all fire-and-forget async calls. Add `.catch(err => logger.error(...))` or `await`.

```javascript
// GOOD
void fireWebhook(data).catch(err => logger.error('Webhook failed', { error: err.message }));
```

## External API Error Handling

FSM, Stripe, Square, and Twilio errors must be caught and mapped — never propagate raw third-party error messages to callers.

```javascript
async function verifySlotWithFSM(adapter, creds, clientId, date, time) {
  try {
    return await adapter.verifySlotAvailability(creds, clientId, date, time);
  } catch (err) {
    logger.error('FSM verification failed', {
      error: err.message,
      client_id: clientId,
      date,
      time,
    });
    // Treat FSM failure as "slot unavailable" — offer alternatives
    return false;
  }
}
```

**Timeouts:** External API calls have no default timeout in Node.js `fetch`/`axios`. Always set one:

```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
try {
  const res = await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}
```
