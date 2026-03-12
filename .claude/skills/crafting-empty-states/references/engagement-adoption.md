# Engagement & Adoption Reference

## Contents
- Feature adoption signals
- Nudge patterns via API response
- Tier upgrade nudges
- FSM adoption tracking
- Anti-patterns

---

## Feature Adoption Signals

Adoption is measured by whether clients are using the features they've configured. The API can signal underutilized features by attaching `adoption_hints` to dashboard responses.

```javascript
// src/routes/dashboard.js — attach adoption hints to /config response
async function getAdoptionHints(clientId, config, pool) {
  const hints = [];

  // Check if pgvector FAQs are configured
  const faqCount = await pool.query(
    'SELECT COUNT(*) FROM client_faqs WHERE client_id = $1',
    [clientId]
  );
  if (parseInt(faqCount.rows[0].count) === 0) {
    hints.push({
      feature: 'faq_search',
      message: 'Add FAQs to let your agent answer common questions instantly',
      action: 'add_faqs'
    });
  }

  // Check if caller memory has any history (proxy for active usage)
  const callCount = await pool.query(
    'SELECT COUNT(*) FROM call_logs WHERE client_id = $1',
    [clientId]
  );
  if (parseInt(callCount.rows[0].count) === 0) {
    hints.push({
      feature: 'live_calls',
      message: 'Your agent is ready. Configure Vapi to route calls to your number.',
      action: 'configure_vapi'
    });
  }

  return hints.length > 0 ? hints : null;
}
```

## Nudge Patterns via API Response

Nudges live in API responses — they are not push notifications. The dashboard polls for them when rendering. Attach them to the most relevant endpoint for each nudge type.

```javascript
// Wallet low-balance nudge — attach to GET /api/v1/dashboard/wallet
function getWalletNudge(balanceCents, tier) {
  const LOW_BALANCE_THRESHOLD_CENTS = 1000; // $10.00

  if (balanceCents > 0 && balanceCents < LOW_BALANCE_THRESHOLD_CENTS) {
    return {
      type: 'low_balance',
      severity: 'warning',
      message: `Your wallet is below $10. Top up to keep your agent running without interruption.`,
      action: 'add_funds'
    };
  }

  return null;
}
```

## Tier Upgrade Nudges

When a client's usage approaches the value ceiling of their current tier, surface an upgrade nudge. All money in cents — never floating point.

```javascript
// src/services/walletService.js — include in getWalletState()
function getTierUpgradeNudge(tier, monthlyMinutes) {
  const TIER_NUDGE_MAP = {
    standard: { threshold_minutes: 50, next_tier: 'growth', savings_per_min_cents: 8 },
    growth:   { threshold_minutes: 100, next_tier: 'scale', savings_per_min_cents: 5 },
    scale:    { threshold_minutes: 200, next_tier: 'enterprise', savings_per_min_cents: 4 }
  };

  const nudge = TIER_NUDGE_MAP[tier];
  if (!nudge || monthlyMinutes < nudge.threshold_minutes) return null;

  const monthlySavingsCents = monthlyMinutes * nudge.savings_per_min_cents;
  return {
    type: 'tier_upgrade',
    current_tier: tier,
    suggested_tier: nudge.next_tier,
    monthly_savings_cents: monthlySavingsCents,
    message: `At your usage, upgrading to ${nudge.next_tier} saves $${(monthlySavingsCents / 100).toFixed(2)}/month`
  };
}
```

## FSM Adoption Tracking

FSM connection is the highest-value activation step — it unlocks booking confirmation. Track whether connected clients are actually generating bookings.

```javascript
// src/routes/dashboard.js — add to /config response
async function getFsmAdoptionState(clientId, pool) {
  const integration = await pool.query(
    `SELECT integration_type FROM client_integrations
     WHERE client_id = $1 AND integration_type = 'fsm'`,
    [clientId]
  );

  if (integration.rows.length === 0) {
    return { connected: false, action: 'connect_fsm' };
  }

  const bookingCount = await pool.query(
    'SELECT COUNT(*) FROM bookings WHERE client_id = $1',
    [clientId]
  );

  return {
    connected: true,
    booking_count: parseInt(bookingCount.rows[0].count),
    adoption_hint: parseInt(bookingCount.rows[0].count) === 0
      ? 'FSM is connected but no bookings have been created yet. Test a call to verify the flow.'
      : null
  };
}
```

## Anti-Patterns

### WARNING: Adoption nudges on every response

**The Problem:**
```javascript
// BAD - nudges on every endpoint regardless of relevance
router.get('/calls', async (req, res, next) => {
  res.json({ calls, adoption_hints: await getAllAdoptionHints(clientId) });
});
```

**Why This Breaks:**
1. Every call endpoint hits the FAQ table, wallet table, and call_logs table — N+1 queries
2. Nudges lose signal value when they appear everywhere
3. Complicates client-side rendering logic

**The Fix:**
- Attach nudges only to the endpoint where the user is most likely to act on them
- Wallet nudges → `/dashboard/wallet`
- FSM nudges → `/dashboard/config`
- FAQ nudges → `/dashboard/config`

### WARNING: Tier upgrade nudge with floating-point math

NEVER compute savings like `monthlyMinutes * 0.08`. This is floating-point currency math.

```javascript
// BAD
const savings = monthlyMinutes * 0.08; // floating point

// GOOD — all cents, all integers
const SAVINGS_PER_MIN_CENTS = 8;
const monthlySavingsCents = monthlyMinutes * SAVINGS_PER_MIN_CENTS;
```

See the **express** skill for structured response patterns and the **postgresql** skill for efficient count queries.
