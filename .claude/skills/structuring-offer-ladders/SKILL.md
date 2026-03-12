---
name: structuring-offer-ladders
description: |
  Frames plan tiers, value ladders, and upgrade logic for the AI Ops prepaid wallet billing system.
  Use when: designing commission incentive tiers, configuring billing tier thresholds, adding premium-based rate splits, modeling bundled vs standalone pricing, mapping Clerk roles to dashboard access ladders, or wiring upgrade prompts to wallet balance events.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Structuring Offer Ladders

This project uses a **prepaid wallet + tier model**: clients load balance upfront, spend it per-minute, and unlock lower per-minute rates at higher tiers. Tier is stored on `clients.billing_tier` and drives per-minute deduction in `walletService.js`. All amounts are integers (cents). Never float.

## Quick Start

### Read current tier and rate

```javascript
// src/services/walletService.js pattern
const TIER_RATES = {
  standard:   40, // cents per minute
  growth:     32,
  scale:      27,
  enterprise: 23,
};

async function getClientRate(clientId) {
  const { rows } = await pool.query(
    'SELECT billing_tier FROM clients WHERE client_id = $1',
    [clientId]
  );
  return TIER_RATES[rows[0].billing_tier] ?? TIER_RATES.standard;
}
```

### Deduct wallet on call complete

```javascript
// POST /api/v1/call/complete — walletService.deductCall()
async function deductCall(clientId, durationSeconds) {
  const rate = await getClientRate(clientId);
  const minutes = Math.ceil(durationSeconds / 60); // always round up
  const chargeAmount = rate * minutes; // cents, integer

  await pool.query(
    `UPDATE client_wallets SET balance_cents = balance_cents - $1
     WHERE client_id = $2 AND balance_cents >= $1`,
    [chargeAmount, clientId]
  );
  // If 0 rows updated: balance insufficient — soft-lock agent to message-only
}
```

### Upgrade tier via dashboard

```javascript
// PUT /api/v1/dashboard/billing — upgrade client tier
router.put('/billing', requireClerk, async (req, res, next) => {
  try {
    const { billing_tier } = req.body;
    if (!TIER_RATES[billing_tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    await pool.query(
      'UPDATE clients SET billing_tier = $1 WHERE client_id = $2',
      [billing_tier, req.clientId]
    );
    res.json({ billing_tier });
  } catch (err) {
    next(err);
  }
});
```

## Key Concepts

| Concept | Usage | Example |
|---------|-------|---------|
| Tier rate lookup | `TIER_RATES[client.billing_tier]` | `TIER_RATES.growth` → `32` |
| Balance check | Query `client_wallets.balance_cents` before call | `balance_cents >= 0` |
| Soft-lock | Agent switches to message-only at $0 balance | See `vapi.js` context inject |
| Upgrade trigger | Emit upgrade prompt when balance drops below threshold | See `references/conversion-optimization.md` |
| Wallet reload | Stripe/Square intent → webhook → `credit_wallet()` | See **stripe** skill |

## Common Patterns

### Tier-gated feature unlock

**When:** A feature (e.g., multi-location, priority routing) is only available at Scale+

```javascript
// In any service function — guard by tier
const TIER_ORDER = ['standard', 'growth', 'scale', 'enterprise'];

function tierAtLeast(clientTier, required) {
  return TIER_ORDER.indexOf(clientTier) >= TIER_ORDER.indexOf(required);
}

// Usage
if (!tierAtLeast(client.billing_tier, 'scale')) {
  return res.status(403).json({ error: 'Feature requires Scale tier or higher' });
}
```

### Low-balance upgrade nudge

**When:** Balance drops below 5 minutes of call time at current rate

```javascript
// After deductCall(), check balance and fire n8n upgrade webhook
async function maybeNudgeUpgrade(clientId, balanceCents, rate) {
  const minutesRemaining = Math.floor(balanceCents / rate);
  if (minutesRemaining < 5) {
    await axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/low-balance`, {
      client_id: clientId,
      minutes_remaining: minutesRemaining,
    });
  }
}
```

## See Also

- [conversion-optimization](references/conversion-optimization.md)
- [content-copy](references/content-copy.md)
- [distribution](references/distribution.md)
- [measurement-testing](references/measurement-testing.md)
- [growth-engineering](references/growth-engineering.md)
- [strategy-monetization](references/strategy-monetization.md)

## Related Skills

- See the **stripe** skill for wallet reload via payment intents
- See the **square** skill for Square-path wallet reloads
- See the **clerk** skill for protecting tier-upgrade dashboard routes
- See the **redis** skill for caching client config including billing_tier
- See the **node** skill for Express route patterns used in billing endpoints
- See the **mapping-conversion-events** skill for instrumenting upgrade funnel
- See the **strengthening-upgrade-moments** skill for in-app upgrade prompts
- See the **instrumenting-product-metrics** skill for tier cohort analytics
