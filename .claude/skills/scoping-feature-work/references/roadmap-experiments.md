# Roadmap & Experiments Reference

## Contents
- Feature Flag Strategy
- Rollout Pattern for Multi-Tenant Changes
- v1 / v2 / v3 Slice Framework
- Anti-Patterns
- Migration Safety for Schema Changes

---

## Feature Flag Strategy

There is no feature flag library in this codebase. Use the `clients` table for per-tenant
flags — this is the correct approach for multi-tenant SaaS where each client controls their
own capabilities.

```javascript
// Per-tenant feature flag — add column to clients table
// migrations/005_add_feature_flags.sql:
ALTER TABLE clients ADD COLUMN features JSONB DEFAULT '{}';

// Check in service layer:
async function isFeatureEnabled(clientId, featureName) {
  const result = await pool.query(
    'SELECT features->$2 AS enabled FROM clients WHERE client_id = $1',
    [clientId, featureName]
  );
  return result.rows[0]?.enabled === true;
}

// Usage:
if (await isFeatureEnabled(clientId, 'square_payments')) {
  return paymentService.createSquareIntent(clientId, amount);
}
```

## Rollout Pattern for Multi-Tenant Changes

When rolling out a new integration or behavior change that not all clients are ready for:

```javascript
// Pattern: check client config, fall back gracefully
const FSM_ADAPTERS = {
  housecall_pro: () => require('../integrations/housecallpro'),
  jobber: () => require('../integrations/jobber'),
  servicetitan: () => require('../integrations/servicetitan'),
  // New FSM — only clients with this integration_type get it
  fieldedge: () => require('../integrations/fieldedge'),
};

async function getAdapter(clientId) {
  const { integration_type } = await getClientFsmConfig(clientId);
  const adapter = FSM_ADAPTERS[integration_type];
  if (!adapter) {
    logger.warn('No FSM adapter', { client_id: clientId, integration_type });
    return null; // Graceful degradation — booking still works without FSM
  }
  return adapter();
}
```

## v1 / v2 / v3 Slice Framework

Every feature should be scoped into independent, shippable slices. Use this framework:

**v1 — Minimum working path:**
- Happy path only, no edge cases
- No caching or performance optimization
- No admin tooling
- Must be testable in isolation

**v2 — Production-ready:**
- Error handling for all external API failures
- Redis cache for performance-critical paths
- Structured logging for all outcomes
- n8n webhook for async side effects

**v3 — Polished:**
- Dashboard visibility (read-only)
- Dashboard control (write)
- Analytics/reporting
- Retry logic with exponential backoff

```javascript
// Example: New payment processor (v1 scope)
// v1: Basic intent creation, return payment link
// NOT in v1: webhook handling, refunds, partial payments, retry on failure

// src/integrations/newprocessor.js — v1 minimum
async function createPaymentIntent(credentials, amountCents, callerPhone) {
  const response = await axios.post(credentials.api_url + '/intents', {
    amount: amountCents,
    currency: 'usd',
    customer_phone: callerPhone,
  }, {
    headers: { Authorization: `Bearer ${credentials.api_key}` }
  });
  return { intent_id: response.data.id, payment_url: response.data.checkout_url };
}
module.exports = { createPaymentIntent };
```

## Anti-Patterns

### WARNING: Big Bang Migrations on Active Tables

**The Problem:**
```sql
-- BAD — renames column while app is running
ALTER TABLE bookings RENAME COLUMN job_id TO fsm_job_id;
```

**Why This Breaks:**
1. All running Express processes still reference old column name → 500 errors mid-deploy
2. Railway restarts are not instantaneous — there's a window of mixed old/new code

**The Fix:**
```sql
-- GOOD — additive migration, deploy, then clean up in next migration
-- Migration 005: Add new column
ALTER TABLE bookings ADD COLUMN fsm_job_id VARCHAR(255);
-- Deploy: update code to write both columns
-- Migration 006: Backfill + drop old column (after all pods running new code)
UPDATE bookings SET fsm_job_id = job_id WHERE fsm_job_id IS NULL;
ALTER TABLE bookings DROP COLUMN job_id;
```

## Migration Safety for Schema Changes

Copy this checklist for any migration touching active tables:

- [ ] Migration is additive (new column with DEFAULT, new table)
- [ ] If renaming: add new column first, deploy, backfill, then drop old in next migration
- [ ] New columns have defaults so existing rows are valid immediately
- [ ] Index added alongside new column if it will be queried with WHERE
- [ ] Tested against local PG with `npm run migrate` before pushing

See the **postgresql** skill for connection and migration patterns. See the **node** skill for
environment validation when new env vars are required by a feature.
