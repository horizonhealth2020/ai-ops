# Strategy & Monetization Reference

## Contents
- Wallet tier structure and upgrade leverage
- The message-only mode as a paywall
- Tier upgrade triggers in code
- Pricing strategy considerations
- Anti-patterns

---

## Wallet Tier Structure and Upgrade Leverage

Four tiers with a 42% price spread between standard and enterprise:

```javascript
// src/services/walletService.js:7
const TIER_RATES = {
  standard:   40,  // $0.40/min
  growth:     32,  // $0.32/min — 20% savings
  scale:      27,  // $0.27/min — 33% savings
  enterprise: 23,  // $0.23/min — 42% savings
};
```

The tier is set at onboard (`wallet_tier` field) and stored in `wallets.tier`. There is currently no mechanism to upgrade tier after onboard. An operator who starts on `standard` and grows to 100+ calls/month has no path to `growth` pricing without a manual DB update.

**Fix:** Add a tier upgrade endpoint:

```javascript
// PUT /api/v1/dashboard/wallet/tier
router.put('/wallet/tier', async (req, res, next) => {
  try {
    const { tier } = req.body;
    const VALID_TIERS = ['standard', 'growth', 'scale', 'enterprise'];
    if (!VALID_TIERS.includes(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
    }
    await pool.query(
      'UPDATE wallets SET tier = $1, updated_at = NOW() WHERE client_id = $2',
      [tier, req.clientId]
    );
    res.json({ tier, monthly_savings_estimate: estimateSavings(req.clientId, tier) });
  } catch (err) {
    next(err);
  }
});
```

---

## The Message-Only Mode as a Paywall

When `checkBalance()` returns `false`, the Vapi route should switch the agent to message-only mode. This is a natural paywall — the agent stops booking and starts saying "I can only take a message right now."

This paywall is effective only if:
1. The operator is notified before it triggers (currently: they're not)
2. The top-up flow is frictionless (currently: no self-serve top-up endpoint exists)
3. The agent's message-only response explains what happened (currently: not enforced)

**Top-up should be self-serve.** Right now, operators need a payment integration to reload. Add a Stripe checkout session endpoint:

```javascript
// POST /api/v1/dashboard/wallet/topup
// Body: { amount_cents: 5000 }  (minimum $5)
// Returns: { checkout_url }  — Stripe Checkout session
// On success: Stripe webhook credits wallet via wallet_transactions
```

See the **stripe** skill for Checkout session implementation.

---

## Tier Upgrade Triggers in Code

The right moment to suggest a tier upgrade is when a client's usage patterns justify it. Two natural triggers:

**Trigger 1: High monthly usage (derivable from call_logs)**
```javascript
// In GET /api/v1/dashboard/wallet — append upgrade recommendation
const usageResult = await pool.query(
  `SELECT SUM(duration_seconds) / 60.0 AS total_minutes
   FROM call_logs
   WHERE client_id = $1 AND created_at >= date_trunc('month', NOW())`,
  [clientId]
);
const monthlyMinutes = parseFloat(usageResult.rows[0]?.total_minutes || 0);
const currentTier = wallet.tier;

// Suggest upgrade if monthly bill at current tier would be >$50 cheaper at next tier
const UPGRADE_MAP = { standard: 'growth', growth: 'scale', scale: 'enterprise' };
const nextTier = UPGRADE_MAP[currentTier];
if (nextTier) {
  const currentRate = TIER_RATES[currentTier];
  const nextRate = TIER_RATES[nextTier];
  const monthlySavingsCents = Math.round(monthlyMinutes * (currentRate - nextRate));
  if (monthlySavingsCents >= 5000) { // $50+ savings
    walletResponse.upgrade_available = {
      tier: nextTier,
      monthly_savings_cents: monthlySavingsCents,
      cta: `Switch to ${nextTier} and save $${(monthlySavingsCents / 100).toFixed(0)}/month`,
    };
  }
}
```

**Trigger 2: Wallet hits $0 (the paywall moment)**
```javascript
// In src/services/walletService.js — at zero balance
if (balanceAfter === 0) {
  // Include upgrade signal in deduction response
  return {
    success: true,
    cost_cents: costCents,
    balance_after_cents: 0,
    agent_status: 'paused_no_balance',
    upgrade_cta: 'Add $20 to restore service. Switch to growth tier and save 20% on every call.',
  };
}
```

---

### WARNING: No Minimum Balance Warning Before Cutoff

**The Problem:**
The wallet hits $0 and the agent immediately goes silent. There is a `auto_reload_threshold_cents` column in `wallets` but the auto-reload webhook is never fired (`src/services/walletService.js:95` — dead code path).

**Why This Breaks:**
An HVAC company owner is on a call and the agent cuts to message-only mode mid-conversation. The owner doesn't know until they check the dashboard. Every call lost to a $0 balance is churn risk.

**The Fix (two-level warning):**
1. At `balance_cents < 2000` ($20): include `low_balance_warning` in dashboard wallet response
2. At `balance_cents < 500` ($5): fire n8n webhook to send SMS alert to operator

```javascript
// src/services/walletService.js — add to deductCallCost return value
return {
  success: true,
  cost_cents: costCents,
  balance_after_cents: balanceAfter,
  low_balance_warning: balanceAfter < 2000 && balanceAfter > 0
    ? `Low balance: $${(balanceAfter / 100).toFixed(2)} remaining. Top up to avoid service interruption.`
    : null,
};
```

---

## Related Skills

- See the **structuring-offer-ladders** skill for tier value prop and upgrade ladder design
- See the **strengthening-upgrade-moments** skill for upgrade CTA copy and trigger timing
- See the **stripe** skill for wallet top-up Checkout session implementation
- See the **mapping-conversion-events** skill for instrumenting tier upgrade events
