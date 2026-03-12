# Product Analytics Reference

## Contents
- Analytics Data Model
- Key Metrics to Query
- Structured Logging as Analytics
- Anti-Patterns
- Dashboard Endpoints for Metrics

---

## Analytics Data Model

There is no dedicated analytics service. All product metrics derive from two PostgreSQL tables:
- `call_logs` — one row per call (duration, caller, outcome, wallet deduction)
- `bookings` — one row per confirmed booking (service, FSM job ID, client)

Both tables are the source of truth. Redis holds no persistent analytics data.

```sql
-- call_logs schema (key analytics columns)
-- client_id, caller_phone, call_duration_seconds, call_outcome,
-- wallet_deducted_cents, fsm_job_created, created_at

-- Core metrics queries:
SELECT
  COUNT(*) AS total_calls,
  AVG(call_duration_seconds) AS avg_duration,
  SUM(wallet_deducted_cents) / 100.0 AS revenue_dollars,
  COUNT(*) FILTER (WHERE call_outcome = 'booked') AS bookings,
  COUNT(*) FILTER (WHERE call_outcome = 'booked')::float / COUNT(*) AS booking_rate
FROM call_logs
WHERE client_id = $1
  AND created_at >= NOW() - INTERVAL '30 days';
```

## Key Metrics to Query

| Metric | Source Table | Business Meaning |
|--------|-------------|-----------------|
| Call volume | call_logs.created_at | Platform usage / growth |
| Booking conversion rate | call_logs.call_outcome | Agent effectiveness |
| Avg call duration | call_logs.call_duration_seconds | Billing projection |
| Wallet burn rate | call_logs.wallet_deducted_cents | Churn risk indicator |
| FSM job creation rate | call_logs.fsm_job_created | Integration health |
| Returning caller rate | call_logs GROUP BY caller_phone | Engagement depth |

## Structured Logging as Analytics

The project uses `src/utils/logger.js` for structured JSON logging. These logs are the
primary observability layer and can feed analytics pipelines.

```javascript
// src/utils/logger.js pattern — every meaningful event logged with metadata
logger.info('call_completed', {
  client_id: clientId,
  call_id: callId,
  duration_seconds: durationSeconds,
  outcome: outcome,           // 'booked' | 'transferred' | 'message_only' | 'abandoned'
  wallet_deducted_cents: deducted,
  fsm_job_id: fsmJobId || null,
});
```

```javascript
// Booking event — ties call to FSM outcome
logger.info('booking_confirmed', {
  client_id: clientId,
  call_id: callId,
  booking_id: bookingId,
  fsm_type: client.fsm_type,
  fsm_job_id: fsmJobId,
  slot_date: date,
  slot_time: time,
});
```

## Anti-Patterns

### WARNING: Querying call_logs Without client_id Filter

**The Problem:**
```javascript
// BAD — cross-tenant data leak
const stats = await pool.query('SELECT COUNT(*) FROM call_logs WHERE created_at > $1', [since]);
```

**Why This Breaks:**
1. Returns aggregate across ALL tenants — meaningless and a data isolation violation
2. On large installs, full table scan without index on client_id

**The Fix:**
```javascript
// GOOD — always scope by client_id
const stats = await pool.query(
  'SELECT COUNT(*) FROM call_logs WHERE client_id = $1 AND created_at > $2',
  [clientId, since]
);
```

## Dashboard Endpoints for Metrics

Scope analytics exposure via the existing dashboard route pattern:

```javascript
// v1 — GET /api/v1/dashboard/calls (already exists)
// Scope: paginated call log with filter by date range, outcome, caller phone

// v2 — GET /api/v1/dashboard/analytics
// Scope: aggregate stats — call volume, booking rate, revenue, avg duration
// Response shape:
{
  period: '30d',
  total_calls: 142,
  booking_rate: 0.34,
  revenue_cents: 286400,
  avg_duration_seconds: 187,
  wallet_balance_cents: 12400
}

// v3 — time-series breakdown for charting (week-over-week, per-vertical)
```

See the **postgresql** skill for query optimization patterns on `call_logs`.
