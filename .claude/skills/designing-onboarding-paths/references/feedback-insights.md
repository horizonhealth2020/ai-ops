# Feedback & Insights Reference

## Contents
- Call outcome as feedback signal
- Caller sentiment from call logs
- FSM rejection as product signal
- Low-balance churn signal
- Surfacing insights in dashboard API
- Anti-patterns

---

## Call Outcome as Feedback Signal

`POST /api/v1/call/complete` receives the full call summary from Vapi. Log the outcome field and use it to surface insights to the client.

```javascript
// src/routes/call.js — POST /complete
router.post('/complete', requireVapiAuth, async (req, res, next) => {
  try {
    const { call_id, client_id, duration_seconds, outcome, summary } = req.body;

    await pool.query(
      `INSERT INTO call_logs (call_id, client_id, duration_seconds, outcome, summary, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [call_id, client_id, duration_seconds, outcome, summary]
    );

    logger.info('call_completed', { call_id, client_id, duration_seconds, outcome });
  } catch (err) {
    next(err);
  }
});
```

Valid `outcome` values to track: `booked`, `transferred`, `message_taken`, `abandoned`, `payment_collected`.

---

## Outcome Insights in Dashboard

Surface a breakdown of outcomes in `GET /api/v1/dashboard/calls`. Clients use this to understand agent performance:

```javascript
// src/routes/dashboard.js — append to calls response
const { rows: outcomeSummary } = await pool.query(
  `SELECT outcome, COUNT(*) as count
   FROM call_logs
   WHERE client_id = $1
     AND created_at >= NOW() - INTERVAL '30 days'
   GROUP BY outcome`,
  [clientId]
);

res.json({
  calls,
  total,
  outcome_summary: outcomeSummary.reduce((acc, row) => {
    acc[row.outcome] = parseInt(row.count, 10);
    return acc;
  }, {}),
});
```

---

## FSM Rejection as Product Signal

When `POST /api/v1/booking/create` gets a rejection from the FSM adapter, log it as a product event. High rejection rates indicate FSM sync lag or misconfigured availability:

```javascript
// src/services/bookingService.js
const isAvailable = await adapter.verifySlotAvailability(credentials, clientId, date, time);

if (!isAvailable) {
  logger.warn('fsm_slot_rejected', { client_id: clientId, date, time, fsm_type: client.fsm_type });
  // Also track for insights
  await pool.query(
    `INSERT INTO product_events (client_id, event, properties)
     VALUES ($1, 'booking_rejected_by_fsm', $2)`,
    [clientId, JSON.stringify({ date, time, fsm_type: client.fsm_type })]
  );
}
```

Surface FSM rejection rate in the dashboard config response when it exceeds 20% of booking attempts:

```javascript
const { rows: [bookingStats] } = await pool.query(
  `SELECT
     COUNT(*) FILTER (WHERE event = 'booking_rejected_by_fsm') AS rejections,
     COUNT(*) FILTER (WHERE event = 'first_booking_created')   AS successes
   FROM product_events
   WHERE client_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
  [clientId]
);

const totalAttempts = parseInt(bookingStats.rejections, 10) + parseInt(bookingStats.successes, 10);
const rejectionRate = totalAttempts > 0 ? bookingStats.rejections / totalAttempts : 0;

if (rejectionRate > 0.2) {
  nudges.push({
    type: 'fsm_sync_lag',
    severity: 'warning',
    heading: 'Booking conflicts detected',
    message: 'Your scheduling software is rejecting slots the agent offers. Check your availability sync settings.',
    cta: { label: 'Review FSM settings', action: 'open_fsm_setup' },
  });
}
```

---

## Low-Balance Churn Signal

Clients who hit zero balance and don't top up within 48h are churn risks. Fire an n8n webhook to trigger a follow-up:

```javascript
// src/services/walletService.js — after deducting call cost
const { rows: [wallet] } = await pool.query(
  'SELECT balance_cents FROM wallets WHERE client_id = $1',
  [clientId]
);

if (wallet.balance_cents <= 0) {
  logger.warn('wallet_depleted', { client_id: clientId });

  // Async — n8n handles follow-up SMS/email via Twilio
  fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/wallet-depleted`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, depleted_at: new Date().toISOString() }),
  }).catch(err => logger.error('n8n wallet-depleted webhook failed', { err: err.message }));
}
```

See the **twilio** skill for the SMS notification implementation in n8n.

---

### WARNING: Querying Call Logs for Insights on Every Dashboard Request

**The Problem:**

```javascript
// BAD — full table scan on every GET /api/v1/dashboard/config
const { rows } = await pool.query(
  'SELECT outcome, COUNT(*) FROM call_logs WHERE client_id = $1 GROUP BY outcome',
  [clientId]
);
```

**Why This Breaks:**
1. `call_logs` grows unbounded — a client with 10k calls causes a slow GROUP BY on every config fetch
2. Insights are not real-time — a 5-minute cache is fine
3. Blocks the PgBouncer pool slot for the duration of the aggregate query

**The Fix:**

```javascript
// GOOD — cache insight summaries in Redis with a 5-minute TTL
const cacheKey = `insights:${clientId}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

const { rows } = await pool.query(
  'SELECT outcome, COUNT(*) FROM call_logs WHERE client_id = $1 GROUP BY outcome',
  [clientId]
);
await redis.set(cacheKey, JSON.stringify(rows), 'EX', 300);
return rows;
```

See the **redis** skill for caching patterns used in this codebase.
