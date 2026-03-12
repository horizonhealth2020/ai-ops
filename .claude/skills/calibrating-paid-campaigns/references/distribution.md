# Distribution Reference

## Contents
- Channel Selection by Vertical
- API Surfaces for Paid Channel Integration
- n8n Webhook as Distribution Bridge
- Anti-Patterns
- Twilio SMS as Retargeting Surface

---

## Channel Selection by Vertical

No pixels are installed in this repo. Distribution channel selection maps to the `vertical` field in `POST /api/v1/onboard`. Different verticals convert on different channels:

| Vertical | Best Paid Channel | Why |
|----------|-----------------|-----|
| `hvac` | Google Search | High-intent ("HVAC answering service"), seasonal demand spikes |
| `plumbing` | Google Search + LSA | Emergency intent, Local Services Ads show call button |
| `spa` | Meta/Instagram | Visual, female 25–55 demo, retargetable audience |
| `electrical` | Google Search | Commercial clients search by need, not browse |
| `cleaning` | Meta + Google | Recurring service, demographic targeting works |
| `restaurant` | Meta | Highly visual, local radius targeting |

This vertical-to-channel mapping should inform how you structure separate onboard campaigns — one ad set per vertical with distinct UTM campaigns.

---

## API Surfaces for Paid Channel Integration

### Onboard as Primary Landing Surface

The `POST /api/v1/onboard` endpoint is the conversion action that all paid campaigns should point to. Structure your campaign with:

```
Ad → Landing Page → Form submit → POST /api/v1/onboard
                                        ↓
                               Returns { client_id, next_step }
                                        ↓
                               Redirect to wallet top-up
                                        ↓
                               Wallet top-up = revenue conversion
```

Pass all channel context through the onboard payload:

```javascript
// Landing page form sends:
{
  business_name: 'Apex HVAC',
  phone: '+19545550100',
  vertical: 'hvac',
  billing_tier: 'growth',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'hvac-emergency-dispatch',
  utm_content: 'responsive-search-ad-v2'
}
```

### Health Endpoint for Uptime Monitoring

If your ad campaigns drive significant traffic, monitor Railway uptime. The `/health` endpoint is unauthenticated and returns PG + Redis status:

```bash
curl https://YOUR_RAILWAY_URL/health
# { "status": "ok", "pg": true, "redis": true }
```

Wire this into UptimeRobot or a paid monitoring service. Paid traffic hitting a down server is pure wasted spend.

---

## n8n Webhook as Distribution Bridge

n8n is already wired for post-call async workflows. Use it as the bridge between this API and ad platforms that support server-to-server conversion APIs:

```javascript
// src/routes/call.js — POST /api/v1/call/complete
// Fire n8n → Meta CAPI or Google Ads offline conversion
await fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/paid-conversion`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event: 'first_call_completed',
    client_id: clientId,
    utm_source: client.utm_source,
    utm_campaign: client.utm_campaign,
    call_duration_seconds: callDuration,
    wallet_balance_cents: newBalance,
    // Hashed PII for CAPI matching
    phone_hash: crypto.createHash('sha256').update(normalizedPhone).digest('hex')
  })
});
```

In n8n, create a workflow that receives this and fires the appropriate platform API (Meta CAPI, Google Ads Offline Conversions, etc.).

---

## WARNING: Sending Raw PII to Ad Platforms

**The Problem:**

```javascript
// BAD - raw phone/email in conversion payload
body: JSON.stringify({
  phone: client.phone,
  email: client.email,
  ...
})
```

**Why This Breaks:**
1. GDPR/CCPA violation — PII must be hashed before leaving your system
2. Meta and Google both require SHA-256 hashing for CAPI/enhanced conversions
3. Sends customer data in plaintext over the wire to third-party systems

**The Fix:**

```javascript
// GOOD - hash before sending
const crypto = require('crypto');

function hashForCAPI(value) {
  return crypto.createHash('sha256')
    .update(value.trim().toLowerCase())
    .digest('hex');
}

body: JSON.stringify({
  user_data: {
    ph: hashForCAPI(client.phone.replace('+1', '')),
    em: client.email ? hashForCAPI(client.email) : undefined
  }
})
```

---

## Twilio SMS as Retargeting Surface

The `twilio.js` integration already sends payment link SMS. Extend this for paid campaign retargeting — specifically for leads who onboarded but never topped up their wallet:

```javascript
// src/services/walletService.js — new helper
async function sendWalletActivationSMS(clientId) {
  const client = await getClientById(clientId);
  if (client.wallet_balance_cents === 0 && client.utm_source) {
    await twilioClient.messages.create({
      to: client.phone,
      from: process.env.TWILIO_PHONE_NUMBER,
      body: `Your AI agent for ${client.business_name} is ready. Add $20 to activate it: ${process.env.DASHBOARD_URL}/wallet?client_id=${clientId}`
    });
  }
}
```

Trigger this via n8n on a 1-hour delay after onboard if `wallet_balance_cents === 0`. See the **twilio** skill for SMS patterns.
