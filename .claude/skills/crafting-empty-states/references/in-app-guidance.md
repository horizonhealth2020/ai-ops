# In-App Guidance Reference

## Contents
- Guidance via API response fields
- Contextual help patterns
- Error-to-guidance mapping
- Severity levels
- Anti-patterns

---

## Guidance via API Response Fields

This is a pure API backend. In-app guidance lives in response fields, not HTML/JSX. The dashboard client renders them. Establish a consistent shape so the client only needs one renderer.

```javascript
// Standard guidance object shape — use everywhere
const GUIDANCE_SHAPE = {
  type: String,       // 'info' | 'warning' | 'error' | 'success'
  reason: String,     // machine-readable code, e.g. 'no_fsm_connected'
  message: String,    // human-readable, action-oriented sentence
  action: String,     // CTA key, e.g. 'connect_fsm', 'add_funds', 'configure_agent'
  docs_url: String    // optional — only for complex setup steps
};
```

## Contextual Help Patterns

Each dashboard endpoint should attach guidance specific to the data it returns.

### Call logs — no calls yet

```javascript
// src/routes/dashboard.js
function getCallLogsGuidance(calls, config) {
  if (calls.length > 0) return null;

  if (!config.system_prompt) {
    return {
      type: 'warning',
      reason: 'agent_not_configured',
      message: 'Complete your agent setup before routing calls.',
      action: 'configure_agent'
    };
  }

  return {
    type: 'info',
    reason: 'no_calls_yet',
    message: 'No calls recorded. Point your Vapi assistant to this server to start.',
    action: 'configure_vapi',
    docs_url: '/docs/configuring-vapi'
  };
}
```

### Booking failure guidance

When `POST /api/v1/booking/create` fails FSM verification, the response must guide the caller (and by extension, the dashboard) on next steps.

```javascript
// src/routes/booking.js — within the rejection branch
if (!fsmVerified) {
  logger.warn('FSM rejected slot', { client_id: clientId, date, time });
  return res.status(409).json({
    booked: false,
    reason: 'fsm_rejected',
    message: 'That slot is no longer available.',
    guidance: {
      type: 'info',
      action: 'check_availability',
      message: 'Ask the caller for an alternative time and check availability again.'
    }
  });
}
```

### Wallet guidance on context inject

When the wallet is empty and the agent switches to message-only mode, the context inject endpoint must signal this clearly so Vapi can relay the right behavior.

```javascript
// src/routes/vapi.js — wallet check before prompt build
if (walletState.balance_cents === 0) {
  logger.info('Wallet empty — message-only mode', { client_id: clientId });
  return res.json({
    mode: 'message_only',
    system_prompt_override: config.message_only_prompt,
    guidance: {
      reason: 'zero_balance',
      message: 'Wallet depleted. Agent is in message-only mode.'
    }
  });
}
```

## Error-to-Guidance Mapping

Map known error conditions to actionable guidance rather than exposing raw error messages to the dashboard.

```javascript
// src/middleware/errorHandler.js — extend to attach guidance
const GUIDANCE_MAP = {
  'FSM_UNAVAILABLE': {
    type: 'error',
    reason: 'fsm_unavailable',
    message: 'Could not reach your field service tool. Check your integration credentials.',
    action: 'check_integrations'
  },
  'WALLET_INSUFFICIENT': {
    type: 'warning',
    reason: 'zero_balance',
    message: 'Wallet balance is $0. Add funds to restore full call handling.',
    action: 'add_funds'
  },
  'SLOT_CONFLICT': {
    type: 'info',
    reason: 'slot_taken',
    message: 'That slot was taken by another caller. Offer an alternative.',
    action: 'check_availability'
  }
};

function getGuidanceForError(errorCode) {
  return GUIDANCE_MAP[errorCode] || null;
}
```

## Severity Levels

Use consistent severity values so the dashboard can color-code guidance without custom logic per endpoint.

| Severity | When to Use |
|----------|-------------|
| `'critical'` | Agent is broken or degraded right now (zero balance, no system prompt) |
| `'warning'` | Configuration gap that will cause problems soon |
| `'info'` | Feature not yet used, optional setup step |
| `'success'` | Activation milestone reached (first call, first booking) |

```javascript
// Example: first booking milestone
async function getFirstBookingMilestone(clientId, pool) {
  const result = await pool.query(
    'SELECT COUNT(*) FROM bookings WHERE client_id = $1',
    [clientId]
  );

  if (parseInt(result.rows[0].count) === 1) {
    return {
      type: 'success',
      reason: 'first_booking',
      message: 'First booking created! Your AI agent is fully operational.'
    };
  }
  return null;
}
```

## Anti-Patterns

### WARNING: Raw error messages in guidance

**The Problem:**
```javascript
// BAD — exposes internal details, not actionable
res.status(500).json({ error: err.message });
// Client sees: "connect ECONNREFUSED 127.0.0.1:3001"
```

**Why This Breaks:**
1. Exposes infrastructure details (IP addresses, service names)
2. Not actionable — the user can't do anything with "ECONNREFUSED"
3. Breaks dashboard rendering if the client expects a `guidance` shape

**The Fix:**
```javascript
// GOOD — maps to actionable guidance
next(Object.assign(err, { code: 'FSM_UNAVAILABLE' }));
// errorHandler attaches GUIDANCE_MAP entry before sending response
```

### WARNING: Missing `reason` code on guidance objects

Always include `reason` as a machine-readable string. The dashboard may want to suppress duplicate guidance, track dismissals, or fire analytics events keyed to the reason. A message-only string makes all of this impossible.

See the **express** skill for error handler patterns, and the **clerk** skill for how `client_id` flows through dashboard routes.
