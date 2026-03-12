# Conversion Optimization Reference

## Contents
- Onboarding Funnel Copy
- Wallet Top-Up Urgency
- Booking Confirmation Scripts
- Error Message Clarity
- Anti-Patterns

---

## Onboarding Funnel Copy

The `/api/v1/onboard` route is the first impression for new clients. Response copy must instill confidence and give a concrete next step.

```javascript
// src/routes/onboard.js — DO: lead with outcome, close with action
res.status(201).json({
  success: true,
  client_id: newClient.id,
  message: 'Your AI agent is live. Call ' + newClient.phone_number + ' to test it now.',
  dashboard_url: 'https://dashboard.aiops.app/login'
});
```

```javascript
// DON'T: vague confirmation with no action
res.status(201).json({
  success: true,
  message: 'Account created successfully.'
});
// WHY BAD: Operator doesn't know what to do next. Reduces activation.
```

## Wallet Top-Up Urgency

When `walletService.js` detects balance below threshold, the message must prompt action without causing panic on a live call.

```javascript
// src/services/walletService.js — DO: specific, actionable, calm
const LOW_BALANCE_OPERATOR_ALERT = {
  level: 'warning',
  message: 'Balance below $10. Your agent will switch to message-only mode at $0. Top up now.',
  action_url: '/dashboard/wallet'
};
```

```javascript
// DON'T: ambiguous severity
const LOW_BALANCE_OPERATOR_ALERT = {
  message: 'Low balance detected.'
};
// WHY BAD: No threshold context, no action. Operator may ignore until it's too late.
```

## Booking Confirmation Scripts

Confirmation copy is injected into `promptBuilder.js` at call time. It must match the client's tone config while hitting required information beats.

```javascript
// src/services/promptBuilder.js — DO: confirm all 3 fields, offer next step
function buildConfirmationScript(booking, client) {
  return `Perfect — you're booked for ${booking.service_name} on ` +
    `${booking.date} at ${booking.time}. We'll send a reminder text to ${booking.caller_phone}. ` +
    `Is there anything else I can help you with today?`;
}
```

**Required information beats in confirmation scripts:**
1. Service name
2. Date + time
3. Reminder channel (SMS/email)
4. Soft close ("anything else?")

## Error Message Clarity

Operator-facing errors (dashboard API) and caller-facing errors (agent scripts) need different voices.

```javascript
// src/middleware/errorHandler.js — operator-facing: specific and debuggable
res.status(err.status || 500).json({
  error: err.message,
  code: err.code || 'INTERNAL_ERROR',
  hint: err.hint || null  // e.g., 'Check ENCRYPTION_KEY env var'
});
```

```javascript
// Agent script for FSM booking failure — caller-facing: apologetic, pivot fast
const FSM_FAILURE_SCRIPT =
  "I'm sorry, that time isn't available after all. " +
  "I have openings on Thursday at 2pm or Friday at 10am — which works better for you?";
// NEVER expose system errors to callers. Always pivot to alternatives.
```

## Anti-Patterns

### WARNING: Exposing Internal Error Text to Callers

**The Problem:**
```javascript
// BAD — leaks system error into agent script
const agentMessage = `There was an error: ${err.message}. Please try again.`;
```

**Why This Breaks:**
1. Callers hear confusing technical language — damages trust in the business
2. May leak integration details (FSM name, internal field names)
3. No pivot to alternatives — call dead-ends

**The Fix:**
```javascript
// GOOD — generic caller message, detailed operator log
logger.error('FSM booking failed', { client_id: clientId, err: err.message });
const agentMessage = "I wasn't able to secure that slot. Let me offer you the next available times.";
```

### WARNING: Generic Onboarding Confirmation

**The Problem:** Single-line "success" responses leave operators without a clear activation path.

**The Fix:** Always include `client_id`, test phone number, and dashboard URL in onboard response.