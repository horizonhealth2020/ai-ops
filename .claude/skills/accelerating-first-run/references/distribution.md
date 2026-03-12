# Distribution Reference

## Contents
- How new clients reach the platform
- n8n as the distribution layer
- Onboarding intake as a conversion surface
- Multi-vertical distribution patterns

---

## How New Clients Reach the Platform

`POST /api/v1/onboard` has no auth — it's designed to be called by trusted internal
systems. In practice, distribution paths are:

1. **n8n webhook** — external intake form (Typeform, Jotform, custom) POSTs to n8n,
   which normalizes the payload and calls `POST /api/v1/onboard`
2. **Direct integration** — a sales or CRM system calls the endpoint after a deal closes
3. **Manual seeding** — `scripts/seed.js` for demo/test clients

The platform has no self-serve signup UI — all acquisition is sales-assisted or
form-gated, which is normal for a B2B SaaS targeting non-technical operators.

---

## n8n as the Distribution Layer

The `N8N_WEBHOOK_BASE_URL` env var connects this backend to async workflows. Distribution
events to send from Express routes to n8n:

```javascript
// src/utils/n8nWebhook.js — helper to fire async distribution events
'use strict';

const logger = require('./logger');

async function fireWebhook(event, payload) {
  const base = process.env.N8N_WEBHOOK_BASE_URL;
  if (!base) return;

  try {
    await fetch(`${base}/webhook/${event}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Never block the main flow for webhook failures
    logger.warn('n8n webhook failed', { event, err: err.message });
  }
}

module.exports = { fireWebhook };
```

**Fire from `onboard.js` after client creation:**

```javascript
// After promptCompiler.compile(clientId)
const { fireWebhook } = require('../utils/n8nWebhook');
await fireWebhook('client-onboarded', {
  client_id: clientId,
  business_name,
  business_phone,
  vertical: vertical || 'general',
  wallet_tier: wallet_tier || 'standard',
});
```

This enables n8n to send a welcome email, notify the sales team, or trigger an onboarding
sequence in a CRM — without blocking the 201 response.

---

## Onboarding Intake as a Conversion Surface

The onboard payload shape is the intake form schema. Reducing required fields shortens
form completion time and increases submission rates.

**Minimum required fields (already validated in `onboard.js`):**

```javascript
// Only these two are validated today
if (!business_name || !business_phone) {
  return res.status(400).json({ error: 'business_name and business_phone are required' });
}
```

**Progressive onboarding pattern** — collect minimums at signup, rest later:

```javascript
// Phase 1: Accept just the minimum, create the record
// Phase 2: Client completes config via PUT /api/v1/dashboard/agent etc.
// Trigger re-compile on every dashboard update (already done in dashboard.js)
await promptCompiler.compile(req.clientId);
```

Every `PUT /api/v1/dashboard/*` already recompiles the prompt, so progressive setup
works without any architectural changes.

---

## Multi-Vertical Distribution Patterns

Each vertical has different acquisition channels. The `vertical` field in the onboard
payload drives the opening line of the system prompt in `promptCompiler.js`.

| Vertical | Typical Acquisition Path | Key Onboard Fields to Pre-fill |
|---|---|---|
| `hvac` | HVAC trade association partner | `service_area`, `transfer_phone` |
| `plumbing` | Plumber directory / Yelp lead form | `after_hours_behavior` |
| `spa` | Beauty industry SaaS partner | `agent_voice`, `tone_tags` |
| `electrical` | Electrical contractor network | `calls_to_reject` |
| `restaurant` | POS system integration | `hours`, `greeting_script` |

Pre-filling vertical-specific defaults in the intake form reduces setup time and improves
first-call quality.

---

### WARNING: Blocking the 201 Response with n8n Calls

**The Problem:**

```javascript
// BAD — awaiting n8n in the main request flow
await fetch(`${N8N_BASE}/webhook/client-onboarded`, { method: 'POST', ... });
res.status(201).json({ client_id: clientId });
```

**Why This Breaks:**
1. If n8n is down, the entire onboard fails — client never gets their `client_id`
2. n8n can be slow (cold start, queue depth); adds 1-5s to a response that should be <500ms
3. The client's creation is already committed in PostgreSQL — n8n failure should never roll it back

**The Fix:**
Always fire n8n webhooks with `.catch()` or in a fire-and-forget pattern. Never `await`
them in the request path. See the `fireWebhook` helper above.

---

## Related Skills

- See the **vapi** skill for connecting onboarded clients to Vapi assistants
- See the **twilio** skill for SMS distribution of payment links post-booking
- See the **framing-release-stories** skill for communicating new vertical support launches
