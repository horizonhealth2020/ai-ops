# Distribution Reference

## Contents
- Onboarding Webhook as Acquisition Entry Point
- n8n Post-Call Workflow Distribution
- Twilio SMS as Retention Channel
- Dashboard as Expansion Channel
- Anti-Patterns

## Onboarding Webhook as Acquisition Entry Point

`POST /api/v1/onboard` is the entry point from external intake forms (Typeform, custom landing page, etc.). It creates the client record and seeds initial config. This is where top-of-funnel leads convert to active clients.

```javascript
// src/routes/onboard.js — what happens at acquisition
router.post('/onboard', async (req, res, next) => {
  try {
    const { company_name, phone, vertical, billing_tier } = req.body;
    // Default new clients to 'standard' if no tier specified
    const tier = billing_tier ?? 'standard';

    const clientId = await onboardingService.createClient({
      company_name, phone, vertical, billing_tier: tier,
    });

    // Fire n8n welcome sequence
    await axios.post(`${N8N_WEBHOOK_BASE_URL}/client-onboarded`, {
      client_id: clientId, company_name, vertical, billing_tier: tier,
    });

    res.status(201).json({ client_id: clientId });
  } catch (err) {
    next(err);
  }
});
```

The n8n welcome sequence is the distribution mechanism: sends setup instructions, Vapi configuration guide, and first reload prompt.

## n8n Post-Call Workflow Distribution

Every completed call fires `POST /api/v1/call/complete` which triggers async n8n workflows. These workflows are the primary distribution and retention channel.

```javascript
// src/routes/call.js — fires after every call
const webhooks = [
  `${N8N_WEBHOOK_BASE_URL}/call-completed`,    // CRM update, call log
  `${N8N_WEBHOOK_BASE_URL}/low-balance`,        // Upgrade nudge (conditional)
  `${N8N_WEBHOOK_BASE_URL}/booking-followup`,   // Booking confirmation SMS
];
```

Configure n8n workflows for:
- Booking confirmation to caller (Twilio SMS)
- Weekly call summary to client (email)
- Low-balance reload reminder (SMS/email)

## Twilio SMS as Retention Channel

SMS has the highest open rate for this ICP (blue-collar business owners). Three distribution moments:

| Trigger | Message Type | Outcome |
|---------|-------------|---------|
| Booking confirmed | Confirmation SMS to caller | Trust + repeat calls |
| Balance < 5 min | Reload reminder to owner | Wallet refill |
| Balance = $0 | Urgent reload to owner | Churn prevention |

```javascript
// src/integrations/twilio.js — all SMS send through single function
async function sendSMS(to, body) {
  return twilioClient.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to,   // E.164 format — +1XXXXXXXXXX
    body, // Keep under 160 chars
  });
}
```

See the **twilio** skill for rate limits and error handling.

## Dashboard as Expansion Channel

The Clerk-protected dashboard (`/api/v1/dashboard/*`) is the self-serve expansion surface. Clients who engage with their dashboard (checking call logs, reviewing wallet) have higher LTV.

```javascript
// GET /api/v1/dashboard/calls — high engagement signal
// If a client checks this endpoint > 3x/week, they're prime for upgrade outreach
// Log access patterns in call_logs for n8n to query
```

See the **clerk** skill for JWT verification on dashboard routes.

## Anti-Patterns

### WARNING: Treating Onboard as One-Time Fire-and-Forget

**The Problem:** Creating the client record in `POST /api/v1/onboard` and doing nothing else.

**Why This Fails:** New clients who don't configure Vapi within 48 hours almost never activate. The onboard webhook to n8n must trigger a multi-step setup sequence, not just a welcome email.

**The Fix:** n8n onboarded workflow should include:
1. Immediate: Welcome email with Vapi setup instructions
2. +24h: "Did you connect your phone number?" check
3. +48h: "Book a setup call" offer if no calls received yet

### WARNING: Sending SMS Without E.164 Validation

**The Problem:**
```javascript
// BAD — Twilio rejects non-E.164 numbers silently
await sendSMS('9545550100', message); // missing +1
```

**The Fix:** Always validate/format before sending. `src/utils/formatters.js` has `formatPhone()` — use it.
