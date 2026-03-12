# Clerk Patterns Reference

## Contents
- Token Verification
- client_id Extraction
- Middleware Application Patterns
- Anti-Patterns
- Error Response Shape

---

## Token Verification

`verifyToken` is called inline inside `clerkAuth`. It requires `CLERK_SECRET_KEY` to
validate the token signature — without it, every request returns 401.

```javascript
// src/middleware/auth.js — actual implementation
const { verifyToken } = require('@clerk/express');
const payload = await verifyToken(token, {
  secretKey: env.clerkSecretKey,
});
```

`verifyToken` throws on expired or tampered tokens. The catch block converts this to a
structured 401 — never let Clerk errors propagate unhandled to `next(err)`, because
Clerk's error messages may expose internal token details.

---

## client_id Extraction

The Clerk JWT `public_metadata` field must contain `client_id` (a UUID). This is set
in the Clerk dashboard when onboarding a new client via `POST /api/v1/onboard`.

```javascript
// Correct extraction — from actual auth.js
const clientId = payload.public_metadata?.client_id;
if (!clientId) {
  return res.status(403).json({ error: 'No client_id in user metadata' });
}

req.clientId = clientId;        // Used by all downstream queries
req.clerkUserId = payload.sub;  // Clerk user UUID, for audit logs
```

**403 vs 401:** A valid token with no `client_id` means the user exists in Clerk but
hasn't been linked to a tenant. Return 403 (Forbidden), not 401 (Unauthorized) — the
distinction matters for frontend error handling.

---

## Middleware Application Patterns

### Apply to an Entire Router (preferred for dashboard routes)

```javascript
// src/routes/dashboard.js — actual pattern
router.use(clerkAuth);

// All routes below this line are protected
router.get('/config', async (req, res, next) => { ... });
router.put('/hours', async (req, res, next) => { ... });
```

This is cleaner than per-route middleware when the entire file is dashboard-only.

### Apply to a Single Route

```javascript
// Use only when mixing public and protected routes in one file
router.get('/public-info', async (req, res, next) => { ... });
router.get('/private-data', clerkAuth, async (req, res, next) => {
  // req.clientId available here
});
```

---

## Anti-Patterns

### WARNING: Trusting `req.body.client_id` Over `req.clientId`

**The Problem:**

```javascript
// BAD - user-supplied client_id bypasses tenant isolation
router.get('/data', clerkAuth, async (req, res, next) => {
  const clientId = req.body.client_id || req.clientId;  // NEVER do this
  const result = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
});
```

**Why This Breaks:**
1. Any authenticated user can read another tenant's data by supplying a different `client_id`
2. Data isolation is the project's hardest constraint — violations are silent bugs
3. Multi-tenant SaaS breach: one client sees another's call logs, wallet, bookings

**The Fix:**

```javascript
// GOOD - always use req.clientId exclusively
router.get('/data', clerkAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM clients WHERE id = $1',
      [req.clientId]  // Only ever use this
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
```

---

### WARNING: Applying clerkAuth to Vapi Routes

**The Problem:**

```javascript
// BAD - Vapi calls do not send Clerk JWTs
router.post('/api/v1/context/inject', clerkAuth, async (req, res, next) => { ... });
```

**Why This Breaks:**
1. Vapi sends `X-Vapi-Secret` or `Authorization: Bearer <vapi_key>`, not a Clerk JWT
2. Every live call returns 401, breaking the entire voice agent
3. Real-time call path requires `vapiAuth`, not `clerkAuth`

**The Fix:**

```javascript
// GOOD - use the correct middleware per route group
const { vapiAuth, clerkAuth } = require('../middleware/auth');

app.use('/api/v1/context', vapiAuth);      // Vapi routes
app.use('/api/v1/dashboard', clerkAuth);   // Dashboard routes
```

See the **express** skill for middleware registration order.

---

## Error Response Shape

Clerk auth produces two distinct error shapes — front ends must handle both:

```javascript
// 401 — Missing or invalid token
{ "error": "Missing authorization token" }
{ "error": "Invalid or expired token" }

// 403 — Authenticated but not linked to a tenant
{ "error": "No client_id in user metadata" }
```

The 403 case means the Clerk user exists but `public_metadata.client_id` was never set.
This happens when a user signs up directly without going through `POST /api/v1/onboard`.
Fix: set `client_id` in Clerk's user `public_metadata` via the Clerk API or dashboard.
