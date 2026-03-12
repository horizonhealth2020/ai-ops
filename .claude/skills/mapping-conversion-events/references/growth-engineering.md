# Growth Engineering Reference

## Contents
- Growth Loops in This Platform
- Viral / Referral Signals
- Retention Engineering
- Anti-patterns
- Checklist: Wiring a New Growth Signal

---

## Growth Loops in This Platform

This platform has two growth loops, both backend-driven:

**Loop 1 — Call volume flywheel:**
More booked calls → higher wallet spend → operator upgrades tier → lower per-minute rate → more margin for operator → more incentive to drive call volume.

**Loop 2 — FSM integration depth:**
More FSM integrations enabled → higher booking confirmation rate → fewer abandoned calls → higher operator satisfaction → lower churn.

Neither loop requires frontend work — both are measurable from `call_logs`, `bookings`, and `wallet_transactions`.

---

## Viral / Referral Signals

There is no built-in referral system. The growth signal closest to viral is **vertical expansion** — when an operator adds a second phone number or vertical to their account. Detect this:

```sql
-- Operators who have more than one active phone number (expansion signal)
SELECT
  client_id,
  COUNT(*) AS phone_count
FROM client_phone_numbers
WHERE is_active = true
GROUP BY client_id
HAVING COUNT(*) > 1;
```

When this fires, it signals product-market fit for that operator. Use it to trigger an n8n workflow that sends a case study or tier upgrade prompt.

---

## Retention Engineering

### Leading indicator: weekly call frequency

An operator who answers ≥5 calls/week is retained. Below 2/week for two consecutive weeks is a churn signal.

```sql
SELECT
  c.client_id,
  c.company_name,
  c.billing_tier,
  COUNT(*) FILTER (
    WHERE cl.completed_at > NOW() - INTERVAL '7 days'
  ) AS calls_last_7d,
  COUNT(*) FILTER (
    WHERE cl.completed_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
  ) AS calls_prior_7d
FROM clients c
LEFT JOIN call_logs cl ON cl.client_id = c.client_id
WHERE c.is_active = true
GROUP BY c.client_id, c.company_name, c.billing_tier
HAVING
  COUNT(*) FILTER (WHERE cl.completed_at > NOW() - INTERVAL '7 days') < 2
  AND COUNT(*) FILTER (
    WHERE cl.completed_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
  ) < 2
ORDER BY calls_last_7d ASC;
```

Wire this query to an n8n cron workflow that fires a proactive outreach or in-dashboard warning.

### Proactive low-balance alert

When `wallet_balance_cents < TIER_THRESHOLD`, fire a reload reminder before the agent goes into message-only mode. This prevents a retention event (silent call failure) from occurring.

```javascript
// src/services/walletService.js — emit warning before deduction
const LOW_BALANCE_THRESHOLDS_CENTS = {
  standard: 2000,  // $20 — ~50 minutes at standard tier
  growth:   3000,
  scale:    4000,
  enterprise: 5000,
};

async function deductForCall(clientId, durationSeconds) {
  const client = await getClientWithBalance(clientId);
  const cost = calculateCost(durationSeconds, client.billing_tier);

  if (client.wallet_balance_cents - cost < LOW_BALANCE_THRESHOLDS_CENTS[client.billing_tier]) {
    logger.warn('wallet_low_balance', {
      client_id: clientId,
      balance_cents: client.wallet_balance_cents,
      billing_tier: client.billing_tier,
    });
    // Fire n8n webhook for reload reminder — async, no await
    notifyLowBalance(clientId, client.wallet_balance_cents).catch(() => {});
  }

  // ... proceed with deduction
}
```

---

## Anti-patterns

### WARNING: Measuring retention with only active-client counts

**The Problem:**
```sql
-- BAD — counts active clients but misses declining ones
SELECT COUNT(*) FROM clients WHERE is_active = true;
```

**Why This Breaks:**
1. Clients can be `is_active = true` with zero calls in 30 days — they're churned but not marked
2. Retention metric is inflated, masks actual product-market fit signal

**The Fix:**
```sql
-- GOOD — active = made a call in last 30 days
SELECT COUNT(DISTINCT client_id)
FROM call_logs
WHERE completed_at > NOW() - INTERVAL '30 days';
```

### WARNING: Tier upgrade prompt on every dashboard load

Showing a tier upgrade nudge on every `GET /api/v1/dashboard/wallet` response creates noise. Trigger it only on meaningful events:

- First time balance drops below the low-balance threshold
- After the 10th call (operator has seen ROI)
- When `calls_last_7d > 10` (operator is growing)

See the **strengthening-upgrade-moments** skill for upgrade prompt placement patterns.

---

## Checklist: Wiring a New Growth Signal

- [ ] Identify the PostgreSQL table and field that captures the signal
- [ ] Write a windowed SQL query (always filter by date range)
- [ ] Add `logger.info` or `logger.warn` in the relevant service file
- [ ] Wire n8n webhook for async follow-up (reload reminder, upgrade prompt, case study)
- [ ] Confirm `client_id` is in every payload
- [ ] Add the query to the dashboard analytics endpoint if operator-visible

See the **instrumenting-product-metrics** skill for turning growth signals into tracked product metrics.
See the **scoping-feature-work** skill when growth signals require new features or API endpoints.
