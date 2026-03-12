# Measurement & Testing Reference

## Contents
- Copy Performance Signals
- A/B Testing Agent Scripts
- Wallet Message Effectiveness
- Logging for Copy Iteration
- Anti-Patterns

---

## Copy Performance Signals

Copy effectiveness is measured through call outcomes logged in `POST /api/v1/call/complete`. Track these fields to measure copy performance.

```javascript
// src/routes/call.js — outcome field drives copy measurement
const OUTCOME_VALUES = {
  booked:       'caller converted to appointment',
  transferred:  'caller handed off to human',
  message_only: 'agent degraded — wallet $0',
  abandoned:    'caller hung up without outcome'
};

// Log duration + outcome for every call
logger.info('Call complete', {
  client_id: clientId,
  call_id: callId,
  duration_seconds: duration,
  outcome,           // Use this to measure script effectiveness
  booking_id: bookingId || null
});
```

**Key metrics to track by `client_id`:**
- `booked / total_calls` → booking conversion rate (primary copy metric)
- `abandoned` rate per vertical → measures agent script friction
- `transferred` rate → measures agent's inability to resolve (prompt gap)

## A/B Testing Agent Scripts

Agent scripts are stored in `clients.agent_config` (PostgreSQL). To A/B test, add a `script_variant` field and route to different `promptCompiler.js` branches.

```javascript
// src/services/promptCompiler.js — variant routing
function compileSystemPrompt(client) {
  const variant = client.agent_config.script_variant || 'control';
  const openingLine = OPENING_VARIANTS[variant] || OPENING_VARIANTS.control;

  return [
    compilePersonaBlock(client),
    openingLine,
    compileServicesBlock(client),
    compileSchedulingBlock(client)
  ].join('\n\n');
}

const OPENING_VARIANTS = {
  control:   'Start every call with: "Thanks for calling [business]. How can I help you today?"',
  test_a:    'Start every call with: "Hi! You\'ve reached [business]. What can I do for you?"',
  test_b:    'Start every call with: "Good [time_of_day], this is [agent_name] at [business]."'
};
```

**Assign variants at onboard or via `PUT /api/v1/dashboard/agent`.** Track `booking_rate` per `script_variant` in your analytics layer.

## Wallet Message Effectiveness

Wallet degradation (`message_only` outcome) is a copy failure — the agent couldn't convert because it was muted. Measure it as a leading indicator.

```javascript
// src/services/walletService.js — log every degradation event
async function checkAndDeductBalance(clientId, durationSeconds, tier) {
  const cost = calculateCost(durationSeconds, tier);  // Always in cents
  const balance = await getBalance(clientId);

  if (balance <= 0) {
    logger.warn('Agent degraded to message-only', {
      client_id: clientId,
      balance_cents: balance,
      // This log drives operator re-engagement copy in n8n
    });
    return { allowed: false, reason: 'insufficient_balance' };
  }
  // ...
}
```

The `message_only` log should trigger an n8n sequence that sends the operator a top-up prompt. That sequence's open/click rate measures the urgency copy effectiveness.

## Logging for Copy Iteration

Use structured logs to build a feedback loop between copy changes and outcomes.

```javascript
// src/utils/logger.js pattern — tag copy experiments in logs
logger.info('Booking script delivered', {
  client_id: clientId,
  script_variant: client.agent_config.script_variant,
  call_id: callId,
  // Downstream: join with call.complete outcome to measure variant performance
});
```

**Copy iteration workflow:**

Copy this checklist and track progress:
- [ ] Identify low conversion `client_id` from call logs
- [ ] Read their `clients.agent_config` to review current script
- [ ] Update `script_variant` via `PUT /api/v1/dashboard/agent`
- [ ] Monitor `booked` rate over next 50 calls
- [ ] If improved: promote variant to `control` for that vertical
- [ ] If no improvement: try next variant or audit FSM availability

## Anti-Patterns

### WARNING: Measuring Copy Without Isolating Variables

**The Problem:** Changing the agent script and the FSM integration simultaneously makes it impossible to attribute outcome changes to copy.

**The Fix:** Change one variable per experiment window. Use `script_variant` to tag which script was active, and join against `bookings` table to measure conversion.

### WARNING: Using `console.log` for Copy Experiment Data

**The Problem:**
```javascript
// BAD — unstructured, can't query
console.log('Booking script variant:', variant, 'for client:', clientId);
```
**The Fix:**
```javascript
// GOOD — structured, queryable
logger.info('Script variant active', { client_id: clientId, script_variant: variant, call_id: callId });
```

Unstructured logs can't feed analytics. Every copy experiment event must be a structured JSON log with `client_id`, `script_variant`, and `call_id` so it can be joined against outcomes.

See the **instrumenting-product-metrics** skill for event schema conventions.