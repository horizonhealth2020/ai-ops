# Strategy & Monetization Reference

## Contents
- Billing Model
- Tier Upgrade Signals
- Revenue Measurement
- Anti-patterns
- Monetization Checklist

---

## Billing Model

Prepaid wallet with tiered per-minute pricing. All amounts in cents (integers — never floats).

| Tier | Rate (cents/min) | Monthly threshold signal |
|------|-----------------|-------------------------|
| standard | 40 | < 50 calls/month |
| growth | 32 | 50–150 calls/month |
| scale | 27 | 150–400 calls/month |
| enterprise | 23 | > 400 calls/month |

Revenue = `SUM(charged_cents)` from `wallet_transactions` where `type = 'deduction'`.

MRR approximation (no subscription):
```sql
SELECT
  date_trunc('month', created_at) AS month,
  SUM(amount_cents) / 100.0 AS revenue_dollars
FROM wallet_transactions
WHERE type = 'deduction'
GROUP BY 1
ORDER BY 1 DESC;
```

---

## Tier Upgrade Signals

### Detect tier under-utilization (eligible for upgrade)

An operator on `standard` tier making 100+ calls/month is paying 40¢/min when they could pay 32¢/min at `growth`. Detecting and surfacing this drives upsell.

```sql
SELECT
  c.client_id,
  c.company_name,
  c.billing_tier,
  COUNT(cl.call_id) AS calls_last_30d,
  SUM(cl.charged_cents) AS spend_last_30d_cents,
  -- What they'd save at next tier
  SUM(cl.charged_cents) - SUM(
    cl.duration_seconds / 60.0 *
    CASE c.billing_tier
      WHEN 'standard' THEN 32  -- growth rate
      WHEN 'growth'   THEN 27  -- scale rate
      WHEN 'scale'    THEN 23  -- enterprise rate
    END
  ) AS potential_savings_cents
FROM clients c
JOIN call_logs cl ON cl.client_id = c.client_id
WHERE cl.completed_at > NOW() - INTERVAL '30 days'
  AND c.billing_tier != 'enterprise'
GROUP BY c.client_id, c.company_name, c.billing_tier
HAVING COUNT(cl.call_id) >= 50
ORDER BY potential_savings_cents DESC;
```

Surface this in `GET /api/v1/dashboard/wallet` as an `upgrade_prompt` field when savings > $20/month.

### Emit upgrade signal on dashboard wallet fetch

```javascript
// src/routes/dashboard.js
const UPGRADE_SAVINGS_THRESHOLD_CENTS = 2000; // $20/month

router.get('/wallet', clerkAuth, async (req, res, next) => {
  try {
    const walletData = await walletService.getWalletSummary(req.clientId);

    if (walletData.potential_savings_cents > UPGRADE_SAVINGS_THRESHOLD_CENTS) {
      walletData.upgrade_prompt = {
        current_tier: walletData.billing_tier,
        next_tier: getNextTier(walletData.billing_tier),
        monthly_savings_dollars: (walletData.potential_savings_cents / 100).toFixed(2),
        message: `Switch to ${getNextTier(walletData.billing_tier)} and save $${(walletData.potential_savings_cents / 100).toFixed(2)}/month.`,
      };
    }

    res.json(walletData);
  } catch (err) {
    next(err);
  }
});
```

---

## Revenue Measurement

### Daily revenue by tier

```sql
SELECT
  date_trunc('day', wt.created_at)::date AS day,
  c.billing_tier,
  SUM(wt.amount_cents) / 100.0 AS revenue_dollars,
  COUNT(DISTINCT wt.client_id) AS paying_clients
FROM wallet_transactions wt
JOIN clients c ON c.client_id = wt.client_id
WHERE wt.type = 'deduction'
  AND wt.created_at > NOW() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC, revenue_dollars DESC;
```

### LTV approximation per client

```sql
SELECT
  client_id,
  SUM(amount_cents) / 100.0 AS ltv_dollars,
  MIN(created_at) AS first_charge,
  MAX(created_at) AS last_charge,
  COUNT(*) AS total_calls_charged
FROM wallet_transactions
WHERE type = 'deduction'
GROUP BY client_id
ORDER BY ltv_dollars DESC;
```

---

## Anti-patterns

### WARNING: Floating point for currency calculations

**The Problem:**
```javascript
// BAD — floating point precision errors
const cost = (durationSeconds / 60) * 0.40;
const newBalance = client.wallet_balance - cost;
```

**Why This Breaks:**
1. `0.1 + 0.2 = 0.30000000000000004` in IEEE 754
2. Cumulative errors over thousands of calls lead to billing discrepancies
3. Reconciliation against Stripe/Square totals fails

**The Fix:**
```javascript
// GOOD — integer cents throughout
const RATE_CENTS_PER_MINUTE = { standard: 40, growth: 32, scale: 27, enterprise: 23 };
const costCents = Math.ceil((durationSeconds / 60) * RATE_CENTS_PER_MINUTE[tier]);
const newBalanceCents = client.wallet_balance_cents - costCents;
```

### WARNING: Tier logic hardcoded in multiple files

**The Problem:**
```javascript
// BAD — tier rates in bookingService.js AND walletService.js
const rate = tier === 'standard' ? 0.40 : tier === 'growth' ? 0.32 : 0.27;
```

**Why This Breaks:**
1. Adding a new tier requires hunting down every file that encodes rates
2. Rate change in one place doesn't propagate

**The Fix:**
```javascript
// GOOD — single source of truth in walletService.js or a constants file
const TIER_RATES_CENTS = { standard: 40, growth: 32, scale: 27, enterprise: 23 };
module.exports = { TIER_RATES_CENTS };
```

---

## Monetization Checklist

Copy this checklist when modifying billing or tier logic:

- [ ] All amounts in cents (integers) — no floats
- [ ] `TIER_RATES_CENTS` defined in one file, imported everywhere
- [ ] `wallet_balance_cents` checked BEFORE deduction, not after
- [ ] Upgrade prompt logic uses `potential_savings_cents` threshold, not call count alone
- [ ] New tier rates added to `TIER_RATES_CENTS` constant AND migration script
- [ ] Wallet deduction logged to `wallet_transactions` with `type = 'deduction'`

See the **structuring-offer-ladders** skill for tier design and upgrade prompt strategy.
See the **stripe** skill and **square** skill for reload (deposit) event handling.
