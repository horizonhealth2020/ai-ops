# Feedback & Insights Reference

## Contents
- Feedback Signals Available
- Call Outcome as Product Signal
- n8n Webhooks for Async Feedback
- Anti-Patterns
- Scoping Feedback-Driven Features

---

## Feedback Signals Available

There is no in-app feedback widget or survey mechanism. Product signals come from:

1. **call_logs.call_outcome** — `booked`, `transferred`, `message_only`, `abandoned`
2. **call_logs.caller_phone** — repeat callers indicate agent satisfaction
3. **bookings table** — confirmed bookings = positive signal
4. **Wallet churn** — clients who don't top up after depletion have churned
5. **FSM job creation failures** — logged errors in n8n webhook indicate integration problems

## Call Outcome as Product Signal

`call_outcome` is the primary feedback metric. Scope features that improve the `booked` rate.

```javascript
// src/routes/call.js — POST /api/v1/call/complete
// This is where call outcome is recorded and is the richest feedback point
router.post('/api/v1/call/complete', requireVapiAuth, async (req, res, next) => {
  try {
    const { callId, clientId, durationSeconds, outcome, callerPhone } = req.body;
    await pool.query(
      `INSERT INTO call_logs
         (call_id, client_id, caller_phone, call_duration_seconds, call_outcome, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [callId, clientId, callerPhone, durationSeconds, outcome]
    );
    await walletService.deduct(clientId, durationSeconds);
    await redis.del(`call_holds:${callId}`); // Release any active slot hold
    // Fire n8n webhook for async post-call processing
    await axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/call-complete`, {
      call_id: callId, client_id: clientId, outcome
    });
    res.json({ status: 'logged' });
  } catch (err) {
    next(err);
  }
});
```

## n8n Webhooks for Async Feedback

All feedback-driven side effects belong in n8n, not in Express routes. Express routes must
return within call latency constraints. n8n handles everything post-call.

```javascript
// What n8n receives on call-complete:
{
  call_id: 'uuid',
  client_id: 'uuid',
  outcome: 'booked' | 'transferred' | 'message_only' | 'abandoned',
  duration_seconds: 187,
  caller_phone: '+13055551234'
}

// n8n can then:
// - Send booking confirmation SMS via Twilio (outcome === 'booked')
// - Alert client if wallet balance is low
// - Sync booking to CRM
// - Log to external analytics (Segment, Amplitude, etc.)
// NEVER put these in Express — they are async and non-blocking
```

## Anti-Patterns

### WARNING: Blocking Express on Post-Call Side Effects

**The Problem:**
```javascript
// BAD — awaiting CRM sync inside /call/complete route
router.post('/api/v1/call/complete', async (req, res, next) => {
  await walletService.deduct(clientId, durationSeconds);
  await crmService.syncBooking(booking); // External API — could take 2s+
  await twilioClient.sendSms(phone, confirmationMsg); // Another external call
  res.json({ status: 'complete' }); // Caller already hung up
});
```

**Why This Breaks:**
1. Adds seconds of latency to call completion — Vapi may timeout and retry
2. If CRM is slow, the call completion response fails, wallet may not deduct
3. Any failure blocks the entire completion flow, including wallet deduction

**The Fix:**
```javascript
// GOOD — fire-and-forget webhook to n8n, return immediately
await walletService.deduct(clientId, durationSeconds); // fast, local
axios.post(n8nUrl, payload).catch(err =>               // non-blocking
  logger.error('n8n webhook failed', { error: err.message, call_id: callId })
);
res.json({ status: 'logged' });
```

## Scoping Feedback-Driven Features

Use call outcome data to prioritize next features:

| Signal | Feature to Scope |
|--------|-----------------|
| High `transferred` rate for a vertical | Add more FSM slot types for that vertical |
| High `abandoned` rate | Improve agent fallback responses — shorten TTL hold to reduce wait |
| High `message_only` rate | Client wallet is depleted — scope low-balance alert + top-up flow |
| Low repeat caller rate | Caller memory not surfacing context — audit callerMemory.js queries |
| FSM job failures in n8n | New FSM integration error handling — scope retry with backoff |

See the **vapi** skill for call lifecycle details and the **twilio** skill for SMS notification scoping.
