# Feedback & Insights Reference

## Contents
- Call outcome as feedback signal
- FSM rejection patterns
- Wallet depletion signals
- n8n post-call workflows as feedback loops
- Anti-patterns

---

## Call Outcome as Feedback Signal

Call outcomes in `call_logs` are the richest feedback source in this system. Every call either books, transfers, fails, or abandons — log all of them with enough context to diagnose patterns.

```javascript
// src/routes/call.js — POST /api/v1/call/complete
router.post('/complete', requireVapiAuth, async (req, res, next) => {
  try {
    const { call_id, client_id, duration_seconds, outcome, caller_phone } = req.body;

    await pool.query(
      `INSERT INTO call_logs
         (call_id, client_id, caller_phone, duration_seconds, outcome, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [call_id, client_id, caller_phone, duration_seconds, outcome]
    );

    // Structured log — queryable for patterns
    logger.info('call.complete', {
      client_id,
      call_id,
      outcome,           // 'booked' | 'transferred' | 'abandoned' | 'message_only'
      duration_seconds,
      wallet_deducted: outcome !== 'abandoned'
    });

    res.json({ logged: true });
  } catch (err) {
    next(err);
  }
});
```

## FSM Rejection Patterns

When an FSM rejects a booking (slot gone or credentials expired), log it with enough context to distinguish the failure type. Repeated FSM rejections mean either the cached availability is stale or the client's FSM credentials have expired.

```javascript
// src/services/bookingService.js
async function createBooking(clientId, slot, caller) {
  const integration = await getIntegration(clientId, 'fsm');

  let fsmJobId;
  try {
    fsmJobId = await fsm.createJob(integration.credentials, clientId, slot);
  } catch (err) {
    logger.warn('fsm.booking_failed', {
      client_id: clientId,
      fsm_type: integration.integration_type,
      error_code: err.code || 'unknown',
      slot_date: slot.date,
      slot_time: slot.time
    });

    return {
      booked: false,
      reason: 'fsm_error',
      guidance: {
        type: 'error',
        action: 'check_integrations',
        message: 'Booking failed. Verify your FSM credentials in the dashboard.'
      }
    };
  }

  // ...success path
}
```

## Wallet Depletion Signals

When a wallet hits $0 mid-period, it's a retention signal — the client is active but unprepared. Log it and trigger an n8n workflow for proactive outreach.

```javascript
// src/services/walletService.js
async function deductCallCost(clientId, durationSeconds, tier) {
  const costCents = calculateCost(durationSeconds, tier); // integer cents

  const result = await pool.query(
    `UPDATE client_wallets
     SET balance_cents = balance_cents - $1
     WHERE client_id = $2 AND balance_cents >= $1
     RETURNING balance_cents`,
    [costCents, clientId]
  );

  if (result.rows.length === 0) {
    logger.warn('wallet.insufficient_for_deduction', { client_id: clientId, cost_cents: costCents });
    return { deducted: false, reason: 'insufficient_balance' };
  }

  const newBalance = result.rows[0].balance_cents;

  if (newBalance === 0) {
    logger.warn('wallet.depleted', { client_id: clientId });

    // Fire n8n for async top-up reminder
    if (process.env.N8N_WEBHOOK_BASE_URL) {
      fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/wallet-depleted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId })
      }).catch(err => logger.warn('n8n wallet-depleted webhook failed', { err: err.message }));
    }
  }

  return { deducted: true, balance_cents: newBalance };
}
```

## n8n Post-Call Workflows as Feedback Loops

n8n handles all async post-call intelligence. Use it for recurring feedback: abandoned call patterns, low booking conversion, FSM credential health checks.

```javascript
// src/routes/call.js — fire n8n on every call completion
async function firePostCallWebhook(callData) {
  if (!process.env.N8N_WEBHOOK_BASE_URL) return;

  const payload = {
    client_id: callData.client_id,
    call_id: callData.call_id,
    outcome: callData.outcome,
    duration_seconds: callData.duration_seconds
  };

  try {
    await fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/call-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    // Non-fatal — n8n failure never breaks the call flow
    logger.warn('n8n post-call webhook failed', { call_id: callData.call_id, err: err.message });
  }
}
```

n8n can then query patterns across `call_logs` and trigger Twilio SMS for low booking rates or repeated abandons. See the **twilio** skill for SMS patterns.

## Anti-Patterns

### WARNING: Blocking call completion on n8n webhook

NEVER `await` the n8n webhook call in the critical path. If n8n is slow or down, the Vapi call completion hangs.

```javascript
// BAD — blocks call completion on external webhook
await firePostCallWebhook(callData);
res.json({ logged: true });

// GOOD — fire and forget; log failures but don't block
firePostCallWebhook(callData); // no await
res.json({ logged: true });
```

### WARNING: Losing FSM rejection context in the log

NEVER log FSM failures with just `err.message`. The message may be a generic HTTP error. Log the FSM type, the slot, and any error code from the FSM API response.

```javascript
// BAD
logger.warn('FSM failed', { error: err.message });

// GOOD
logger.warn('fsm.booking_failed', {
  client_id: clientId,
  fsm_type: integration.integration_type,
  slot: `${slot.date}T${slot.time}`,
  error_code: err.response?.status || err.code
});
```

See the **vapi** skill for call completion payload shapes, and the **node** skill for fire-and-forget async patterns.
