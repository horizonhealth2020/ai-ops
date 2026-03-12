# Content Copy Reference

## Contents
- Where Copy Lives
- Conversion-Critical Copy Locations
- Anti-patterns
- Copy Patterns by Funnel Stage

---

## Where Copy Lives

This is a backend-only project. All user-facing copy is delivered as JSON response bodies or SSE stream content — there are no HTML templates. Copy lives in:

| Location | Type | File |
|----------|------|------|
| Agent persona script | System prompt | `src/services/promptCompiler.js` |
| Onboarding confirmation | JSON response | `src/routes/onboard.js` |
| Wallet/billing messages | JSON response | `src/services/walletService.js` |
| Error copy | JSON response | `src/middleware/errorHandler.js` |
| SMS payment link text | Twilio body string | `src/integrations/twilio.js` |
| Dashboard API responses | JSON | `src/routes/dashboard.js` |

---

## Conversion-Critical Copy Locations

### 1. Onboarding success response

The first thing an operator sees after submitting the intake form. Weak copy here increases support load.

```javascript
// src/routes/onboard.js
res.status(201).json({
  success: true,
  client_id: newClient.client_id,
  message: 'Your AI agent is ready. Fund your wallet to activate live call answering.',
  next_steps: [
    'Log in to your dashboard to review your agent configuration',
    'Add wallet funds to enable call answering',
    'Set your business hours to control when the agent picks up',
  ],
});
```

### 2. Wallet empty message — the churn moment

When `wallet_balance_cents = 0`, the agent tells callers it can only take messages. The operator-facing copy in the dashboard response must convey urgency without alarm.

```javascript
// src/routes/dashboard.js — wallet endpoint
if (client.wallet_balance_cents <= 0) {
  walletData.status_message = 'Call answering is paused. Add funds to resume.';
  walletData.cta = 'Reload wallet';
}
```

### 3. SMS payment link copy

Sent by Twilio after a payment intent is created. This is the only outbound copy that reaches the end customer (the caller). Keep it under 160 characters.

```javascript
// src/integrations/twilio.js
const body = `Hi ${customerName}, pay $${amountDollars} for your ${serviceType} appointment: ${paymentUrl}`;
// Target: under 160 chars to avoid multi-part SMS surcharge
```

---

## Anti-patterns

### WARNING: Generic error messages that expose internal state

**The Problem:**
```javascript
// BAD — leaks stack trace context to caller
res.status(500).json({ error: err.message });
```

**Why This Breaks:**
1. Exposes DB column names, query fragments, or service names to operators
2. Breaks trust — operators see technical noise instead of actionable guidance
3. No conversion signal — operator can't self-serve to fix the issue

**The Fix:**
```javascript
// GOOD — map to operator-friendly message
res.status(500).json({
  error: 'Unable to create booking. Please try again or contact support.',
  code: 'BOOKING_FAILED',
});
```

### WARNING: Missing `next_steps` in onboarding response

**The Problem:**
```javascript
// BAD — operator doesn't know what to do next
res.status(201).json({ success: true, client_id: id });
```

**Why This Breaks:**
1. No activation funnel guidance → operator never funds wallet → never activates
2. Support tickets spike: "What do I do now?"

---

## Copy Patterns by Funnel Stage

### Stage: Onboard → Wallet funded

Goal: get the operator to add wallet funds within 24h of onboarding.

- Dashboard `GET /api/v1/dashboard/wallet` response must include `status_message` and `cta` when balance is zero
- Include the per-minute rate for their tier so the value is concrete
- NEVER say "insufficient funds" — say "Add funds to activate call answering"

### Stage: Wallet funded → First booking

Goal: operator gains confidence the agent is working.

- `GET /api/v1/dashboard/calls` response should highlight when there are zero calls yet: include an `empty_state` field with "Your agent is live and waiting for the first call."
- NOT: "No calls found."

```javascript
// src/routes/dashboard.js
if (calls.length === 0) {
  return res.json({
    calls: [],
    empty_state: 'Your agent is live and waiting for the first call.',
  });
}
```

### Stage: First booking → Recurring calls

Goal: operator sees ROI in the call log and stays funded.

- Call log entries should include `outcome` labels in human-readable form: `'Appointment booked'`, not `'booked'`
- `charged_cents` should surface as formatted dollars in the response for the dashboard

See the **tightening-brand-voice** skill for copy tone and consistency guidelines.
See the **crafting-page-messaging** skill for dashboard-facing response copy patterns.
