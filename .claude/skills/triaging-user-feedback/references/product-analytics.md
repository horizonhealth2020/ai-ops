# Product Analytics Reference

## Contents
- Primary product events
- Call outcome funnel
- Dashboard usage tracking
- Wallet health metrics
- WARNING: Missing analytics library

## Primary Product Events

This backend has no dedicated analytics SDK (no Segment, Mixpanel, or PostHog in dependencies). All product analytics must be derived from PostgreSQL (`call_logs`, `bookings`, `wallet_transactions`) and structured logs via `logger.js`.

```javascript
// src/utils/logger.js — structured log as analytics event
logger.info('call_completed', {
  client_id: clientId,
  call_id: callId,
  outcome: outcome,           // booking_confirmed | transfer_required | failed | message_only
  duration_seconds: duration,
  cost_cents: costCharged,
  fsm_verified: fsmVerified,
});
```

## Call Outcome Funnel

The core product funnel: incoming call → context injected → booking attempted → booking confirmed.

```javascript
// Triage query: funnel drop-off by client
const { rows } = await pool.query(
  `SELECT
     COUNT(*) FILTER (WHERE outcome IS NOT NULL) AS total_calls,
     COUNT(*) FILTER (WHERE outcome = 'booking_confirmed') AS bookings_confirmed,
     COUNT(*) FILTER (WHERE outcome = 'transfer_required') AS transfers,
     COUNT(*) FILTER (WHERE outcome = 'failed') AS failures,
     COUNT(*) FILTER (WHERE outcome = 'message_only') AS wallet_empty
   FROM call_logs
   WHERE client_id = $1
     AND created_at > NOW() - INTERVAL '30 days'`,
  [clientId]
);
// High wallet_empty → reload nudge needed (engagement gap)
// High failures → booking/payment bug (backlog item)
// High transfers → agent capability gap (roadmap item)
```

## Dashboard Usage Tracking

Track which dashboard endpoints each client calls. Unused endpoints = adoption gap.

```javascript
// Add to src/middleware — log before route handler
function analyticsMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('api_request', {
      client_id: req.auth?.clientId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    });
  });
  next();
}
```

## Wallet Health Metrics

```javascript
// Weekly wallet health snapshot — run via n8n cron
const { rows } = await pool.query(
  `SELECT
     tier,
     COUNT(*) AS client_count,
     AVG(balance_cents) AS avg_balance_cents,
     COUNT(*) FILTER (WHERE balance_cents = 0) AS zero_balance_count
   FROM client_wallets
   GROUP BY tier`
);
// High zero_balance_count in 'standard' tier → low-balance warning feature needed
```

## WARNING: Missing Analytics Library

**Detected:** No analytics SDK (Segment, PostHog, Mixpanel) in `package.json`.

**Impact:** All product metrics must be reconstructed from `call_logs` SQL queries. There is no real-time funnel visibility and no user-level event history.

**Recommended Quick Win:** Wrap `logger.js` calls with a consistent event schema now, so a future analytics SDK can be dropped in without changing call sites:

```javascript
// src/utils/analytics.js — thin wrapper, SDK-ready
'use strict';
const logger = require('./logger');

function track(event, properties) {
  logger.info(event, properties);
  // Future: analyticsClient.track({ event, properties });
}

module.exports = { track };
```

See the **instrumenting-product-metrics** skill for event taxonomy and activation metric definitions.
