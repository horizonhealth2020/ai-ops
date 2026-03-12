---
name: crafting-page-messaging
description: |
  Writes conversion-focused messaging for pages and key CTAs across the AI Ops platform.
  Use when: writing or rewriting onboarding copy in /api/v1/onboard responses, improving
  empty states in dashboard routes, tightening CTA labels in dashboard config responses,
  writing error messages that guide operators toward resolution, or crafting wallet/billing
  copy that reduces churn when balance runs low.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Crafting-page-messaging Skill

AI Ops surfaces messaging in three places: API response text read aloud by the Vapi agent,
dashboard JSON payloads consumed by operator UIs, and onboarding webhook responses. All copy
must be terse (voice is unforgiving), action-oriented, and tenant-aware — a spa caller gets
different tone than an HVAC dispatcher. The wallet soft-lock and booking fallback paths are
the highest-stakes copy surfaces because they directly affect call completion rate.

## Quick Start

### Voice-safe agent copy (src/services/promptCompiler.js)

```javascript
// Compile persona + service copy into pre-built system prompt
const systemPrompt = compilePrompt({
  persona: client.agent_persona,        // "friendly", "professional", "casual"
  business_name: client.business_name,
  services: client.services_offered,
  wallet_soft_lock_message: client.wallet_message || DEFAULT_WALLET_MESSAGE,
});
```

### Wallet soft-lock fallback message (src/services/walletService.js)

```javascript
const DEFAULT_WALLET_MESSAGE =
  "I can take a message and have someone call you back shortly. " +
  "Our scheduling system is temporarily unavailable.";
// Never expose billing state to the caller — always use a neutral fallback.
```

### Booking rejection copy (src/services/bookingService.js)

```javascript
// Good: offer alternatives, never dead-end the caller
const fallbackScript =
  `That slot just filled up. I have openings on ${altSlots[0]} or ${altSlots[1]}. ` +
  `Which works better for you?`;
```

## Key Concepts

| Surface | Location | Audience |
|---------|----------|----------|
| Agent voice script | `clients.system_prompt` (DB) | End caller |
| Wallet soft-lock message | `clients.wallet_message` (DB) | End caller |
| Dashboard error/empty states | `src/routes/dashboard.js` responses | Operator |
| Onboarding confirmation | `src/routes/onboard.js` response body | New client (operator) |
| Payment SMS link | `src/integrations/twilio.js` message body | End caller |

## Common Patterns

### Never expose system state to callers

**When:** wallet is $0, FSM is down, booking fails

```javascript
// GOOD — neutral, action-forward
res.json({ script: "Let me get your name and number and have someone call you right back." });

// BAD — exposes infrastructure state
res.json({ script: "Our Redis slot lock failed. Please try again." });
```

### Operator-facing error messages (dashboard routes)

**When:** `GET /api/v1/dashboard/wallet` returns low balance

```javascript
res.json({
  balance_cents: client.wallet_balance,
  warning: client.wallet_balance < 2000
    ? "Balance below $20. Top up to keep your agent active."
    : null,
});
```

### Onboarding confirmation copy

**When:** `POST /api/v1/onboard` succeeds

```javascript
res.status(201).json({
  message: "Your AI agent is being configured. You'll receive a test call within 10 minutes.",
  client_id: newClient.client_id,
  next_steps: ["Set your business hours in the dashboard", "Add your team's transfer numbers"],
});
```

## See Also

- [conversion-optimization](references/conversion-optimization.md)
- [content-copy](references/content-copy.md)
- [distribution](references/distribution.md)
- [measurement-testing](references/measurement-testing.md)
- [growth-engineering](references/growth-engineering.md)
- [strategy-monetization](references/strategy-monetization.md)

## Related Skills

- **vapi** — where compiled agent scripts are consumed and streamed
- **designing-onboarding-paths** — onboarding flow that wraps the `/api/v1/onboard` copy
- **crafting-empty-states** — dashboard empty states that rely on operator-facing copy
- **mapping-user-journeys** — maps operator friction points where copy interventions help
- **structuring-offer-ladders** — wallet tier names and upgrade prompts
- **tuning-landing-journeys** — public-facing page copy upstream of onboarding
- **mapping-conversion-events** — instruments copy experiments with `logEvent()`
