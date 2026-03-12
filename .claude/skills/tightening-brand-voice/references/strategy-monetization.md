# Strategy & Monetization Reference

## Contents
- Wallet Tier Copy
- Billing Degradation Messaging
- Upsell Moments in Call Scripts
- Payment Intent Copy
- Pricing Table Language
- Anti-Patterns

---

## Wallet Tier Copy

The four billing tiers (standard/growth/scale/enterprise) are the core monetization mechanic. The copy associated with each tier should reinforce its value, not just state the price.

```javascript
// src/services/walletService.js — tier labels used in dashboard responses
const TIER_COPY = {
  standard:   { label: 'Standard',    rate_cents: 40, value_prop: 'Pay as you go' },
  growth:     { label: 'Growth',      rate_cents: 32, value_prop: 'Best for growing teams' },
  scale:      { label: 'Scale',       rate_cents: 27, value_prop: 'Volume discounts unlocked' },
  enterprise: { label: 'Enterprise',  rate_cents: 23, value_prop: 'Custom SLA + priority support' }
};

// Return tier copy in wallet dashboard response
res.json({
  balance_cents: wallet.balance,
  tier: TIER_COPY[client.tier],
  monthly_spend_cents: monthlySummary.total
});
```

**All amounts in cents (integers). Never use floats for money in this codebase.**

## Billing Degradation Messaging

When balance hits $0, the agent switches to `message_only` mode. The operator must understand what happened and what to do.

```javascript
// src/services/walletService.js — message-only degradation alert payload
function buildDegradationAlert(client, callId) {
  return {
    event: 'agent.degraded',
    client_id: client.id,
    call_id: callId,
    reason: 'insufficient_balance',
    // Operator-facing copy — surfaced in dashboard and n8n email
    operator_message: `Your agent ran out of balance during call ${callId} and switched to message-only mode. ` +
      `Callers were told to expect a callback. Top up your wallet to restore full service.`,
    top_up_url: '/dashboard/wallet'
  };
}
```

```javascript
// Agent script for message-only mode — caller-facing
const MESSAGE_ONLY_SCRIPT =
  "I'm not able to book appointments right now, but I'll make sure someone from our team " +
  "calls you back within one business hour. Can I get the best number to reach you?";
// Never reveal billing issues to callers. Always frame as a callback offer.
```

## Upsell Moments in Call Scripts

The agent can surface upsell opportunities at natural moments. Add to `promptCompiler.js` when `client.agent_config.upsell_enabled` is true.

```javascript
// src/services/promptCompiler.js — upsell hook after service identification
function compileUpsellBlock(client) {
  if (!client.agent_config.upsell_enabled) return '';
  return `After the caller describes their issue, mention any relevant add-on services: ` +
    `${client.agent_config.upsell_services.join(', ')}. ` +
    `Only mention once — never push if declined.`;
}
```

**Upsell copy rules:**
- Mention once, immediately after problem identification
- Frame as "we also do X" not "would you like to add X for $Y"
- Never mention price in the upsell — that's for the human follow-up

## Payment Intent Copy

Payment links are created via `POST /api/v1/payment/create-intent` and sent via Twilio SMS. Copy must drive click-through before the 15-minute hold expires.

```javascript
// src/services/paymentService.js — build payment SMS copy
function buildPaymentSMSCopy(client, amount, paymentUrl, expiryMinutes = 15) {
  const amountFormatted = `$${(amount / 100).toFixed(2)}`;
  // Keep under 160 chars
  return `${client.business_name}: ${amountFormatted} deposit link: ${paymentUrl} — expires in ${expiryMinutes} min.`;
}
```

**Conversion checklist for payment SMS:**
- [ ] Business name in first 20 characters (builds trust)
- [ ] Dollar amount explicit (reduces "what is this?" friction)
- [ ] URL as short as possible (use URL shortener in n8n if needed)
- [ ] Expiry creates urgency without panic
- [ ] Under 160 characters total

## Pricing Table Language

If the platform surfaces pricing to prospects (e.g., via the onboard form or a marketing page), use outcome-based language, not feature-based.

```
// DO: outcome language
Standard — "Handle up to 500 calls/month without thinking about it"
Growth   — "Save 20% vs. Standard when you're fielding 500+ calls"
Scale    — "Volume pricing for high-call businesses"
Enterprise — "Custom pricing with SLA guarantees"

// DON'T: feature language
Standard — "$0.40/min, basic features"
Growth   — "$0.32/min, all Standard features plus..."
```

## Anti-Patterns

### WARNING: Surfacing Billing State to Callers

**The Problem:**
```javascript
// BAD — leaks billing status
const agentMessage = `I'm sorry, your company's account has insufficient funds to book appointments.`;
```
**Why This Breaks:** Destroys caller trust in the business. Makes the operator look unprofessional. May cause the caller to go to a competitor.

**The Fix:** Always use the `MESSAGE_ONLY_SCRIPT` above — frame as a callback, never a billing issue.

### WARNING: Floating-Point Money Arithmetic

**The Problem:**
```javascript
// BAD — floating point error in financial calculations
const cost = durationMinutes * 0.40;  // 0.1 + 0.2 !== 0.3 in JS
```
**The Fix:**
```javascript
// GOOD — integer cents throughout
const RATE_CENTS = { standard: 40, growth: 32, scale: 27, enterprise: 23 };
const costCents = Math.ceil(durationMinutes * RATE_CENTS[tier]);
```

See the **stripe** skill and **square** skill for payment processor-specific amount handling.