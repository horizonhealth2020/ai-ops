# Feedback Insights Reference

## Contents
- Signal sources
- Complaint-to-query mapping
- Vertical-specific patterns
- n8n post-call feedback loop
- DO/DON'T pairs
- WARNING: No feedback capture mechanism

## Signal Sources

This platform has three feedback signal sources. Each has different reliability.

| Source | Reliability | How to Access |
|--------|-------------|---------------|
| `call_logs.outcome` | High — system-recorded | SQL query on `call_logs` |
| `call_logs.transcript_summary` | Medium — LLM-generated | Full-text search on `call_logs` |
| Client self-report (email/phone) | Low — often vague | Manual, correlate to `client_id` |

Always correlate self-reported complaints to `call_logs` before acting. Clients frequently misattribute the failure point.

## Complaint-to-Query Mapping

```javascript
// "Agent couldn't book my customer"
const bookingFailures = await pool.query(
  `SELECT cl.call_id, cl.outcome, cl.error_code, b.booking_id
   FROM call_logs cl
   LEFT JOIN bookings b ON b.call_id = cl.call_id
   WHERE cl.client_id = $1
     AND cl.outcome IN ('failed', 'transfer_required')
     AND cl.created_at > NOW() - INTERVAL '7 days'`,
  [clientId]
);
// b.booking_id IS NULL + outcome = 'failed' → booking never attempted → check wallet
// b.booking_id IS NULL + outcome = 'transfer_required' → FSM rejected → check credentials

// "Agent charged me but I got no booking"
const billingWithoutBooking = await pool.query(
  `SELECT wt.amount_cents, wt.call_id, b.booking_id
   FROM wallet_transactions wt
   LEFT JOIN bookings b ON b.call_id = wt.call_id
   WHERE wt.client_id = $1
     AND wt.type = 'debit'
     AND b.booking_id IS NULL
     AND wt.created_at > NOW() - INTERVAL '30 days'`,
  [clientId]
);
// This is a critical billing bug if rows exist — escalate immediately
```

## Vertical-Specific Patterns

Different verticals generate predictably different feedback:

| Vertical | Common Complaint | Likely Root Cause |
|----------|-----------------|-------------------|
| hvac / electrical | "Wrong slot offered" | `cached_availability` stale > 5 min |
| spa | "Booking duration too short" | Default duration in `client_config` wrong |
| restaurant | "Agent doesn't know menu" | FAQ not seeded at onboard |
| all | "Agent transferred me unnecessarily" | `transfer_threshold` in config too low |

```javascript
// Triage: stale availability cache for hvac/electrical
const { rows } = await pool.query(
  `SELECT client_id, availability_updated_at
   FROM clients
   WHERE vertical IN ('hvac', 'electrical')
     AND availability_updated_at < NOW() - INTERVAL '5 minutes'`,
  []
);
// Stale cache → availability shows open slots that FSM has already booked
```

## n8n Post-Call Feedback Loop

Post-call n8n webhooks fire after `POST /api/v1/call/complete`. This is the right place to capture structured feedback signals asynchronously — don't add sync calls to the hot path.

```javascript
// src/routes/call.js — fire n8n webhook after call complete
const webhookPayload = {
  client_id: clientId,
  call_id: callId,
  outcome: outcome,
  duration_seconds: duration,
  cost_cents: costCharged,
  booking_created: !!bookingId,
  timestamp: new Date().toISOString(),
};

await fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/call-complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(webhookPayload),
}).catch(err => logger.warn('n8n webhook failed', { err: err.message }));
// NEVER await this synchronously — it must not block the call completion response
```

## DO/DON'T Pairs

**DO** always correlate client complaints to a specific `call_id` before classifying the issue.

**DON'T** trust "the agent said X" reports without checking `call_logs.transcript_summary` — client memory is unreliable.

**DO** treat billing-without-booking as P0 — charge without service is always an immediate fix.

**DON'T** file backlog items for single-tenant config errors. Verify cross-tenant impact first (see [roadmap-experiments.md](roadmap-experiments.md)).

## WARNING: No Feedback Capture Mechanism

**Detected:** No in-product feedback widget, NPS survey, or structured feedback endpoint in this codebase.

**Impact:** All feedback arrives via self-report (email/phone). By the time feedback is received, the client may have already churned silently.

**Recommended Quick Win:** Add a `POST /api/v1/feedback` endpoint that accepts a call rating after completion. Wire it to n8n for async processing.

```javascript
// src/routes/feedback.js — lightweight call rating endpoint
'use strict';
const router = require('express').Router();
const { requireVapiAuth } = require('../middleware/auth');
const pool = require('../config/database');
const logger = require('../utils/logger');

router.post('/', requireVapiAuth, async (req, res, next) => {
  try {
    const { call_id, client_id, rating, comment } = req.body;
    await pool.query(
      'INSERT INTO call_feedback (call_id, client_id, rating, comment) VALUES ($1, $2, $3, $4)',
      [call_id, client_id, rating, comment]
    );
    logger.info('call_feedback_received', { call_id, client_id, rating });
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

See the **instrumenting-product-metrics** skill for tying feedback ratings to activation and retention funnels.
