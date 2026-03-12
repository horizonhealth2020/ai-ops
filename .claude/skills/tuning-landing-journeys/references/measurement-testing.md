# Measurement & Testing Reference

## Contents
- Key funnel metrics
- Querying call_logs for funnel data
- Wallet conversion queries
- A/B testing patterns for API responses
- Anti-patterns

---

## Key Funnel Metrics

Four metrics define conversion health for this platform:

| Metric | Definition | Query target |
|--------|-----------|-------------|
| Onboard completion rate | % of intakes that result in `clients.status = 'active'` | `clients` table |
| Activation rate | % of active clients that fund wallet within 7 days | `wallets` + `wallet_transactions` |
| First-call rate | % of funded clients with at least one `call_logs` row | `call_logs` |
| Booking rate | % of calls with `outcome = 'booked'` | `call_logs` |

None of these are currently instrumented as structured events. They're derivable from existing tables.

---

## Querying call_logs for Funnel Data

The `call_logs` table is the primary conversion measurement surface. Use `intent` and `outcome` columns to compute funnel rates.

```sql
-- Booking conversion rate per client (last 30 days)
SELECT
  client_id,
  COUNT(*) AS total_calls,
  COUNT(*) FILTER (WHERE outcome = 'booked') AS bookings,
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'booked') / COUNT(*), 1) AS booking_rate_pct
FROM call_logs
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY client_id
ORDER BY booking_rate_pct DESC;
```

```sql
-- Calls that ended without booking (potential friction audit)
SELECT intent, outcome, COUNT(*) AS count
FROM call_logs
WHERE client_id = $1
  AND outcome != 'booked'
  AND intent = 'book_appointment'
GROUP BY intent, outcome
ORDER BY count DESC;
```

---

## Wallet Conversion Queries

```sql
-- Clients who onboarded but never funded (activation gap)
SELECT c.id, c.business_name, c.created_at, w.balance_cents
FROM clients c
JOIN wallets w ON w.client_id = c.id
WHERE w.balance_cents = 0
  AND NOT EXISTS (
    SELECT 1 FROM wallet_transactions wt
    WHERE wt.client_id = c.id AND wt.type = 'credit'
  )
ORDER BY c.created_at DESC;
```

```sql
-- Time from onboard to first wallet credit (activation latency)
SELECT
  c.id,
  c.business_name,
  c.created_at AS onboarded_at,
  MIN(wt.created_at) AS first_funded_at,
  EXTRACT(EPOCH FROM (MIN(wt.created_at) - c.created_at)) / 3600 AS hours_to_activate
FROM clients c
JOIN wallet_transactions wt ON wt.client_id = c.id AND wt.type = 'credit'
GROUP BY c.id, c.business_name, c.created_at
ORDER BY hours_to_activate;
```

---

## A/B Testing Patterns for API Responses

There is no A/B testing infrastructure in this codebase. The correct pattern for testing onboard response variants is to use a feature flag field on the `clients` table or a Redis key, not a separate service.

```javascript
// Pattern: simple bucketing for onboard response variant test
// Bucket by last digit of client_id UUID (deterministic, no DB needed)
function getTestVariant(clientId) {
  const lastChar = clientId.slice(-1);
  const bucket = parseInt(lastChar, 16) % 2; // 0 or 1
  return bucket === 0 ? 'control' : 'treatment';
}

// In src/routes/onboard.js — after 201 response is constructed
const variant = getTestVariant(clientId);
logger.info('Onboard variant assigned', { client_id: clientId, variant });
// Modify response based on variant (e.g., include/exclude activation_checklist)
```

Log variant assignment to `call_logs` or a dedicated `experiments` table, then query conversion rates by variant.

---

### WARNING: No Structured Event Logging

**The Problem:**

```javascript
// src/routes/onboard.js:156 — logs exist but are not structured for funnel queries
logger.info('Client onboarded', { client_id: clientId, business_name, business_phone });
// No: vertical, wallet_tier, has_integration, has_services — all missing from log
```

**Why This Breaks:**
Without structured event fields, you cannot segment conversion by vertical, tier, or whether the operator provided an FSM integration. You cannot answer "do HVAC clients on growth tier activate faster than spa clients on standard tier?"

**The Fix:** Emit a structured `client.onboarded` event at the end of the onboard route:

```javascript
// src/routes/onboard.js — structured activation event
logger.info('client.onboarded', {
  event: 'client.onboarded',
  client_id: clientId,
  business_phone,
  vertical: vertical || 'general',
  wallet_tier: wallet_tier || 'standard',
  has_integration: !!(integration && integration.credentials),
  has_services: Array.isArray(services) && services.length > 0,
  has_agent_config: !!(agent_name && greeting_script),
  completeness_score: [
    !!(agent_name),
    !!(greeting_script),
    !!(services && services.length > 0),
    !!(integration),
    !!(business_description),
  ].filter(Boolean).length,
});
```

---

## Related Skills

- See the **instrumenting-product-metrics** skill for defining activation funnels as queryable events
- See the **mapping-conversion-events** skill for structuring call lifecycle events
- See the **running-product-experiments** skill for experiment design patterns
