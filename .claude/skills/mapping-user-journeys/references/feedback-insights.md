# Feedback & Insights Reference

## Contents
- Call log as feedback signal
- FSM error patterns as product signals
- Dashboard config as adoption signal
- Wallet depletion as churn signal
- Missing feedback infrastructure
- DO/DON'T pairs

## Call Log as Feedback Signal

`call_logs` is the primary feedback source. Every completed call should populate `outcome` and `summary`.

```javascript
// src/routes/call.js — POST /api/v1/call/complete
router.post('/complete', requireVapiAuth, async (req, res, next) => {
  try {
    const { call_id, client_id, duration_seconds, outcome, summary } = req.body;

    await pool.query(
      `INSERT INTO call_logs
        (call_id, client_id, caller_phone, duration_seconds, outcome, summary, cost_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [call_id, client_id, callerPhone, duration_seconds, outcome, summary, costCents]
    );

    logger.info('call.completed', {
      client_id,
      duration_seconds,
      outcome, // 'booked', 'payment_taken', 'message_left', 'transferred', 'no_action'
      cost_cents: costCents,
    });
  } catch (err) {
    next(err);
  }
});
```

**Friction:** If Vapi doesn't send `outcome` in the post-call payload, the field is NULL and call analysis is blind.

## FSM Error Patterns as Product Signals

FSM rejections reveal mismatches between the AI's slot suggestions and actual availability.

```javascript
// src/services/bookingService.js — log FSM rejections with context
try {
  const isAvailable = await adapter.verifySlotAvailability(credentials, clientId, date, time);
  if (!isAvailable) {
    logger.warn('fsm.slot_rejected', {
      client_id: clientId,
      fsm_type: client.fsm_type,
      date,
      time,
      // This pattern — same slot rejected repeatedly — means cached_availability is stale
    });
  }
} catch (err) {
  logger.error('fsm.verification_failed', { client_id: clientId, fsm_type: client.fsm_type, error: err.message });
  throw err;
}
```

**Insight pattern:** If `fsm.slot_rejected` fires for the same `(client_id, date)` repeatedly, `cached_availability` needs more frequent refresh from the FSM.

## Dashboard Config as Adoption Signal

Track which clients update their config — these are your most engaged users.

```javascript
// src/routes/dashboard.js — add adoption logging to every PUT
router.put('/hours', requireClerkAuth, async (req, res, next) => {
  try {
    // ... update logic ...
    logger.info('config.updated', {
      client_id: clientId,
      config_type: 'hours', // 'hours', 'scheduling', 'agent'
      // Helps identify which config sections are actually used
    });
  } catch (err) {
    next(err);
  }
});
```

## Wallet Depletion as Churn Signal

```javascript
// src/services/walletService.js — track depletion events
async function deductCallCost(clientId, durationSeconds) {
  const costCents = calculateCost(clientId, durationSeconds);
  const { rows } = await pool.query(
    `UPDATE client_wallets
     SET balance_cents = balance_cents - $1
     WHERE client_id = $2
     RETURNING balance_cents`,
    [costCents, clientId]
  );
  const balanceAfter = rows[0].balance_cents;

  if (balanceAfter <= 0) {
    logger.warn('wallet.depleted', { client_id: clientId });
    // FRICTION: no automated outreach — business owner may not know until next call fails
  }

  return { balance_cents: balanceAfter, cost_cents: costCents };
}
```

**Recommended:** Hook into this log event via n8n to send an email/SMS to the business owner immediately on depletion.

## WARNING: Missing Customer Feedback Infrastructure

**Detected:** No feedback collection mechanism (Intercom, Canny, Typeform, in-app survey) in dependencies.
**Impact:** Product decisions rely on inference from logs, not direct user input. Silent churners leave no signal.

### Minimum Viable Feedback Hook

Add a post-call webhook to n8n that sends a satisfaction SMS via Twilio:

```javascript
// Triggered from POST /api/v1/call/complete via n8n
// n8n workflow: receive webhook → wait 5min → send SMS via Twilio
{
  "to": callerPhone,
  "body": `Thanks for calling ${clientName}! Reply 1-5 to rate your experience.`
}
```

See the **twilio** skill for SMS sending patterns.

## DO / DON'T

```javascript
// DO — log FSM errors with enough context to diagnose
logger.error('fsm.verification_failed', {
  client_id: clientId,
  fsm_type: client.fsm_type,
  date,
  time,
  error: err.message,
});

// DON'T — swallow FSM errors silently
try {
  await adapter.verifySlotAvailability(...);
} catch (err) {
  return { confirmed: false }; // No log — no signal — no way to diagnose
}
```

## Related Skills

- See the **twilio** skill for SMS notification patterns
- See the **vapi** skill for post-call webhook payload structure
- See the **postgresql** skill for querying `call_logs` for insights
- See the **instrumenting-product-metrics** skill for structuring events for funnel analysis
