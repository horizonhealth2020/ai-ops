# Stripe Patterns Reference

## Contents
- Currency safety
- Per-client credential loading
- Processor routing pattern
- DB record insertion
- Anti-patterns

---

## Currency Safety: Always Cents

All money in this codebase is stored and passed as integer cents. The `payments` table column is
`amount_cents`. Stripe's API also expects cents for USD. This is intentional and non-negotiable.

```javascript
// GOOD — cents as integer
const intent = await stripe.paymentIntents.create({
  amount: 15000,  // $150.00
  currency: 'usd',
});

// BAD — will charge $0.15 instead of $150
const intent = await stripe.paymentIntents.create({
  amount: 150.00,  // floating point, silently truncates to 150 cents
  currency: 'usd',
});
```

Never convert to dollars before passing to Stripe. The DB stores cents, Stripe expects cents —
no conversion needed.

---

## Per-Client Credential Loading

Each client may have their own Stripe account. Credentials are AES-256 encrypted in
`client_integrations`. The platform key is the fallback for clients without their own integration.

```javascript
// GOOD — try client key first, fall back to platform key
const result = await pool.query(
  `SELECT credentials_encrypted FROM client_integrations
   WHERE client_id = $1 AND platform = 'stripe' AND is_active = true
   LIMIT 1`,
  [clientId]
);

let stripeKey;
if (result.rows.length > 0) {
  const creds = decrypt(result.rows[0].credentials_encrypted);
  stripeKey = creds.secret_key;
} else {
  stripeKey = process.env.STRIPE_SECRET_KEY;
}

if (!stripeKey) throw new Error('No Stripe credentials configured');
const stripe = new Stripe(stripeKey);
```

```javascript
// BAD — hardcoded to platform key, breaks white-label clients
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
```

**Why this matters:** Some clients collect payments into their own Stripe account (direct charges).
Platform key only works for clients using the platform's Stripe account.

---

## Processor Routing Pattern

NEVER call `stripeIntegration.createPaymentIntent()` directly from routes. Always go through
`paymentService.createPayment()` — it handles the Stripe/Square routing decision.

```javascript
// GOOD — route handler uses service layer
const result = await createPayment(clientId, {
  amount_cents: 15000,
  description: 'HVAC tune-up deposit',
  caller_phone: req.body.caller_phone,
  booking_id: req.body.booking_id,
});
```

```javascript
// BAD — bypasses processor routing
const result = await stripeIntegration.createPaymentIntent(clientId, params);
```

`getPaymentProcessor()` in `paymentService.js` checks `client_integrations` for an active
`integration_type = 'payment'` row. If none exists, it defaults to `'stripe'`.

---

## Always Insert a DB Record After Intent Creation

After creating a Stripe payment intent, immediately write to the `payments` table with
`status = 'pending'`. This is the source of truth for reconciliation — n8n updates status
async via webhook.

```javascript
// GOOD — record before returning
await pool.query(
  `INSERT INTO payments
     (client_id, booking_id, processor, external_payment_id, amount_cents, currency, status, payment_link)
   VALUES ($1, $2, 'stripe', $3, $4, $5, 'pending', $6)`,
  [clientId, params.booking_id || null, intent.id,
   params.amount_cents, params.currency || 'usd', intent.url || null]
);

return { payment_id: intent.id, client_secret: intent.client_secret, payment_link: intent.url };
```

```javascript
// BAD — no DB record, payment is invisible to the platform
return { payment_id: intent.id, client_secret: intent.client_secret };
```

If the process crashes after Stripe confirms the intent but before n8n fires, the DB record
ensures the platform can still reconcile.

---

## WARNING: Webhook Handling Does NOT Belong in Express

### The Problem

```javascript
// BAD — Stripe webhook handler in Express route
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res, next) => {
  const event = stripe.webhooks.constructEvent(req.body, sig, secret);
  await updatePaymentStatus(event.data.object.id, 'succeeded');
  res.json({ received: true });
});
```

**Why This Breaks:**
1. This is async reconciliation — it does not need to be in the real-time call path
2. Stripe retries webhooks; a crashed Express instance causes duplicate processing
3. Webhook signature verification requires `express.raw()` which conflicts with `express.json()` on the same router
4. Adds latency-sensitive infrastructure for a non-latency-sensitive operation

**The Fix:**

Route all Stripe webhook events through n8n. Configure the Stripe webhook destination to point
to your n8n instance URL. n8n handles retries, deduplication, and async DB updates.

```javascript
// GOOD — Express only creates intents; n8n handles webhooks
// In src/integrations/stripe.js: only createPaymentIntent()
// Webhook processing: n8n workflow triggered by Stripe → updates payments table
```

---

## Metadata: Always Include client_id

```javascript
// GOOD — metadata enables cross-referencing in n8n and Stripe dashboard
const intent = await stripe.paymentIntents.create({
  amount: params.amount_cents,
  currency: 'usd',
  metadata: {
    client_id: clientId,
    booking_id: params.booking_id || '',
    ...params.metadata,
  },
});
```

Without `client_id` in metadata, webhook events arriving in n8n have no way to identify
which tenant the payment belongs to. This breaks multi-tenant reconciliation.
