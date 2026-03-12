# Activation & Onboarding Reference

## Contents
- Onboarding Entry Point
- Activation Checklist Schema
- Soft-Lock for Incomplete Tenants
- WARNING: Activation State in Redis
- New Client Checklist

---

## Onboarding Entry Point

`POST /api/v1/onboard` creates the client record and fires the activation clock. Everything downstream depends on the data written here. See `src/routes/onboard.js`.

```javascript
// src/routes/onboard.js — minimal required fields to unblock activation
router.post('/', async (req, res, next) => {
  try {
    const { business_name, phone_number, vertical, owner_email, clerk_user_id } = req.body;

    const clientId = uuidv4();
    await pool.query(
      `INSERT INTO clients
        (client_id, business_name, phone_number, vertical, owner_email, clerk_user_id, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())`,
      [clientId, business_name, phone_number, vertical, owner_email, clerk_user_id]
    );

    // Seed an empty wallet immediately — walletService checks balance before every call
    await pool.query(
      'INSERT INTO wallets (client_id, balance_cents, tier) VALUES ($1, 0, $2)',
      [clientId, 'standard']
    );

    logger.info('Client onboarded', { client_id: clientId, vertical });
    res.status(201).json({ client_id: clientId, next_action: 'fund_wallet' });
  } catch (err) {
    next(err);
  }
});
```

## Activation Checklist Schema

Store activation state in `clients` table, not derived on every request. Denormalize the flags that are expensive to compute.

```sql
-- migrations/004_activation_state.sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS total_calls INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vapi_assistant_id TEXT,
  ADD COLUMN IF NOT EXISTS activation_completed_at TIMESTAMPTZ;
```

Compute `activation_completed_at` when all steps are satisfied — index it for cohort queries:

```sql
CREATE INDEX IF NOT EXISTS idx_clients_activation ON clients (activation_completed_at)
  WHERE activation_completed_at IS NOT NULL;
```

## Checking Activation Completeness

```javascript
// src/services/activationService.js
'use strict';

const { pool } = require('../config/database');
const logger = require('../utils/logger');

async function getActivationState(clientId) {
  const [client, integrations, wallet] = await Promise.all([
    pool.query('SELECT * FROM clients WHERE client_id = $1', [clientId]),
    pool.query('SELECT integration_type, is_active FROM client_integrations WHERE client_id = $1', [clientId]),
    pool.query('SELECT balance_cents FROM wallets WHERE client_id = $1', [clientId]),
  ]);

  const c = client.rows[0];
  const steps = {
    wallet_funded: wallet.rows[0]?.balance_cents > 0,
    fsm_connected: integrations.rows.some(i => i.integration_type === 'fsm' && i.is_active),
    vapi_configured: Boolean(c.vapi_assistant_id),
    first_call_received: c.total_calls > 0,
  };

  const allComplete = Object.values(steps).every(Boolean);

  if (allComplete && !c.activation_completed_at) {
    await pool.query(
      'UPDATE clients SET activation_completed_at = NOW() WHERE client_id = $1',
      [clientId]
    );
    logger.info('Client fully activated', { client_id: clientId });
  }

  return { steps, next_action: deriveNextAction(steps) };
}

function deriveNextAction(steps) {
  if (!steps.wallet_funded) return 'fund_wallet';
  if (!steps.fsm_connected) return 'connect_fsm';
  if (!steps.vapi_configured) return 'configure_vapi';
  if (!steps.first_call_received) return 'test_call';
  return null;
}

module.exports = { getActivationState };
```

### WARNING: Activation State in Redis

**The Problem:**

```javascript
// BAD — storing activation state only in Redis
await redis.set(`activation:${clientId}`, JSON.stringify(steps), 'EX', 3600);
```

**Why This Breaks:**
1. Redis is explicitly ephemeral in this architecture — if it dies, activation state vanishes
2. A client that was fully activated will appear unactivated to the dashboard after a Redis flush
3. Activation milestones (e.g., `activation_completed_at`) need to be queryable for analytics — Redis doesn't support that

**The Fix:**
Write activation milestones to PostgreSQL. Cache the computed state in Redis for performance, but always treat PostgreSQL as truth.

```javascript
// GOOD — cache is a read-through, PostgreSQL is the source of truth
const cacheKey = `activation:${clientId}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

const state = await computeActivationState(clientId); // reads from PG
await redis.set(cacheKey, JSON.stringify(state), 'EX', 300);
return state;
```

See the **redis** skill for caching patterns and the **postgresql** skill for schema conventions.

## New Client Activation Checklist

Copy this checklist and track progress:

- [ ] Step 1: `POST /api/v1/onboard` — create client record + empty wallet
- [ ] Step 2: Client funds wallet via payment processor
- [ ] Step 3: Client connects FSM integration (`PUT /api/v1/dashboard/scheduling`)
- [ ] Step 4: Client creates Vapi assistant and sets `vapi_assistant_id`
- [ ] Step 5: First inbound call received — `total_calls` increments to 1
- [ ] Step 6: `activation_completed_at` written to `clients` table
