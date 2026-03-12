# Auth Reference

## Contents
- Two auth paths: Vapi vs Clerk
- vapiAuth middleware
- clerkAuth middleware
- Applying auth to routes
- Rate limiting
- Anti-patterns

---

## Two Auth Paths

This codebase has two completely separate auth flows — never mix them up:

| Auth | Middleware | Used By | Sets |
|------|-----------|---------|------|
| Vapi API key | `vapiAuth` | AI agent during live calls | nothing on `req` |
| Clerk JWT | `clerkAuth` | Dashboard (browser) | `req.clientId`, `req.clerkUserId` |

Vapi routes are called from Vapi's infrastructure with a pre-shared API key.
Dashboard routes are called from the browser with a Clerk JWT.

---

## vapiAuth

Checks `Authorization: Bearer <key>` or `X-Vapi-Secret: <key>` header against `VAPI_API_KEY` env var.
If the key doesn't match, returns 401 immediately. No JWT verification needed — this is a simple shared secret.

```javascript
function vapiAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const secret = req.headers['x-vapi-secret'] || authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!secret || secret !== env.vapiApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
```

Apply per-route (Vapi routes do not share a common router):

```javascript
const { vapiAuth } = require('../middleware/auth');

router.post('/create', vapiAuth, async (req, res, next) => { ... });
router.post('/check', vapiAuth, rateLimiter(30, 60), async (req, res, next) => { ... });
```

---

## clerkAuth

Verifies a Clerk JWT from `Authorization: Bearer <token>`. On success, extracts `client_id` from
`publicMetadata` and attaches it as `req.clientId`. If `client_id` is missing from the metadata, returns 403
(user is authenticated but not provisioned as a client).

```javascript
async function clerkAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  try {
    const { verifyToken } = require('@clerk/express');
    const payload = await verifyToken(token, { secretKey: env.clerkSecretKey });

    const clientId = payload.public_metadata?.client_id;
    if (!clientId) {
      return res.status(403).json({ error: 'No client_id in user metadata' });
    }

    req.clientId = clientId;
    req.clerkUserId = payload.sub;
    next();
  } catch (err) {
    logger.warn('Clerk auth failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

Apply at the router level for dashboard routes — all dashboard routes require auth:

```javascript
const router = require('express').Router();
const { clerkAuth } = require('../middleware/auth');

router.use(clerkAuth); // protects all routes in this file

router.get('/config', async (req, res, next) => {
  // req.clientId is always set here
  const client = await loadClientFromDb(req.clientId);
  res.json(client);
});
```

See the **clerk** skill for JWT issuance and user metadata setup.

---

## Rate Limiting

The rate limiter (`src/middleware/rateLimiter.js`) is Redis-backed, keyed by `client_id:endpoint`.
Apply it selectively on high-frequency Vapi routes:

```javascript
const rateLimiter = require('../middleware/rateLimiter');

// 30 requests/60s per client on this endpoint
router.post('/check', vapiAuth, rateLimiter(30, 60), async (req, res, next) => { ... });
```

If Redis is unavailable, the limiter fails open (requests pass through). This is intentional — Redis is
ephemeral; a Redis outage should never take down live call handling.

---

## Adding a New Route Checklist

Copy this checklist when adding a new endpoint:

- [ ] Choose auth: `vapiAuth` (called by Vapi) or `clerkAuth` (called by browser)
- [ ] For Vapi routes: apply `vapiAuth` per-route
- [ ] For dashboard routes: apply `clerkAuth` via `router.use()` at top of file
- [ ] Use `req.clientId` from Clerk (set by middleware) or `req.body.client_id` from Vapi payload
- [ ] Every DB query includes `client_id` in WHERE clause
- [ ] Rate limit high-frequency endpoints with `rateLimiter()`
- [ ] Register route in `src/index.js`

---

### WARNING: Trusting client_id from Vapi Request Body Without DB Verification

**The Problem:**

```javascript
// RISKY - no verification that the Vapi caller owns this client_id
router.post('/booking/create', vapiAuth, async (req, res, next) => {
  const { client_id } = req.body;
  await bookingService.createBooking({ client_id, ...rest });
});
```

**Why This Is Acceptable Here (But Requires Care):**
Vapi routes are called by Vapi's infrastructure using the shared `VAPI_API_KEY`. The `client_id` in the
request body comes from Vapi assistant metadata configured by the platform operator — not from end callers.
The model is: Vapi is trusted (verified by API key), and it passes the correct `client_id`.

However, you MUST still validate that the `client_id` exists and is active before performing any action.
Never trust a `client_id` that doesn't exist in your database:

```javascript
// GOOD - verify the client exists before acting
const client = await getClientConfig(client_id);
if (!client) return res.status(404).json({ error: 'Client not found' });
```

---

### WARNING: Exposing clerkAuth on Public Routes

**The Problem:**

```javascript
// BAD - applying clerkAuth to public webhook (onboard endpoint)
router.use(clerkAuth);
router.post('/onboard', async (req, res, next) => { ... }); // this should be public
```

**Why This Breaks:**
The onboard route (`POST /api/v1/onboard`) receives webhooks from intake forms — no Clerk session exists.
Applying `clerkAuth` here would block all onboarding.

**The Fix:** `src/routes/onboard.js` has no auth middleware. Only apply `clerkAuth` to `src/routes/dashboard.js`.
The health endpoint (`/health`) is also intentionally unauthenticated.
