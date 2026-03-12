# Distribution Reference

## Contents
- Distribution Channels in This Platform
- n8n Async Webhook Patterns
- Twilio SMS Distribution
- Anti-patterns
- Checklist: Adding a New Distribution Trigger

---

## Distribution Channels in This Platform

This backend distributes conversion signals through two channels:

| Channel | Mechanism | Timing | Use Case |
|---------|-----------|--------|----------|
| n8n webhooks | HTTP POST to `N8N_WEBHOOK_BASE_URL` | Async, post-call | Follow-up emails, CRM sync, wallet reload reminders |
| Twilio SMS | `twilio.js` integration | Sync, during call | Payment links, booking confirmations |

There is no email provider wired directly. Email goes through n8n workflows triggered by backend events.

---

## n8n Async Webhook Patterns

### Trigger after call completion

```javascript
// src/routes/call.js — fire n8n after logging
const N8N_CALL_COMPLETE_WEBHOOK = `${process.env.N8N_WEBHOOK_BASE_URL}/call-complete`;

router.post('/complete', async (req, res, next) => {
  try {
    // ... log to DB, deduct wallet ...

    // Async — don't await, don't block response
    fetch(N8N_CALL_COMPLETE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        call_id: callId,
        outcome,
        duration_seconds: duration,
        charged_cents: chargedCents,
      }),
    }).catch(err => logger.error('n8n_webhook_failed', { error: err.message }));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

**Critical:** Never `await` the n8n webhook call during a live call path. Failure must be logged but must not fail the response.

### Trigger on booking confirm

```javascript
// src/services/bookingService.js
const payload = {
  client_id: clientId,
  booking_id: newBooking.booking_id,
  customer_phone: callerPhone,
  slot_date: date,
  slot_time: time,
  fsm_job_id: fsmJobId,
};

fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/booking-confirmed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}).catch(err => logger.error('n8n_booking_webhook_failed', { error: err.message, client_id: clientId }));
```

---

## Twilio SMS Distribution

### Payment link SMS (sync — during call)

This fires synchronously because the caller is waiting for the payment link URL.

```javascript
// src/integrations/twilio.js
async function sendPaymentLink(toPhone, paymentUrl, amountDollars, serviceType) {
  const body = `Pay $${amountDollars} for your ${serviceType} appointment: ${paymentUrl}`;

  const message = await twilioClient.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: toPhone,
  });

  logger.info('payment_sms_sent', { to: toPhone, sid: message.sid });
  return message.sid;
}
```

Keep `body` under 160 characters. Every multi-part SMS fragment adds cost and delivery latency.

---

## Anti-patterns

### WARNING: Awaiting n8n webhook in live call path

**The Problem:**
```javascript
// BAD — blocks call response on external service
await fetch(N8N_WEBHOOK_URL, { method: 'POST', body: JSON.stringify(data) });
res.json({ success: true });
```

**Why This Breaks:**
1. n8n latency (~200–500ms) adds to every call completion response
2. If n8n is down, the call completion route returns 500 — the call log is lost
3. Railway request timeout (30s) can be hit if n8n is slow

**The Fix:**
```javascript
// GOOD — fire and forget with error logging only
fetch(N8N_WEBHOOK_URL, { method: 'POST', body: JSON.stringify(data) })
  .catch(err => logger.error('n8n_webhook_failed', { error: err.message }));
res.json({ success: true });
```

### WARNING: Missing `client_id` in n8n payload

**The Problem:**
```javascript
// BAD — n8n can't route to the correct client workflow
fetch(N8N_URL, { body: JSON.stringify({ outcome, duration }) });
```

**Why This Breaks:**
1. n8n is multi-tenant — it needs `client_id` to look up the right operator config
2. Wallet reload reminders go to the wrong client or fail silently

---

## Checklist: Adding a New Distribution Trigger

Copy this checklist when wiring a new conversion event to n8n or Twilio:

- [ ] Identify the route where the event fires (`src/routes/*.js` or `src/services/*.js`)
- [ ] Define the payload shape (always include `client_id`)
- [ ] Add `fetch()` call — fire-and-forget with `.catch()` error logging
- [ ] Add `logger.info('event_name', { client_id, ... })` before the fetch
- [ ] Test that route still returns correctly if `N8N_WEBHOOK_BASE_URL` is unset
- [ ] Document the new webhook in `.env.example` if it needs a new env var

See the **twilio** skill for SMS sending patterns and character limit constraints.
See the **node** skill for fire-and-forget async patterns in Express route handlers.
