# Measurement & Testing Reference

## Contents
- Activation funnel queries
- Key metrics to track
- Onboarding regression tests
- Anti-patterns

---

## Activation Funnel Queries

The entire activation funnel lives in PostgreSQL. No external analytics tool is required
to instrument the key metrics.

**Clients onboarded but never had a call (stuck in activation):**

```sql
SELECT
  c.id,
  c.business_name,
  c.vertical,
  c.created_at,
  w.balance_cents,
  CASE WHEN c.system_prompt IS NOT NULL THEN 'compiled' ELSE 'missing' END AS prompt_status
FROM clients c
LEFT JOIN wallets w ON w.client_id = c.id
WHERE c.id NOT IN (SELECT DISTINCT client_id FROM call_logs)
  AND c.status = 'active'
ORDER BY c.created_at DESC;
```

**Time-to-first-call distribution (activation velocity):**

```sql
SELECT
  c.id,
  c.business_name,
  c.created_at AS onboarded_at,
  MIN(cl.created_at) AS first_call_at,
  EXTRACT(EPOCH FROM (MIN(cl.created_at) - c.created_at)) / 3600 AS hours_to_first_call
FROM clients c
JOIN call_logs cl ON cl.client_id = c.id
GROUP BY c.id, c.business_name, c.created_at
ORDER BY hours_to_first_call ASC;
```

**Wallet balance at time of first call (are clients funding before or after?):**

```sql
SELECT
  c.id,
  c.business_name,
  first_call.created_at AS first_call_time,
  -- Approximate wallet state at first call using transaction history
  w.balance_cents AS current_balance
FROM clients c
JOIN wallets w ON w.client_id = c.id
JOIN (
  SELECT client_id, MIN(created_at) AS created_at
  FROM call_logs GROUP BY client_id
) first_call ON first_call.client_id = c.id;
```

---

## Key Metrics to Track

| Metric | Source | Target |
|---|---|---|
| Onboard-to-first-call rate | `clients` vs `call_logs` | >80% within 7 days |
| Median hours to first call | `call_logs.created_at - clients.created_at` | <24 hours |
| Wallet funded at onboard | `wallets.balance_cents` on day 0 | >60% |
| System prompt compile success | `clients.system_prompt IS NOT NULL` | 100% |
| Prompt completeness (avg fields) | Count non-null columns in `clients` | >12/20 fields |

---

## Onboarding Regression Tests

**Test the full onboard transaction atomicity:**

```javascript
// scripts/test-onboard.js — manual smoke test
const payload = {
  business_name: 'Test HVAC Co',
  business_phone: '+19995550001',
  vertical: 'hvac',
  agent_name: 'Test Agent',
  greeting_script: 'Thanks for calling Test HVAC!',
  services: [{ name: 'AC Repair', duration_min: 60 }],
  wallet_tier: 'standard',
};

const res = await fetch('http://localhost:3000/api/v1/onboard', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const data = await res.json();
console.assert(res.status === 201, 'Should return 201');
console.assert(data.client_id, 'Should return client_id');
console.assert(data.status === 'active', 'Should be active');
```

**Verify promptCompiler ran after onboard:**

```javascript
// After POST /api/v1/onboard
const { rows } = await pool.query(
  'SELECT system_prompt FROM clients WHERE id = $1',
  [data.client_id]
);
console.assert(rows[0].system_prompt !== null, 'Prompt should be compiled');
console.assert(rows[0].system_prompt.includes('Test HVAC Co'), 'Prompt should include business name');
```

**Verify transaction rollback on partial failure:**

```javascript
// Simulate a services insert failure — onboard should rollback entirely
const badPayload = {
  business_name: 'Rollback Test',
  business_phone: '+19995550002',
  services: [{ name: null, duration_min: 60 }], // null name should violate NOT NULL constraint
};
const res = await fetch('http://localhost:3000/api/v1/onboard', { ... });
console.assert(res.status === 500 || res.status === 400, 'Should fail');
// Verify no partial client record was created
const check = await pool.query('SELECT id FROM clients WHERE business_name = $1', ['Rollback Test']);
console.assert(check.rows.length === 0, 'Rollback should have deleted partial record');
```

---

### WARNING: Missing Activation Instrumentation

**The Problem:**

This codebase has no structured activation event logging. `logger.info('Client onboarded', ...)`
writes to stdout but there's no queryable audit trail in the database for funnel analysis.

**Why This Breaks:**
1. Can't answer "what % of onboarded clients have their first call within 24 hours?"
2. Can't detect when `promptCompiler.compile()` silently fails and leaves `system_prompt = null`
3. No alerting possible when clients go days without activating

**The Fix — add an `activation_events` table:**

```sql
-- migrations/004_add_activation_events.sql
CREATE TABLE activation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  event_type TEXT NOT NULL, -- 'onboarded', 'prompt_compiled', 'wallet_funded', 'first_call'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);
CREATE INDEX ON activation_events(client_id, event_type);
```

Then log from each route:

```javascript
// src/routes/onboard.js — after promptCompiler.compile()
await pool.query(
  `INSERT INTO activation_events (client_id, event_type, metadata)
   VALUES ($1, 'onboarded', $2)`,
  [clientId, JSON.stringify({ vertical, wallet_tier })]
);
```

---

## Related Skills

- See the **mapping-conversion-events** skill for full event taxonomy
- See the **instrumenting-product-metrics** skill for product analytics patterns
- See the **running-product-experiments** skill for A/B testing onboard flows
