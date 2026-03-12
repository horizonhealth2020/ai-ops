# In-App Guidance Reference

## Contents
- Guidance Surfaces in This Codebase
- Agent Persona as Guidance Layer
- Error Messages That Guide
- Anti-Patterns
- Dashboard Config Validation

---

## Guidance Surfaces in This Codebase

This is an API-first backend. "In-app guidance" means:
1. **Agent responses** — the AI phone agent guiding callers through booking/payment flows
2. **API error messages** — actionable errors returned to Vapi and the dashboard
3. **Dashboard config** — validating that clients have completed setup before going live

There is no frontend in this repo. Guidance lives in prompt content and API response shapes.

## Agent Persona as Guidance Layer

The agent's persona config (stored in `clients` table) determines how the AI guides callers.
Scope persona changes as a `PUT /api/v1/dashboard/agent` update + prompt recompile.

```javascript
// src/routes/dashboard.js — agent config update
router.put('/api/v1/dashboard/agent', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    const { agent_name, tone, fallback_message, transfer_phone } = req.body;
    await pool.query(
      `UPDATE clients SET agent_name = $1, tone = $2, fallback_message = $3,
       transfer_phone = $4 WHERE client_id = $5`,
      [agent_name, tone, fallback_message, transfer_phone, clientId]
    );
    await promptCompiler.compileAndStore(clientId); // Guidance change → recompile
    res.json({ status: 'updated' });
  } catch (err) {
    next(err);
  }
});
```

## Error Messages That Guide

API errors returned to Vapi must be actionable — the agent reads them and responds to callers.
Errors returned to dashboard clients must explain what to fix, not just that something failed.

```javascript
// src/middleware/errorHandler.js — DO: map internal errors to caller-safe messages
function errorHandler(err, req, res, next) {
  logger.error('Request error', { error: err.message, stack: err.stack, path: req.path });

  // NEVER expose stack traces or internal DB errors to callers
  if (req.path.startsWith('/api/v1/context')) {
    // Vapi endpoint — return in OpenAI error format so agent can handle gracefully
    return res.status(200).json({
      choices: [{ message: { content: 'I apologize, I\'m having trouble right now. Please call back shortly.' } }]
    });
  }

  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
}
```

```javascript
// GOOD — actionable validation error
if (!req.body.date || !req.body.time) {
  return res.status(400).json({
    error: 'Missing required fields: date and time',
    required: ['date', 'time'],
    example: { date: '2026-03-15', time: '10:00' }
  });
}
```

## Anti-Patterns

### WARNING: Leaking Internal Errors to Callers

**The Problem:**
```javascript
// BAD — exposes DB error details through Vapi to the caller
} catch (err) {
  res.status(500).json({ error: err.message }); // "relation 'bookings' does not exist"
}
```

**Why This Breaks:**
1. SQL errors, connection strings, and table names leak to end-callers via Vapi
2. Security risk — structural information aids SQL injection attempts
3. Degrades caller experience — "relation does not exist" is not a useful message

**The Fix:**
Always pass errors to `next(err)` and let `errorHandler.js` map to safe messages.

## Dashboard Config Validation

Scope a "readiness check" endpoint for clients to verify their config before going live:

```javascript
// v1 scope — GET /api/v1/dashboard/readiness
// Returns list of incomplete config items blocking first call:
async function checkReadiness(clientId) {
  const client = await loadClientConfig(clientId);
  const issues = [];
  if (!client.business_hours) issues.push('business_hours_not_set');
  if (!client.agent_name) issues.push('agent_name_not_set');
  if (!client.fsm_integration) issues.push('fsm_not_connected');
  if (client.wallet_balance_cents <= 0) issues.push('wallet_empty');
  if (!client.system_prompt) issues.push('prompt_not_compiled');
  return { ready: issues.length === 0, issues };
}
```

See the **express** skill for route handler patterns and the **clerk** skill for dashboard auth.
