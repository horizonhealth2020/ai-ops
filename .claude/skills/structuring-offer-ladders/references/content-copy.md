# Content Copy Reference

## Contents
- Tier Value Proposition Copy
- In-Agent Upgrade Messaging
- Dashboard Empty States
- SMS/Email Copy Patterns
- Anti-Patterns

## Tier Value Proposition Copy

Each tier name must communicate volume and seriousness, not just a discount. The per-minute rate reduction is the mechanic — the copy frames the outcome.

```javascript
// Used in dashboard config response and onboarding emails
const TIER_COPY = {
  standard: {
    name: 'Standard',
    headline: 'Your AI agent answers every call',
    subline: '$0.40/min · Pay as you go',
    cta: 'Get started',
  },
  growth: {
    name: 'Growth',
    headline: 'More calls, lower cost per call',
    subline: '$0.32/min · 20% savings vs Standard',
    cta: 'Upgrade to Growth',
  },
  scale: {
    name: 'Scale',
    headline: 'Built for high-volume operations',
    subline: '$0.27/min · 32% savings vs Standard',
    cta: 'Upgrade to Scale',
  },
  enterprise: {
    name: 'Enterprise',
    headline: 'Custom pricing for large fleets',
    subline: '$0.23/min · 42% savings · Dedicated support',
    cta: 'Contact sales',
  },
};
```

## In-Agent Upgrade Messaging

When the agent is in message-only mode, the caller-facing message must not sound like an error. Frame it as a scheduling hold, not a system failure.

```javascript
// src/services/promptCompiler.js — message-only prompt fragment
const MESSAGE_ONLY_FRAGMENT = `
You are currently in message-taking mode.
Tell callers: "Our scheduling system is being updated right now.
I'd love to take your name and number so we can call you back
within the hour to get you booked."
Do NOT mention billing, balance, or technical issues.
`;
```

The owner sees in their dashboard: "Agent is in message-only mode. Reload your wallet to restore full booking."

## Dashboard Empty States

Empty state copy for the wallet dashboard (`GET /api/v1/dashboard/wallet`) when a new client has $0 balance:

```javascript
// Injected into dashboard config response
const emptyWalletState = {
  title: 'Load your wallet to activate your agent',
  body: 'Your AI agent is ready. Add at least $25 to start taking calls and booking appointments automatically.',
  cta_label: 'Add funds',
  cta_action: 'reload_wallet',
};
```

See the **crafting-empty-states** skill for full empty state patterns.

## SMS/Email Copy Patterns

SMS via Twilio is the primary upgrade channel. Keep under 160 characters to avoid MMS.

```javascript
// src/integrations/twilio.js — low balance SMS
const LOW_BALANCE_SMS = (minutesLeft, reloadUrl) =>
  `Your AI agent has ~${minutesLeft} min left. Reload now to keep taking calls: ${reloadUrl}`;

// wallet-depleted SMS
const DEPLETED_SMS = (reloadUrl) =>
  `Your AI agent is in message-only mode. Reload your wallet to restore full booking: ${reloadUrl}`;
```

See the **twilio** skill for sending patterns.

## Anti-Patterns

### WARNING: Feature-Generic Upgrade Copy

**The Problem:** "Upgrade your plan for more features" — this copy converts poorly because it's vague.

**Why This Fails:** Blue-collar business owners respond to concrete outcomes (calls answered, bookings made, revenue protected), not abstract feature lists.

**The Fix:** Always tie copy to a specific outcome the client is currently losing:
- "Your agent missed 3 calls today. Reload $50 to answer every call tomorrow."
- "At your current rate you have 4 minutes of call time left this week."

### WARNING: Showing Raw Cents in UI Copy

**The Problem:**
```javascript
// BAD — confusing to non-technical users
`Balance: ${wallet.balance_cents} cents`
```

**The Fix:**
```javascript
// GOOD — format at the presentation layer
const formatDollars = (cents) => `$${(cents / 100).toFixed(2)}`;
// src/utils/formatters.js already has this — use it
```
