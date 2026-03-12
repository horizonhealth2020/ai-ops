# Measurement & Testing Reference

## Contents
- Core Metrics
- SQL Measurement Queries
- Structured Log Schema
- Anti-patterns
- Validation Checklist

---

## Core Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| Activation rate | `(clients with ≥1 confirmed booking) / total clients` | `bookings` + `clients` |
| Call-to-book rate | `(calls with outcome='booked') / total calls` | `call_logs` |
| Wallet churn rate | `(clients with balance=0 and no reload in 7d) / active clients` | `clients` + `wallet_transactions` |
| Payment capture rate | `(payment intents created vs confirmed)` | Stripe/Square webhook events |
| Hold abandonment rate | `(holds that expired without confirm booking) / total holds` | `slot_hold_logs` (if tracked) |

---

## SQL Measurement Queries

### Call-to-book rate by vertical

```sql
SELECT
  c.vertical,
  COUNT(*) AS total_calls,
  COUNT(*) FILTER (WHERE cl.outcome = 'booked') AS booked_calls,
  ROUND(
    COUNT(*) FILTER (WHERE cl.outcome = 'booked')::numeric / COUNT(*) * 100,
    1
  ) AS book_rate_pct
FROM call_logs cl
JOIN clients c ON c.client_id = cl.client_id
WHERE cl.completed_at > NOW() - INTERVAL '30 days'
GROUP BY c.vertical
ORDER BY book_rate_pct DESC;
```

### Wallet churn — clients at risk

```sql
SELECT
  c.client_id,
  c.company_name,
  c.billing_tier,
  c.wallet_balance_cents,
  MAX(wt.created_at) AS last_reload,
  COUNT(cl.call_id) FILTER (
    WHERE cl.outcome = 'message_only'
    AND cl.completed_at > NOW() - INTERVAL '7 days'
  ) AS blocked_calls_7d
FROM clients c
LEFT JOIN wallet_transactions wt
  ON wt.client_id = c.client_id AND wt.type = 'reload'
LEFT JOIN call_logs cl ON cl.client_id = c.client_id
WHERE c.is_active = true
  AND c.wallet_balance_cents < 2000  -- less than $20
GROUP BY c.client_id, c.company_name, c.billing_tier, c.wallet_balance_cents
ORDER BY blocked_calls_7d DESC, c.wallet_balance_cents ASC;
```

### Activation funnel by cohort week

```sql
SELECT
  date_trunc('week', c.created_at)::date AS cohort_week,
  COUNT(DISTINCT c.client_id) AS onboarded,
  COUNT(DISTINCT wt.client_id) AS wallet_funded,
  COUNT(DISTINCT b.client_id) AS first_booking
FROM clients c
LEFT JOIN wallet_transactions wt
  ON wt.client_id = c.client_id AND wt.type = 'reload'
LEFT JOIN bookings b
  ON b.client_id = c.client_id AND b.status = 'confirmed'
WHERE c.created_at > NOW() - INTERVAL '90 days'
GROUP BY 1
ORDER BY 1 DESC;
```

---

## Structured Log Schema

Every conversion event must emit a structured log with this shape. Enforce this in code review.

```javascript
// Required fields for any conversion event log
logger.info('event_name', {
  client_id: clientId,       // REQUIRED — tenant isolation
  call_id: callId,           // Include when event is call-scoped
  // event-specific fields below
});
```

### Event catalog

| Event Name | Required Fields | File |
|-----------|----------------|------|
| `call_completed` | `client_id`, `call_id`, `outcome`, `duration_seconds`, `charged_cents` | `src/routes/call.js` |
| `booking_confirmed` | `client_id`, `booking_id`, `fsm_type`, `slot_date`, `is_first_booking` | `src/services/bookingService.js` |
| `wallet_empty_call_blocked` | `client_id`, `call_id` | `src/services/walletService.js` |
| `payment_sms_sent` | `client_id`, `to` (hashed), `sid` | `src/integrations/twilio.js` |
| `client_onboarded` | `client_id`, `vertical`, `fsm_type` | `src/routes/onboard.js` |
| `booking_fsm_rejected` | `client_id`, `fsm_type`, `slot_date`, `slot_time` | `src/services/bookingService.js` |

**NEVER log raw phone numbers** — hash or truncate in event payloads that leave the service boundary.

---

## Anti-patterns

### WARNING: Using `console.log` for conversion events

**The Problem:**
```javascript
// BAD — not queryable, no structure, no metadata
console.log('Booking confirmed for', clientId);
```

**Why This Breaks:**
1. Railway log drain can't parse unstructured lines for alerting
2. No `client_id` field → can't filter by tenant in log search
3. No `duration_ms` or outcome fields → can't measure latency or conversion

**The Fix:**
```javascript
// GOOD — structured, queryable, tenant-scoped
logger.info('booking_confirmed', {
  client_id: clientId,
  booking_id: bookingId,
  fsm_type: fsmType,
  is_first_booking: previousCount === 0,
});
```

### WARNING: Measuring conversion with `SELECT COUNT(*)` without date filter

```sql
-- BAD — grows forever, slow on large tables
SELECT COUNT(*) FROM bookings WHERE status = 'confirmed';

-- GOOD — windowed query, uses index on completed_at
SELECT COUNT(*) FROM bookings
WHERE status = 'confirmed'
  AND created_at > NOW() - INTERVAL '30 days';
```

---

## Validation Checklist

Run these checks after adding a new conversion event:

- [ ] `logger.info('event_name', { client_id, ... })` fires in the happy path
- [ ] `logger.warn(...)` fires on all failure branches (FSM rejected, wallet empty, hold expired)
- [ ] SQL query for the event is tested against the `call_logs` or relevant table
- [ ] No raw PII (phone numbers, names) in the log payload
- [ ] n8n webhook payload includes `client_id` as the first field

See the **postgresql** skill for query index conventions.
See the **instrumenting-product-metrics** skill for turning these events into dashboard-visible metrics.
