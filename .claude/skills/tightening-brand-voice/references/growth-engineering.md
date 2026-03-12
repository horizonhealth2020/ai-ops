# Growth Engineering Reference

## Contents
- Returning Caller Recognition Copy
- Referral Hooks in Call Scripts
- Vertical Expansion Copy Patterns
- Onboarding Activation Copy
- Anti-Patterns

---

## Returning Caller Recognition Copy

`src/services/callerMemory.js` looks up call history by phone number. When a returning caller is detected, the agent can personalize — this is the highest-leverage copy opportunity in the platform.

```javascript
// src/services/callerMemory.js — returning caller context injected into prompt
async function getCallerContext(clientId, callerPhone) {
  const history = await pool.query(
    'SELECT service_requested, booked_at FROM call_logs ' +
    'WHERE client_id = $1 AND caller_phone = $2 ORDER BY booked_at DESC LIMIT 3',
    [clientId, callerPhone]
  );

  if (history.rows.length === 0) return null;

  const lastService = history.rows[0].service_requested;
  return `This caller has contacted us before. Their last service was: ${lastService}. ` +
    `Greet them warmly as a returning customer and ask if they need the same service again.`;
}
```

**Growth impact:** Personalized returning-caller greetings reduce time-to-booking by removing service selection friction. Callers who hear their name or last service mentioned book at higher rates.

## Referral Hooks in Call Scripts

After a successful booking, the agent can plant a referral seed. This is injected via `promptBuilder.js` when `outcome === 'booked'`.

```javascript
// src/services/promptBuilder.js — post-booking referral hook
function appendReferralHook(client) {
  if (!client.agent_config.referral_enabled) return '';
  return `After confirming the booking, say: "By the way, if you know anyone who needs ` +
    `${client.vertical} help, we'd love the referral — we take great care of our customers' friends."`;
}
```

Add `referral_enabled` boolean to `clients.agent_config` JSON column. No schema migration needed.

## Vertical Expansion Copy Patterns

When adding a new vertical (e.g., restaurant, cleaning), the `promptCompiler.js` services block needs vertical-specific copy.

```javascript
// src/services/promptCompiler.js — vertical-aware services block
const VERTICAL_SERVICES_COPY = {
  hvac:       'heating, cooling, and ventilation services',
  plumbing:   'pipe repair, drain cleaning, and water heater service',
  electrical: 'wiring, panel upgrades, and outlet installation',
  spa:        'massages, facials, and wellness treatments',
  cleaning:   'residential and commercial cleaning services',
  restaurant: 'reservations, catering inquiries, and event bookings'
};

function compileServicesBlock(client) {
  const servicesCopy = VERTICAL_SERVICES_COPY[client.vertical] || 'services';
  return `You help callers with ${servicesCopy}. ` +
    `Only offer services listed in the knowledge base below.`;
}
```

Add new verticals here and in the seed data. See `seeds/demo_clients.sql` for examples.

## Onboarding Activation Copy

The moment between signup and first successful call is where clients churn. The onboard response and follow-up webhook payload must drive activation.

```javascript
// src/routes/onboard.js — activation-focused response
res.status(201).json({
  success: true,
  client_id: newClient.id,
  agent_phone: newClient.phone_number,
  message: `Your agent is live. Call ${newClient.phone_number} right now to test it.`,
  setup_remaining: [
    'Connect your FSM (HouseCall Pro / Jobber / ServiceTitan)',
    'Set your business hours in the dashboard',
    'Add your FAQs to improve answer accuracy'
  ]
});
```

**Activation copy rules:**
1. Always surface the agent's phone number — it's the "aha moment"
2. Provide a numbered checklist, not a paragraph
3. "Right now" beats "when you're ready" — urgency drives activation

## Anti-Patterns

### WARNING: Generic Welcome Messages

**The Problem:**
```javascript
// BAD — no personalization, no urgency
res.json({ message: 'Welcome to AI Ops! Your account has been created.' });
```
**Why This Fails:** Clients don't know their agent is actually live. First call test rate drops. Churn increases if operators don't hear the agent working within 24 hours.

**The Fix:** Surface the phone number and say "call it now" in the onboard response.

### WARNING: Missing Vertical Context in Returning-Caller Script

**The Problem:** A returning caller who got HVAC service last time and now needs plumbing will get confused if the agent asks "Would you like to schedule another HVAC appointment?"

**The Fix:** Include service category in the returning-caller context string, and instruct the agent to confirm before assuming the same service.

```javascript
return `Returning customer. Last service: ${lastService}. ` +
  `Ask if they need the same service or something different before proceeding.`;
```

See the **orchestrating-feature-adoption** skill for post-activation feature rollout patterns.