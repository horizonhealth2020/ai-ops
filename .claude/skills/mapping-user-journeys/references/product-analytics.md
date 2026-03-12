# Product Analytics Reference

## Contents
- Key events to instrument
- Structured logging as analytics
- Call log queries
- Wallet analytics
- Missing analytics solutions
- DO/DON'T pairs

## Key Events to Instrument

This codebase uses structured JSON logging via `src/utils/logger.js`. These are the events that matter for journey analytics:

| Event | Where | Key Fields |
|-------|-------|-----------|
| `call.started` | `POST /api/v1/context/inject` | `client_id`, `caller_phone`, `is_returning_caller` |
| `slot.held` | `POST /api/v1/availability/hold` | `client_id`, `date`, `time`, `hold_id` |
| `slot.hold_failed` | same | `client_id`, `date`, `time`, `reason` |
| `booking.confirmed` | `POST /api/v1/booking/create` | `client_id`, `booking_id`, `fsm_type`, `duration_ms` |
| `booking.rejected` | same | `client_id`, `date`, `time`, `reason` |
| `payment.intent_created` | `POST /api/v1/payment/create-intent` | `client_id`, `amount_cents`, `processor` |
| `call.completed` | `POST /api/v1/call/complete` | `client_id`, `duration_seconds`, `cost_cents`, `balance_after` |
| `wallet.low_balance` | `POST /api/v1/call/complete` | `client_id`, `balance_cents` |
| `client.onboarded` | `POST /api/v1/onboard` | `client_id`, `vertical`, `fsm_type` |

## Structured Logging as Analytics

```javascript
// src/utils/logger.js — use this, not console.log
const logger = require('../utils/logger');

// Instrument booking confirmation
logger.info('booking.confirmed', {
  client_id: clientId,
  booking_id: bookingResult.id,
  fsm_type: client.fsm_type,
  duration_ms: Date.now() - startTime,
  date: bookingData.date,
  time: bookingData.time,
});
```

Ship these logs to Railway's log drain → a log aggregator (Datadog, Logtail, Axiom) for querying.

## Call Log Queries

```javascript
// src/routes/dashboard.js — GET /api/v1/dashboard/calls
// Paginated, filterable — use this as the analytics read model
const { rows } = await pool.query(
  `SELECT call_id, caller_phone, duration_seconds, cost_cents, created_at, outcome
   FROM call_logs
   WHERE client_id = $1
     AND created_at >= $2
   ORDER BY created_at DESC
   LIMIT $3 OFFSET $4`,
  [clientId, startDate, limit, offset]
);
```

**Friction:** `outcome` field must be populated at `call/complete`. If it's NULL, call analytics are blind to booking vs. no-booking calls.

## Wallet Analytics

```javascript
// src/routes/dashboard.js — GET /api/v1/dashboard/wallet
// Returns balance + transaction history — use for churn prediction
const { rows } = await pool.query(
  `SELECT transaction_type, amount_cents, created_at, description
   FROM wallet_transactions
   WHERE client_id = $1
   ORDER BY created_at DESC LIMIT 50`,
  [clientId]
);
```

**Key metric:** Average days between wallet reloads per client. A lengthening interval signals churn risk.

## WARNING: Missing Dedicated Analytics Layer

**Detected:** No analytics library (Segment, Mixpanel, PostHog, Amplitude) in dependencies.
**Impact:** Product events are buried in application logs. Funnels, retention, and cohort analysis require manual SQL queries.

### Recommended Solution

Add PostHog (self-hostable) or Segment for structured event capture:

```javascript
// npm install posthog-node
const { PostHog } = require('posthog-node');
const posthog = new PostHog(process.env.POSTHOG_API_KEY, { host: process.env.POSTHOG_HOST });

// In src/routes/call.js — POST /api/v1/call/complete
posthog.capture({
  distinctId: clientId,
  event: 'call_completed',
  properties: {
    duration_seconds: durationSeconds,
    cost_cents: costCents,
    outcome: bookingConfirmed ? 'booked' : 'no_booking',
    vertical: client.vertical,
  },
});
```

### Quick Funnel Query (SQL fallback until analytics is added)

```sql
-- Booking funnel: calls started → slot held → booking confirmed
SELECT
  DATE_TRUNC('week', created_at) AS week,
  COUNT(*) FILTER (WHERE event = 'call.started') AS calls_started,
  COUNT(*) FILTER (WHERE event = 'slot.held') AS slots_held,
  COUNT(*) FILTER (WHERE event = 'booking.confirmed') AS bookings_confirmed
FROM app_events
WHERE client_id = $1
GROUP BY week ORDER BY week DESC;
```

## DO / DON'T

```javascript
// DO — log with structured metadata at every journey step
logger.info('slot.hold_failed', { client_id: clientId, reason: 'already_held', alternatives_count: alternatives.length });

// DON'T — log plain strings
console.log('Hold failed for client ' + clientId);
// Unsearchable, unquantifiable, useless in production
```

## Related Skills

- See the **instrumenting-product-metrics** skill for defining activation funnels
- See the **postgresql** skill for writing analytics queries against `call_logs`
- See the **node** skill for async event emission patterns
