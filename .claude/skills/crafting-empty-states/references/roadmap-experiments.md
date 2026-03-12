# Roadmap & Experiments Reference

## Contents
- Feature flag pattern (no library)
- A/B testing via client tier/vertical
- Rollout via seed data
- Validating experiments
- Anti-patterns

---

## Feature Flag Pattern (No Library)

This project has no feature flag library. Use a `feature_flags` JSON column on the `clients` table, or a dedicated `client_features` table for per-client flag overrides.

```sql
-- migrations/007_feature_flags.sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';
```

```javascript
// src/services/featureFlags.js
'use strict';

async function isEnabled(clientId, flagName, pool) {
  const result = await pool.query(
    'SELECT feature_flags FROM clients WHERE client_id = $1',
    [clientId]
  );

  if (!result.rows[0]) return false;
  const flags = result.rows[0].feature_flags || {};
  return flags[flagName] === true;
}

module.exports = { isEnabled };
```

```javascript
// Usage in a route — guard new features behind a flag
const { isEnabled } = require('../services/featureFlags');

router.get('/calls', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.clerk;
    const hasNewCallSummary = await isEnabled(clientId, 'call_summary_v2', pool);

    const calls = await getCallLogs(clientId, hasNewCallSummary);
    res.json({ calls });
  } catch (err) {
    next(err);
  }
});
```

## A/B Testing via Client Tier/Vertical

The most practical "experiment" in this codebase is varying behavior by `tier` or `vertical` — both are already on every client row. Use this to run controlled rollouts without infrastructure.

```javascript
// Empty state CTA varies by vertical
function getEmptyStateForVertical(vertical) {
  const VERTICAL_CTAS = {
    hvac:       { action: 'connect_housecallpro', message: 'Connect HouseCall Pro to enable booking.' },
    spa:        { action: 'connect_google_cal',   message: 'Connect Google Calendar to manage appointments.' },
    electrical: { action: 'connect_jobber',        message: 'Connect Jobber to enable job scheduling.' },
    restaurant: { action: 'configure_hours',       message: 'Set your hours to start taking reservations.' },
    default:    { action: 'connect_fsm',           message: 'Connect your scheduling tool to enable booking.' }
  };

  return VERTICAL_CTAS[vertical] || VERTICAL_CTAS.default;
}
```

## Rollout via Seed Data

To roll out a feature to specific clients without deploying code, enable it via a SQL update — no flag library needed.

```javascript
// scripts/enable_flag.js — run with: node scripts/enable_flag.js <flag> <client_id>
'use strict';
const { Pool } = require('pg');
require('dotenv').config();

async function enableFlag(flagName, clientId) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `UPDATE clients
     SET feature_flags = feature_flags || $1::jsonb
     WHERE client_id = $2`,
    [JSON.stringify({ [flagName]: true }), clientId]
  );
  console.log(`Flag "${flagName}" enabled for ${clientId}`);
  await pool.end();
}

const [,, flagName, clientId] = process.argv;
enableFlag(flagName, clientId).catch(console.error);
```

## Validating Experiments

Checklist for shipping a guarded feature:

- [ ] Migration: add `feature_flags JSONB` column if not present
- [ ] Gate: wrap new behavior in `isEnabled(clientId, 'flag_name', pool)`
- [ ] Log: `logger.info('feature.used', { client_id, flag: 'flag_name' })` on first use
- [ ] Enable: run `node scripts/enable_flag.js flag_name <client_id>` for pilot clients
- [ ] Validate: query logs for `feature.used` events to confirm adoption
- [ ] Promote: once validated, remove the flag gate and set behavior as default

Iterate until the log query shows consistent `feature.used` events before removing the flag.

1. Enable for 1-2 pilot clients
2. Validate: `grep 'feature.used' logs | grep flag_name`
3. If adoption is zero, investigate — don't just wait
4. Only promote when validated

## Anti-Patterns

### WARNING: Hardcoded feature gates by client_id

**The Problem:**
```javascript
// BAD — hardcoded list of client IDs
const BETA_CLIENTS = ['uuid-1', 'uuid-2'];
if (BETA_CLIENTS.includes(clientId)) { ... }
```

**Why This Breaks:**
1. Every rollout requires a code deploy
2. The list grows unbounded and becomes a maintenance nightmare
3. No audit trail — you can't tell when a flag was enabled or by whom

**The Fix:**
Use the `feature_flags` JSONB column and `scripts/enable_flag.js` to manage rollout in data.

### WARNING: Experiments that modify billing behavior without a flag

NEVER ship changes to wallet deduction, tier pricing, or payment routing without a feature flag. These changes are irreversible mid-call and could cause incorrect billing.

See the **postgresql** skill for JSONB column patterns, and the **scoping-feature-work** skill for slicing experiment rollouts into safe increments.
