# Distribution Reference

## Contents
- Intake form entry points
- n8n webhook integration for signups
- Vapi assistant provisioning after signup
- Twilio SMS activation flow
- Multi-channel onboard triggers

---

## Intake Form Entry Points

`POST /api/v1/onboard` is unauthenticated — it's designed to be called from any trusted source.
This makes it flexible for multiple distribution channels.

```javascript
// src/routes/onboard.js — no auth middleware on this route
router.post('/', async (req, res, next) => {
  // Any trusted caller can trigger onboarding
});

// src/index.js — registered without auth middleware
app.use('/api/v1/onboard', require('./routes/onboard'));
```

Distribution channels and their payload patterns:

| Channel | How it POSTs | Notes |
|---------|-------------|-------|
| n8n workflow | n8n HTTP node → `/api/v1/onboard` | Full payload from form data |
| Typeform webhook | n8n → normalize → `/api/v1/onboard` | Map Typeform fields to API schema |
| Direct API call | Sales rep tool or CRM | Minimal payload, rest deferred |
| Partner integration | White-label intake form | Include `integration` block |

---

## n8n Webhook Integration for Signups

The platform already uses n8n for post-call async workflows. Signups should route through n8n
for field normalization and error recovery before hitting the onboard endpoint.

```javascript
// n8n HTTP Request node — normalize phone to E.164 before sending
const normalizedPayload = {
  business_name: $node["Form"].json.company_name,
  business_phone: $node["Form"].json.phone.replace(/\D/g, '')
    .replace(/^1?(\d{10})$/, '+1$1'),   // Normalize to E.164
  vertical: $node["Form"].json.industry || 'general',
  wallet_tier: $node["Form"].json.plan || 'standard',
};

// POST to /api/v1/onboard
// On success: trigger Vapi provisioning workflow
// On failure: alert via Slack/email, do NOT silently drop
```

**NEVER** let a signup fail silently in n8n. Always add an error branch that notifies the team.

---

## Vapi Assistant Provisioning After Signup

After onboard succeeds, the operator must configure their Vapi assistant with `client_id`.
This is the most common activation gap — operators don't know they need to do this step.

```javascript
// The onboard endpoint returns client_id — this must go into Vapi metadata
// POST /api/v1/onboard response:
{ client_id: 'uuid', business_phone: '+19545550100', status: 'active' }

// Vapi assistant config (done by operator or via Vapi API):
{
  "model": {
    "provider": "custom-llm",
    "url": "https://YOUR_RAILWAY_URL/api/v1/context/inject",
    "metadata": {
      "client_id": "uuid"  // ← This is what connects the call to the client record
    }
  }
}
```

**Automate this step** by calling the Vapi API from n8n after onboard to provision the assistant:

```javascript
// n8n HTTP Request — create Vapi assistant automatically
{
  method: 'POST',
  url: 'https://api.vapi.ai/assistant',
  headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
  body: {
    name: `${business_name} AI Agent`,
    model: {
      provider: 'custom-llm',
      url: `${SERVER_URL}/api/v1/context/inject`,
      metadata: { client_id: clientId },
    },
    phoneNumber: { number: business_phone },
  }
}
```

See the **vapi** skill for full Vapi API patterns.

---

## Twilio SMS Activation Flow

After signup, send an SMS to the operator's phone with their activation link.
Twilio is already wired for payment links — extend it for onboard confirmation.

```javascript
// src/integrations/twilio.js — reuse the existing SMS helper
const { sendSms } = require('../integrations/twilio');

// After successful onboard + Vapi provisioning:
await sendSms({
  to: business_phone,
  body: `Your AI agent is almost ready! Fund your wallet to go live: ${DASHBOARD_URL}/wallet?client=${clientId}`,
});
```

See the **twilio** skill for `sendSms` implementation details.

---

## WARNING: Skipping Vapi Provisioning in the Onboard Flow

**The Problem:**

```javascript
// BAD — onboard completes, returns client_id, operator has no idea what to do with it
res.status(201).json({ client_id: clientId, status: 'active' });
// Operator stares at a UUID with no instructions
```

**Why This Breaks:**
1. The `client_id` is useless without being wired into the Vapi assistant metadata
2. Operators in blue-collar verticals are not developers — they won't figure out Vapi config
3. The activation gap between "onboard complete" and "first call handled" is where 80% of churn starts

**The Fix:**
- Automate Vapi assistant creation from n8n after onboard
- Include the Vapi assistant URL in the onboard confirmation SMS
- Surface a one-click setup link in the onboard response's `next_steps` array

---

## Related Skills

- See the **vapi** skill for Vapi assistant API provisioning
- See the **twilio** skill for SMS send patterns
- See the **mapping-conversion-events** skill for tracking signup channel attribution
