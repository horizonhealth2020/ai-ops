# Twilio Patterns Reference

## Contents
- Lazy Client Initialization
- E.164 Phone Number Enforcement
- Multi-Tenant Safety
- Anti-Patterns
- Error Handling

---

## Lazy Client Initialization

The Twilio client is created on first use, not at module load time. This means the server starts successfully even when `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are not set — environments without SMS configured degrade gracefully.

```javascript
// src/integrations/twilio.js — current pattern
let twilioClient = null;

function getClient() {
  if (!twilioClient && env.twilioAccountSid && env.twilioAuthToken) {
    const twilio = require('twilio');
    twilioClient = twilio(env.twilioAccountSid, env.twilioAuthToken);
  }
  return twilioClient;  // null when unconfigured
}

async function sendSms(to, body) {
  const client = getClient();
  if (!client) {
    logger.warn('Twilio not configured, SMS not sent', { to });
    return null;  // caller must handle null
  }
  // ...
}
```

**Why this works:** `require('twilio')` only executes when credentials exist, so the module doesn't fail to load if the package is present but env vars are absent.

---

## E.164 Phone Number Enforcement

ALWAYS pass E.164 format (`+1XXXXXXXXXX`) to Twilio. This is enforced by CLAUDE.md as a project-wide convention. Raw phone numbers will cause Twilio to throw `21211 - Invalid 'To' Phone Number`.

```javascript
// GOOD — use formatters.js to normalize before calling Twilio
const { formatPhone } = require('../utils/formatters');

const normalizedPhone = formatPhone(rawPhone); // ensures +1XXXXXXXXXX
await sendSms(normalizedPhone, message);
```

```javascript
// BAD — passing unvalidated user input directly
await sendSms(req.body.phone, message); // may be "9545550100" — will fail
```

If `formatters.js` doesn't yet normalize to E.164, do it inline:

```javascript
function toE164(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
}
```

---

## Multi-Tenant Safety

Twilio is a **platform-level** integration — one account/phone number serves all tenants. NEVER store per-client Twilio credentials. The `TWILIO_PHONE_NUMBER` in env is the single outbound number for the entire platform.

```javascript
// GOOD — platform credentials from env, only `to` is tenant-specific
const message = await client.messages.create({
  from: env.twilioPhoneNumber,   // platform number
  to,                             // caller's phone (tenant data)
  body,
});
```

```javascript
// BAD — attempting per-client Twilio credentials
const credentials = await getClientCredentials(clientId, 'twilio'); // WRONG
const client = twilio(credentials.sid, credentials.token);          // Don't do this
```

Contrast with Stripe/Square which ARE per-client. See the **stripe** skill for per-client credential loading via `client_integrations`.

---

## WARNING: Swallowing vs. Propagating Errors

### The Problem

```javascript
// BAD — SMS failure crashes the payment response
const result = await createPaymentIntent(clientId, params);
await sendPaymentLink(callerPhone, result.payment_link, description); // throws → 500
res.json(result); // never reached
```

**Why This Breaks:**
1. The customer already has a payment intent created in Stripe/Square — charging twice on retry
2. The AI agent gets a 500 and may loop or give a confused response during a live call
3. Twilio outages (not rare) brick all payment flows

### The Fix

```javascript
// GOOD — from src/services/paymentService.js
if (params.caller_phone && paymentResult.payment_link) {
  try {
    await sendPaymentLink(params.caller_phone, paymentResult.payment_link, params.description);
  } catch (err) {
    logger.warn('Failed to send payment SMS', { error: err.message });
    // SMS is best-effort — payment still succeeded
  }
}

return {
  payment_id: paymentResult.payment_id,
  payment_link: paymentResult.payment_link,  // agent can still read the URL
  processor,
};
```

**When You Might Be Tempted:** Adding SMS to a critical-path booking confirmation and wanting to know if it failed. Log the warning; alert on elevated Twilio error rates in your monitoring instead.

---

## WARNING: Logging PII in SMS Errors

### The Problem

```javascript
// BAD — logs the full phone number in error output
logger.error('SMS failed', { to: callerPhone, body, error: err.message });
```

**Why This Breaks:** Call logs are often stored in PostgreSQL and may appear in Railway log streams, exposing customer phone numbers in cleartext logs.

### The Fix

```javascript
// GOOD — log only what's needed for debugging
logger.warn('Failed to send payment SMS', {
  client_id: clientId,
  error: err.message,
  // omit `to` and `body`
});
```

---

## Checking Configuration Status

Use this guard when building features that conditionally show SMS options:

```javascript
// In a service or route that needs to know if SMS is available
function isSmsEnabled() {
  return !!(
    env.twilioAccountSid &&
    env.twilioAuthToken &&
    env.twilioPhoneNumber
  );
}
```

See the **node** skill for environment variable validation patterns in `src/config/env.js`.
