# Conversion Optimization Reference

## Contents
- Onboard endpoint friction audit
- Minimum viable activation checklist
- Anti-patterns that kill conversion
- Wallet zero-balance problem
- Prompt compilation failure handling

---

## Onboard Endpoint Friction Audit

`POST /api/v1/onboard` (`src/routes/onboard.js`) accepts 20+ fields but only validates two.
Every optional field that your intake form presents as "required" is a conversion leak.

The actual hard requirements for a working agent:

```javascript
// Minimum to create a functional client record
{
  business_name: 'Apex Plumbing',    // Required — validation in route
  business_phone: '+19545550100',    // Required — must be E.164
  vertical: 'hvac',                  // Defaults to 'general'
  wallet_tier: 'standard',           // Defaults to 'standard'
}
// All other fields default gracefully:
// - hours: Mon-Fri 9-5, voicemail after hours
// - scheduling: 15min buffer, 20 bookings/day, 14-day advance, 60min slots
// - agent_name/voice/greeting: null (promptCompiler handles missing fields)
```

## Minimum Viable Activation Checklist

Copy this checklist for any signup flow audit:

- [ ] Step 1: Collect `business_name` + `business_phone` + `vertical` only
- [ ] Step 2: POST to `/api/v1/onboard` — get `client_id` back
- [ ] Step 3: Verify `system_prompt IS NOT NULL` (promptCompiler ran successfully)
- [ ] Step 4: Show wallet top-up CTA immediately (balance starts at 0)
- [ ] Step 5: Configure Vapi assistant with `client_id` in metadata
- [ ] Step 6: Make first test call — agent should answer with default greeting
- [ ] Step 7 (deferred): Connect FSM integration via dashboard
- [ ] Step 8 (deferred): Customize agent persona, hours, services

---

## WARNING: Presenting All Fields at Signup

**The Problem:**

```javascript
// BAD — intake form that blocks until everything is filled
{
  business_name: required,
  agent_name: required,        // Not needed to activate
  greeting_script: required,   // Not needed to activate
  fsm_credentials: required,   // Definitely not needed to activate
  services: required,          // Not needed to activate
}
```

**Why This Breaks:**
1. Blue-collar operators won't complete a 15-field form — they'll abandon
2. FSM credentials require IT involvement — stalls solo owners
3. You lose the "quick win" moment of a working agent in under 5 minutes

**The Fix:**

```javascript
// GOOD — phase 1 collects only what's needed to POST /api/v1/onboard
{
  business_name: required,
  business_phone: required,
  vertical: required,        // Determines default agent tone
}
// Phase 2 via dashboard after first successful call
```

---

## Wallet Zero-Balance Problem

Every new client starts with `balance_cents = 0` (see `src/routes/onboard.js:145-148`).
The agent immediately falls into message-only mode on the first real call.

```javascript
// src/services/walletService.js — this is what blocks the first call
const isActive = wallet.balance_cents > 0;
// If false: agent says "I can take a message" — not what the operator expected
```

**Convert this into an activation moment, not a silent failure:**

```javascript
// In onboard response — surface the blocker explicitly
res.status(201).json({
  client_id: clientId,
  business_phone,
  status: 'active',
  agent_ready: false,
  activation_required: {
    action: 'fund_wallet',
    message: 'Your agent answers calls but cannot book until your wallet has a balance.',
    minimum_recommended_cents: 2000,  // $20 = ~50 mins at standard rate
  },
});
```

---

## Prompt Compilation Failure Handling

`promptCompiler.compile(clientId)` runs outside the DB transaction (line 154 of `onboard.js`).
If it fails silently, the agent will have a null `system_prompt` and behave unpredictably.

```javascript
// GOOD — surface compile failure in the onboard response
let promptReady = false;
try {
  await promptCompiler.compile(clientId);
  promptReady = true;
} catch (compileErr) {
  logger.error('Prompt compile failed after onboard', { client_id: clientId, error: compileErr.message });
}

res.status(201).json({
  client_id: clientId,
  business_phone,
  status: 'active',
  prompt_ready: promptReady,
});
```

**When to re-trigger compile:** Any `PUT /api/v1/dashboard/agent`, `/dashboard/hours`, or
`/dashboard/scheduling` call already calls `promptCompiler.compile()` — so a failed initial
compile self-heals on first dashboard edit.

---

## Related Skills

- See the **designing-onboarding-paths** skill for activation checklist UX
- See the **instrumenting-product-metrics** skill for tracking onboard-to-active-agent conversion
- See the **crafting-page-messaging** skill for onboard response copy
- See the **structuring-offer-ladders** skill for wallet tier and trial strategy
