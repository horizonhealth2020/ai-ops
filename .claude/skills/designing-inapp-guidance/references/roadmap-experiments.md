# Roadmap & Experiments Reference

## Contents
- Feature flag pattern (Redis-based)
- Experiment variant assignment
- Rollout by client tier
- Validating experiment impact
- Anti-patterns

---

## Feature Flag Pattern (Redis-Based)

No feature flag service in dependencies. Use Redis hash for lightweight per-client flags.

```javascript
// src/services/featureFlags.js
'use strict';

const redis = require('../config/redis');

const FLAGS = {
  ENHANCED_CHECKLIST: 'enhanced_checklist',   // show 6-step checklist vs 3-step
  WALLET_NUDGE_V2:    'wallet_nudge_v2',       // new nudge copy
};

async function isEnabled(clientId, flagName) {
  // Global override first
  const globalKey = `feature_flag:global:${flagName}`;
  const global = await redis.get(globalKey);
  if (global === 'true') return true;
  if (global === 'false') return false;

  // Per-client flag
  const clientKey = `feature_flag:${clientId}:${flagName}`;
  return (await redis.get(clientKey)) === 'true';
}

async function setFlag(clientId, flagName, enabled) {
  const key = `feature_flag:${clientId}:${flagName}`;
  await redis.set(key, enabled ? 'true' : 'false');
}

module.exports = { FLAGS, isEnabled, setFlag };
```

## Rollout by Client Tier

Roll out new guidance to growth/scale/enterprise clients first.

```javascript
// src/services/featureFlags.js
async function isTierEnabled(clientId, flagName, allowedTiers) {
  const result = await pool.query(
    'SELECT billing_tier FROM clients WHERE client_id = $1',
    [clientId]
  );
  const tier = result.rows[0]?.billing_tier;
  return allowedTiers.includes(tier);
}

// Usage: enhanced checklist only for growth+ clients
const showEnhanced = await isTierEnabled(clientId, FLAGS.ENHANCED_CHECKLIST, ['growth', 'scale', 'enterprise']);
```

## Experiment Variant Assignment

Deterministic variant assignment based on `client_id` hash — no randomness drift on re-evaluation.

```javascript
// src/services/featureFlags.js
const crypto = require('crypto');

function getVariant(clientId, experimentId, variants) {
  // variants: ['control', 'treatment']
  const hash = crypto.createHash('md5').update(`${experimentId}:${clientId}`).digest('hex');
  const index = parseInt(hash.slice(0, 8), 16) % variants.length;
  return variants[index];
}

// Usage
const variant = getVariant(clientId, 'wallet_nudge_copy_test', ['control', 'v2']);
const message = variant === 'v2'
  ? 'Low balance detected — your agent may go offline soon.'
  : 'Your wallet is running low. Add funds to avoid interruptions.';
```

## Validating Experiment Impact

Log variant with every guidance event so you can split-analyze in Railway logs.

```javascript
logger.info('guidance_nudge_surfaced', {
  client_id: clientId,
  nudge_type: 'low_balance',
  experiment_id: 'wallet_nudge_copy_test',
  variant,
});
```

Query from logs or n8n to compare wallet top-up rate by variant.

## Experiment Checklist

Copy this checklist when launching a guidance experiment:
- [ ] Define experiment ID (snake_case, descriptive)
- [ ] Define variants: `['control', 'treatment']`
- [ ] Implement deterministic variant assignment via `getVariant()`
- [ ] Log `experiment_id` and `variant` with every surfaced guidance event
- [ ] Set Redis feature flag for gradual rollout if needed
- [ ] Define success metric (e.g., wallet top-up rate, FSM connection rate)
- [ ] Set experiment end date — clean up flag and log after conclusion

## DO / DON'T

**DO** use deterministic hash-based assignment — same client always gets same variant.
**DON'T** use `Math.random()` for variant assignment — it changes on every evaluation.

**DO** log `variant` with every guidance event.
**DON'T** try to reconstruct variants post-hoc from client IDs — that's brittle if experiment IDs change.

**DO** clean up Redis flags after an experiment concludes.
**DON'T** leave dead feature flags in Redis indefinitely — they accumulate and confuse future developers.

## WARNING: Persisting variants in PostgreSQL prematurely

Only write variant assignments to PostgreSQL if you need long-term retention (>30 days) or reporting. For short experiments, Redis TTL with a 30-day expiry is sufficient and avoids schema migrations.

See the **redis** skill for Redis key conventions. See the **scoping-feature-work** skill for experiment scoping.
