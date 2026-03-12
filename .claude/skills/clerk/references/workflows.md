# Clerk Workflows Reference

## Contents
- Adding a New Protected Dashboard Route
- Onboarding: Linking a Clerk User to a Tenant
- Debugging Auth Failures
- Testing Clerk Auth Locally

---

## Adding a New Protected Dashboard Route

Copy this checklist:

- [ ] Create or open the route file under `src/routes/`
- [ ] Import `clerkAuth` and apply with `router.use(clerkAuth)` at the top
- [ ] Use `req.clientId` (never `req.body.client_id`) in all DB queries
- [ ] Register the router in `src/index.js` under `/api/v1/dashboard/`
- [ ] Return `next(err)` in all catch blocks — never inline `res.status(500)`
- [ ] Verify: unauthenticated request returns 401, valid token returns data

### Route Template

```javascript
'use strict';

const router = require('express').Router();
const { clerkAuth } = require('../middleware/auth');
const pool = require('../config/database');

router.use(clerkAuth);

router.get('/my-resource', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM my_table WHERE client_id = $1',
      [req.clientId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

```javascript
// src/index.js — register the router
const myResource = require('./routes/myResource');
app.use('/api/v1/dashboard/my-resource', myResource);
```

See the **express** skill for route handler conventions and error forwarding.

---

## Onboarding: Linking a Clerk User to a Tenant

When `POST /api/v1/onboard` creates a new client, it must write `client_id` into the
Clerk user's `public_metadata`. Without this, `clerkAuth` returns 403 on every call.

```javascript
// src/routes/onboard.js — pattern for setting metadata after client creation
const { createClerkClient } = require('@clerk/express');

const clerkClient = createClerkClient({ secretKey: env.clerkSecretKey });

// After inserting the new client into PostgreSQL:
await clerkClient.users.updateUserMetadata(clerkUserId, {
  publicMetadata: { client_id: newClient.id },
});
```

**Iterate-until-pass validation:**

1. Create client via `POST /api/v1/onboard`
2. Validate: `GET /api/v1/dashboard/config` with the user's Clerk JWT
3. If 403: check Clerk dashboard → User → `public_metadata.client_id` is missing
4. If 401: check `CLERK_SECRET_KEY` matches the Clerk instance
5. Repeat step 2 until 200 is returned

---

## Debugging Auth Failures

### 401 "Missing authorization token"

Request has no `Authorization` header or it's malformed.

```bash
# Correct header format
curl -H "Authorization: Bearer <your_jwt>" https://your-host/api/v1/dashboard/config
```

### 401 "Invalid or expired token"

Token is signed with a different Clerk instance or has expired (default: 60s).

- Verify `CLERK_SECRET_KEY` matches the Clerk instance that issued the token
- Check the token's `exp` claim — Clerk tokens are short-lived by default
- The error is logged: `logger.warn('Clerk auth failed', { error: err.message })` — check Railway logs

```bash
# Decode JWT payload (without verification) to inspect claims
echo "<jwt>" | cut -d. -f2 | base64 -d | jq .
```

Look for: `sub` (Clerk user ID), `public_metadata.client_id`, `exp` timestamp.

### 403 "No client_id in user metadata"

Token is valid but the user hasn't been linked to a tenant.

```bash
# Check Clerk user metadata via Clerk API
curl -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  "https://api.clerk.com/v1/users/<clerk_user_id>"
```

Fix: update `public_metadata.client_id` in Clerk dashboard or via the Clerk API.

---

## Testing Clerk Auth Locally

No mock or stub is needed — use a real Clerk token from your development Clerk instance.

```bash
# 1. Get a session token from Clerk (use Clerk's test helper or frontend)
# 2. Set env var
export CLERK_SECRET_KEY=sk_test_...

# 3. Hit dashboard endpoint
curl -H "Authorization: Bearer <session_jwt>" \
  http://localhost:3000/api/v1/dashboard/config
```

NEVER hardcode a token or secret in test files. Use environment variables.
Use `CLERK_SECRET_KEY` from `.env` — see `src/config/env.js` for validation.

See the **node** skill for environment variable loading and validation patterns.
