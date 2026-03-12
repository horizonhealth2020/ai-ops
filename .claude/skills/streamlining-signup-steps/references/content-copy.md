# Content Copy Reference

## Contents
- Onboard response messaging
- Error message copy patterns
- Wallet activation copy
- Vertical-specific default agent persona
- Anti-patterns in API response copy

---

## Onboard Response Messaging

The `POST /api/v1/onboard` response is the first thing an operator (or n8n automation) sees
after signup. The current response is minimal. Every field is an opportunity to guide the next action.

```javascript
// src/routes/onboard.js — current response (line 158-162)
res.status(201).json({
  client_id: clientId,
  business_phone,
  status: 'active',
});

// IMPROVED — tells the operator exactly what to do next
res.status(201).json({
  client_id: clientId,
  business_phone,
  status: 'active',
  agent_status: 'message_only',  // honest about wallet = $0
  next_steps: [
    { order: 1, action: 'fund_wallet', label: 'Add wallet balance to enable bookings' },
    { order: 2, action: 'configure_vapi', label: 'Set client_id in your Vapi assistant metadata' },
    { order: 3, action: 'test_call', label: 'Call your business number to test the agent' },
  ],
});
```

---

## Error Message Copy Patterns

Errors in `src/routes/onboard.js` and `src/middleware/errorHandler.js` should guide, not block.

```javascript
// BAD — generic, no path forward
res.status(400).json({ error: 'business_name and business_phone are required' });

// GOOD — tells them exactly what to fix and expected format
res.status(400).json({
  error: 'Missing required fields',
  missing: ['business_name', 'business_phone'],
  example: { business_name: 'Apex Plumbing', business_phone: '+19545550100' },
  docs: 'Phone must be E.164 format: +1XXXXXXXXXX',
});
```

---

## Wallet Activation Copy

The wallet state drives agent capability. Surface this clearly at every touchpoint.

```javascript
// GET /api/v1/dashboard/wallet — augment the response with action copy
// src/services/walletService.js — add to getWalletInfo() return value

const tierRates = {
  standard: 0.40,
  growth: 0.32,
  scale: 0.27,
  enterprise: 0.23,
};

// Contextual copy based on balance
function getWalletCopy(balanceCents, tier) {
  if (balanceCents === 0) {
    return {
      status_label: 'Agent paused — add balance to go live',
      cta: 'Add $20 to handle ~50 calls',
    };
  }
  const minsRemaining = Math.floor(balanceCents / 100 / tierRates[tier]);
  return {
    status_label: `~${minsRemaining} minutes of call coverage remaining`,
    cta: minsRemaining < 30 ? 'Running low — top up now' : null,
  };
}
```

---

## Vertical-Specific Default Agent Persona

When `agent_name` and `greeting_script` are omitted, `promptCompiler.js` falls back to nulls.
Provide sensible vertical defaults instead of null:

```javascript
// src/services/promptCompiler.js — add vertical defaults before compile
const VERTICAL_DEFAULTS = {
  hvac: {
    agent_name: 'Alex',
    greeting_script: "Thanks for calling! I'm Alex, your virtual assistant. Are you looking to schedule a service, or do you have an urgent issue?",
  },
  spa: {
    agent_name: 'Aria',
    greeting_script: "Welcome! I'm Aria, here to help you book your next appointment. What service can I set up for you today?",
  },
  electrical: {
    agent_name: 'Sam',
    greeting_script: "Hi, thanks for calling! I'm Sam. Are you dealing with an emergency or looking to schedule an electrical service?",
  },
  plumbing: {
    agent_name: 'Jordan',
    greeting_script: "Thanks for calling! I'm Jordan. Is this an urgent plumbing issue, or would you like to schedule a visit?",
  },
  general: {
    agent_name: 'Casey',
    greeting_script: "Hi there! I'm Casey, your virtual assistant. How can I help you today?",
  },
};

// In promptCompiler.compile():
const defaults = VERTICAL_DEFAULTS[client.vertical] || VERTICAL_DEFAULTS.general;
const agentName = client.agent_name || defaults.agent_name;
const greetingScript = client.greeting_script || defaults.greeting_script;
```

---

## WARNING: Generic Error Messages That Kill Trust

**The Problem:**

```javascript
// BAD — this copy appears in the agent's voice during a live call
'I cannot process your request at this time.'

// BAD — wallet-empty fallback with no explanation
'I can only take messages right now.'
```

**Why This Breaks:**
1. Callers assume the business is having technical problems
2. Operators don't know WHY their agent is in message-only mode
3. No path forward for either party

**The Fix:**

```javascript
// GOOD — in src/services/walletService.js, return differentiated messages
function getAgentMode(wallet) {
  if (wallet.balance_cents <= 0) {
    return {
      mode: 'message_only',
      // Caller-facing: warm, not broken-sounding
      caller_message: "I can take your details and have someone call you right back.",
      // Operator alert via n8n webhook
      operator_alert: 'Wallet balance is $0 — agent in message-only mode',
    };
  }
  return { mode: 'full', caller_message: null, operator_alert: null };
}
```

---

## Related Skills

- See the **tightening-brand-voice** skill for agent persona copy consistency
- See the **crafting-page-messaging** skill for intake form and dashboard copy
- See the **clarifying-market-fit** skill for vertical-specific positioning
