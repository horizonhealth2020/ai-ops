# Content Copy Reference

## Contents
- Agent Persona Templates
- SMS Copy Constraints
- Call Transfer Scripts
- Dashboard Empty States
- Tone Configuration Patterns
- Anti-Patterns

---

## Agent Persona Templates

Agent voice is compiled in `src/services/promptCompiler.js` from client config. The persona block must contain: name, business, vertical, tone instruction, and scope limits.

```javascript
// src/services/promptCompiler.js — full persona block
function compilePersonaBlock(client) {
  const toneInstruction = TONE_INSTRUCTIONS[client.tone] || TONE_INSTRUCTIONS['professional'];
  return [
    `You are ${client.agent_name}, the virtual assistant for ${client.business_name}.`,
    `You handle ${client.vertical} service inquiries, bookings, and payments.`,
    toneInstruction,
    `Never discuss competitors. If asked about pricing not in your knowledge base, offer to have the team follow up.`
  ].join(' ');
}

const TONE_INSTRUCTIONS = {
  professional: 'Speak clearly and efficiently. Skip filler phrases like "absolutely" or "great question".',
  friendly:     'Be warm and conversational, but stay on task. Use the caller\'s first name when you have it.',
  formal:       'Maintain a professional, courteous tone. Avoid contractions.'
};
```

**Tone options map directly to `clients.agent_config.tone` in PostgreSQL.** Add new tone keys here and in the seed/migration.

## SMS Copy Constraints

Twilio SMS via `src/integrations/twilio.js` must stay under 160 characters per segment. Multi-segment messages cost more and feel spammy.

```javascript
// src/integrations/twilio.js — payment link SMS
// DO: action first, business context second, URL last, expiry inline
function buildPaymentSMS(callerName, businessName, amount, paymentUrl) {
  // Max 160 chars
  return `${businessName}: Hi ${callerName}, your $${(amount/100).toFixed(2)} deposit link: ${paymentUrl} (15 min)`;
}
```

```javascript
// DON'T: context-first structure buries the link
const badSms = `Hello! Thank you for calling ${businessName}. ` +
  `We wanted to follow up regarding your appointment deposit of $${amount}. ` +
  `Please use the following link to complete your payment: ${paymentUrl}`;
// WHY BAD: Almost certainly >160 chars, splits into 2+ segments, reads like spam
```

**Checklist for every SMS:**
- [ ] Under 160 characters (count it)
- [ ] Business name in first 20 characters
- [ ] CTA link before expiry notice
- [ ] No "click here" — link is the CTA

## Call Transfer Scripts

`src/services/transferService.js` generates the handoff script the agent reads before transferring.

```javascript
// src/services/transferService.js — DO: explain what's happening, set expectation
function buildTransferScript(transferConfig, booking) {
  return `I'm going to connect you with ${transferConfig.department_name} now. ` +
    `I've noted your ${booking ? 'booking request' : 'inquiry'} so they'll have context. ` +
    `Please hold for just a moment.`;
}
```

```javascript
// DON'T: cold transfer with no warning
const coldTransfer = "Transferring you now. Goodbye.";
// WHY BAD: Caller confusion, higher hang-up rate, damages trust in the business
```

## Dashboard Empty States

Dashboard route responses (`src/routes/dashboard.js`) return data to the operator UI. When collections are empty, the response should guide the operator.

```javascript
// src/routes/dashboard.js — GET /api/v1/dashboard/calls — empty state
if (calls.length === 0) {
  return res.json({
    calls: [],
    message: 'No calls yet. Make sure your Vapi assistant is pointed to this agent.',
    docs_url: 'https://docs.aiops.app/setup/vapi'
  });
}
```

## Tone Configuration Patterns

Store tone as a structured config, not a free-text string, to prevent prompt injection and ensure consistent compilation.

```javascript
// Enforced tone values (validate in onboard.js and dashboard.js)
const VALID_TONES = ['professional', 'friendly', 'formal'];

function validateAgentConfig(config) {
  if (!VALID_TONES.includes(config.tone)) {
    throw Object.assign(new Error('Invalid tone value'), { status: 400 });
  }
}
```

## Anti-Patterns

### WARNING: Free-Text Tone Fields

**The Problem:** Allowing arbitrary `tone` values means `promptCompiler.js` will silently fall back to defaults or produce malformed prompts.

**The Fix:** Enumerate valid tones. Reject unknown values at the `onboard` and `dashboard/agent` routes before they reach `promptCompiler.js`.

### WARNING: Hardcoded Business Name in Scripts

**The Problem:**
```javascript
// BAD — breaks for every client except one
const script = "Thank you for calling Apex Plumbing. How can I help?";
```
**The Fix:** Always interpolate from `client.business_name`. The multi-tenant architecture means every string the agent speaks must come from client config.