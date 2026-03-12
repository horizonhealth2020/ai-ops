# Twilio Workflows Reference

## Contents
- Payment Link SMS Flow
- Adding a New SMS Notification Type
- Booking Confirmation Notification
- Testing Without Real SMS
- Debugging Delivery Failures

---

## Payment Link SMS Flow

This is the only current Twilio workflow. It runs during a live Vapi call after a payment intent is created.

```
POST /api/v1/payment/create-intent
  └─ paymentService.createPayment()
       ├─ getPaymentProcessor() → 'stripe' | 'square'
       ├─ stripeIntegration.createPaymentIntent() | squareIntegration.createPaymentIntent()
       │    └─ returns { payment_id, payment_link }
       └─ sendPaymentLink(caller_phone, payment_link, description)  ← Twilio here
            └─ sendSms(to, "Here's your payment link for {description}: {url}")
```

The SMS fires only when both `caller_phone` and `payment_link` are present. If Twilio fails, the payment result still returns to the Vapi agent — the agent can read the URL aloud or repeat it.

---

## Adding a New SMS Notification Type

**Checklist:**

- [ ] Step 1: Add function to `src/integrations/twilio.js`
- [ ] Step 2: Export the new function
- [ ] Step 3: Import and call from the relevant service (not from a route directly)
- [ ] Step 4: Wrap in try/catch, log warn on failure — never propagate
- [ ] Step 5: Verify phone is E.164 before passing to Twilio

**Example — booking confirmation:**

```javascript
// Step 1 & 2: src/integrations/twilio.js
async function sendBookingConfirmation(to, { date, time, service, clientName }) {
  return sendSms(
    to,
    `${clientName} confirmed: ${service} on ${date} at ${time}. Reply STOP to opt out.`
  );
}

module.exports = { sendSms, sendPaymentLink, sendBookingConfirmation };
```

```javascript
// Step 3 & 4: src/services/bookingService.js (after writing to PostgreSQL)
const { sendBookingConfirmation } = require('../integrations/twilio');

async function createBooking(clientId, bookingData) {
  // ... FSM verify, PostgreSQL write ...

  if (bookingData.caller_phone) {
    try {
      await sendBookingConfirmation(bookingData.caller_phone, {
        date: bookingData.date,
        time: bookingData.time,
        service: bookingData.service_type,
        clientName: client.company_name,
      });
    } catch (err) {
      logger.warn('Booking SMS failed', { client_id: clientId, error: err.message });
    }
  }

  return booking;
}
```

See the **express** skill for route handler patterns, and **postgresql** skill for the booking write.

---

## n8n Post-Call Notifications

For non-real-time SMS (reminders, follow-ups, review requests), trigger via n8n webhook rather than calling Twilio directly from Express. This keeps the real-time call path fast and allows retries and scheduling.

```javascript
// src/services/callService.js — after call completes
const axios = require('axios');

async function firePostCallWebhook(clientId, callData) {
  if (!env.n8nWebhookBaseUrl) return;

  await axios.post(`${env.n8nWebhookBaseUrl}/call-complete`, {
    client_id: clientId,
    caller_phone: callData.callerPhone,
    call_summary: callData.summary,
    booking_id: callData.bookingId,
  });
  // n8n workflow handles: reminder SMS at T-24h, review request at T+2h, etc.
}
```

**Rule:** If the SMS doesn't need to fire during the live call → use n8n. Only use direct Twilio for in-call moments (payment links, immediate confirmations the agent references in the same turn).

---

## Testing Without Real SMS

Set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` to empty strings. The `getClient()` function returns `null`, `sendSms()` logs a warning and returns `null`. No errors thrown, no actual SMS sent.

```bash
# .env for local development
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

For integration tests that need to assert SMS was attempted, mock the module:

```javascript
// In test file (Jest)
jest.mock('../src/integrations/twilio', () => ({
  sendSms: jest.fn().mockResolvedValue({ sid: 'SMtest123' }),
  sendPaymentLink: jest.fn().mockResolvedValue({ sid: 'SMtest123' }),
}));

const { sendPaymentLink } = require('../src/integrations/twilio');

// After calling paymentService.createPayment(...)
expect(sendPaymentLink).toHaveBeenCalledWith(
  '+19545550100',
  expect.stringContaining('https://'),
  'AC repair service'
);
```

---

## Debugging Delivery Failures

**Twilio error codes to know:**

| Code | Meaning | Fix |
|------|---------|-----|
| 21211 | Invalid `To` number | Phone not in E.164 format |
| 21608 | Unverified number (trial) | Verify recipient in Twilio console, or upgrade account |
| 21614 | Not a mobile number | Landlines can't receive SMS — skip gracefully |
| 30008 | Unknown carrier error | Transient; log and continue |

**Adding error code context to logs:**

```javascript
async function sendSms(to, body) {
  const client = getClient();
  if (!client) {
    logger.warn('Twilio not configured, SMS not sent', { to });
    return null;
  }

  try {
    const message = await client.messages.create({ from: env.twilioPhoneNumber, to, body });
    return { sid: message.sid };
  } catch (err) {
    // Twilio errors have a `code` property
    logger.warn('Twilio SMS failed', { to, code: err.code, message: err.message });
    throw err;  // re-throw so caller's try/catch can decide to swallow or not
  }
}
```

**Why re-throw here:** The `sendSms` function shouldn't make the swallow/propagate decision — that belongs to the caller (`paymentService`, `bookingService`). This keeps `twilio.js` a dumb transport layer.
