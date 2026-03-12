---
name: clarifying-market-fit
description: |
  Aligns ICP, positioning, and value narrative for on-page messaging across the AI Ops platform.
  Use when: rewriting onboard intake copy, updating wallet tier value props, clarifying vertical-specific
  agent personas, positioning against generic chatbot alternatives, or defining what "success" looks like
  for each blue-collar vertical (HVAC, plumbing, spa, electrical, cleaning, restaurant).
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Clarifying-market-fit Skill

AI Ops serves owner-operators of blue-collar service businesses who lose revenue to missed calls — not
enterprise IT buyers. Every word on the platform (onboard form, wallet tier labels, dashboard copy,
agent persona prompts) must reflect that specific buyer. The ICP is a 1–15 person shop where the owner
answers the phone personally; the pain is unanswered calls during job site hours.

## Quick Start

### Positioning the Wallet Tiers

Tiers are priced in `seeds/demo_clients.sql` and documented in README.md. Name them around call volume,
not abstract tier labels:

```javascript
// src/services/walletService.js — tier copy must match ICP language
const TIER_LABELS = {
  standard: 'Starter (up to ~250 calls/mo)',
  growth:   'Growth (up to ~400 calls/mo)',
  scale:    'Scale (up to ~650 calls/mo)',
  enterprise: 'Enterprise (unlimited)',
};
```

### Vertical-Specific Agent Persona

The compiled system prompt (stored in `clients.system_prompt`) is the primary value surface. Persona
copy should reference vertical pain, not generic AI benefits:

```javascript
// src/services/promptCompiler.js — inject vertical context
function compileSystemPrompt(client) {
  const verticalHook = VERTICAL_HOOKS[client.vertical] || '';
  return `${verticalHook}\n\n${client.agent_persona}`;
}

const VERTICAL_HOOKS = {
  hvac:       'You answer calls for an HVAC company. Owners are on job sites and miss calls — every missed call is a $200–$800 lost job.',
  plumbing:   'You answer calls for a plumbing company. Emergency calls convert at 3× the rate of routine service.',
  spa:        'You answer calls for a day spa. Callers expect warm, unhurried service even from an AI.',
  electrical: 'You answer calls for an electrical contractor. Safety framing builds trust fast.',
  cleaning:   'You answer calls for a cleaning service. Recurring bookings are the revenue engine.',
  restaurant: 'You answer calls for a restaurant. Speed and accuracy on reservations prevent walkouts.',
};
```

### Onboard Intake Field Ordering

`POST /api/v1/onboard` collects the first impression. Field order signals what the platform values:

```javascript
// src/routes/onboard.js — lead with business identity, not technical config
const ONBOARD_FIELD_ORDER = [
  'business_name',
  'vertical',          // drives persona + FSM defaults
  'phone_number',      // the asset being protected
  'owner_name',
  'timezone',
  'fsm_type',          // collected last — technical detail
];
```

## Key Concepts

| Concept | Usage | Example |
|---------|-------|---------|
| ICP signal | Vertical field drives persona + FSM defaults | `client.vertical = 'hvac'` |
| Value anchor | Missed call cost, not AI features | "$800 lost job" not "GPT-4o powered" |
| Tier naming | Volume-based, not prestige-based | "Growth (400 calls/mo)" |
| Trust signal | Returning caller recognition | "Welcome back, Mike" in agent greeting |
| Soft-lock UX | Booking hold = urgency signal | "I'm holding that slot for 5 minutes" |

## Common Patterns

### Vertical-Gated Copy

**When:** Onboard confirmation, dashboard empty states, wallet reload nudges

```javascript
// src/routes/dashboard.js — vertical-aware copy in API responses
function getWalletNudgeCopy(client) {
  const avgCallCost = { hvac: 800, plumbing: 600, spa: 120, electrical: 500 };
  const missedCallValue = avgCallCost[client.vertical] || 300;
  return `Your wallet is low. At your call volume, a missed call costs ~$${missedCallValue}.`;
}
```

### ICP-Anchored Error Messages

**When:** Wallet soft-lock (balance = $0 switches agent to message-only mode)

```javascript
// src/services/walletService.js — rejection copy speaks to owner fear
const LOW_BALANCE_MESSAGE =
  'Your AI agent is in message-only mode. Reload your wallet to restore full booking.';
// NOT: "Insufficient balance. Feature disabled."
```

## See Also

- [conversion-optimization](references/conversion-optimization.md)
- [content-copy](references/content-copy.md)
- [distribution](references/distribution.md)
- [measurement-testing](references/measurement-testing.md)
- [growth-engineering](references/growth-engineering.md)
- [strategy-monetization](references/strategy-monetization.md)

## Related Skills

- See the **crafting-page-messaging** skill for hero copy and CTA rewriting
- See the **tuning-landing-journeys** skill for onboard flow optimization
- See the **structuring-offer-ladders** skill for wallet tier pricing logic
- See the **designing-onboarding-paths** skill for first-run activation flows
- See the **instrumenting-product-metrics** skill for measuring ICP activation
- See the **triaging-user-feedback** skill for routing vertical-specific complaints
- See the **writing-release-notes** skill for shipping positioning changes
