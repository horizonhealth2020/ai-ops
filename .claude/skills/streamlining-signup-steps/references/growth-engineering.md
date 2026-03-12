# Growth Engineering Reference

## Contents
- Trial tier pattern (no trial tier exists yet)
- Referral signal from `caller_memory`
- Wallet auto-reload as a retention mechanic
- Activation email/SMS triggers via n8n
- Multi-tenant viral loop via call logs

---

## Trial Tier Pattern

No trial tier exists in the codebase. The wallet tiers are: `standard`, `growth`, `scale`, `enterprise`
(see `src/routes/onboard.js:27`). Adding a `trial` tier is the highest-leverage signup
friction reduction possible — let operators experience the agent before paying.

```javascript
// migrations/00X_add_trial_tier.sql
ALTER TYPE wallet_tier ADD VALUE 'trial';

-- Trial wallet: $5 credit, 7-day expiry
INSERT INTO wallets (client_id, balance_cents, tier)
VALUES ($1, 500, 'trial');  -- $5 = ~12 mins at standard rate
```

```javascript
// src/services/walletService.js — add trial expiry check
async function checkTrialExpiry(clientId) {
  const { rows } = await pool.query(
    `SELECT tier, created_at FROM wallets WHERE client_id = $1`,
    [clientId]
  );
  const wallet = rows[0];
  if (wallet.tier === 'trial') {
    const daysOld = (Date.now() - new Date(wallet.created_at)) / 86400000;
    if (daysOld > 7) {
      await pool.query(
        `UPDATE wallets SET balance_cents = 0 WHERE client_id = $1 AND tier = 'trial'`,
        [clientId]
      );
      logger.info('trial_expired', { client_id: clientId });
    }
  }
}
```

---

## Referral Signal from Caller Memory

`src/services/callerMemory.js` records every caller's phone number. This is a built-in referral
signal — when a caller phones a client for the first time, you know the client is driving call volume.
High call volume = happy client = referral candidate.

```javascript
// Query for clients with high unique caller counts in last 30 days
// These are your most engaged clients — target for referral asks

const { rows } = await pool.query(`
  SELECT
    c.id, c.business_name,
    COUNT(DISTINCT cl.caller_phone) AS unique_callers_30d
  FROM clients c
  JOIN call_logs cl ON cl.client_id = c.id
  WHERE cl.created_at > NOW() - INTERVAL '30 days'
  GROUP BY c.id, c.business_name
  HAVING COUNT(DISTINCT cl.caller_phone) > 20
  ORDER BY unique_callers_30d DESC
`);
// Fire n8n webhook to send referral ask to these operators
```

---

## Wallet Auto-Reload as a Retention Mechanic

Auto-reload prevents the worst churn moment: agent goes silent mid-day because balance hit $0.
Add a `low_balance_threshold_cents` field to the `wallets` table to trigger reloads.

```javascript
// src/services/walletService.js — check threshold after each deduction
async function deductCallCost(clientId, durationSec, tier) {
  const rateCentsPerMin = TIER_RATES[tier];
  const cost = Math.ceil((durationSec / 60) * rateCentsPerMin);

  const { rows } = await pool.query(
    `UPDATE wallets
     SET balance_cents = balance_cents - $2
     WHERE client_id = $1
     RETURNING balance_cents, auto_reload_amount_cents, low_balance_threshold_cents`,
    [clientId, cost]
  );

  const wallet = rows[0];
  if (
    wallet.auto_reload_amount_cents > 0 &&
    wallet.balance_cents <= wallet.low_balance_threshold_cents
  ) {
    // Fire n8n webhook for async Stripe charge
    await triggerAutoReload(clientId, wallet.auto_reload_amount_cents);
    logger.info('auto_reload_triggered', { client_id: clientId, amount_cents: wallet.auto_reload_amount_cents });
  }
}
```

---

## Activation Email/SMS Triggers via n8n

Wire n8n to fire activation nudges at key funnel gaps. These are event-driven, not time-based.

```javascript
// Pattern: fire n8n webhook from Express route, n8n handles delay + send

// Trigger 1: Onboard complete, wallet = $0 after 2 hours
// src/routes/onboard.js — fire to n8n after successful insert
await fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/onboard-complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_id: clientId, business_phone, vertical }),
});

// Trigger 2: First call completed (proof of value moment)
// src/routes/call.js — fire to n8n on call complete
await fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/first-call-complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_id: clientId, duration_sec, outcome }),
});
```

In n8n: wait 2 hours → check if wallet still = $0 → send SMS via Twilio nudge.

---

## Multi-Tenant Viral Loop via Call Logs

Every booking the AI agent creates is a service delivered to a real customer. Those customers
can become word-of-mouth referral sources if the booking experience is exceptional.

```javascript
// After a successful booking (src/routes/booking.js + call complete):
// Fire n8n to send a confirmation SMS to the CALLER (end customer), not the operator

// n8n receives booking_confirmed event:
{
  caller_phone: '+15555550000',
  business_name: 'Apex Plumbing',
  appointment_date: '2026-03-15',
  appointment_time: '10:00',
}

// SMS copy: "Your appointment with Apex Plumbing is confirmed for March 15 at 10am.
// Powered by AI Ops — want an AI agent for your business? [link]"
```

This turns every booking into a B2B lead generation event.

---

## Related Skills

- See the **structuring-offer-ladders** skill for trial tier design and wallet tier strategy
- See the **twilio** skill for SMS nudge implementation
- See the **mapping-conversion-events** skill for tracking growth loop events
- See the **stripe** skill for auto-reload Stripe charge patterns
