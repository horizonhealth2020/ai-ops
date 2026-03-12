# Product Analytics Queries

> WARNING: This project has no analytics SDK in `package.json`. There is no
> Mixpanel, Segment, or PostHog client installed. Run
> `npm install posthog-node` and configure `POSTHOG_API_KEY` in `.env` before
> building a real analytics pipeline. Until then, use the `logEvent()` helper
> (see activation-onboarding.md) to write structured events to logs and
> forward them to n8n.

---

## logEvent() Utility

Define in `src/utils/analytics.js`. Import only from route files.
Uses the existing `src/utils/logger.js` for structured output and
`fireN8nWebhook` for async fan-out.

```javascript
'use strict';

const logger = require('./logger');
const { fireN8nWebhook } = require('../services/bookingService');

/**
 * Emit a structured product event to logs and n8n.
 * Never awaits the n8n call — fully fire-and-forget.
 *
 * @param {string} event
 * @param {object} props  - must include client_id
 */
function logEvent(event, props) {
  if (!props || !props.client_id) {
    logger.warn('logEvent: missing client_id', { event });
    return;
  }
  logger.info('product_event', {
    event,
    ...props,
    ts: new Date().toISOString(),
  });
  fireN8nWebhook('product-event', {
    event,
    ...props,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { logEvent };
```

---

## Activation Funnel Query (CTE)

Measures the four-stage funnel: onboard → wallet_funded → first_call →
first_booking. Run via `psql $PGBOUNCER_URL` or a scheduled n8n workflow.

```sql
WITH onboarded AS (
  SELECT id AS client_id, vertical, created_at AS onboarded_at
  FROM clients
  WHERE status = 'active'
),
wallet_funded AS (
  SELECT DISTINCT wt.client_id, MIN(wt.created_at) AS funded_at
  FROM wallet_transactions wt
  WHERE wt.type = 'credit' AND wt.amount_cents > 0
  GROUP BY wt.client_id
),
first_call AS (
  SELECT DISTINCT cl.client_id, MIN(cl.created_at) AS first_call_at
  FROM call_logs cl
  GROUP BY cl.client_id
),
first_booking AS (
  SELECT DISTINCT b.client_id, MIN(b.created_at) AS first_booking_at
  FROM bookings b
  GROUP BY b.client_id
)
SELECT
  o.client_id,
  o.vertical,
  o.onboarded_at,
  wf.funded_at,
  fc.first_call_at,
  fb.first_booking_at,
  (wf.client_id  IS NOT NULL)::int AS reached_wallet_funded,
  (fc.client_id  IS NOT NULL)::int AS reached_first_call,
  (fb.client_id  IS NOT NULL)::int AS reached_first_booking
FROM onboarded o
LEFT JOIN wallet_funded wf ON wf.client_id = o.client_id
LEFT JOIN first_call fc    ON fc.client_id = o.client_id
LEFT JOIN first_booking fb ON fb.client_id = o.client_id
ORDER BY o.onboarded_at DESC;
```

---

## Per-Vertical Funnel Breakdown

Groups funnel completion rates by `clients.vertical` column
(hvac, spa, electrical, plumbing, restaurant, cleaning).

```sql
SELECT
  c.vertical,
  COUNT(*)                                                    AS total_clients,
  COUNT(wt.client_id)                                         AS wallet_funded,
  COUNT(cl.client_id)                                         AS had_first_call,
  COUNT(b.client_id)                                          AS had_first_booking,
  ROUND(
    100.0 * COUNT(b.client_id) / NULLIF(COUNT(*), 0), 1
  )                                                           AS booking_conversion_pct
FROM clients c
LEFT JOIN (
  SELECT DISTINCT client_id FROM wallet_transactions WHERE type = 'credit'
) wt ON wt.client_id = c.id
LEFT JOIN (
  SELECT DISTINCT client_id FROM call_logs
) cl ON cl.client_id = c.id
LEFT JOIN (
  SELECT DISTINCT client_id FROM bookings
) b ON b.client_id = c.id
WHERE c.status = 'active'
GROUP BY c.vertical
ORDER BY booking_conversion_pct DESC;
```

---

## Cohort Retention Query

Groups clients by signup week and counts how many are still active
(had a call) in subsequent weeks.

```sql
SELECT
  DATE_TRUNC('week', c.created_at)   AS cohort_week,
  DATE_TRUNC('week', cl.created_at)  AS activity_week,
  COUNT(DISTINCT cl.client_id)        AS active_clients
FROM clients c
JOIN call_logs cl ON cl.client_id = c.id
WHERE c.status = 'active'
GROUP BY cohort_week, activity_week
ORDER BY cohort_week, activity_week;
```

---

## DO / DON'T

DO — batch analytics writes via n8n. The n8n webhook in `fireN8nWebhook`
is already fire-and-forget. Let n8n fan out to PostHog, a data warehouse,
or Slack. Keep the Express process free of blocking analytics I/O.

DON'T — use `console.log` for product events. The structured logger in
`src/utils/logger.js` emits JSON with `level`, `message`, and `timestamp`
fields that log aggregators (Datadog, Papertrail) can parse and index.

```javascript
// WRONG — unstructured, unparseable, no client_id
console.log('booking created for', callerId);

// RIGHT — structured event with all dimensions
logger.info('product_event', {
  event: 'first_booking_created',
  client_id: clientId,
  call_id: callId,
  service_type: serviceType,
  ts: new Date().toISOString(),
});
```

DON'T — run funnel queries inline in request handlers. These are
analytical queries with multiple LEFT JOINs. Run them in a scheduled
n8n workflow or a separate reporting script, not in the Express hot path.

---

## Related Skills

See **postgresql** skill for CTE patterns and migration conventions.
See **node** skill for async patterns and environment variable validation.
See **mapping-conversion-events** skill for event naming conventions.
