---
name: tightening-brand-voice
description: |
  Refines copy for clarity, tone, and consistency across AI agent scripts, API error messages, onboarding flows, and dashboard responses in the AI Ops multi-tenant voice platform.
  Use when: editing agent persona text in promptCompiler.js, rewriting onboarding response copy in onboard.js, polishing error messages in errorHandler.js, tightening Twilio SMS payment link copy, or improving wallet/billing messaging in dashboard responses.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Tightening Brand Voice

Brand voice in this codebase lives in three places: AI agent system prompts (compiled in `src/services/promptCompiler.js`), operator-facing API response strings (routes and services), and SMS copy sent via Twilio. Every client runs the same engine — but the agent sounds like *their* business. Voice work here means both platform-level clarity and per-client persona fidelity.

## Quick Start

### Edit Agent Persona Copy

```javascript
// src/services/promptCompiler.js
// Agent persona text is assembled from client config fields
function compilePersonaBlock(client) {
  return `You are ${client.agent_name}, the virtual assistant for ${client.business_name}. ` +
    `Speak in a ${client.tone} tone. You specialize in ${client.vertical} services.`;
}
```

Tighten: replace vague `tone` values like "friendly" with behavior instructions: "warm but efficient — never say 'no problem' or 'absolutely'".

### Polish SMS Payment Copy

```javascript
// src/integrations/twilio.js
// Keep SMS under 160 chars. Lead with action, not context.
const message = `Hi ${callerName}, pay your ${businessName} deposit here: ${paymentUrl} — expires in 15 min.`;
```

### Improve Onboarding Response Copy

```javascript
// src/routes/onboard.js
// Response shown after intake form submission
res.json({
  success: true,
  message: 'Your AI agent is being configured. You\'ll receive a setup email within 2 minutes.',
  next_steps: ['Check your email', 'Log in to your dashboard', 'Test your agent']
});
```

## Key Concepts

| Surface | File | Voice Priority |
|---------|------|----------------|
| Agent system prompt | `src/services/promptCompiler.js` | Per-client persona fidelity |
| Error messages | `src/middleware/errorHandler.js` | Operator clarity, not end-user |
| Wallet/billing alerts | `src/services/walletService.js` | Urgency without panic |
| Onboarding responses | `src/routes/onboard.js` | Confidence + next steps |
| SMS payment links | `src/integrations/twilio.js` | Brevity, <160 chars |
| Call transfer prompts | `src/services/transferService.js` | Caller trust, smooth handoff |

## Common Patterns

### Wallet Low-Balance Warning

**When:** Agent detects balance will run low mid-call

```javascript
// src/services/walletService.js
// Operator-facing, not caller-facing
const WARNING_MESSAGE = 'Your call balance is running low. Top up at dashboard to avoid service interruption.';
```

### Booking Confirmation Script

**When:** Booking confirmed, agent reads back details to caller

```javascript
// Injected via promptBuilder.js into live call context
const confirmationScript = `Great — I've got you booked for ${serviceName} on ${date} at ${time}. ` +
  `You'll get a confirmation text shortly. Is there anything else I can help you with?`;
```

## See Also

- [conversion-optimization](references/conversion-optimization.md)
- [content-copy](references/content-copy.md)
- [distribution](references/distribution.md)
- [measurement-testing](references/measurement-testing.md)
- [growth-engineering](references/growth-engineering.md)
- [strategy-monetization](references/strategy-monetization.md)

## Related Skills

- See the **crafting-page-messaging** skill for dashboard-facing UI copy
- See the **designing-onboarding-paths** skill for onboarding flow structure
- See the **vapi** skill for agent prompt delivery mechanics
- See the **twilio** skill for SMS length and encoding constraints
- See the **framing-release-stories** skill for launch and changelog copy