# Distribution Reference

## Contents
- Where copy lives in the system
- Updating agent scripts without redeployment
- SMS distribution via Twilio
- n8n post-call webhook copy
- Propagation checklist

---

## Where Copy Lives

AI Ops distributes copy through three channels. Know which one to edit.

| Copy Type | Storage | Update Mechanism |
|-----------|---------|------------------|
| Agent system prompt | `clients.system_prompt` (PostgreSQL) | `PUT /api/v1/dashboard/agent` → recompile |
| Wallet soft-lock message | `clients.wallet_message` (PostgreSQL) | `PUT /api/v1/dashboard/agent` |
| SMS payment link text | Hardcoded in `src/integrations/twilio.js` | Code deploy required |
| Booking rejection fallback | Hardcoded in `src/services/bookingService.js` | Code deploy required |
| Dashboard operator messages | Hardcoded in `src/routes/dashboard.js` | Code deploy required |
| FAQ answers | `client_faqs` table (PostgreSQL) | Direct DB insert / admin API |

Prefer DB-stored copy for tenant-specific messages — it allows per-client customization
without a redeploy. Hardcode only platform-level copy that applies to all tenants equally.

---

## Updating Agent Scripts Without Redeployment

The `PUT /api/v1/dashboard/agent` endpoint triggers prompt recompilation. Any copy change
to the agent persona, tone, or wallet message flows through here.

```javascript
// src/routes/dashboard.js
router.put('/agent', requireClerkAuth, async (req, res, next) => {
  try {
    const { persona, greeting, wallet_message } = req.body;
    await pool.query(
      `UPDATE clients SET agent_persona = $1, greeting_script = $2,
       wallet_message = $3, system_prompt = $4
       WHERE client_id = $5`,
      [persona, greeting, wallet_message,
       await promptCompiler.compile(clientId), clientId]
    );
    res.json({ success: true, message: "Agent script updated. Changes are live immediately." });
  } catch (err) { next(err); }
});
```

The `system_prompt` column is rebuilt on every agent config edit. The cached version in
Redis (`client_config:{client_id}`) expires after 300s — no manual cache invalidation needed.

---

## SMS Distribution via Twilio (src/integrations/twilio.js)

Payment link SMS is the only outbound distribution channel. It fires during
`POST /api/v1/payment/create-intent`.

```javascript
async function sendPaymentLink(toPhone, amount, paymentUrl, callerName) {
  const body =
    `Hi ${callerName || 'there'}, your secure payment link for ` +
    `$${(amount / 100).toFixed(2)}: ${paymentUrl} — expires in 15 min.`;

  await twilioClient.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: toPhone,  // E.164 format: +1XXXXXXXXXX
  });
}
```

Copy rule: under 160 chars to avoid multipart SMS. Always include amount and expiry.

See the **twilio** skill for rate limiting and error handling patterns.

---

## n8n Post-Call Webhook Copy

After `POST /api/v1/call/complete`, an n8n webhook fires with call metadata. n8n uses this
to send follow-up messages (review requests, appointment reminders). The copy for these
messages lives in n8n — not in this codebase.

```javascript
// src/routes/call.js — what we send to n8n
async function firePostCallWebhook(callData) {
  await fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/post-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: callData.clientId,
      caller_phone: callData.callerPhone,
      outcome: callData.outcome,       // 'booked' | 'message_taken' | 'transferred' | 'abandoned'
      booking_id: callData.bookingId,  // null if not booked
      duration_seconds: callData.duration,
    }),
  });
}
```

The `outcome` field drives which n8n message template fires. "booked" → confirmation SMS,
"message_taken" → callback promise SMS. Map these outcome values to n8n template names when
writing post-call copy in n8n.

---

## WARNING: Hardcoding Tenant-Specific Copy

**The Problem:**
```javascript
// BAD — hardcoded for one tenant, breaks multi-tenancy
const greeting = "Thank you for calling Apex Plumbing! How can I help?";
```

**Why This Breaks:**
1. Every other tenant gets the wrong business name
2. Requires a code deploy to update any greeting
3. Violates the multi-tenant architecture principle

**The Fix:**
```javascript
// GOOD — tenant-aware, zero-deploy updates
const greeting = client.greeting_script ||
  `Thank you for calling ${client.business_name}! How can I help you today?`;
```

---

## Copy Propagation Checklist

Use when rolling out copy changes across the platform:

- [ ] Is this tenant-specific or platform-wide copy?
- [ ] If tenant-specific: update via `PUT /api/v1/dashboard/agent`, confirm `system_prompt` rebuilt
- [ ] If platform-wide: edit the hardcoded constant, deploy, verify in staging
- [ ] SMS copy: confirm under 160 chars after variable substitution
- [ ] n8n templates: update in n8n admin, test with a mock webhook payload
- [ ] Validate: call the test number and listen — does the script sound right?
