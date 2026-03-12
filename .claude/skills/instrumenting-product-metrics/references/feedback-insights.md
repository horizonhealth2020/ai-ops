# Feedback & Insights

Explicit caller feedback (star ratings, surveys) disrupts the booking flow
and should not be added to the voice agent. Instead, derive product quality
signals from data that already exists: call outcomes, duration, booking
success rates, and wallet churn patterns.

---

## Post-Call Feedback via n8n Webhook

`POST /api/v1/call/complete` in `src/routes/call.js` already calls
`fireN8nWebhook('call-completed', ...)`. Extend the payload to include
all the signals needed for post-call analysis.

### Extended n8n Webhook Payload

```javascript
'use strict';

const { fireN8nWebhook } = require('../services/bookingService');

// Replace the existing fireN8nWebhook call in src/routes/call.js:
fireN8nWebhook('call-completed', {
  call_id,
  client_id,
  caller_phone,
  duration_seconds,
  intent,
  outcome,                    // 'booked' | 'transferred' | 'message_taken' | 'abandoned'
  booking_id: booking_id || null,
  transcript_summary,
  wallet_deducted_cents: walletResult?.cost_cents || 0,
  balance_after_cents: walletResult?.balance_after_cents || 0,
  timestamp: new Date().toISOString(),
});
```

n8n receives this payload and can route it to:
- A Slack channel for ops review
- PostHog (once installed) for funnel analytics
- A Notion or Airtable database for manual review

---

## call_logs Fields as Feedback Signals

The `call_logs` table captures signals that proxy for call quality
without any additional instrumentation.

| Column | Signal | How to Use |
|---|---|---|
| `outcome` | Whether the call succeeded (`booked`) | Booking conversion rate per client |
| `duration_seconds` | Call length | Short calls with `outcome=abandoned` signal agent failure |
| `transcript_summary` | Caller's words | Search for complaint keywords via n8n/LLM |
| `intent` | What caller wanted | Intent vs. outcome mismatch = agent failure |

### Outcome Distribution Query

```sql
SELECT
  c.business_name,
  c.vertical,
  cl.outcome,
  COUNT(*)                                       AS call_count,
  ROUND(AVG(cl.duration_seconds))                AS avg_duration_sec,
  ROUND(
    100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY cl.client_id), 1
  )                                              AS outcome_pct
FROM call_logs cl
JOIN clients c ON c.id = cl.client_id
WHERE cl.created_at >= NOW() - INTERVAL '30 days'
GROUP BY c.business_name, c.vertical, cl.client_id, cl.outcome
ORDER BY c.business_name, call_count DESC;
```

---

## Wallet Churn Signal

A client whose wallet reaches zero and does not reload within 7 days is
at high churn risk. Detect this in an n8n scheduled workflow querying
`wallet_transactions`.

```sql
-- Clients whose wallet depleted and have not reloaded in 7 days
SELECT
  w.client_id,
  c.business_name,
  c.vertical,
  MAX(wt_depletion.created_at)  AS depleted_at,
  MAX(wt_reload.created_at)     AS last_reload_at
FROM wallets w
JOIN clients c ON c.id = w.client_id
LEFT JOIN wallet_transactions wt_depletion
  ON wt_depletion.client_id = w.client_id
  AND wt_depletion.type = 'usage'
  AND wt_depletion.balance_after_cents = 0
LEFT JOIN wallet_transactions wt_reload
  ON wt_reload.client_id = w.client_id
  AND wt_reload.type = 'credit'
  AND wt_reload.created_at > wt_depletion.created_at
WHERE w.balance_cents = 0
  AND wt_depletion.created_at < NOW() - INTERVAL '7 days'
  AND wt_reload.client_id IS NULL
GROUP BY w.client_id, c.business_name, c.vertical;
```

---

## FSM Verification Failure Rate as Quality Signal

`src/services/bookingService.js` calls the FSM API to verify slot
availability before confirming a booking. When the FSM rejects the slot,
the agent offers alternatives. A high rejection rate signals a data sync
problem between the platform's cached availability and the FSM's state.

Emit a structured log when FSM verification fails:

```javascript
'use strict';

const logger = require('../utils/logger');

// Inside bookingService.createBooking(), after FSM verifySlotAvailability:
if (!slotConfirmed) {
  logger.warn('fsm_slot_rejected', {
    client_id: data.client_id,
    call_id: data.call_id,
    fsm_platform: integration.platform,
    scheduled_date: data.scheduled_date,
    scheduled_time: data.scheduled_time,
  });
}
```

Aggregate this via the log query in n8n or a daily SQL report:

```sql
-- FSM rejection rate by client over 7 days
-- Requires log aggregator or raw JSON log parsing
-- As a proxy, compare bookings.status = 'fsm_rejected' vs 'confirmed':
SELECT
  c.business_name,
  ci.platform          AS fsm_platform,
  COUNT(*) FILTER (WHERE b.status = 'confirmed')     AS confirmed,
  COUNT(*) FILTER (WHERE b.status = 'fsm_rejected')  AS rejected,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE b.status = 'fsm_rejected')
    / NULLIF(COUNT(*), 0), 1
  )                                                   AS rejection_rate_pct
FROM bookings b
JOIN clients c              ON c.id = b.client_id
JOIN client_integrations ci ON ci.client_id = b.client_id AND ci.is_active = true
WHERE b.created_at >= NOW() - INTERVAL '7 days'
GROUP BY c.business_name, ci.platform
ORDER BY rejection_rate_pct DESC;
```

---

## DO / DON'T

DO — use call outcome and duration as the primary proxy for agent quality.
Both fields are already populated in `call_logs` by `POST /api/v1/call/complete`.
A booking conversion rate below 30% for `intent=booking` signals a problem.

DON'T — ask callers for feedback during the call. Inserting a feedback
prompt between the booking confirmation and call close disrupts the
primary job-to-be-done and adds latency. Post-call signals are sufficient.

```javascript
// WRONG — injecting feedback prompt into the voice agent flow
const systemPrompt = client.system_prompt +
  '\nAfter booking, always ask: "On a scale of 1-5 how was your experience?"';

// RIGHT — derive quality from outcome + duration without caller interruption
// Analyze call_logs.outcome and call_logs.duration_seconds in n8n
```

DON'T — rely solely on `transcript_summary` for quality signals.
Summaries are LLM-generated and may miss nuance. Use `outcome` as the
primary signal and `transcript_summary` as a supplementary read for outliers.

---

## Related Skills

See **mapping-user-journeys** skill for tracing how calls flow through the booking pipeline.
See **mapping-conversion-events** skill for defining what "success" means per intent.
See **orchestrating-feature-adoption** skill for turning churn signals into re-engagement flows.
