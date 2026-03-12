# Feedback & Insights Reference

## Contents
- Call Outcome as Feedback Signal
- Booking Failure Patterns
- n8n Webhook for Post-Call Insights
- WARNING: Silent FSM Failures
- Structured Feedback Loop Checklist

---

## Call Outcome as Feedback Signal

The richest feedback signal in this system is the call outcome logged at `POST /api/v1/call/complete`. Every call result — booked, transferred, failed, message-only — is a product signal. Log it with enough context to diagnose issues.

```javascript
// src/routes/call.js — complete handler
router.post('/complete', requireVapi, async (req, res, next) => {
  try {
    const { callId, clientId, outcome, durationSeconds, callerPhone, summary } = req.body;

    await pool.query(
      `INSERT INTO call_logs
        (call_id, client_id, caller_phone, duration_seconds, outcome, summary, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [callId, clientId, callerPhone, durationSeconds, outcome, summary]
    );

    // Increment total_calls — used for activation state
    await pool.query(
      'UPDATE clients SET total_calls = total_calls + 1 WHERE client_id = $1',
      [clientId]
    );

    logger.info('call_completed', {
      client_id: clientId,
      call_id: callId,
      outcome,
      duration_seconds: durationSeconds,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

Query call outcomes to identify where the agent is failing clients:

```sql
-- Outcome distribution by vertical (last 30 days)
SELECT
  c.vertical,
  cl.outcome,
  COUNT(*) AS count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER (PARTITION BY c.vertical) * 100, 1) AS pct
FROM call_logs cl
JOIN clients c ON c.client_id = cl.client_id
WHERE cl.ended_at > NOW() - INTERVAL '30 days'
GROUP BY c.vertical, cl.outcome
ORDER BY c.vertical, count DESC;
```

## Booking Failure Patterns

FSM verification failures at `POST /api/v1/booking/create` are product feedback — they mean slots shown as available weren't actually bookable. Track them:

```javascript
// src/services/bookingService.js
async function createBooking(clientId, bookingData) {
  const fsmVerified = await verifyWithFsm(clientId, bookingData);

  if (!fsmVerified) {
    logger.warn('booking_fsm_rejected', {
      client_id: clientId,
      slot_date: bookingData.date,
      slot_time: bookingData.time,
      fsm_type: bookingData.fsmType,
    });
    return { success: false, reason: 'slot_unavailable', alternatives: await getAlternativeSlots(clientId) };
  }

  // ... proceed with confirmed booking
}
```

Query FSM rejection rate to identify integration issues:

```sql
-- Clients with high FSM rejection rates (potential sync issue)
SELECT
  c.client_id, c.business_name, c.vertical,
  COUNT(*) FILTER (WHERE outcome = 'booked') AS booked,
  COUNT(*) FILTER (WHERE outcome = 'fsm_rejected') AS rejected,
  ROUND(
    COUNT(*) FILTER (WHERE outcome = 'fsm_rejected')::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS rejection_rate_pct
FROM bookings b
JOIN clients c ON c.client_id = b.client_id
WHERE b.created_at > NOW() - INTERVAL '7 days'
GROUP BY c.client_id, c.business_name, c.vertical
HAVING COUNT(*) FILTER (WHERE outcome = 'fsm_rejected') > 3
ORDER BY rejection_rate_pct DESC;
```

## n8n Webhook for Post-Call Insights

After `POST /api/v1/call/complete`, fire an n8n webhook to trigger async analysis — transcript review, CRM updates, or satisfaction follow-ups. This is the async/real-time split in action.

```javascript
// src/routes/call.js — fire n8n after logging
if (process.env.N8N_WEBHOOK_BASE_URL) {
  // Fire and forget — don't await, don't block the response
  fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/webhook/call-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId, clientId, outcome, durationSeconds, summary }),
  }).catch(err => logger.warn('n8n_webhook_failed', { call_id: callId, error: err.message }));
}
```

NEVER await the n8n call. The Vapi platform times out after a few seconds. The n8n webhook is fire-and-forget.

### WARNING: Silent FSM Failures

**The Problem:**

```javascript
// BAD — swallowing FSM errors without logging
try {
  await fsmAdapter.createJob(credentials, clientId, booking);
} catch (err) {
  return { success: false };  // caller gets a generic failure, ops team has no signal
}
```

**Why This Breaks:**
1. FSM credentials expire or rotate — silent failures mean you won't know until clients complain
2. Rate limits on FSM APIs (HouseCall Pro, Jobber) are silent failures without logs
3. You can't distinguish "slot genuinely unavailable" from "FSM API down" without error context

**The Fix:**

```javascript
// GOOD — log FSM failures with full context
try {
  await fsmAdapter.createJob(credentials, clientId, booking);
} catch (err) {
  logger.error('fsm_create_job_failed', {
    client_id: clientId,
    fsm_type: integration.integration_type,
    error: err.message,
    status_code: err.status || null,
  });
  throw err;  // re-throw so the route handler returns a meaningful error response
}
```

## Structured Feedback Loop Checklist

Use this process when investigating a product problem reported by a client:

1. Query `call_logs` for the client in the relevant time window:
   ```sql
   SELECT * FROM call_logs WHERE client_id = $1 AND ended_at > NOW() - INTERVAL '48 hours' ORDER BY ended_at DESC;
   ```
2. Check `bookings` for FSM rejections in the same window
3. Search structured logs for `_level: 'error'` entries with `client_id` match
4. Check `wallets` balance — message-only mode is often misidentified as a bug
5. Verify FSM integration is still active: `SELECT * FROM client_integrations WHERE client_id = $1`
6. If FSM credentials are suspected stale, check `st_token:{client_id}` in Redis (ServiceTitan OAuth)
7. Fix root cause, verify fix: repeat step 1-5 after deploying

See the **redis** skill for inspecting cached OAuth tokens, and the **express** skill for adding structured error logging to routes.
