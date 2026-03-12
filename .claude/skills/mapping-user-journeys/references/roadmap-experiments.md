# Roadmap & Experiments Reference

## Contents
- How to ship journey improvements safely
- Feature flag pattern (no library)
- A/B testing prompt variants
- Rollout checklist
- Anti-patterns

## How to Ship Journey Improvements Safely

This codebase has no feature flag library. Use a DB column or environment variable for controlled rollouts.

### DB Column Feature Flag

```javascript
// migrations/00X_add_feature_flags.sql
ALTER TABLE clients ADD COLUMN features JSONB DEFAULT '{}';

// Usage in a route
const { rows } = await pool.query(
  'SELECT features FROM clients WHERE client_id = $1', [clientId]
);
const features = rows[0].features || {};

if (features.new_booking_flow) {
  return await newBookingFlow(req, res, next);
}
return await legacyBookingFlow(req, res, next);
```

**Why DB over env var:** Per-client rollout. Env vars are global — you can't roll out to 10% of clients with them.

### Environment Variable Flag (global rollout only)

```javascript
// .env
NEW_HOLD_STRATEGY=true

// src/services/availabilityService.js
const useNewHoldStrategy = process.env.NEW_HOLD_STRATEGY === 'true';

async function holdSlot(clientId, date, time) {
  if (useNewHoldStrategy) {
    return holdSlotV2(clientId, date, time);
  }
  return holdSlotV1(clientId, date, time);
}
```

## A/B Testing Prompt Variants

The prompt system is uniquely testable — `clients.system_prompt` is per-client, so different clients can run different variants.

```javascript
// src/services/promptCompiler.js — variant selection during compilation
async function compilePrompt(clientId) {
  const { rows } = await pool.query(
    'SELECT *, features FROM clients WHERE client_id = $1', [clientId]
  );
  const client = rows[0];
  const promptVariant = client.features?.prompt_variant || 'control';

  const prompt = promptVariant === 'concise'
    ? buildConcisePrompt(client)
    : buildDefaultPrompt(client);

  await pool.query(
    'UPDATE clients SET system_prompt = $1 WHERE client_id = $2',
    [prompt, clientId]
  );
}
```

**Measure:** Compare `call_logs.duration_seconds` and `bookings` count across variant groups.

## Rollout Checklist

Copy and track progress for any journey change:
- [ ] New behavior behind a feature flag (DB column or env var)
- [ ] Flag defaults to `false` (off) for all existing clients
- [ ] Rolled out to 1 test client first
- [ ] Structured log added at new branch: `logger.info('feature.new_flow', { client_id, variant })`
- [ ] Metrics defined: what does success look like? (booking rate, call duration, error rate)
- [ ] Rollback plan: how to disable flag instantly if issues arise
- [ ] Cache busted after any prompt/config change: `redis.del(`client_config:${clientId}`)`
- [ ] n8n webhook tested on new flow end-to-end

## WARNING: NEVER Deploy Breaking Route Changes Without Versioning

**The Problem:**
```javascript
// BAD — changing request/response shape on existing endpoint
router.post('/availability/hold', async (req, res, next) => {
  // Changed: now requires `duration_minutes` field
  const { date, time, duration_minutes } = req.body; // was just date, time
});
```

**Why This Breaks:**
1. Vapi is the caller — it sends the old payload shape
2. All live calls fail simultaneously
3. No gradual rollout possible

**The Fix:**
```javascript
// GOOD — accept both shapes, deprecate old one
const { date, time, duration_minutes = 60 } = req.body; // default for backward compat
```

## Anti-Patterns

```javascript
// NEVER — deploy prompt changes directly to all clients at once
await pool.query('UPDATE clients SET system_prompt = $1', [newPrompt]);
// One bad prompt takes down all clients simultaneously

// ALWAYS — compile per client, test on one first
await compilePrompt(testClientId); // verify behavior
// Then roll out to others
```

## Related Skills

- See the **scoping-feature-work** skill for breaking rollouts into shippable increments
- See the **redis** skill for cache invalidation after flag changes
- See the **postgresql** skill for JSONB feature flag queries
