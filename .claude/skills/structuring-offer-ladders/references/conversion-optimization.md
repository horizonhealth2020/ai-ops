# Conversion Optimization Reference

## Contents
- Upgrade Trigger Points
- Wallet Reload Flow
- Message-Only Soft-Lock as Conversion Moment
- Anti-Patterns
- Checklist

## Upgrade Trigger Points

The two highest-leverage conversion moments in this system:

1. **Low balance warning** — when `balance_cents / rate < 300` (5 minutes)
2. **Message-only mode** — when `balance_cents <= 0` and agent is soft-locked

Both fire via n8n webhooks from `POST /api/v1/call/complete`.

```javascript
// src/services/walletService.js — after deduction
const LOW_BALANCE_THRESHOLD_MINUTES = 5;

async function checkAndFireUpgradeEvents(clientId, balanceCents, rateCents) {
  const minutesLeft = Math.floor(balanceCents / rateCents);

  if (balanceCents <= 0) {
    // Agent is now in message-only mode — critical upgrade moment
    await fireWebhook('wallet-depleted', { client_id: clientId });
  } else if (minutesLeft < LOW_BALANCE_THRESHOLD_MINUTES) {
    await fireWebhook('low-balance', {
      client_id: clientId,
      minutes_remaining: minutesLeft,
    });
  }
}
```

## Wallet Reload Flow

The reload flow is the primary conversion action. Both Stripe and Square follow identical patterns.

```javascript
// POST /api/v1/payment/create-intent — paymentService.js
async function createReloadIntent(clientId, amountCents, processor) {
  // amountCents must be integer — NEVER pass a float
  if (!Number.isInteger(amountCents) || amountCents < 1000) {
    throw new Error('Minimum reload is $10.00 (1000 cents)');
  }

  const intent = processor === 'stripe'
    ? await stripe.createIntent(amountCents, clientId)
    : await square.createIntent(amountCents, clientId);

  // SMS payment link via Twilio — see twilio skill
  await twilio.sendPaymentLink(client.phone, intent.url);

  return intent;
}
```

See the **stripe** skill and **square** skill for intent creation details.

## Message-Only Soft-Lock as Conversion Moment

NEVER let the agent go silent. When `balance_cents <= 0`, the Vapi context inject endpoint returns a modified system prompt instructing the agent to take messages only and inform the caller that full booking is temporarily unavailable.

```javascript
// src/routes/vapi.js — context inject
const wallet = await walletService.getBalance(clientId);
const isMessageOnly = wallet.balance_cents <= 0;

const systemPrompt = isMessageOnly
  ? buildMessageOnlyPrompt(client)  // stripped-down prompt
  : client.system_prompt + callerContext;
```

This creates natural urgency: the business owner sees calls not being booked → reloads wallet immediately. Don't suppress this — it's the strongest organic upgrade trigger.

## Anti-Patterns

### WARNING: Floating-Point Balance Math

**The Problem:**
```javascript
// BAD — float arithmetic causes penny errors at scale
const charge = (durationSeconds / 60) * (rate / 100);
wallet.balance -= charge;
```

**Why This Breaks:**
1. `0.1 + 0.2 !== 0.3` in IEEE 754 — balances drift over hundreds of calls
2. Accumulated errors cause incorrect soft-locks (agent goes silent when client has credit)
3. Reconciliation against Stripe/Square is impossible when DB and payment totals diverge

**The Fix:**
```javascript
// GOOD — all math in integer cents
const minutes = Math.ceil(durationSeconds / 60);
const chargeCents = minutes * rateCents; // integer * integer = integer
```

### WARNING: Checking Balance After Deduction

**The Problem:**
```javascript
// BAD — race condition between concurrent calls
const balance = await getBalance(clientId);
if (balance >= charge) {
  await deduct(clientId, charge);
}
```

**Why This Breaks:** Two concurrent calls both read sufficient balance and both deduct — resulting in negative balance.

**The Fix:**
```javascript
// GOOD — atomic conditional update
const result = await pool.query(
  `UPDATE client_wallets
   SET balance_cents = balance_cents - $1
   WHERE client_id = $2 AND balance_cents >= $1
   RETURNING balance_cents`,
  [chargeCents, clientId]
);
if (result.rowCount === 0) {
  throw new InsufficientBalanceError(clientId);
}
```

## Checklist: Adding a New Upgrade Trigger

Copy and track progress:
- [ ] Identify the trigger condition (balance threshold, feature gate, tier check)
- [ ] Add condition check in the relevant service function
- [ ] Fire n8n webhook with `client_id` and trigger metadata
- [ ] Configure n8n to send upgrade email/SMS via Twilio
- [ ] Log the trigger event for analytics (see **instrumenting-product-metrics** skill)
- [ ] Test with a seed client at $0 balance
