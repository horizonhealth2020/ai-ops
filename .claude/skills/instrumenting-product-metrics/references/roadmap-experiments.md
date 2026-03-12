# Roadmap & Experiments

Feature flags and A/B experiments let you roll out capabilities gradually
per tenant or per vertical without deploying separate code branches.
This codebase stores flags in PostgreSQL and caches them in Redis using
the same key pattern as `client_config:{client_id}`.

---

## Schema: client_flags Column

Add a `client_flags` JSONB column to `clients` via a migration in
`migrations/`. This avoids a separate table and co-locates flags with
the existing client config cache.

```sql
-- migrations/007_add_client_flags.sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_flags JSONB NOT NULL DEFAULT '{}';
```

Example flags stored in the column:

```json
{
  "pgvector_faq_enabled": true,
  "payment_links_enabled": false,
  "prompt_variant": "B"
}
```

---

## isFeatureEnabled() Helper

Define in `src/utils/featureFlags.js`. Uses Redis for fast reads and
falls back to PostgreSQL when the cache is cold.

```javascript
'use strict';

const redis = require('../config/redis');
const pool = require('../config/database');
const logger = require('./logger');

const FLAGS_TTL = 300; // seconds — matches client_config TTL

/**
 * Check if a feature flag is enabled for a client.
 * Reads from Redis cache first, falls back to PostgreSQL.
 *
 * @param {string} clientId
 * @param {string} flagName  - key in client_flags JSONB
 * @returns {Promise<boolean>}
 */
async function isFeatureEnabled(clientId, flagName) {
  const cacheKey = `client_config:${clientId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const config = JSON.parse(cached);
      return Boolean(config.client_flags && config.client_flags[flagName]);
    }
  } catch (err) {
    logger.warn('Feature flag cache miss', { client_id: clientId, flag: flagName, err: err.message });
  }

  // PostgreSQL fallback
  const result = await pool.query(
    'SELECT client_flags FROM clients WHERE id = $1',
    [clientId]
  );

  if (!result.rows.length) return false;
  const flags = result.rows[0].client_flags || {};
  return Boolean(flags[flagName]);
}

module.exports = { isFeatureEnabled };
```

---

## Gradual Rollout by Vertical

Enable a feature for all `hvac` clients using a SQL UPDATE, then verify
with a SELECT before rolling out to other verticals.

```sql
-- Enable pgvector FAQ for all hvac clients
UPDATE clients
SET client_flags = client_flags || '{"pgvector_faq_enabled": true}'
WHERE vertical = 'hvac' AND status = 'active';

-- Verify rollout scope
SELECT id, business_name, client_flags->>'pgvector_faq_enabled' AS flag_value
FROM clients
WHERE vertical = 'hvac'
ORDER BY created_at;
```

After updating the database, flush Redis caches so live calls pick up the
new flag immediately:

```javascript
'use strict';

// One-off cache bust script (run via: node scripts/bustFlagCache.js)
const redis = require('./src/config/redis');
const pool = require('./src/config/database');

async function bustFlagCaches() {
  const result = await pool.query(
    "SELECT id FROM clients WHERE vertical = 'hvac' AND status = 'active'"
  );
  for (const row of result.rows) {
    await redis.del(`client_config:${row.id}`);
  }
  console.log(`Busted ${result.rows.length} caches`);
  process.exit(0);
}

bustFlagCache();
```

---

## A/B Prompt Variant Routing in src/routes/vapi.js

Use `isFeatureEnabled` to select a pre-compiled system prompt variant.
Both variants must already exist in `clients.system_prompt` or a
`client_prompt_variants` table. Never generate prompts at call time.

```javascript
'use strict';

const { isFeatureEnabled } = require('../utils/featureFlags');

// Inside POST /api/v1/context/inject handler:
const useVariantB = await isFeatureEnabled(clientId, 'prompt_variant_b');

const systemPrompt = useVariantB
  ? client.system_prompt_b   // pre-compiled alternate prompt
  : client.system_prompt;    // default prompt
```

---

## DO / DON'T

DO — store flags in `clients.client_flags` JSONB and cache them in Redis
under `client_config:{client_id}` with the existing 300s TTL. This means
flag reads are free during calls — they come from the already-cached config.

DON'T — hardcode feature flags in application code. Hardcoded flags require
a deploy to change. Database-backed flags change instantly with a SQL UPDATE.

```javascript
// WRONG — hardcoded flag requires a code change to toggle
const USE_PGVECTOR = true;  // comment this out to disable

// RIGHT — flag in database, cached in Redis
const usePgvector = await isFeatureEnabled(clientId, 'pgvector_faq_enabled');
if (usePgvector) {
  faqResults = await faqSearch.search(clientId, query);
}
```

DON'T — store flags in environment variables. Env vars are per-deployment,
not per-tenant. A flag in `process.env` affects all clients simultaneously.

---

## Related Skills

See **redis** skill for key namespacing and TTL patterns.
See **postgresql** skill for JSONB column migrations.
See **express** skill for middleware patterns used in route-level flag checks.
