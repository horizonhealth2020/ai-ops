# Square Patterns Reference

## Contents
- Payment link creation
- Credentials loading
- Idempotency
- Money handling
- Error handling
- Anti-patterns

---

## Payment Link Creation

Square uses the **Online Checkout** API (`/online-checkout/payment-links`), not `POST /payments`. This produces a hosted URL — the client never handles card data. The returned `link.url` is what gets sent via SMS.

```javascript
// src/integrations/square.js — createPaymentIntent()
const resp = await squareRequest(creds.access_token, 'POST', '/online-checkout/payment-links', {
  idempotency_key: uuidv4(),
  quick_pay: {
    name: params.description,
    price_money: {
      amount: params.amount_cents,     // integer cents — NEVER float
      currency: (params.currency || 'usd').toUpperCase(),
    },
    location_id: config.location_id || creds.location_id,
  },
});
```

`location_id` is required by Square. Store it in `client_integrations.config` (JSON column) so it can be updated without re-encrypting credentials.

---

## Credentials Loading

Square credentials are **always per-client**. There is no platform-level `SQUARE_ACCESS_TOKEN` fallback for the production payment flow (unlike Stripe which falls back to `process.env.STRIPE_SECRET_KEY`).

```javascript
// src/integrations/square.js
const result = await pool.query(
  `SELECT credentials_encrypted, config
   FROM client_integrations
   WHERE client_id = $1 AND platform = 'square' AND is_active = true
   LIMIT 1`,
  [clientId]
);

if (result.rows.length === 0) {
  throw new Error('No Square credentials configured for this client');
}

const creds = decrypt(result.rows[0].credentials_encrypted);
const config = result.rows[0].config || {};
```

`creds` decrypts to `{ access_token: 'EAA...' }`. `config` holds `{ location_id: 'L...' }`.

---

## Idempotency

Every Square request MUST include a unique `idempotency_key`. Square uses this to safely retry failed requests without double-charging.

```javascript
// GOOD — fresh UUID per call
const { v4: uuidv4 } = require('uuid');
const resp = await squareRequest(creds.access_token, 'POST', '/online-checkout/payment-links', {
  idempotency_key: uuidv4(),
  // ...
});
```

```javascript
// BAD — reusing the booking_id or any stable ID
idempotency_key: params.booking_id,  // If retried, Square may reject as duplicate
```

**Why this matters:** If the HTTP request times out after Square processes it, the caller will retry. A stable key causes Square to return the original result (good). A missing key causes duplicate charges (catastrophic).

---

## Money Handling

```javascript
// GOOD — integer cents
amount: params.amount_cents,  // 15000 = $150.00

// BAD — float dollars
amount: 150.00 * 100,  // Floating point: may produce 14999.999999... or 15000.000001
```

The codebase convention from `CLAUDE.md`: **all money in cents (integers)**. Never convert inside the integration layer — enforce this at the route validation boundary.

---

## Error Handling

Square returns non-2xx status for API errors. The current integration checks `resp.status !== 200` and throws a generic message. When debugging, log `resp.data` — it contains Square's error body with `errors[].code` and `errors[].detail`.

```javascript
// src/integrations/square.js
if (resp.status !== 200) {
  throw new Error(`Square API error: ${resp.status}`);
}
```

For richer debugging, temporarily log the response body:

```javascript
if (resp.status !== 200) {
  logger.error('Square API error', { status: resp.status, body: resp.data });
  throw new Error(`Square API error: ${resp.status}`);
}
```

---

## WARNING: Skipping the DB Insert

**The Problem:**

```javascript
// BAD — returning link without recording it
return { payment_id: link.id, payment_link: link.url };
// Missing: INSERT INTO payments ...
```

**Why This Breaks:**
1. Payment reconciliation in n8n webhooks requires the `payments` row to exist — the webhook handler will 404 on lookup.
2. Dashboard wallet and transaction views query the `payments` table. Missing records cause silent revenue gaps.
3. Square webhooks (if configured) update `payments.status` — no row means the update is silently dropped.

**The Fix:** Always write to `payments` before returning:

```javascript
await pool.query(
  `INSERT INTO payments (client_id, booking_id, processor, external_payment_id, amount_cents, currency, status, payment_link)
   VALUES ($1, $2, 'square', $3, $4, $5, 'pending', $6)`,
  [clientId, params.booking_id || null, link.id, params.amount_cents,
   params.currency || 'usd', link.url]
);
```

---

## WARNING: Raw `https` Module vs SDK

Square does not have an official Node.js SDK in this project's dependencies. The codebase uses raw `https.request` via `squareRequest()`. This is intentional — avoid pulling in `squareup` npm package for a single endpoint.

```javascript
// GOOD — use existing squareRequest() helper
const resp = await squareRequest(creds.access_token, 'POST', '/path', body);

// BAD — adding the squareup SDK for one endpoint
const { Client } = require('squareup');
const client = new Client({ accessToken: creds.access_token });
```

The SDK adds significant bundle size and version drift risk. The raw helper is sufficient for the single payment-link endpoint used here.
