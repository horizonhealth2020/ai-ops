# Roadmap & Experiments Reference

## Contents
- Feature flags in this codebase
- Rollout pattern via client tier
- A/B testing without a flag service
- Experiment validation loop
- Anti-patterns

---

## Feature Flags in This Codebase

There is no feature flag service (LaunchDarkly, Unleash, etc.) in the current dependencies. Use the `clients` table itself as the flag store. Add a `feature_flags` JSONB column:

```sql
-- migrations/006_feature_flags.sql
ALTER TABLE clients
  ADD COLUMN feature_flags JSONB NOT NULL DEFAULT '{}';
```

Read flags in routes:

```javascript
// src/routes/dashboard.js
const { rows: [client] } = await pool.query(
  'SELECT feature_flags FROM clients WHERE client_id = $1',
  [clientId]
);

const flags = client.feature_flags || {};
const hasPaymentLinks = flags.payment_links_enabled === true;
```

Set a flag for a single client (admin operation):

```sql
UPDATE clients
SET feature_flags = feature_flags || '{"payment_links_enabled": true}'
WHERE client_id = 'uuid-here';
```

---

## Tier-Based Rollout

The simplest rollout mechanism is the existing `tier` column. Gate new features by tier before writing a full flag system:

```javascript
// src/services/paymentService.js
const TIERS_WITH_SMS_LINKS = ['growth', 'scale', 'enterprise'];

async function createPaymentIntent(clientId, amountCents, processor) {
  const { rows: [client] } = await pool.query(
    'SELECT tier FROM clients WHERE client_id = $1',
    [clientId]
  );

  const shouldSendSmsLink = TIERS_WITH_SMS_LINKS.includes(client.tier);

  if (shouldSendSmsLink) {
    // Send via Twilio — see the **twilio** skill
  }
}
```

This is the right approach when a feature maps cleanly to a pricing tier. Use `feature_flags` when you need per-client control within a tier.

---

## A/B Testing Without a Flag Service

For simple prompt experiments (e.g., testing agent persona copy), use the `clients.agent_persona` field as the variant carrier — no external service needed:

```javascript
// src/services/promptBuilder.js — variant injected from stored config
function buildSystemPrompt(client, callerContext) {
  // agent_persona is set per-client — can be 'friendly' | 'professional' | 'concise'
  const personaBlock = PERSONA_BLOCKS[client.agent_persona] || PERSONA_BLOCKS['professional'];
  return `${client.system_prompt}\n\n${personaBlock}\n\n${callerContext}`;
}
```

Assign variants at onboard time by splitting on modulo of a hash or sequentially:

```javascript
// src/routes/onboard.js
const PERSONA_VARIANTS = ['friendly', 'professional'];
const variantIndex = Buffer.from(clientId).reduce((a, b) => a + b, 0) % PERSONA_VARIANTS.length;
const agentPersona = PERSONA_VARIANTS[variantIndex];
```

Log the variant as a product event so you can segment call outcomes by variant:

```javascript
await track(clientId, 'client_onboarded', { vertical, tier, agent_persona: agentPersona });
```

---

## Experiment Validation Loop

Before shipping a new onboarding step or feature flag to all clients:

1. Add migration and deploy (non-breaking — JSONB default, nullable column)
2. Enable for internal test client only: `UPDATE clients SET feature_flags = '{"new_feature": true}' WHERE client_id = 'test-uuid'`
3. Verify: `GET /api/v1/dashboard/config` returns expected flag behavior
4. Enable for one real client; monitor Railway logs for errors
5. If no errors in 24h, roll out to target tier: `UPDATE clients SET feature_flags = feature_flags || '{"new_feature": true}' WHERE tier = 'growth'`
6. Monitor `product_events` table for activation metrics
7. If metrics pass threshold, promote to all tiers

```sql
-- Step 5: tier rollout
UPDATE clients
SET feature_flags = feature_flags || '{"new_feature": true}'
WHERE tier IN ('growth', 'scale', 'enterprise');
```

---

### WARNING: Storing Experiment Variants in Redis

**The Problem:**

```javascript
// BAD — experiment assignment in Redis, lost on restart
await redis.set(`experiment:${clientId}`, 'variant_b', 'EX', 86400);
```

**Why This Breaks:**
1. Redis is ephemeral — Railway restarts wipe all keys
2. Clients get re-assigned to a different variant after any Redis flush, corrupting experiment data
3. You cannot query Redis for aggregate variant assignment counts

**The Fix:**

```javascript
// GOOD — experiment assignment in PostgreSQL
await pool.query(
  "UPDATE clients SET feature_flags = feature_flags || $1 WHERE client_id = $2",
  [JSON.stringify({ experiment_variant: 'variant_b' }), clientId]
);
```

See the **redis** skill for what belongs in Redis vs PostgreSQL.

---

### WARNING: Gating on Tier Without a Migration Path

**The Problem:**

```javascript
// BAD — hardcodes 'enterprise' with no way to override for a specific client
if (client.tier !== 'enterprise') return res.status(403).json({ error: 'Upgrade required' });
```

**The Fix:**

```javascript
// GOOD — tier gate with per-client override escape hatch
const hasAccess = client.tier === 'enterprise' || client.feature_flags?.override_enterprise_features === true;
if (!hasAccess) return res.status(403).json({ error: 'Upgrade required' });
```

This lets support teams unblock specific clients without a code deploy.
