# Stripe Workflows Reference

## Contents
- Payment creation workflow (during a call)
- Adding Stripe to a new client
- Dual-path payment split decision
- Checklist: new payment integration
- Validating payment state

---

## Payment Creation Workflow (During a Live Call)

This is the only Stripe flow that runs in the real-time call path. It must complete fast —
the AI agent is waiting for a `payment_link` to read back to the caller.

```
Vapi → POST /api/v1/payment/create-intent
  → vapiAuth middleware validates VAPI_API_KEY
  → routes/payment.js validates required fields
  → paymentService.createPayment(clientId, params)
    → getPaymentProcessor(clientId) → 'stripe' or 'square'
    → stripeIntegration.createPaymentIntent(clientId, params)
      → load + decrypt client credentials (or platform fallback)
      → stripe.paymentIntents.create(...)
      → INSERT INTO payments (..., status='pending')
      → return { payment_id, client_secret, payment_link }
    → if caller_phone + payment_link → sendPaymentLink() via Twilio (non-fatal)
  → res.json({ payment_id, payment_link, processor })
```

The SMS send is wrapped in try/catch and logged as a warning on failure — it MUST NOT fail
the payment intent creation.

```javascript
// src/services/paymentService.js — correct SMS error handling
if (params.caller_phone && paymentResult.payment_link) {
  try {
    await sendPaymentLink(params.caller_phone, paymentResult.payment_link, params.description);
  } catch (err) {
    logger.warn('Failed to send payment SMS', { error: err.message });
    // Intentionally non-fatal
  }
}
```

---

## Adding Stripe to a New Client

When onboarding a client with their own Stripe account, insert an encrypted credentials row:

```javascript
// In onboard route or admin tooling
const { encrypt } = require('../services/encryption');

const encrypted = encrypt(JSON.stringify({
  secret_key: 'sk_live_...',
  publishable_key: 'pk_live_...',
}));

await pool.query(
  `INSERT INTO client_integrations
     (client_id, integration_type, platform, credentials_encrypted, is_active)
   VALUES ($1, 'payment', 'stripe', $2, true)`,
  [clientId, encrypted]
);
```

Then verify the routing logic picks it up:

```javascript
// getPaymentProcessor() will return 'stripe' for this client
const processor = await getPaymentProcessor(clientId);
// processor === 'stripe'
```

If the client should use Square instead, set `platform = 'square'` — `getPaymentProcessor()`
returns the platform value directly.

---

## Dual-Path Payment Split Decision

The routing rule in `paymentService.getPaymentProcessor()` is simple:

```javascript
// GOOD — explicit processor detection
async function getPaymentProcessor(clientId) {
  const result = await pool.query(
    `SELECT platform FROM client_integrations
     WHERE client_id = $1 AND integration_type = 'payment' AND is_active = true
     LIMIT 1`,
    [clientId]
  );
  if (result.rows.length > 0) return result.rows[0].platform;
  return 'stripe';  // platform default
}
```

Decision tree:
- Client has `client_integrations` row with `integration_type='payment'` → use that `platform`
- No row → use `STRIPE_SECRET_KEY` (platform Stripe account)
- `platform = 'square'` → route to Square integration

See the **express** skill for route handler conventions. For Square-specific patterns, see
`src/integrations/square.js`.

---

## Checklist: Adding a New Stripe Feature

Copy this checklist and track progress:

- [ ] Step 1: All amounts are integer cents — never divide or multiply by 100 in intent creation
- [ ] Step 2: `metadata.client_id` is always set on the intent for n8n reconciliation
- [ ] Step 3: Insert a `payments` row with `status='pending'` immediately after intent creation
- [ ] Step 4: Return `{ payment_id, client_secret, payment_link }` — match existing shape
- [ ] Step 5: SMS send failures are caught and logged as `warn`, never thrown
- [ ] Step 6: New Stripe API calls go in `src/integrations/stripe.js`, not in routes or services
- [ ] Step 7: Webhook handling routes to n8n, not a new Express endpoint

---

## Validating Payment State

To check if a payment intent was recorded correctly:

```sql
-- Verify payment record exists and has correct state
SELECT payment_id, processor, amount_cents, status, created_at
FROM payments
WHERE client_id = $1
ORDER BY created_at DESC
LIMIT 10;
```

Expected flow of `status` values:
1. `pending` — inserted by Express immediately after intent creation
2. `succeeded` — updated by n8n after Stripe webhook fires
3. `failed` — updated by n8n on payment failure

```javascript
// GOOD — structured log on intent creation for traceability
logger.info('Payment intent created', {
  client_id: clientId,
  payment_id: intent.id,
  amount_cents: params.amount_cents,
  processor: 'stripe',
});
```

Without this log, debugging "was the intent created or did it fail silently?" requires
cross-referencing the Stripe dashboard. Log it. See the **node** skill for logger usage.

---

## WARNING: Instantiating Stripe Once vs Per-Request

### The Problem

```javascript
// BAD — module-level Stripe instance (wrong for multi-tenant)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = { createPaymentIntent };
```

**Why This Breaks:**
1. Multi-tenant: different clients have different Stripe keys — a singleton uses the wrong key
2. Key rotation: changing `STRIPE_SECRET_KEY` requires a process restart to take effect
3. Per-client keys can never be used — the module-level instance hardcodes the platform key

**The Fix:**

```javascript
// GOOD — instantiate per-request after loading the correct key
async function createPaymentIntent(clientId, params) {
  const stripeKey = await loadStripeKey(clientId); // platform fallback included
  const stripe = new Stripe(stripeKey);
  // ...
}
```

The Stripe SDK constructor is lightweight — instantiating it per-request is safe and correct here.
