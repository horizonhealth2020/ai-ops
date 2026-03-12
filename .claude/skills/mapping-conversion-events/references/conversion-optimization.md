# Conversion Optimization Reference

## Contents
- Funnel Stages
- Key Drop-off Points
- Anti-patterns
- Optimization Patterns

---

## Funnel Stages

This platform has four measurable conversion stages, all tracked in PostgreSQL:

| Stage | Table / Field | Success Signal |
|-------|--------------|----------------|
| Onboard | `clients.created_at` | Row inserted via `POST /api/v1/onboard` |
| Wallet funded | `wallet_transactions` type=`reload` | First deposit > 0 |
| First booking | `bookings` status=`confirmed` | `is_first_booking = true` |
| Recurring call | `call_logs` weekly count ≥ 3 | Retained client |

The biggest drop-off is between **onboard** and **wallet funded** — clients who never reload never activate.

---

## Key Drop-off Points

### 1. Zero-balance soft-lock

When `wallet_balance_cents = 0` at call start, the agent switches to `message_only` mode. This silently kills conversions without any operator notification.

```javascript
// src/services/walletService.js — detect and log the drop-off
async function checkBalance(clientId) {
  const { rows } = await pool.query(
    'SELECT wallet_balance_cents, billing_tier FROM clients WHERE client_id = $1',
    [clientId]
  );
  const client = rows[0];
  if (client.wallet_balance_cents <= 0) {
    logger.warn('wallet_empty_call_blocked', { client_id: clientId });
  }
  return client;
}
```

### 2. FSM verification rejection

If the FSM rejects a slot at confirm time, the booking fails after the hold was already set. This wastes the caller's time and inflates hold abandonment.

```javascript
// src/services/bookingService.js — log FSM rejection explicitly
if (!fsmConfirmed) {
  logger.warn('booking_fsm_rejected', {
    client_id: clientId,
    fsm_type: client.fsm_type,
    slot_date: date,
    slot_time: time,
  });
  // Return alternatives — never silently fail
  return { success: false, alternatives };
}
```

### 3. Hold expiry before confirm

Redis holds expire at 300s. If the AI takes too long (slow FSM, long conversation), the slot releases before `booking/create` fires. Track this:

```sql
-- Holds that expired before booking was confirmed
SELECT
  h.call_id,
  h.client_id,
  h.held_at,
  h.expired_at,
  b.booking_id
FROM slot_hold_logs h
LEFT JOIN bookings b ON b.call_id = h.call_id
WHERE b.booking_id IS NULL
  AND h.expired_at IS NOT NULL
ORDER BY h.expired_at DESC;
```

---

## Anti-patterns

### WARNING: Silent outcome on empty wallet

**The Problem:**
```javascript
// BAD — returns 200 with no logging
if (balance <= 0) {
  return res.json({ mode: 'message_only' });
}
```

**Why This Breaks:**
1. No operator alert → client doesn't know calls are failing
2. No funnel signal → can't measure wallet churn rate
3. n8n async workflow never fires → no reload reminder SMS

**The Fix:**
```javascript
// GOOD — log before switching mode
if (balance <= 0) {
  logger.warn('wallet_empty_call_blocked', { client_id: clientId, call_id });
  // Optionally: fire n8n webhook for reload reminder
  return res.json({ mode: 'message_only' });
}
```

### WARNING: Missing `outcome` field on call_logs insert

**The Problem:**
```javascript
// BAD — no outcome field
await pool.query(
  'INSERT INTO call_logs (call_id, client_id, duration_seconds) VALUES ($1, $2, $3)',
  [callId, clientId, duration]
);
```

**Why This Breaks:**
1. Can't segment `booked` vs `transferred` vs `message_only` calls
2. Conversion rate query always returns NULL
3. Dashboard call log shows no actionable outcome data

**The Fix:**
```javascript
// GOOD — always include outcome
await pool.query(
  `INSERT INTO call_logs
     (call_id, client_id, duration_seconds, outcome, charged_cents, completed_at)
   VALUES ($1, $2, $3, $4, $5, NOW())`,
  [callId, clientId, duration, outcome, chargedCents]
);
```

---

## Optimization Patterns

### Detect stalled activations (no wallet reload after 48h)

```sql
SELECT
  c.client_id,
  c.company_name,
  c.created_at,
  MAX(wt.created_at) AS last_reload
FROM clients c
LEFT JOIN wallet_transactions wt
  ON wt.client_id = c.client_id AND wt.type = 'reload'
WHERE c.is_active = true
GROUP BY c.client_id, c.company_name, c.created_at
HAVING MAX(wt.created_at) IS NULL
   OR MAX(wt.created_at) < NOW() - INTERVAL '48 hours'
ORDER BY c.created_at DESC;
```

Use this query as input for an n8n workflow that fires a Twilio SMS reload reminder.

See the **stripe** skill and **twilio** skill for implementing the reload + SMS notification flow.
See the **instrumenting-product-metrics** skill for turning these queries into dashboard metrics.
