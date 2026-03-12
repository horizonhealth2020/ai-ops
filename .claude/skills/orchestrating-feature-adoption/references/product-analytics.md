# Product Analytics Reference

## Contents
- Event Sources
- WARNING: Missing Analytics Layer
- Adoption Metrics SQL
- Funnel Queries
- Structured Logging as Analytics

---

## Event Sources

This project has no dedicated analytics library (no Segment, Mixpanel, or PostHog). All product analytics must be derived from:

1. **`call_logs` table** — call volume, duration, outcomes per client
2. **`bookings` table** — booking conversion rate
3. **`payment_intents` table** — payment adoption
4. **`wallets` + `wallet_transactions` tables** — revenue per client
5. **`client_integrations` table** — FSM adoption
6. **`clients` table** — activation milestones, `activation_completed_at`
7. **Structured logger output** — server-side event stream via `src/utils/logger.js`

## WARNING: Missing Analytics Layer

**Detected:** No analytics SDK (`segment`, `posthog-node`, `mixpanel`, `@amplitude/analytics-node`) in `package.json`.

**Impact:**
- No funnel visibility between onboarding steps
- Impossible to know which clients are stuck at which activation step without raw SQL queries
- No cohort analysis or retention metrics without custom queries on `call_logs`

### Recommended Solution

For lightweight analytics without a third-party SDK, instrument key events through the structured logger and ship logs to a log aggregator (Railway supports Datadog, Papertrail, Logtail):

```javascript
// src/utils/analytics.js
'use strict';

const logger = require('./logger');

function track(event, properties) {
  logger.info(event, {
    _analytics: true,  // filter in log aggregator
    event,
    ...properties,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { track };
```

Instrument activation milestones:

```javascript
// src/routes/onboard.js
const { track } = require('../utils/analytics');

track('client_onboarded', {
  client_id: clientId,
  vertical,
  source: 'intake_form',
});
```

```javascript
// src/services/walletService.js
track('wallet_funded', {
  client_id: clientId,
  amount_cents: amountCents,
  tier: newTier,
});
```

## Adoption Metrics SQL

Run these against PostgreSQL to understand feature adoption across the tenant base:

```sql
-- Activation funnel by step
SELECT
  COUNT(*) FILTER (WHERE true) AS total_clients,
  COUNT(*) FILTER (WHERE total_calls > 0) AS received_first_call,
  COUNT(*) FILTER (WHERE activation_completed_at IS NOT NULL) AS fully_activated,
  COUNT(*) FILTER (WHERE vapi_assistant_id IS NOT NULL) AS vapi_configured
FROM clients
WHERE is_active = true;
```

```sql
-- FSM adoption by vertical
SELECT
  c.vertical,
  COUNT(DISTINCT c.client_id) AS total_clients,
  COUNT(DISTINCT ci.client_id) FILTER (WHERE ci.is_active = true) AS fsm_connected,
  ROUND(
    COUNT(DISTINCT ci.client_id) FILTER (WHERE ci.is_active = true)::numeric
    / NULLIF(COUNT(DISTINCT c.client_id), 0) * 100, 1
  ) AS fsm_adoption_pct
FROM clients c
LEFT JOIN client_integrations ci ON ci.client_id = c.client_id AND ci.integration_type = 'fsm'
WHERE c.is_active = true
GROUP BY c.vertical
ORDER BY fsm_adoption_pct DESC;
```

```sql
-- Booking conversion rate per client (last 30 days)
SELECT
  c.client_id,
  c.business_name,
  c.vertical,
  COUNT(DISTINCT cl.call_id) AS calls,
  COUNT(DISTINCT b.booking_id) AS bookings,
  ROUND(COUNT(DISTINCT b.booking_id)::numeric / NULLIF(COUNT(DISTINCT cl.call_id), 0) * 100, 1) AS booking_rate_pct
FROM clients c
LEFT JOIN call_logs cl ON cl.client_id = c.client_id AND cl.started_at > NOW() - INTERVAL '30 days'
LEFT JOIN bookings b ON b.client_id = c.client_id AND b.created_at > NOW() - INTERVAL '30 days'
WHERE c.is_active = true
GROUP BY c.client_id, c.business_name, c.vertical
ORDER BY booking_rate_pct DESC;
```

## Funnel Queries

Track the onboarding funnel — where do new clients drop off?

```sql
-- Weekly activation cohort funnel
SELECT
  DATE_TRUNC('week', c.created_at) AS cohort_week,
  COUNT(*) AS onboarded,
  COUNT(*) FILTER (WHERE w.balance_cents > 0) AS funded_wallet,
  COUNT(*) FILTER (WHERE ci.client_id IS NOT NULL) AS connected_fsm,
  COUNT(*) FILTER (WHERE c.vapi_assistant_id IS NOT NULL) AS configured_vapi,
  COUNT(*) FILTER (WHERE c.total_calls > 0) AS received_first_call
FROM clients c
LEFT JOIN wallets w ON w.client_id = c.client_id
LEFT JOIN client_integrations ci ON ci.client_id = c.client_id AND ci.integration_type = 'fsm' AND ci.is_active = true
WHERE c.created_at > NOW() - INTERVAL '90 days'
GROUP BY cohort_week
ORDER BY cohort_week DESC;
```

## Structured Logging as Analytics

The structured logger in `src/utils/logger.js` already outputs JSON. Use consistent event names so logs become queryable:

```javascript
// Consistent event naming convention: noun_verb (past tense)
logger.info('call_completed', { client_id, call_id, duration_seconds, outcome, cost_cents });
logger.info('booking_created', { client_id, booking_id, fsm_type, slot_date });
logger.info('payment_intent_created', { client_id, intent_id, amount_cents, processor });
logger.info('slot_hold_acquired', { client_id, call_id, slot_date, slot_time });
logger.info('slot_hold_expired', { client_id, call_id });  // logged in call.complete handler
logger.info('wallet_balance_low', { client_id, balance_cents, tier });
```

NEVER use `console.log` for events you need to analyze — it defeats structured logging. See the **node** skill for logger setup.
