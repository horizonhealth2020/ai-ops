# Distribution Reference

## Contents
- Distribution Channels Available in This Stack
- SMS via Twilio (Primary Channel)
- n8n Webhook Async Distribution
- Dashboard In-App Announcements
- WARNING: Email-Only Distribution

---

## Distribution Channels Available in This Stack

This platform has three built-in distribution channels for release announcements:

| Channel | Integration | Latency | Best for |
|---------|-------------|---------|----------|
| SMS | Twilio (`src/integrations/twilio.js`) | Immediate | Wallet alerts, critical changes |
| In-app | Dashboard routes (`src/routes/dashboard.js`) | On next login | Feature announcements |
| Async webhook | n8n (`N8N_WEBHOOK_BASE_URL`) | Minutes | Post-call notifications, batch comms |

No email integration exists in `package.json` — there is no nodemailer, sendgrid, or similar.
**Do not plan email-based release distribution without first adding an email integration.**

---

## SMS via Twilio (Primary Channel)

Twilio is already wired for payment link SMS (`src/integrations/twilio.js`). The same
infrastructure can distribute release announcements to all active clients.

```javascript
// src/integrations/twilio.js — existing SMS send pattern
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendSms(to, body) {
  return client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to,    // E.164 format: +1XXXXXXXXXX
    body,  // 160 chars max for single SMS
  });
}
```

**Release announcement SMS template (160 chars max):**
```
AI Ops update: [Feature name] is live. [One-line benefit]. Details: Dashboard → [Section]. Reply STOP to opt out.
```

**Batch announcement pattern (iterate over active clients):**
```javascript
// Pseudocode — adapt into a one-off script or n8n workflow
const clients = await pool.query(
  "SELECT phone, client_id FROM clients WHERE is_active = true"
);

for (const client of clients.rows) {
  await sendSms(client.phone, SMS_BODY);
  // IMPORTANT: add delay between sends — Twilio rate limits at ~1 msg/sec
  await new Promise(r => setTimeout(r, 1100));
}
```

**SMS distribution checklist:**
- [ ] Copy is 160 chars or under (single SMS, no fragmentation)
- [ ] Vertical-specific version drafted if feature is vertical-specific
- [ ] Opt-out language included ("Reply STOP")
- [ ] Twilio env vars confirmed set: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- [ ] Tested on one client before batch send

See the **twilio** skill for SMS send patterns and error handling.

---

## n8n Webhook Async Distribution

n8n handles post-call workflows already. It can also be used for scheduled release
announcement delivery or triggered comms after a specific client action.

```javascript
// src/routes/call.js — existing n8n trigger pattern
// Adapt this pattern to fire a "release announcement" webhook
async function triggerN8nWebhook(eventType, payload) {
  const url = `${process.env.N8N_WEBHOOK_BASE_URL}/webhook/${eventType}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
```

**Release distribution workflow in n8n:**
1. Trigger: manual or scheduled cron in n8n
2. Action: POST to `N8N_WEBHOOK_BASE_URL/webhook/release-announce`
3. n8n node: query active clients from PostgreSQL
4. n8n node: send SMS or in-app notification per client

This keeps distribution logic out of the Express app and avoids blocking the main API.

---

## Dashboard In-App Announcements

The dashboard config endpoint (`GET /api/v1/dashboard/config`) returns full client config.
A `notices` or `announcements` array field can be added to this response to surface banners.

```javascript
// src/routes/dashboard.js — extend config response with announcements
router.get('/config', requireClerkAuth, async (req, res, next) => {
  try {
    const config = await getClientConfig(req.clientId);
    res.json({
      ...config,
      announcements: [
        {
          id: 'rel-2026-03-12-fsm',
          type: 'info',
          message: 'ServiceTitan integration now available. Connect in Integrations.',
          cta: { label: 'Connect', path: '/integrations/servicetitan' },
          dismissable: true,
        }
      ]
    });
  } catch (err) {
    next(err);
  }
});
```

**Announcement object schema:**
```javascript
{
  id: string,          // unique per release, used to track dismissal
  type: 'info' | 'warning' | 'success',
  message: string,     // plain text, under 120 chars
  cta: {               // optional
    label: string,
    path: string,      // dashboard-relative path
  },
  dismissable: boolean,
}
```

---

## WARNING: Email-Only Distribution

**The Problem:**
Planning a release communication strategy that relies exclusively on email when no email
integration exists in the codebase.

**Why This Breaks:**
1. `package.json` has no email library — shipping email requires adding a dependency
2. No email addresses are stored in the `clients` table schema — only phone numbers
3. Blue-collar operators check SMS far more reliably than email

**The Fix:**
Use SMS as the primary channel (Twilio is already integrated). If email is needed for a
specific campaign, add it as a secondary channel and document the dependency gap:

```markdown
// BEFORE adding email distribution:
// 1. Add nodemailer or @sendgrid/mail to package.json
// 2. Add email_address column to clients table (migration required)
// 3. Update onboard flow to capture email at signup
// Then: write the distribution logic
```

**When You Might Be Tempted:**
When planning a "professional" launch, email feels standard. But this platform's operators
are in the field — SMS reaches them; email often doesn't.
