# Measurement & Testing Reference

## Contents
- Signup funnel stages to instrument
- SQL queries for funnel analysis
- Key activation metrics
- A/B testing the onboard payload
- WARNING: missing analytics infrastructure

---

## Signup Funnel Stages to Instrument

The onboard-to-active-agent funnel has distinct stages, each with a measurable conversion rate.
Add `logger.info()` calls with structured metadata at each stage.

```javascript
// src/routes/onboard.js — instrument each stage

// Stage 1: Onboard attempted
logger.info('onboard_attempted', { business_phone, vertical, wallet_tier });

// Stage 2: Client record created (after COMMIT)
logger.info('client_created', { client_id: clientId, business_name, vertical });

// Stage 3: Prompt compiled
logger.info('prompt_compiled', { client_id: clientId, success: promptReady });

// Stage 4: First wallet funding (in walletService.js on top-up)
logger.info('wallet_funded', { client_id: clientId, amount_cents, tier });

// Stage 5: First live call (in src/routes/call.js on complete)
logger.info('first_call_completed', { client_id: clientId, duration_sec, outcome });
```

---

## SQL Queries for Funnel Analysis

Query the `clients`, `wallets`, and `call_logs` tables to measure each stage.

```sql
-- Clients created but never funded (wallet = $0)
SELECT c.id, c.business_name, c.created_at, w.balance_cents
FROM clients c
JOIN wallets w ON w.client_id = c.id
WHERE w.balance_cents = 0
  AND c.created_at > NOW() - INTERVAL '30 days'
ORDER BY c.created_at DESC;

-- Time from onboard to first call (activation lag)
SELECT
  c.id,
  c.business_name,
  c.created_at AS onboarded_at,
  MIN(cl.created_at) AS first_call_at,
  EXTRACT(EPOCH FROM (MIN(cl.created_at) - c.created_at)) / 3600 AS hours_to_first_call
FROM clients c
LEFT JOIN call_logs cl ON cl.client_id = c.id
WHERE c.created_at > NOW() - INTERVAL '30 days'
GROUP BY c.id, c.business_name, c.created_at
ORDER BY hours_to_first_call NULLS LAST;

-- Clients by vertical + activation rate
SELECT
  vertical,
  COUNT(*) AS total,
  COUNT(cl.client_id) AS activated,
  ROUND(COUNT(cl.client_id)::numeric / COUNT(*) * 100, 1) AS activation_pct
FROM clients c
LEFT JOIN (
  SELECT DISTINCT client_id FROM call_logs
) cl ON cl.client_id = c.id
GROUP BY vertical;
```

---

## Key Activation Metrics

| Metric | Definition | Target |
|--------|-----------|--------|
| Onboard completion rate | % of started intakes that POST successfully | >90% |
| Wallet activation rate | % of clients that fund wallet within 24h | Baseline first |
| Time-to-first-call | Hours from onboard to first `call/complete` event | <48h |
| Prompt compile success | % of onboards where `system_prompt IS NOT NULL` | 100% |
| 7-day retention | % of clients with a call in week 2 | Baseline first |

---

## A/B Testing the Onboard Payload

Since the onboard endpoint is called from n8n or external forms, test payload variations
by routing cohorts through different form versions and comparing activation rates.

```javascript
// In n8n: route A/B cohorts by splitting on business_phone hash
const cohort = parseInt(business_phone.slice(-1)) % 2 === 0 ? 'control' : 'treatment';

// Control: standard tier default
// Treatment: pre-select 'growth' tier for higher engagement signal
const payload = {
  business_name,
  business_phone,
  vertical,
  wallet_tier: cohort === 'treatment' ? 'growth' : 'standard',
};

// Tag the cohort in the onboard call for later analysis:
logger.info('onboard_ab_cohort', { cohort, business_phone: payload.business_phone });
```

---

## WARNING: Missing Analytics Infrastructure

**Detected:** No analytics library (`posthog-node`, `mixpanel`, `segment`, `amplitude`) in `package.json`.

**Impact:**
- Funnel drop-off is invisible — you cannot identify which signup step loses operators
- Activation metrics require manual SQL queries instead of dashboards
- No A/B test result tracking without custom tooling

**Recommended Solution (lightweight, no new dependency):**

Use the existing `logger.js` structured logs + Railway log drain to pipe events to a logging
platform (Datadog, Papertrail, Logtail). All `logger.info()` calls with an `event` field become
queryable metrics without installing an analytics SDK.

```javascript
// src/utils/logger.js — existing logger already uses JSON output
// Add a dedicated event tracking helper:

function track(eventName, properties) {
  logger.info(eventName, { ...properties, _type: 'analytics_event' });
}

module.exports = { ...logger, track };

// Usage in onboard.js:
const { track } = require('../utils/logger');
track('client_onboarded', { client_id: clientId, vertical, wallet_tier });
```

Then query `_type = analytics_event` in your log platform to build funnels.

---

## Related Skills

- See the **instrumenting-product-metrics** skill for event tracking patterns
- See the **mapping-conversion-events** skill for funnel event definitions
- See the **running-product-experiments** skill for A/B test infrastructure
