# Product Analytics Reference

## Contents
- Event logging pattern
- Key onboarding funnel events
- Activation metrics queries
- Funnel drop-off detection
- Anti-patterns

---

## Event Logging Pattern

This codebase uses structured JSON logging via `src/utils/logger.js`. There is no third-party analytics SDK. Product events are logged as structured JSON and must be queryable from Railway's log stream or a downstream sink (e.g., n8n writing to a `product_events` table).

Log every meaningful state transition with a consistent `event` field:

```javascript
// src/utils/logger.js pattern — used for product events
logger.info('product_event', {
  event: 'client_onboarded',      // snake_case event name
  client_id: clientId,
  vertical: client.vertical,
  tier: client.tier,
  timestamp: new Date().toISOString(),
});
```

If you need queryable event history, write to a `product_events` table:

```sql
-- migrations/005_product_events.sql
CREATE TABLE product_events (
  id           BIGSERIAL PRIMARY KEY,
  client_id    UUID NOT NULL REFERENCES clients(client_id),
  event        TEXT NOT NULL,
  properties   JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON product_events (client_id, event, created_at DESC);
```

```javascript
// src/services/analyticsService.js
'use strict';
const pool = require('../config/database');

async function track(clientId, event, properties = {}) {
  await pool.query(
    'INSERT INTO product_events (client_id, event, properties) VALUES ($1, $2, $3)',
    [clientId, event, JSON.stringify(properties)]
  );
}

module.exports = { track };
```

---

## Key Onboarding Funnel Events

Track these events to measure activation funnel health:

| Event | Fired in | Properties |
|-------|----------|------------|
| `client_onboarded` | `src/routes/onboard.js` | `vertical`, `tier`, `fsm_type` |
| `wallet_funded` | `src/services/walletService.js` | `amount_cents`, `balance_after_cents` |
| `fsm_connected` | `src/routes/dashboard.js PUT /scheduling` | `fsm_type` |
| `vapi_configured` | n8n webhook (async) | `assistant_id` |
| `first_call_handled` | `src/routes/call.js POST /complete` | `duration_seconds`, `call_outcome` |
| `first_booking_created` | `src/routes/booking.js` | `fsm_type`, `booking_date` |

Fire `client_onboarded` in the onboard route:

```javascript
// src/routes/onboard.js — after successful provisioning
const { track } = require('../services/analyticsService');
await track(clientId, 'client_onboarded', { vertical, tier, fsm_type });
```

Fire `first_call_handled` exactly once per client:

```javascript
// src/routes/call.js — POST /complete
const { rows: [existing] } = await pool.query(
  "SELECT 1 FROM product_events WHERE client_id = $1 AND event = 'first_call_handled' LIMIT 1",
  [clientId]
);
if (!existing) {
  await track(clientId, 'first_call_handled', {
    duration_seconds: callDurationSeconds,
    call_outcome: outcome,
  });
}
```

---

## Activation Metrics Queries

**Funnel conversion by step:**

```sql
-- Clients who completed each activation step
SELECT
  COUNT(*) FILTER (WHERE event = 'client_onboarded')   AS onboarded,
  COUNT(*) FILTER (WHERE event = 'wallet_funded')       AS wallet_funded,
  COUNT(*) FILTER (WHERE event = 'fsm_connected')       AS fsm_connected,
  COUNT(*) FILTER (WHERE event = 'first_call_handled')  AS first_call,
  COUNT(*) FILTER (WHERE event = 'first_booking_created') AS first_booking
FROM (
  SELECT DISTINCT ON (client_id, event) client_id, event
  FROM product_events
  WHERE created_at >= NOW() - INTERVAL '30 days'
) e;
```

**Median time from onboard to first call:**

```sql
SELECT
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY (first_call.created_at - onboard.created_at)
  ) AS median_time_to_first_call
FROM product_events onboard
JOIN product_events first_call USING (client_id)
WHERE onboard.event = 'client_onboarded'
  AND first_call.event = 'first_call_handled';
```

---

### WARNING: Logging Events on the Vapi Hot Path

**The Problem:**

```javascript
// BAD — analytics insert inside POST /api/v1/context/inject
await track(clientId, 'call_started', { ... }); // adds ~150ms on every LLM request
```

**Why This Breaks:**
1. `context/inject` must respond in <200ms — a synchronous DB insert burns that budget
2. Vapi will time out the request if the SSE stream doesn't start in time
3. Every call gets penalized even when the analytics table is under load

**The Fix:**

```javascript
// GOOD — fire analytics async, don't await
track(clientId, 'call_started', { ... })
  .catch(err => logger.error('analytics track failed', { err: err.message }));
```

Or handle activation events exclusively in `POST /api/v1/call/complete`, which is not on the hot path.

See the **vapi** skill for latency requirements on the context injection endpoint.
