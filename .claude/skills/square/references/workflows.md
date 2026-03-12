# Square Workflows Reference

## Contents
- End-to-end payment flow (live call)
- Onboarding a new Square client
- Processor selection routing
- Async reconciliation (post-call)
- Testing Square integration
- Checklist: adding Square to a new client

---

## End-to-End Payment Flow (Live Call)

```
Vapi → POST /api/v1/payment/create-intent
  → vapiAuth middleware
  → paymentService.createPayment()
    → getPaymentProcessor(clientId)   // reads client_integrations
    → squareIntegration.createPaymentIntent()
      → load + decrypt credentials
      → POST /online-checkout/payment-links (Square API)
      → INSERT INTO payments (status='pending')
    → twilio.sendPaymentLink()        // non-fatal if SMS fails
  → return { payment_id, payment_link, processor }
```

The route handler (`src/routes/payment.js`) requires `client_id`, `amount_cents`, and `description`. `caller_phone` and `booking_id` are optional but should always be provided when available.

---

## Onboarding a New Square Client

When a client switches from Stripe to Square (or enables Square for the first time), store credentials via the onboard flow or direct DB insert.

### 1. Encrypt credentials before storage

```javascript
// src/services/encryption.js
const { encrypt } = require('../services/encryption');

const encrypted = encrypt(JSON.stringify({
  access_token: 'EAAAlxxxxxxxxxxxxxxx',
}));
```

### 2. Insert the integration record

```sql
INSERT INTO client_integrations
  (client_id, platform, integration_type, credentials_encrypted, config, is_active)
VALUES
  ('uuid-here', 'square', 'payment',
   'encrypted-blob-here',
   '{"location_id": "LXXXXXXXXXXXXXXXXX"}',
   true);
```

**Important:** If a Stripe integration exists with `is_active = true`, deactivate it first, or `getPaymentProcessor()` will return `'stripe'` (it takes the first active payment integration).

```sql
UPDATE client_integrations
  SET is_active = false
  WHERE client_id = 'uuid-here' AND integration_type = 'payment' AND platform = 'stripe';
```

### 3. Verify routing

```javascript
// Confirm processor returns 'square'
const { getPaymentProcessor } = require('../services/paymentService');
const processor = await getPaymentProcessor('uuid-here');
// Should be: 'square'
```

---

## Processor Selection Routing

`paymentService.getPaymentProcessor()` reads `client_integrations` and returns the first active payment platform. The fallback is `'stripe'` when no integration row exists — Square is **never** the default.

```javascript
// src/services/paymentService.js
async function getPaymentProcessor(clientId) {
  const result = await pool.query(
    `SELECT platform FROM client_integrations
     WHERE client_id = $1 AND integration_type = 'payment' AND is_active = true
     LIMIT 1`,
    [clientId]
  );

  if (result.rows.length > 0) return result.rows[0].platform;
  return 'stripe'; // default
}
```

If a client has both Stripe and Square rows active simultaneously, the result is non-deterministic — PostgreSQL does not guarantee ordering without `ORDER BY`. NEVER leave two active payment integrations for the same client.

---

## Async Reconciliation (Post-Call)

Square fires webhooks when a payment link is completed. The reconciliation flow is handled by n8n, not Express. The Express layer only creates the intent and records `status = 'pending'`.

n8n webhook handler should:

1. Receive Square `payment.completed` or `payment_link.completed` event
2. Look up `payments` row by `external_payment_id`
3. Update `status = 'completed'`
4. Trigger wallet top-up or booking confirmation logic

**NEVER** poll Square from Express for payment status during a live call. The call completes before the customer pays — the link is async by design.

---

## Testing Square Integration

Square provides a Sandbox environment. Use `access_token` values beginning with `EAAAl` (sandbox) for testing.

### Sandbox setup

```javascript
// Override the base URL for test environments
const SQUARE_API = process.env.SQUARE_ENV === 'sandbox'
  ? 'https://connect.squareupsandbox.com/v2'
  : 'https://connect.squareup.com/v2';
```

### Smoke test a payment link

```bash
curl -X POST http://localhost:3000/api/v1/payment/create-intent \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "uuid-of-square-client",
    "amount_cents": 5000,
    "description": "Test deposit",
    "caller_phone": "+19545550000"
  }'
# Expected: { payment_id, payment_link, processor: "square" }
```

### Verify DB record

```sql
SELECT external_payment_id, amount_cents, status, payment_link
FROM payments
WHERE client_id = 'uuid-here'
ORDER BY created_at DESC
LIMIT 1;
-- Should show: status='pending', payment_link='https://checkout.square.site/...'
```

---

## Checklist: Adding Square to a New Client

Copy and track progress:

- [ ] Step 1: Obtain Square `access_token` and `location_id` from client
- [ ] Step 2: Encrypt credentials using `encryption.encrypt()`
- [ ] Step 3: Deactivate any existing active payment integration for this client
- [ ] Step 4: Insert `client_integrations` row with `platform='square'`, `integration_type='payment'`
- [ ] Step 5: Verify `getPaymentProcessor(clientId)` returns `'square'`
- [ ] Step 6: Test with sandbox credentials via `POST /api/v1/payment/create-intent`
- [ ] Step 7: Confirm `payments` row written with `status='pending'`
- [ ] Step 8: Confirm SMS delivered to test number (check Twilio logs)
- [ ] Step 9: Switch to production `access_token` and re-encrypt

---

## Related Skills

- See the **stripe** skill for the parallel Stripe workflow — both processors follow the same dual-path pattern
- See the **express** skill for the route handler in `src/routes/payment.js`
- See the **postgresql** skill for `payments` table schema and migration patterns
- See the **node** skill for the raw `https.request` implementation in `squareRequest()`
