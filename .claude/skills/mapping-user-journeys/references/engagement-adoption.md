# Engagement & Adoption Reference

## Contents
- Returning caller recognition
- Wallet reload as re-engagement
- Dashboard config adoption
- DO/DON'T pairs
- Anti-patterns

## Returning Caller Recognition

The primary engagement signal for callers is history injection via `callerMemory.js`.

```javascript
// src/services/callerMemory.js — called in promptBuilder before every call
async function getCallerHistory(clientId, callerPhone) {
  const { rows } = await pool.query(
    `SELECT summary, last_called_at FROM call_logs
     WHERE client_id = $1 AND caller_phone = $2
     ORDER BY last_called_at DESC LIMIT 3`,
    [clientId, callerPhone]
  );
  return rows; // injected into prompt context
}
```

**Adoption signal:** If `call_logs` has 0 rows for a client's callers, returning-caller recognition is dead. Check this before blaming the LLM.

## Wallet Reload as Re-engagement

When wallet balance hits $0, the agent switches to message-only mode. This is a hard drop in service quality — treat it as a churn signal.

```javascript
// src/services/walletService.js
async function checkBalance(clientId) {
  const { rows } = await pool.query(
    'SELECT balance_cents FROM client_wallets WHERE client_id = $1',
    [clientId]
  );
  const balance = rows[0]?.balance_cents ?? 0;
  return { allowed: balance > 0, balance_cents: balance };
}
```

**Re-engagement pattern:** Fire an n8n webhook when balance drops below a threshold (e.g., 1000 cents = $10), not when it hits $0.

```javascript
// src/routes/call.js — POST /api/v1/call/complete
const { balance_cents } = await walletService.deductCallCost(clientId, durationSeconds);
if (balance_cents < 1000) {
  // Fire low-balance webhook — don't wait for $0
  await axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/low-balance`, {
    client_id: clientId,
    balance_cents,
  });
}
```

## Dashboard Config Adoption

Clients who update their config (hours, scheduling, agent persona) are more engaged. Each `PUT` must re-trigger `compilePrompt`.

```javascript
// src/routes/dashboard.js — all config PUTs follow this pattern
router.put('/agent', requireClerkAuth, async (req, res, next) => {
  try {
    const clientId = req.auth.clientId;
    await pool.query(
      'UPDATE clients SET agent_name = $1, agent_persona = $2 WHERE client_id = $3',
      [req.body.agent_name, req.body.agent_persona, clientId]
    );
    // CRITICAL: re-compile prompt after every config change
    await compilePrompt(clientId);
    // Bust config cache so next call gets fresh data
    await redis.del(`client_config:${clientId}`);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

**FRICTION:** Cache busting is often forgotten. If `redis.del` is missing, the agent runs on stale config for up to 300s.

## DO / DON'T

```javascript
// DO — bust Redis cache after every config update
await redis.del(`client_config:${clientId}`);

// DON'T — update DB without cache invalidation
await pool.query('UPDATE clients SET agent_name = $1 WHERE client_id = $2', [name, clientId]);
// Agent will use old name for up to 5 minutes on next call
```

### WARNING: Silent Wallet Depletion

**The Problem:**
```javascript
// BAD — deduct without checking result
await walletService.deductCallCost(clientId, duration);
```

**Why This Breaks:**
1. Client goes to $0 with no notification
2. Next caller gets message-only mode with no warning to the business owner
3. Revenue is lost silently

**The Fix:**
```javascript
// GOOD — check balance after deduction and fire webhook if low
const { balance_cents } = await walletService.deductCallCost(clientId, duration);
if (balance_cents < LOW_BALANCE_THRESHOLD_CENTS) {
  await notifyLowBalance(clientId, balance_cents);
}
```

## Related Skills

- See the **redis** skill for cache invalidation patterns
- See the **vapi** skill for message-only mode SSE response format
- See the **instrumenting-product-metrics** skill for tracking engagement events
