# Activation & Onboarding Reference

## Contents
- Onboarding step schema
- Provisioning flow
- Activation gates
- Anti-patterns
- Checklist

---

## Onboarding Step Schema

Add `onboarding_step` to the `clients` table. Use a constrained enum so invalid steps are caught at the DB layer:

```sql
-- migrations/004_onboarding_step.sql
ALTER TABLE clients
  ADD COLUMN onboarding_step TEXT NOT NULL DEFAULT 'wallet_pending'
    CHECK (onboarding_step IN ('wallet_pending','fsm_pending','vapi_pending','active'));
```

Query it alongside config in `GET /api/v1/dashboard/config`:

```javascript
// src/routes/dashboard.js
const { rows: [client] } = await pool.query(
  `SELECT c.*, w.balance_cents
   FROM clients c
   LEFT JOIN wallets w ON w.client_id = c.client_id
   WHERE c.client_id = $1`,
  [clientId]
);

const STEPS = ['wallet_pending', 'fsm_pending', 'vapi_pending', 'active'];
res.json({
  config: client,
  onboarding: {
    step: client.onboarding_step,
    step_index: STEPS.indexOf(client.onboarding_step),
    total_steps: STEPS.length,
    is_complete: client.onboarding_step === 'active',
  },
});
```

---

## Provisioning Flow

`POST /api/v1/onboard` is the single entry point. It must complete synchronously (client record + wallet row) then hand off async work to n8n.

```javascript
// src/routes/onboard.js
'use strict';
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const logger = require('../utils/logger');

router.post('/', async (req, res, next) => {
  try {
    const { business_name, phone, vertical, timezone, tier = 'standard' } = req.body;
    const clientId = uuidv4();

    await pool.query('BEGIN');
    await pool.query(
      `INSERT INTO clients (client_id, business_name, phone, vertical, timezone, tier, onboarding_step)
       VALUES ($1,$2,$3,$4,$5,$6,'wallet_pending')`,
      [clientId, business_name, phone, vertical, timezone, tier]
    );
    await pool.query(
      `INSERT INTO wallets (client_id, balance_cents) VALUES ($1, 0)`,
      [clientId]
    );
    await pool.query('COMMIT');

    logger.info('Client provisioned', { client_id: clientId, vertical });

    // Async: Vapi assistant creation, welcome SMS via Twilio
    fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/client-onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    }).catch(err => logger.error('n8n onboard webhook failed', { client_id: clientId, err: err.message }));

    res.status(201).json({ client_id: clientId, next_step: 'fund_wallet' });
  } catch (err) {
    await pool.query('ROLLBACK');
    next(err);
  }
});
```

---

## Activation Gates

Each step has a clear trigger that advances the state machine. Never skip steps — an `active` client without a wallet is a billing bug.

| Step | Trigger | Advance condition |
|------|---------|-------------------|
| `wallet_pending` | Client created | `wallets.balance_cents > 0` |
| `fsm_pending` | Wallet funded | `client_integrations` row exists with `integration_type = 'fsm'` |
| `vapi_pending` | FSM saved | Vapi assistant ID written to `clients.vapi_assistant_id` |
| `active` | Vapi configured | All above complete |

Advance step in `walletService.js` after a successful top-up:

```javascript
// src/services/walletService.js
async function reload(clientId, amountCents) {
  await pool.query(
    `UPDATE wallets SET balance_cents = balance_cents + $1 WHERE client_id = $2`,
    [amountCents, clientId]
  );
  await pool.query(
    `UPDATE clients
     SET onboarding_step = 'fsm_pending'
     WHERE client_id = $1 AND onboarding_step = 'wallet_pending'`,
    [clientId]
  );
  logger.info('Wallet reloaded', { client_id: clientId, amount_cents: amountCents });
}
```

---

### WARNING: Skipping the transaction on client provisioning

**The Problem:**

```javascript
// BAD — wallet insert can fail leaving a client with no billing record
await pool.query('INSERT INTO clients ...', [...]);
await pool.query('INSERT INTO wallets ...', [...]);
```

**Why This Breaks:**
1. If the wallet insert fails, the client exists but has no billing record
2. First call immediately hits the $0 balance guard and drops to message-only mode
3. No error is surfaced to the intake form — client thinks setup succeeded

**The Fix:**

```javascript
// GOOD — atomic client + wallet creation
await pool.query('BEGIN');
await pool.query('INSERT INTO clients ...', [...]);
await pool.query('INSERT INTO wallets ...', [...]);
await pool.query('COMMIT');
```

---

## New Client Activation Checklist

Copy this checklist and track progress:
- [ ] Step 1: Add `onboarding_step` column with migration
- [ ] Step 2: `POST /api/v1/onboard` creates client + wallet in a transaction
- [ ] Step 3: n8n webhook fires async for Vapi assistant creation
- [ ] Step 4: `GET /api/v1/dashboard/config` returns `onboarding` block
- [ ] Step 5: Wallet top-up advances step from `wallet_pending` → `fsm_pending`
- [ ] Step 6: FSM credential save advances step to `vapi_pending`
- [ ] Step 7: Vapi assistant ID write advances step to `active`
- [ ] Step 8: All dashboard empty states return `empty_state.cta` blocks

See the **scoping-feature-work** skill for slicing this into shippable increments.
