# Conversion Optimization Reference

## Contents
- ICP Conversion Signals
- Onboard Form Optimization
- Wallet Reload Conversion
- Soft-Lock as Urgency Pattern
- Anti-Patterns

---

## ICP Conversion Signals

Blue-collar owner-operators convert on **fear of missed revenue**, not feature lists. Every conversion
surface should anchor to a missed call = lost job frame.

Vertical lost-job averages (use in copy, not just internally):

```javascript
// src/services/walletService.js
const VERTICAL_LOST_CALL_VALUE = {
  hvac:       800,   // emergency dispatch avg
  plumbing:   600,
  electrical: 500,
  spa:        120,   // single service avg
  cleaning:   180,   // recurring booking value
  restaurant:  90,   // cover avg
};
```

---

## Onboard Form Optimization

`POST /api/v1/onboard` is the top-of-funnel conversion. Reduce cognitive load by front-loading
identity fields and deferring technical config.

```javascript
// src/routes/onboard.js — validate in ICP-first order
router.post('/api/v1/onboard', async (req, res, next) => {
  try {
    const { business_name, vertical, phone_number, owner_name, timezone, fsm_type } = req.body;
    // business_name + vertical asked first — confirms "this is for me"
    // phone_number third — the asset being protected
    // fsm_type last — technical, can default or skip
  } catch (err) {
    next(err);
  }
});
```

**DO:** Default `fsm_type` to `none` if not supplied — never block onboard on optional fields.
**DON'T:** Ask for API keys during onboard — kills conversion. Collect post-activation.

---

## Wallet Reload Conversion

The wallet balance check happens in `src/services/walletService.js` before every call. The moment
balance hits zero, the agent downgrades to message-only mode. This is a conversion trigger:

```javascript
// src/services/walletService.js
async function checkAndDeductBalance(clientId, durationMinutes, tier) {
  const costCents = Math.ceil(durationMinutes * TIER_RATES[tier]);
  const { rows } = await pool.query(
    'SELECT balance_cents FROM wallets WHERE client_id = $1',
    [clientId]
  );
  if (rows[0].balance_cents < costCents) {
    // Trigger reload nudge via n8n webhook — this is a conversion moment
    await triggerN8nWebhook('wallet_low', { client_id: clientId, balance: rows[0].balance_cents });
    return { allowed: false, message: LOW_BALANCE_MESSAGE };
  }
}
```

Wallet reload nudge copy must reference vertical lost-call value, not account balance numbers.

---

## Soft-Lock as Urgency Pattern

The 5-minute Redis TTL on slot holds is a built-in urgency signal. Surface it in agent copy:

```javascript
// src/services/availabilityService.js — hold confirmation message
const HOLD_CONFIRMATION = {
  message: "I've reserved that slot for you — it's held for 5 minutes while we confirm.",
  // NOT: "Slot hold created with 300 second TTL"
};
```

Urgency works because the caller knows other callers exist (shared booking system). Make the hold
explicit in the agent's spoken response, not just an internal state.

---

## Anti-Patterns

### WARNING: Feature-First Copy

**The Problem:**
```javascript
// BAD — leads with technology
const ONBOARD_HERO = 'GPT-4o powered AI voice agent with pgvector FAQ search';
```

**Why This Breaks:**
1. Owner-operators don't know GPT-4o
2. "AI voice agent" is generic — every competitor says this
3. No connection to the missed-call pain

**The Fix:**
```javascript
// GOOD — leads with the pain solved
const ONBOARD_HERO = 'Your phone answers every call, books the job, takes payment — even when you\'re on the job site.';
```

### WARNING: Generic Tier Names

**The Problem:**
```javascript
// BAD — prestige ladder, no volume signal
const TIERS = ['Starter', 'Pro', 'Business', 'Enterprise'];
```

**Why This Breaks:** Owner doesn't know which tier fits their call volume. Leads to
over/under-buying, churn, and support tickets asking "which plan do I need?"

**The Fix:** Name tiers by call volume or business size signal that the ICP self-identifies with.
