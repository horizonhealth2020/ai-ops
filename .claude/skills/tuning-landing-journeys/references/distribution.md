# Distribution Reference

## Contents
- Distribution surfaces in this backend
- The onboard webhook as distribution entry point
- n8n post-call webhooks as async distribution
- Twilio SMS as distribution channel
- Anti-patterns

---

## Distribution Surfaces

This is a headless backend. Distribution channels are:

| Channel | Entry point | File |
|---------|-------------|------|
| Intake form → onboard webhook | POST /api/v1/onboard | `src/routes/onboard.js` |
| Post-call async workflows | n8n webhook (N8N_WEBHOOK_BASE_URL) | `src/routes/call.js` |
| SMS payment links | Twilio (TWILIO_PHONE_NUMBER) | `src/integrations/twilio.js` |
| Dashboard API | Clerk-authenticated clients | `src/routes/dashboard.js` |

External form tools (Typeform, Tally, n8n forms) submit to `/api/v1/onboard`. This is the primary acquisition funnel entry point.

---

## The Onboard Webhook as Entry Point

The `POST /api/v1/onboard` endpoint is public (no auth) and designed to receive webhooks from form tools or n8n automation. The intake payload is large — 25+ optional fields. Drop-off increases with every required decision.

Current required fields:
```javascript
// src/routes/onboard.js:45
if (!business_name || !business_phone) {
  return res.status(400).json({ error: 'business_name and business_phone are required' });
}
```

Only two fields are required. Everything else has safe defaults. This is correct for minimizing drop-off at intake. The tradeoff: operators onboard with an incomplete agent and need post-onboard nudges to complete setup.

**Minimal viable intake payload:**
```json
{
  "business_name": "Apex Plumbing",
  "business_phone": "+19545550100",
  "vertical": "plumbing",
  "wallet_tier": "standard"
}
```

This creates a live (but generic) agent. The distribution strategy should be: get them in fast, then drive completion via dashboard nudges.

---

## n8n Post-Call Webhooks as Async Distribution

After each call completes (`POST /api/v1/call/complete`), an n8n webhook fires for async processing. This is where follow-up emails, SMS summaries, review requests, and re-engagement flows belong.

```javascript
// src/routes/call.js — n8n webhook fires post-call (approximate pattern)
const n8nUrl = `${process.env.N8N_WEBHOOK_BASE_URL}/call-complete`;
await fetch(n8nUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_id: clientId, call_id: callId, outcome, duration_seconds }),
});
```

Distribution workflows that belong in n8n (not Express):
- Post-booking confirmation SMS to caller
- Low-wallet-balance alert to operator (when `balance_cents < 500`)
- Weekly call summary email to operator
- Booking reminder 24h before appointment

---

## Twilio SMS as Distribution Channel

See the **twilio** skill for implementation. SMS via Twilio is currently used for payment links. It should also be used for:

```javascript
// Pattern: operator low-balance alert
// Trigger: walletService.deductCallCost() when balance falls below threshold
// File: src/services/walletService.js:95

if (wallet.auto_reload_enabled && balanceAfter < (wallet.auto_reload_threshold_cents || 500)) {
  // Currently only logs — should also SMS the operator
  // Add: await twilioClient.sendSms(operatorPhone, `Your AI agent wallet is low ($${(balanceAfter/100).toFixed(2)} remaining). Top up: https://...`);
}
```

---

### WARNING: No Post-Onboard Activation Sequence

**The Problem:**
The onboard endpoint creates the client and returns 201. There is no follow-up mechanism — no email, no SMS, no webhook — to guide the operator through wallet funding and agent testing.

**Why This Breaks:**
Operators who onboard but don't fund their wallet within 48 hours rarely return. The activation window is short and there is no distribution mechanism to reach them.

**The Fix:** Fire an n8n webhook at onboard completion:

```javascript
// src/routes/onboard.js — after promptCompiler.compile()
if (process.env.N8N_WEBHOOK_BASE_URL) {
  fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/client-onboarded`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      business_name,
      business_phone,
      wallet_tier: wallet_tier || 'standard',
      has_integration: !!(integration && integration.credentials),
      has_services: Array.isArray(services) && services.length > 0,
    }),
  }).catch(err => logger.warn('n8n onboard webhook failed', { err: err.message }));
}
```

n8n then handles the activation email/SMS sequence without blocking the onboard response.

---

## Related Skills

- See the **twilio** skill for SMS implementation patterns
- See the **mapping-conversion-events** skill for defining which n8n webhook events to instrument
- See the **framing-release-stories** skill for operator-facing launch communications
