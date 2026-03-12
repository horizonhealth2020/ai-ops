# Roadmap & Experiments Reference

## Contents
- Feature Flag Pattern
- Vertical-Scoped Rollouts
- WARNING: Experiment State in Redis
- Rollout Checklist
- Measuring Experiment Success

---

## Feature Flag Pattern

Feature flags live in `clients.feature_flags` JSONB. This is the only correct place for them — no environment variables, no code constants, no Redis keys.

```sql
-- migrations/005_feature_flags.sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}';
```

Enable a flag for a single client:

```sql
UPDATE clients
SET feature_flags = feature_flags || '{"payment_links": true}'::jsonb
WHERE client_id = 'target-uuid';
```

Enable for an entire vertical:

```sql
UPDATE clients
SET feature_flags = feature_flags || '{"maintenance_reminders": true}'::jsonb
WHERE vertical = 'hvac' AND is_active = true;
```

Read the flag in service code:

```javascript
// src/services/featureService.js
'use strict';

const { pool } = require('../config/database');

async function isEnabled(clientId, flag) {
  const result = await pool.query(
    'SELECT feature_flags FROM clients WHERE client_id = $1',
    [clientId]
  );
  return Boolean(result.rows[0]?.feature_flags?.[flag]);
}

module.exports = { isEnabled };
```

Use it to gate a route:

```javascript
// src/routes/booking.js
const { isEnabled } = require('../services/featureService');

router.post('/create', requireVapi, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    if (!await isEnabled(clientId, 'fsm_sync')) {
      // Fall back to non-FSM booking path
      return await createBookingWithoutFsm(req, res);
    }
    await createBookingWithFsm(req, res);
  } catch (err) {
    next(err);
  }
});
```

## Vertical-Scoped Rollouts

New features rarely apply to all verticals equally. Gate by vertical before gating by feature flag — it reduces noise in the flag system.

```javascript
// src/services/featureService.js
const VERTICAL_BETA_FEATURES = {
  hvac: ['service_contracts', 'maintenance_reminders'],
  spa: ['membership_upsell', 'waitlist_management'],
  electrical: ['permit_tracking'],
};

function isInBeta(vertical, feature) {
  return (VERTICAL_BETA_FEATURES[vertical] || []).includes(feature);
}

module.exports = { isEnabled, isInBeta };
```

Combine vertical gating with individual overrides:

```javascript
// Feature is in beta for hvac, or individually enabled for this client
const allowed = isInBeta(client.vertical, 'service_contracts')
  || await isEnabled(clientId, 'service_contracts');
```

## WARNING: Experiment State in Redis

**The Problem:**

```javascript
// BAD — storing rollout cohort in Redis
await redis.sadd('experiment:payment_links:enrolled', clientId);
const isEnrolled = await redis.sismember('experiment:payment_links:enrolled', clientId);
```

**Why This Breaks:**
1. Redis is ephemeral — all experiment enrollments vanish on a Redis flush or restart
2. A client in a payment experiment who loses their enrollment mid-experiment experiences inconsistent behavior — potentially a partial payment flow
3. No audit trail for when a client was enrolled or which variant they saw

**The Fix:**
Store experiment enrollment in `clients.feature_flags` or a dedicated `experiments` table. Redis is for TTL-bound ephemeral state only (slot holds, config caches).

```javascript
// GOOD — experiment enrollment in PostgreSQL
await pool.query(
  `INSERT INTO client_experiments (client_id, experiment_name, variant, enrolled_at)
   VALUES ($1, $2, $3, NOW())
   ON CONFLICT (client_id, experiment_name) DO NOTHING`,
  [clientId, 'payment_links_v2', 'treatment']
);
```

## Rollout Checklist

Copy this checklist for every new feature rollout:

- [ ] Step 1: Add migration — `ALTER TABLE clients ADD COLUMN` or add to `feature_flags` JSONB
- [ ] Step 2: Implement `isEnabled(clientId, 'feature_name')` check in service layer
- [ ] Step 3: Write fallback path for clients without the flag
- [ ] Step 4: Enable flag for internal test client (`seeds/demo_clients.sql`)
- [ ] Step 5: Run `npm run migrate && npm run seed` on staging
- [ ] Step 6: Test the gated path and the fallback path end-to-end
- [ ] Step 7: Enable for beta vertical: `UPDATE clients SET feature_flags = ... WHERE vertical = 'hvac'`
- [ ] Step 8: Monitor `call_logs` and `bookings` for anomalies (7 days)
- [ ] Step 9: Enable broadly: `UPDATE clients SET feature_flags = feature_flags || '{"feature": true}'`
- [ ] Step 10: Remove the flag check once fully rolled out (don't leave dead flag gates in code)

## Measuring Experiment Success

The minimum viable experiment measurement uses SQL against existing tables — no analytics SDK required.

```javascript
// src/services/experimentService.js
'use strict';

const { pool } = require('../config/database');

async function measureExperiment(experimentName, metric, windowDays = 14) {
  // Compare treatment vs control on booking conversion rate
  const result = await pool.query(
    `SELECT
       ce.variant,
       COUNT(DISTINCT cl.call_id) AS calls,
       COUNT(DISTINCT b.booking_id) AS bookings,
       ROUND(
         COUNT(DISTINCT b.booking_id)::numeric / NULLIF(COUNT(DISTINCT cl.call_id), 0) * 100, 2
       ) AS conversion_rate
     FROM client_experiments ce
     JOIN clients c ON c.client_id = ce.client_id
     LEFT JOIN call_logs cl
       ON cl.client_id = ce.client_id
       AND cl.started_at > ce.enrolled_at
       AND cl.started_at > NOW() - INTERVAL '${windowDays} days'
     LEFT JOIN bookings b
       ON b.client_id = ce.client_id
       AND b.created_at > ce.enrolled_at
       AND b.created_at > NOW() - INTERVAL '${windowDays} days'
     WHERE ce.experiment_name = $1
     GROUP BY ce.variant`,
    [experimentName]
  );
  return result.rows;
}

module.exports = { measureExperiment };
```

See the **scoping-feature-work** skill for breaking experiment work into shippable increments.
