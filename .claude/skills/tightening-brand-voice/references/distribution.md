# Distribution Reference

## Contents
- Twilio SMS Distribution
- n8n Post-Call Webhook Payloads
- Onboarding Email Triggers
- Vapi Callback Copy
- Anti-Patterns

---

## Twilio SMS Distribution

SMS is the primary distribution channel for payment links and booking confirmations. All sends go through `src/integrations/twilio.js`.

```javascript
// src/integrations/twilio.js — standard send wrapper
async function sendSMS(to, body) {
  // Validate E.164 format before send — never assume
  if (!/^\+1\d{10}$/.test(to)) {
    throw Object.assign(new Error('Invalid phone format'), { code: 'INVALID_PHONE' });
  }
  return twilioClient.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
    body
  });
}
```

**Distribution use cases in this codebase:**

| Trigger | Route | Copy Goal |
|---------|-------|-----------|
| Payment intent created | `/api/v1/payment/create-intent` | Urgency + link |
| Booking confirmed | `/api/v1/booking/create` | Confirmation + date/time |
| Wallet low balance | `walletService.js` | Operator alert, top-up CTA |

## n8n Post-Call Webhook Payloads

After each call, `POST /api/v1/call/complete` fires an n8n webhook for async workflows (follow-up emails, CRM sync). The payload shape determines what n8n can use for personalized messaging.

```javascript
// src/routes/call.js — webhook payload for n8n
const webhookPayload = {
  event: 'call.complete',
  client_id: clientId,
  call_id: callId,
  caller_phone: callerPhone,
  duration_seconds: duration,
  booking_id: bookingId || null,
  payment_intent_id: paymentIntentId || null,
  outcome: outcome  // 'booked' | 'transferred' | 'message_only' | 'abandoned'
};

await axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/call-complete`, webhookPayload);
```

**n8n copy decisions based on `outcome`:**
- `booked` → confirmation email with appointment details
- `message_only` → follow-up from team (wallet was $0)
- `abandoned` → win-back sequence
- `transferred` → notify receiving team with context

## Onboarding Email Triggers

`POST /api/v1/onboard` should fire an n8n webhook that triggers the welcome email sequence.

```javascript
// src/routes/onboard.js — fire onboarding webhook after client creation
const onboardPayload = {
  event: 'client.onboarded',
  client_id: newClient.id,
  business_name: newClient.business_name,
  contact_email: req.body.contact_email,
  vertical: newClient.vertical,
  agent_phone: newClient.phone_number
};

await axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/client-onboarded`, onboardPayload);
```

**Welcome sequence copy beats (in n8n, not in this codebase):**
1. Immediate: "Your agent is live — test it at [phone]"
2. Day 1: Setup checklist (Vapi config, FSM connection)
3. Day 3: First call review prompt

## Vapi Callback Copy

When Vapi delivers the SSE response from `/api/v1/context/inject`, the streamed content is what the caller hears. The final token of every response should be a soft close or next-step question.

```javascript
// src/routes/vapi.js — ensure every streamed response ends with engagement
// The promptBuilder appends this to every context injection
const CALL_ENGAGEMENT_SUFFIX = ' Is there anything else I can help you with today?';
// Omit only when agent is mid-booking flow (caller has already committed)
```

## Anti-Patterns

### WARNING: Sending SMS Without E.164 Validation

**The Problem:** Twilio will throw a 400 if the number isn't E.164. Without pre-validation, the error propagates to the caller's live call.

**The Fix:** Validate in `formatters.js` before any SMS send. See `src/utils/formatters.js` for the canonical phone formatter.

### WARNING: Hardcoded n8n Webhook URLs

**The Problem:**
```javascript
// BAD — breaks on environment change
await axios.post('https://n8n.myserver.com/webhook/call-complete', payload);
```
**The Fix:** Always use `process.env.N8N_WEBHOOK_BASE_URL`. If the env var is missing, log a warning and skip — never block the call completion flow on a webhook failure.

```javascript
// GOOD — non-blocking with graceful skip
if (process.env.N8N_WEBHOOK_BASE_URL) {
  axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/call-complete`, webhookPayload)
    .catch(err => logger.warn('n8n webhook failed', { err: err.message }));
}
```

See the **twilio** skill for SMS rate limits and error handling patterns.