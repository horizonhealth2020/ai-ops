# Strategy & Monetization Reference

## Contents
- Tier Architecture
- Upgrade Decision Points
- Prepaid vs Subscription Tradeoffs
- Migration Path: Standard to Enterprise
- Anti-Patterns

---

## Tier Architecture

Tiers are defined in `src/services/walletService.js` as cents per minute:

```javascript
const TIER_RATES = {
  standard:   40,  // $0.40/min — entry tier
  growth:     32,  // $0.32/min — 20% savings vs standard
  scale:      27,  // $0.27/min — 32.5% savings vs standard
  enterprise: 23,  // $0.23/min — 42.5% savings vs standard
};
```

The natural upgrade path is **call volume × minutes × rate differential**. At 100 calls/month averaging 4 minutes:

| Upgrade | Monthly Savings | Break-even Reload |
|---------|----------------|-------------------|
| Standard → Growth | $9.60 | Any reload if consistent volume |
| Growth → Scale | $6.00 | ~60 calls/month |
| Scale → Enterprise | $4.80 | ~80 calls/month |

This math must be surfaced at the upgrade moment. Operators don't think in ¢/min — they think in monthly dollars saved.

---

## Upgrade Decision Points

There are three distinct decision points in the client lifecycle. Each requires different copy and mechanics.

### Decision Point 1: Onboarding Tier Selection (POST /api/v1/onboard)

The `wallet_tier` field defaults to `standard`. Most clients don't know to set it higher.

**Strategy:** Surface the savings math in the onboard 201 response. If the operator filled out 5+ services or shows high call volume intent, default-suggest `growth`.

```javascript
// src/routes/onboard.js — suggest tier based on intake data
function suggestTier(services, vertical) {
  const HIGH_VOLUME_VERTICALS = ['restaurant', 'spa'];
  const serviceCount = Array.isArray(services) ? services.length : 0;

  if (HIGH_VOLUME_VERTICALS.includes(vertical) || serviceCount >= 5) {
    return { suggested: 'growth', reason: 'High call volume expected for your vertical.' };
  }
  return { suggested: 'standard', reason: 'Start here and upgrade as volume grows.' };
}
```

### Decision Point 2: Low-Balance Warning (walletService.js post-deduction)

**Strategy:** Show savings math tied to the specific tier delta. Don't just say "upgrade" — show exactly what they'd save at their current call pace.

```javascript
// Enrich deductCallCost response at balance < $20
if (balanceAfter < 2000) {
  const nextTier = getNextTier(wallet.tier);
  const callsThisMonth = await getMonthlyCallCount(clientId); // from call_logs
  const avgCallMin = 4; // reasonable default
  const monthlySavings = nextTier
    ? ((TIER_RATES[wallet.tier] - TIER_RATES[nextTier]) * avgCallMin * callsThisMonth) / 100
    : 0;

  return {
    ...result,
    upgrade_nudge: nextTier && monthlySavings > 0 ? {
      next_tier: nextTier,
      monthly_savings_estimate: `$${monthlySavings.toFixed(2)}`,
    } : null,
  };
}
```

### Decision Point 3: Zero Balance (vapi.js agent fallback)

**Strategy:** The operator gets an n8n notification — not just a generic email. The notification must include: the call that was missed, the caller's number, and the direct reload link. Make the consequence tangible.

```javascript
// n8n payload for zero-balance notification
{
  event: 'wallet-empty',
  client_id: client.id,
  business_name: client.business_name,
  missed_caller: callerPhone,         // The actual call that was missed
  missed_at: new Date().toISOString(),
  tier: wallet.tier,
  upgrade_savings: getNextTier(wallet.tier)
    ? `$${((TIER_RATES[wallet.tier] - TIER_RATES[getNextTier(wallet.tier)]) * 4 * 100 / 100).toFixed(2)}/month at current volume`
    : null,
}
```

---

## Prepaid vs Subscription Tradeoffs

The current prepaid model is correct for this ICP. Blue-collar operators resist monthly commitments but will reload when they need service. However, prepaid creates churn risk at $0.

**The hybrid opportunity:** Offer a minimum monthly commitment (e.g., "Auto-reload $30/month") in exchange for a locked-in tier rate. This is equivalent to a subscription but framed as a wallet benefit — higher conversion for blue-collar operators.

```javascript
// Schema addition for future milestone:
// wallets.auto_reload_enabled = true
// wallets.auto_reload_amount_cents = 3000  ($30)
// wallets.auto_reload_threshold_cents = 500 ($5)
// → unlocks a discounted rate that sits between tiers
```

See the **structuring-offer-ladders** skill for full tier ladder design and pricing philosophy.

---

## Anti-Patterns

### WARNING: Upgrading Tier Without Updating TIER_RATES

**The Problem:**

```javascript
// BAD — changing tier in wallets without corresponding rate in TIER_RATES
await pool.query('UPDATE wallets SET tier = $1 WHERE client_id = $2', ['premium', clientId]);
// 'premium' has no entry in TIER_RATES — falls back to 'standard' rate silently
```

**Why This Breaks:**
`walletService.js` line 48: `const rate = TIER_RATES[wallet.tier] || TIER_RATES.standard;` — an unknown tier silently charges the standard rate. The client pays standard rate but believes they're on a custom tier. This is both a billing error and a trust violation.

**The Fix:**

```javascript
// GOOD — validate tier before updating
const VALID_TIERS = Object.keys(TIER_RATES);
if (!VALID_TIERS.includes(newTier)) {
  return res.status(400).json({ error: `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}` });
}
await pool.query('UPDATE wallets SET tier = $1 WHERE client_id = $2', [newTier, clientId]);
```

### WARNING: Blocking the Request Path for Upgrade Notifications

**The Problem:**

```javascript
// BAD — awaiting Twilio SMS in the call completion request path
await sendUpgradeAlert(operatorPhone, ...);  // adds 200-500ms to the response
```

**Why This Breaks:**
Call completion is called by Vapi at the end of every call. Adding synchronous external HTTP calls to this path increases latency for every call, even calls where no SMS is needed. One Twilio timeout can cause a call log to fail.

**The Fix:**

```javascript
// GOOD — fire-and-forget via n8n webhook
fireN8nWebhook('wallet-threshold-crossed', { client_id: clientId, ... });
// n8n handles the Twilio SMS asynchronously
```
