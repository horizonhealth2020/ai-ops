# Strategy & Monetization Reference

## Contents
- Wallet tier selection at signup
- Trial-to-paid conversion strategy
- Tier upgrade triggers in the API
- Pricing copy at signup decision point
- Anti-patterns in prepaid billing flows

---

## Wallet Tier Selection at Signup

The `wallet_tier` field on `POST /api/v1/onboard` defaults to `'standard'` if omitted.
This is a silent monetization choice — most operators will never upgrade unless prompted.

Tier rates (from `README.md`):

| Tier | Rate | Annual savings vs Standard |
|------|------|---------------------------|
| standard | $0.40/min | baseline |
| growth | $0.32/min | -20% |
| scale | $0.27/min | -32.5% |
| enterprise | $0.23/min | -42.5% |

**Growth tier is the right default for most operators.** The $0.08/min savings compounds
fast for businesses handling 50+ calls/week. Frame standard as the entry option, not the default.

```javascript
// src/routes/onboard.js — change the default tier signal
// Current:
wallet_tier || 'standard'

// Consider: default to 'growth' for operators with high-volume verticals
const isHighVolume = ['hvac', 'plumbing', 'electrical'].includes(vertical);
const defaultTier = isHighVolume ? 'growth' : 'standard';
const tier = wallet_tier || defaultTier;
```

---

## Trial-to-Paid Conversion Strategy

No trial tier exists (see `growth-engineering.md`). Until a trial tier is built, the conversion
strategy is: minimize time-to-value so operators are already reliant on the agent before
their first top-up decision.

Conversion checklist:

- [ ] Onboard with minimal fields (3 fields max in intake form)
- [ ] Auto-provision Vapi assistant immediately after onboard
- [ ] Seed wallet with $5 credit for first test call (only costs ~$0.40)
- [ ] Send SMS confirmation with direct link to fund wallet
- [ ] Surface ROI framing in wallet dashboard: "Handles calls you'd miss for $X/month"
- [ ] At first wallet top-up: offer annual billing discount to lock in commitment

---

## Tier Upgrade Triggers in the API

Upgrade nudges should fire at moments of demonstrated value, not on a schedule.

```javascript
// src/routes/call.js — post-call complete, check upgrade trigger conditions
router.post('/complete', vapiAuth, async (req, res, next) => {
  try {
    // ... existing deduction logic ...

    // Upgrade nudge: after 10th booking, suggest scale tier
    const { rows } = await pool.query(
      'SELECT COUNT(*) FROM bookings WHERE client_id = $1',
      [clientId]
    );
    const bookingCount = parseInt(rows[0].count);

    if (bookingCount === 10) {
      // Fire n8n webhook — send tier upgrade suggestion
      await fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/tier-upgrade-nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, current_tier: wallet.tier, trigger: 'booking_milestone_10' }),
      });
      logger.info('tier_upgrade_nudge_fired', { client_id: clientId, booking_count: bookingCount });
    }

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});
```

---

## Pricing Copy at Signup Decision Point

Tier selection copy must frame value in terms blue-collar operators understand: missed calls
and job cost, not abstract per-minute rates.

```javascript
// Include this framing in the onboard confirmation or intake form:
const TIER_VALUE_PROPS = {
  standard: {
    rate: '$0.40/min',
    framing: 'Best for getting started — pay as you go',
    example: 'A 5-min call costs $2. One booked job pays for 50 calls.',
  },
  growth: {
    rate: '$0.32/min',
    framing: 'Most popular — 20% savings for growing businesses',
    example: 'A 5-min call costs $1.60. Best for 20+ calls/week.',
  },
  scale: {
    rate: '$0.27/min',
    framing: 'Built for busy shops handling 50+ calls/week',
    example: 'A 5-min call costs $1.35. Pays for itself in one recovered job.',
  },
};
```

---

## WARNING: Defaulting to the Cheapest Tier

**The Problem:**

```javascript
// BAD — silent default to lowest tier
wallet_tier || 'standard'
// Operator never sees the other options
// Leaves 20-42% margin on the table per call
```

**Why This Breaks:**
1. Most operators won't revisit tier selection once onboarded — inertia is real
2. Standard tier operators churn faster because their cost-per-call appears higher
3. You lose the upsell moment that has the highest conversion rate: right at signup

**The Fix:**
- Show all 4 tiers in the intake form with value props (not just a dropdown)
- Pre-select `growth` for high-volume verticals
- Add a "recommended" badge to the growth tier
- Include a volume estimate question ("How many calls/week?") to auto-select tier

---

## WARNING: No Annual Billing Option

**Detected:** Wallet is purely prepaid per-top-up. No annual commitment or subscription model.

**Impact:**
- Monthly churn is structurally higher than subscription models
- No upfront cash flow for platform growth
- Operators have zero switching cost at any moment

**The Fix:** Add an `annual_commitment_cents` field to `wallets` and offer a 15% discount
for paying 12 months upfront via Stripe. See the **stripe** skill for payment intent patterns
and the **structuring-offer-ladders** skill for tier ladder design.

---

## Related Skills

- See the **structuring-offer-ladders** skill for full wallet tier and billing model design
- See the **stripe** skill for Stripe payment intent and subscription patterns
- See the **strengthening-upgrade-moments** skill for upgrade prompt placement
- See the **clarifying-market-fit** skill for vertical-specific pricing positioning
