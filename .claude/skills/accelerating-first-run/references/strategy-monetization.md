# Strategy & Monetization Reference

## Contents
- Wallet tier strategy
- Onboard-to-paid conversion
- Low-balance intervention
- Tier upgrade triggers
- Anti-patterns

---

## Wallet Tier Strategy

The prepaid wallet is both the monetization mechanism and the activation gate. A client
with zero balance cannot use the product. This creates a natural urgency to fund at signup.

Tier rates are defined in `src/services/walletService.js`:

```javascript
const TIER_RATES = {
  standard:   40,  // $0.40/min — default for all new clients
  growth:     32,  // $0.32/min — 20% savings
  scale:      27,  // $0.27/min — 32.5% savings
  enterprise: 23,  // $0.23/min — 42.5% savings
};
```

The `wallet_tier` is set at onboard and stored in `wallets.tier`. Changing it requires
a database update — there's no upgrade endpoint today.

**Add a tier upgrade endpoint:**

```javascript
// src/routes/dashboard.js — PUT /api/v1/dashboard/wallet/tier
router.put('/wallet/tier', async (req, res, next) => {
  try {
    const { tier } = req.body;
    const validTiers = ['standard', 'growth', 'scale', 'enterprise'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${validTiers.join(', ')}` });
    }

    await pool.query(
      'UPDATE wallets SET tier = $1, updated_at = NOW() WHERE client_id = $2',
      [tier, req.clientId]
    );

    logger.info('Wallet tier upgraded', { client_id: req.clientId, tier });
    res.json({ status: 'updated', tier, rate_cents_per_min: TIER_RATES[tier] });
  } catch (err) {
    next(err);
  }
});
```

---

## Onboard-to-Paid Conversion

The `wallet_tier` field in the onboard payload defaults to `'standard'` — but the wallet
balance starts at `0`. There's no payment collection at onboard time.

**Monetization sequence:**
1. Intake form submits `POST /api/v1/onboard` → client created, wallet at $0
2. `201` response includes `next_step: 'Add wallet balance'`
3. Client visits dashboard, clicks top-up → goes to Stripe/Square payment flow (external)
4. Payment webhook fires → wallet credited via `wallet_transactions` INSERT
5. Agent activates (balance > 0)

**Surface the conversion moment in the 201 response:**

```javascript
// src/routes/onboard.js
const tierRates = { standard: 40, growth: 32, scale: 27, enterprise: 23 };
const selectedTier = wallet_tier || 'standard';

res.status(201).json({
  client_id: clientId,
  status: 'active',
  wallet: {
    tier: selectedTier,
    rate_cents_per_min: tierRates[selectedTier],
    balance_cents: 0,
    recommended_topup_cents: 5000, // $50 = ~125 minutes at standard tier
  },
});
```

---

## Low-Balance Intervention

`walletService.deductCallCost()` checks `auto_reload_threshold_cents` but defers the
actual reload to "payment phase" (never implemented). This is a missed monetization moment.

**Add a low-balance flag to `POST /api/v1/call/complete`:**

```javascript
// src/routes/call.js — after deductCallCost()
const { cost_cents, balance_after_cents } = await deductCallCost(clientId, durationSeconds, callId);

const LOW_BALANCE_THRESHOLD_CENTS = 1000; // $10
if (balance_after_cents < LOW_BALANCE_THRESHOLD_CENTS && balance_after_cents > 0) {
  logger.info('Low wallet balance after call', {
    client_id: clientId,
    balance_after_cents,
  });
  // Fire n8n webhook to send low-balance email/SMS
  await fireWebhook('wallet-low-balance', {
    client_id: clientId,
    balance_after_cents,
    tier: wallet.tier,
  });
}
```

---

## Tier Upgrade Triggers

Surface upgrade prompts at high-value moments — when the client is demonstrably getting
value and the savings are most tangible.

**Trigger upgrade prompt when monthly spend crosses a threshold:**

```javascript
// GET /api/v1/dashboard/wallet — compute monthly spend
const monthlySpend = await pool.query(
  `SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS spend_cents
   FROM wallet_transactions
   WHERE client_id = $1
     AND type = 'usage'
     AND created_at >= NOW() - INTERVAL '30 days'`,
  [clientId]
);

const spendCents = parseInt(monthlySpend.rows[0].spend_cents);
const currentTier = wallet.tier;

// Show upgrade prompt if on standard tier and spending >$20/month
const shouldUpgrade = currentTier === 'standard' && spendCents > 2000;
res.json({
  ...wallet,
  monthly_spend_cents: spendCents,
  upgrade_prompt: shouldUpgrade ? {
    message: `You spent $${(spendCents / 100).toFixed(2)} this month. Switch to Growth and save 20%.`,
    savings_cents: Math.round(spendCents * 0.2),
    recommended_tier: 'growth',
  } : null,
});
```

---

### WARNING: Starting All Clients on the Lowest Tier

**The Problem:**

```javascript
// BAD — onboard defaults to standard regardless of call volume signal
wallet_tier: wallet_tier || 'standard'
```

**Why This Breaks:**
1. High-volume clients (restaurants, HVAC) immediately lose money staying on standard
2. No signal to sales team to proactively upgrade new clients
3. Clients who self-discover the tier difference feel deceived when they compare invoices

**The Fix:**
Pre-select tier based on `vertical` at onboard time, since call volume correlates
strongly with vertical:

```javascript
// src/routes/onboard.js
const DEFAULT_TIER_BY_VERTICAL = {
  restaurant: 'growth',   // High call volume
  hvac: 'growth',
  plumbing: 'growth',
  spa: 'standard',
  electrical: 'standard',
};

const defaultTier = DEFAULT_TIER_BY_VERTICAL[vertical] || 'standard';
const selectedTier = wallet_tier || defaultTier;
```

---

## Related Skills

- See the **structuring-offer-ladders** skill for tier value ladder design
- See the **strengthening-upgrade-moments** skill for upgrade prompt copy and placement
- See the **stripe** skill for wallet top-up payment intent patterns
- See the **square** skill for Square-path payment processing
