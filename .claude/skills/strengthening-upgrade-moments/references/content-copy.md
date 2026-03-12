# Content Copy Reference

## Contents
- Tone Principles for Upgrade Copy
- Copy by Surface
- Anti-Patterns
- Vertical-Specific Variants

---

## Tone Principles for Upgrade Copy

Upgrade copy in AI Ops talks to HVAC owners, plumbers, spa managers — not SaaS power users. The voice must be:

- **Direct**: "You're losing $X/month" not "There may be optimization opportunities"
- **Operational**: Savings framed as call volume, not abstract percentages
- **Action-oriented**: Every message ends with one specific next step
- **Non-alarmist**: Low balance is a heads-up, not an emergency (unless zero)

See the **tightening-brand-voice** skill for broader tone conventions across agent scripts and error messages.

---

## Copy by Surface

### 1. Low-Balance Warning (walletService.js)

```javascript
// src/services/walletService.js — TIER_RATES context required
const LOW_BALANCE_COPY = {
  standard: (nextRate) => `You're at $0.40/min. Reload $50+ to unlock Growth at $0.32/min — that's $9.60 less per 120 calls.`,
  growth:   (nextRate) => `You're at $0.32/min. Reload $50+ to unlock Scale at $0.27/min — worth it above 80 calls/month.`,
  scale:    (nextRate) => `You're at $0.27/min. Reload $50+ to unlock Enterprise at $0.23/min.`,
  enterprise: ()       => `Balance below $20. Reload to keep your agent fully active.`,
};
```

### 2. Zero-Balance Agent Fallback (vapi.js)

```javascript
// The agent MUST still be helpful — caller doesn't know about billing
const ZERO_BALANCE_AGENT_COPY = (businessName) =>
  `I'm only able to take a message right now — ${businessName} will follow up with you soon. ` +
  `Can I get your name and the best number to reach you?`;
```

DO NOT expose billing details to the caller. The caller message is purely functional. The upgrade moment is the n8n notification to the operator.

### 3. Onboard Tier Selection (onboard.js)

```javascript
// src/routes/onboard.js — 201 response tier context
const TIER_VALUE_PROPS = {
  standard:   'Best for new accounts. Upgrade anytime as call volume grows.',
  growth:     'Best for 60+ calls/month. Saves $9.60 per 120 calls vs Standard.',
  scale:      'Best for 100+ calls/month. Saves $15.60 per 120 calls vs Standard.',
  enterprise: 'Best for high-volume operations. Maximum savings at scale.',
};

res.status(201).json({
  client_id: clientId,
  business_phone,
  status: 'active',
  wallet: {
    tier: wallet_tier || 'standard',
    rate_display: `$${(TIER_RATES[wallet_tier || 'standard'] / 100).toFixed(2)}/min`,
    value_prop: TIER_VALUE_PROPS[wallet_tier || 'standard'],
  },
});
```

### 4. Dashboard Wallet Empty State (dashboard.js)

```javascript
// When balance_cents === 0 in GET /api/v1/dashboard/wallet
const EMPTY_WALLET_COPY = {
  headline: 'Agent is in message-only mode',
  body: 'Your AI agent is still answering calls and taking messages, but cannot book appointments or process payments until your wallet is reloaded.',
  cta: 'Reload wallet to restore full capabilities',
};
```

---

## Anti-Patterns

### WARNING: Exposing Internal Tier Names as Copy

**The Problem:**

```javascript
// BAD — "standard" is a database value, not customer-facing copy
message: `Your tier is "standard". Consider upgrading.`
```

**Why This Breaks:**
"Standard" reads as adequate. The copy should frame it as the entry tier with room to save, not as a stable permanent state.

**The Fix:**

```javascript
// GOOD — frame it as a starting point
message: `You're on the entry rate ($0.40/min). At Growth ($0.32/min), 100 calls/month saves you $9.60.`
```

---

### WARNING: Using Floating Point in Copy Calculations

**The Problem:**

```javascript
// BAD — floating point arithmetic for display
const savingsDisplay = (TIER_RATES.standard - TIER_RATES.growth) / 100;
// May produce: "0.07999999999999999"
```

**Why This Breaks:**
All rates are stored as cents (integers) per CLAUDE.md principle #6. Floating point display is a UI bug that erodes trust.

**The Fix:**

```javascript
// GOOD — integer cents, format at display time
const savingsCents = TIER_RATES.standard - TIER_RATES.growth; // 8
const display = `${savingsCents}¢/min`;  // "8¢/min"

// Or for dollar amounts:
function centsToDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
```

---

## Vertical-Specific Variants

Different verticals have different call patterns. The upgrade copy should reference the right unit of value:

```javascript
// src/utils/upgradeHelper.js
const VERTICAL_CALL_CONTEXT = {
  hvac:       { avg_call_min: 5, monthly_calls: 120 },
  plumbing:   { avg_call_min: 4, monthly_calls: 100 },
  electrical: { avg_call_min: 4, monthly_calls: 80  },
  spa:        { avg_call_min: 3, monthly_calls: 150 },
  restaurant: { avg_call_min: 2, monthly_calls: 200 },
  cleaning:   { avg_call_min: 4, monthly_calls: 90  },
};

function buildVerticalUpgradeCopy(vertical, currentTier, nextTier) {
  const ctx = VERTICAL_CALL_CONTEXT[vertical] || { avg_call_min: 4, monthly_calls: 100 };
  const monthlySavingsCents = (TIER_RATES[currentTier] - TIER_RATES[nextTier]) * ctx.avg_call_min * ctx.monthly_calls;
  return `Switch to ${nextTier} — at your call volume, that's ${centsToDollars(monthlySavingsCents)}/month back.`;
}
```

See the **clarifying-market-fit** skill for ICP details per vertical.
