# Strategy & Monetization Reference

## Contents
- Billing tier copy
- Wallet upgrade prompts
- Upgrade moment copy
- Tier names and value framing
- Anti-patterns

---

## Billing Tier Copy

Tiers are stored in PostgreSQL as `clients.billing_tier`. The value prop for each tier
must be communicated in wallet and dashboard copy — not just in pricing pages.

| Tier | Rate | Value Prop for Copy |
|------|------|---------------------|
| standard | $0.40/min | "Pay as you go — no commitment" |
| growth | $0.32/min | "20% off for growing teams" |
| scale | $0.27/min | "32% off — for businesses handling 200+ calls/month" |
| enterprise | $0.23/min | "Best rate + dedicated support" |

```javascript
// src/routes/dashboard.js — expose tier value prop alongside balance
const TIER_VALUE_PROPS = {
  standard: 'Pay-as-you-go rate. Upgrade anytime to save.',
  growth:   '20% savings vs standard. Great for 50–200 calls/month.',
  scale:    '32% savings. Best for high-volume operations.',
  enterprise: 'Best rate available. Contact us to manage your account.',
};

res.json({
  balance_display: `$${(balanceCents / 100).toFixed(2)}`,
  tier: client.billing_tier,
  tier_description: TIER_VALUE_PROPS[client.billing_tier],
  rate_per_min: RATES[client.billing_tier],
});
```

---

## Wallet Upgrade Prompts

The best upgrade trigger is when an operator is actively topping up their wallet.
Surface the tier upgrade copy at `GET /api/v1/dashboard/wallet` when usage patterns
suggest they'd benefit from a higher tier.

```javascript
// Suggest upgrade if they're topping up more than twice a month
async function buildUpgradePrompt(clientId, tier) {
  if (tier === 'enterprise') return null;

  const topups = await pool.query(
    `SELECT COUNT(*) FROM wallet_transactions
     WHERE client_id = $1 AND type = 'credit'
       AND created_at > NOW() - INTERVAL '30 days'`,
    [clientId]
  );

  const upgradeMap = {
    standard: { next: 'growth',     savings: '20%', threshold: 2 },
    growth:   { next: 'scale',      savings: '32%', threshold: 3 },
    scale:    { next: 'enterprise', savings: '42%', threshold: 4 },
  };

  const config = upgradeMap[tier];
  if (topups.rows[0].count >= config.threshold) {
    return {
      message: `You've topped up ${topups.rows[0].count} times this month. ` +
               `Upgrading to ${config.next} saves you ${config.savings} per call.`,
      cta: `Upgrade to ${config.next}`,
      next_tier: config.next,
    };
  }
  return null;
}
```

---

## Upgrade Moment Copy — Wallet Empty State

The wallet-empty state is the highest-intent upgrade moment. Don't waste it with a
generic "add funds" message.

```javascript
// GOOD — tier-aware, specific savings
function buildEmptyWalletMessage(tier) {
  const savings = { standard: 20, growth: 32, scale: 42 };
  const nextTier = { standard: 'growth', growth: 'scale', scale: 'enterprise' };

  if (tier === 'enterprise') {
    return {
      message: "Your agent has paused. Add funds to resume.",
      cta: "Add funds",
    };
  }

  return {
    message: `Your agent has paused. Add funds to resume — or upgrade to ` +
             `${nextTier[tier]} and save ${savings[tier]}% on every call going forward.`,
    cta_primary: `Upgrade to ${nextTier[tier]}`,
    cta_secondary: "Add funds (current rate)",
  };
}

// BAD — no upgrade hook, lost opportunity
res.json({ message: "Insufficient balance. Please add funds." });
```

---

## Tier Names and Voice Agent Copy

Tier names should NEVER appear in agent voice scripts. Callers don't need to know the
operator's billing tier.

```javascript
// GOOD — tier drives behavior, not copy
const callRatePerMin = RATES[client.billing_tier];
const minutesRemaining = Math.floor(walletBalance / callRatePerMin);
// Use minutesRemaining internally to decide soft-lock threshold

// BAD — exposes internal billing state to caller
const badScript = "You are on the standard tier. Advanced features require upgrade.";
```

Tier naming matters for operator-facing dashboards only. For agent scripts, the tier
affects the soft-lock threshold silently.

---

## WARNING: Anchoring to Dollar Amounts Instead of Value

**The Problem:**
```javascript
// BAD — "$27 per minute" means nothing to an HVAC dispatcher
res.json({ rate: "$0.27/min" });
```

**Why This Breaks:**
1. Blue-collar operators think in calls and jobs, not per-minute rates
2. "$0.27/min" on a 5-minute call = $1.35 — frame it that way
3. Without context, any per-minute rate sounds expensive

**The Fix:**
```javascript
// GOOD — anchor to cost-per-call, ROI framing
const avgCallMinutes = 4.5;
const costPerCall = (RATES[tier] * avgCallMinutes / 100).toFixed(2);
res.json({
  rate_per_min: RATES[tier],
  cost_per_avg_call: `~$${costPerCall}/call`,
  value_context: `Less than a missed job.`,
});
```

See the **structuring-offer-ladders** skill for full tier ladder design.

---

## Monetization Copy Checklist

- [ ] Does wallet balance show rate-per-call, not just rate-per-minute?
- [ ] Does the upgrade prompt fire on topup frequency, not just balance level?
- [ ] Is the empty-wallet state showing a tier upgrade CTA for non-enterprise clients?
- [ ] Are tier names absent from all voice agent scripts?
- [ ] Is the "enterprise" tier framed with human-touch benefits, not just price?
- [ ] Does `GET /api/v1/dashboard/wallet` include `tier_description` alongside balance?
