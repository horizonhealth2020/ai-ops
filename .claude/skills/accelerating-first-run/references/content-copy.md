# Content Copy Reference

## Contents
- Where copy lives in this codebase
- Onboard response copy
- Dashboard guidance copy
- Agent persona copy
- Anti-patterns

---

## Where Copy Lives

This backend is API-only — there are no HTML templates. All user-facing copy is in JSON
response payloads and in `src/services/promptCompiler.js` (agent script copy).

| Copy surface | File | When shown |
|---|---|---|
| Onboard success/error messages | `src/routes/onboard.js` | Intake form submission |
| Dashboard config guidance | `src/routes/dashboard.js` | First login to dashboard |
| Agent greeting script | `src/services/promptCompiler.js` | Every inbound call |
| Wallet empty state | `src/routes/dashboard.js` | `GET /wallet` with zero balance |
| Error messages | `src/middleware/errorHandler.js` | Any 4xx/5xx |

---

## Onboard Response Copy

The 201 response from `POST /api/v1/onboard` is the first message a new client sees after
signing up. Currently it returns only `{ client_id, business_phone, status }`. That's not
enough to drive activation.

**Add actionable next steps:**

```javascript
// src/routes/onboard.js — res.status(201).json(...)
res.status(201).json({
  client_id: clientId,
  business_phone,
  status: 'active',
  setup_checklist: [
    { step: 'fund_wallet', label: 'Add wallet balance to activate your agent', done: false },
    { step: 'configure_vapi', label: 'Connect your Vapi assistant', done: false },
    { step: 'test_call', label: 'Make a test call to your business number', done: false },
  ],
});
```

---

## Dashboard Guidance Copy

When `GET /api/v1/dashboard/config` returns a client with no greeting script or empty
wallet, the response should include guidance — not silence.

```javascript
// src/routes/dashboard.js — GET /config
const guidance = [];
if (!client.greeting_script) {
  guidance.push({
    type: 'warning',
    field: 'greeting_script',
    message: 'Your agent has no greeting script. Callers will hear a generic opening.',
    action: 'PUT /api/v1/dashboard/agent',
  });
}
if (!client.agent_name) {
  guidance.push({
    type: 'tip',
    field: 'agent_name',
    message: 'Give your agent a name to make calls feel personal.',
    action: 'PUT /api/v1/dashboard/agent',
  });
}
res.json({ ...config, guidance });
```

---

## Agent Persona Copy

The compiled prompt in `src/services/promptCompiler.js` is the agent's script. The copy
here directly affects booking conversion on calls.

**High-converting greeting patterns for blue-collar verticals:**

```javascript
// HVAC
"Thanks for calling [Company], this is [Name]! Are you calling about a repair or new system quote?"

// Spa
"Thank you for calling [Company], this is [Name]. How can I help you relax today?"

// Plumbing
"[Company], [Name] speaking. Got an emergency or looking to schedule a service?"
```

**Differentiator copy that converts callers to bookings:**

```javascript
// src/routes/onboard.js — differentiators field in request body
// These become the "Why Choose Us" section in the compiled prompt
{
  differentiators: "Licensed master plumbers. Same-day service. No overtime charges."
}
```

---

## Wallet Empty State Copy

`GET /api/v1/dashboard/wallet` returns raw wallet data. Add a state-aware message:

```javascript
// src/routes/dashboard.js — GET /wallet
const wallet = await getWalletInfo(req.clientId);
const message = wallet.balance_cents === 0
  ? 'Your agent is in message-only mode. Add balance to enable bookings and payments.'
  : wallet.balance_cents < 500
    ? `Low balance: ${wallet.balance_cents} cents remaining. Consider topping up.`
    : null;

res.json({ ...wallet, status_message: message });
```

---

### WARNING: Generic Error Messages Block Activation

**The Problem:**

```javascript
// BAD — no actionable context
res.status(400).json({ error: 'Validation failed' });
```

**Why This Breaks:**
1. Client's intake form fails silently — they don't know which field to fix
2. Support tickets spike because the error gives no resolution path
3. Clients abandon onboarding entirely

**The Fix:**

```javascript
// GOOD — field-specific errors from onboard.js
if (!business_name || !business_phone) {
  return res.status(400).json({
    error: 'Missing required fields',
    fields: {
      business_name: !business_name ? 'Required' : undefined,
      business_phone: !business_phone ? 'Required — use E.164 format: +1XXXXXXXXXX' : undefined,
    },
  });
}
```

---

## Related Skills

- See the **tightening-brand-voice** skill for tone and consistency in all copy surfaces
- See the **crafting-page-messaging** skill for converting empty states to action prompts
- See the **crafting-empty-states** skill for zero-state UI patterns in dashboard responses
