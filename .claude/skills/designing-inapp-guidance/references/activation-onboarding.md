# Activation & Onboarding Reference

## Contents
- Onboarding state model
- Checklist computation pattern
- Setup step definitions
- Cache invalidation on state change
- n8n webhook on completion
- Anti-patterns

---

## Onboarding State Model

Activation state is derived from existing DB columns — no separate `onboarding_state` table needed. Compute it on read; cache aggressively.

```javascript
// src/services/guidanceService.js
'use strict';

const { pool } = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const STEPS = [
  {
    id: 'agent_configured',
    label: 'Configure your AI agent',
    check: (row) => row.system_prompt !== null,
  },
  {
    id: 'fsm_connected',
    label: 'Connect your scheduling system',
    check: (row) => parseInt(row.fsm_count, 10) > 0,
  },
  {
    id: 'wallet_funded',
    label: 'Add funds to your wallet',
    check: (row) => parseInt(row.balance_cents, 10) > 0,
  },
  {
    id: 'first_call_received',
    label: 'Receive your first call',
    check: (row) => parseInt(row.call_count, 10) > 0,
  },
];

async function getSetupChecklist(clientId) {
  const result = await pool.query(
    `SELECT
       c.system_prompt,
       (SELECT COUNT(*) FROM client_integrations
        WHERE client_id = $1 AND integration_type = 'fsm') AS fsm_count,
       COALESCE((SELECT balance_cents FROM client_wallets
        WHERE client_id = $1), 0)                          AS balance_cents,
       (SELECT COUNT(*) FROM call_logs
        WHERE client_id = $1)                              AS call_count
     FROM clients c WHERE c.client_id = $1`,
    [clientId]
  );

  const row = result.rows[0];
  const steps = STEPS.map((s) => ({ id: s.id, label: s.label, complete: s.check(row) }));
  const completed = steps.filter((s) => s.complete).length;

  return { steps, completed, total: steps.length, all_complete: completed === steps.length };
}

module.exports = { getSetupChecklist };
```

## Cache Invalidation on State Change

Invalidate `guidance_checklist:{client_id}` whenever a PUT route changes setup-relevant data.

```javascript
// src/routes/dashboard.js — shared helper
async function invalidateGuidanceCache(clientId) {
  await redis.del(`guidance_checklist:${clientId}`);
  logger.info('Guidance cache invalidated', { client_id: clientId });
}

// Call after PUT /agent, PUT /hours, PUT /scheduling, wallet top-up
router.put('/agent', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    await updateAgentConfig(clientId, req.body);
    await recompileSystemPrompt(clientId);   // triggers prompt_compiled = true
    await invalidateGuidanceCache(clientId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

## n8n Webhook on Onboarding Completion

Fire once per client, idempotent via Redis flag.

```javascript
// src/services/guidanceService.js
async function maybeFireOnboardComplete(clientId) {
  const checklist = await getSetupChecklist(clientId);
  if (!checklist.all_complete) return false;

  const key = `onboard_complete_fired:${clientId}`;
  const set = await redis.setnx(key, Date.now().toString());
  if (!set) return false; // already fired

  await redis.expire(key, 86400 * 30); // 30-day idempotency window

  const axios = require('axios');
  await axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/onboard-complete`, {
    client_id: clientId,
    completed_at: new Date().toISOString(),
  });

  logger.info('Onboard complete webhook fired', { client_id: clientId });
  return true;
}
```

## DO / DON'T

**DO** derive activation state from existing columns — no extra table.
**DON'T** store `is_onboarded = true` as a flag that goes stale when data changes.

**DO** cache checklist for 300s (same TTL as `client_config`).
**DON'T** recompute from DB on every dashboard load — it involves 3 subqueries.

**DO** use `SETNX` for one-time webhook idempotency.
**DON'T** use a boolean DB column for "webhook fired" — Redis is the right tool here.

**DO** invalidate guidance cache whenever a PUT changes setup-relevant state.
**DON'T** let stale checklists linger — a client who just connected their FSM should see the step complete immediately.

## WARNING: Leaking guidance state across tenants

```javascript
// BAD — no client_id filter
const result = await pool.query('SELECT COUNT(*) FROM call_logs');

// GOOD — always scope to client_id
const result = await pool.query(
  'SELECT COUNT(*) FROM call_logs WHERE client_id = $1',
  [clientId]
);
```

Every subquery in the checklist computation MUST include `WHERE client_id = $1`. Missing this leaks one tenant's activation state into another's response.

See the **redis** skill for key namespacing conventions. See the **designing-onboarding-paths** skill for flow design.
