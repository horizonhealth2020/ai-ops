# Growth Engineering Reference

## Contents
- Auto-Reload as Retention Mechanism
- Tier Upgrade via Reload Amount
- Proactive Reload Prompts
- Upgrade Helper Module

---

## Auto-Reload as Retention Mechanism

The `auto_reload_enabled` field on `wallets` already exists in `walletService.js`. This is the highest-leverage growth mechanism: operators who enable auto-reload never churn due to empty wallets.

```javascript
// src/services/walletService.js — current auto-reload detection (line 95)
if (wallet.auto_reload_enabled && balanceAfter < (wallet.auto_reload_threshold_cents || 500)) {
  logger.info('Wallet below auto-reload threshold', {
    client_id: clientId,
    balance: balanceAfter,
    threshold: wallet.auto_reload_threshold_cents,
  });
  // Auto-reload would trigger Stripe charge here — deferred to payment phase
}
```

Completing the auto-reload flow requires a Stripe charge in `src/integrations/stripe.js`. Once wired, the upgrade moment becomes automatic retention. See the **stripe** skill for payment intent creation patterns.

---

## Tier Upgrade via Reload Amount

Tie tier upgrades to reload amount to make the upgrade decision frictionless. A client reloading $100+ should be offered an automatic tier bump.

```javascript
// src/routes/payment.js or a new POST /api/v1/wallet/reload
async function handleWalletReload(clientId, amountCents, currentTier) {
  const RELOAD_TIER_THRESHOLDS = {
    // If on standard and reloading >= $100, offer growth
    standard: { amount: 10000, next_tier: 'growth' },
    growth:   { amount: 20000, next_tier: 'scale' },
    scale:    { amount: 50000, next_tier: 'enterprise' },
  };

  const threshold = RELOAD_TIER_THRESHOLDS[currentTier];
  const shouldOfferUpgrade = threshold && amountCents >= threshold.amount;

  return {
    reload_applied: true,
    upgrade_offer: shouldOfferUpgrade ? {
      next_tier: threshold.next_tier,
      savings_per_min: `${TIER_RATES[currentTier] - TIER_RATES[threshold.next_tier]}¢`,
      message: `Since you reloaded $${amountCents / 100}+, you qualify for ${threshold.next_tier} pricing. Activate it?`,
      action: 'PUT /api/v1/dashboard/wallet/tier',
    } : null,
  };
}
```

---

## Proactive Reload Prompts

The call completion event (`POST /api/v1/call/complete`) already has the post-call wallet deduction. Add a proactive reload prompt to the response when the client is burning through balance quickly.

```javascript
// src/routes/call.js — enrich /complete response
const BURN_RATE_THRESHOLD_CALLS = 5; // Show prompt after 5 calls if balance < 30-day estimate

res.json({
  status: 'logged',
  call_id,
  wallet: walletResult ? {
    cost_cents: walletResult.cost_cents,
    balance_after_cents: walletResult.balance_after_cents,
    reload_prompt: buildReloadPrompt(walletResult, client),
  } : null,
});

function buildReloadPrompt(walletResult, client) {
  if (!walletResult || walletResult.balance_after_cents > 5000) return null;

  const daysOfCallsRemaining = estimateDaysRemaining(
    walletResult.balance_after_cents,
    walletResult.cost_cents
  );

  if (daysOfCallsRemaining > 7) return null;

  return {
    days_remaining: daysOfCallsRemaining,
    message: `At your call pace, your balance covers ~${daysOfCallsRemaining} more days. Reload to avoid service interruption.`,
    suggested_reload_cents: walletResult.cost_cents * 30, // 30 days of current burn rate
  };
}

function estimateDaysRemaining(balanceCents, lastCallCostCents) {
  if (!lastCallCostCents || lastCallCostCents === 0) return 999;
  // Rough: assume 10 calls/day at current cost
  const dailyCostEstimate = lastCallCostCents * 10;
  return Math.floor(balanceCents / dailyCostEstimate);
}
```

---

## Upgrade Helper Module

Create `src/utils/upgradeHelper.js` to centralize tier logic used across routes and services:

```javascript
// src/utils/upgradeHelper.js
'use strict';

const { TIER_RATES } = require('../services/walletService');

const TIER_ORDER = ['standard', 'growth', 'scale', 'enterprise'];

function getNextTier(currentTier) {
  const idx = TIER_ORDER.indexOf(currentTier);
  return idx >= 0 && idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}

function buildUpgradePrompt(currentTier, nextTier) {
  if (!nextTier) return null;
  const savingsCents = TIER_RATES[currentTier] - TIER_RATES[nextTier];
  return {
    next_tier: nextTier,
    savings_per_min_cents: savingsCents,
    savings_display: `${savingsCents}¢/min`,
    headline: `Switch to ${nextTier} — save ${savingsCents}¢ per minute`,
    monthly_savings_estimate: `$${((savingsCents * 4 * 100) / 100).toFixed(2)}/mo at 100 calls`,
  };
}

function buildTierUpgradePath(currentTier) {
  const path = [];
  let tier = currentTier;
  while (getNextTier(tier)) {
    const next = getNextTier(tier);
    path.push(buildUpgradePrompt(tier, next));
    tier = next;
  }
  return path;
}

module.exports = { getNextTier, buildUpgradePrompt, buildTierUpgradePath, TIER_ORDER };
```

See the **structuring-offer-ladders** skill for tier architecture decisions and pricing rationale.
See the **running-product-experiments** skill for A/B testing reload prompt copy variants.
