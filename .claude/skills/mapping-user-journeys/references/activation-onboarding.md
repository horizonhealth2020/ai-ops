# Activation & Onboarding Reference

## Contents
- Onboarding endpoint anatomy
- Prompt compilation as activation gate
- Common friction points
- DO/DON'T pairs
- Checklist

## Onboarding Endpoint Anatomy

`POST /api/v1/onboard` — no auth, called from intake form or Clerk webhook.

```javascript
// src/routes/onboard.js
'use strict';
const router = require('express').Router();
const { pool } = require('../config/database');
const { compilePrompt } = require('../services/promptCompiler');
const { formatPhone } = require('../utils/formatters');
const logger = require('../utils/logger');

router.post('/onboard', async (req, res, next) => {
  try {
    const { business_name, phone_number, vertical, fsm_type } = req.body;

    // Normalize phone before any DB write
    const e164Phone = formatPhone(phone_number);

    const { rows } = await pool.query(
      `INSERT INTO clients (business_name, phone_number, vertical, fsm_type, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING client_id`,
      [business_name, e164Phone, vertical, fsm_type]
    );

    const clientId = rows[0].client_id;

    // Compile system prompt immediately — client is not "activated" until this runs
    await compilePrompt(clientId);

    logger.info('Client onboarded', { client_id: clientId, vertical });
    res.status(201).json({ client_id: clientId });
  } catch (err) {
    next(err);
  }
});
```

## Prompt Compilation as Activation Gate

A client is **not ready to receive calls** until `clients.system_prompt` is populated. `compilePrompt()` must run at onboard and on every config edit.

```javascript
// src/services/promptCompiler.js — called by onboard + all dashboard PUT routes
async function compilePrompt(clientId) {
  const { rows } = await pool.query(
    'SELECT * FROM clients WHERE client_id = $1',
    [clientId]
  );
  const client = rows[0];
  const prompt = buildSystemPrompt(client); // assemble from all config fields
  await pool.query(
    'UPDATE clients SET system_prompt = $1 WHERE client_id = $2',
    [prompt, clientId]
  );
}
```

**FRICTION:** If onboard succeeds but `compilePrompt` throws, `system_prompt` stays NULL. The first call will fail at `promptBuilder.js` with a silent empty prompt.

**Fix:** Wrap in a transaction or check for NULL at call time:

```javascript
// src/services/promptBuilder.js — guard against NULL
if (!client.system_prompt) {
  logger.error('System prompt missing', { client_id: clientId });
  throw new Error('Client not fully activated — system_prompt is NULL');
}
```

## Common Friction Points

| Point | Symptom | Root Cause | Fix |
|-------|---------|------------|-----|
| Phone not E.164 | Caller lookup fails | Raw user input stored | Always run `formatPhone()` before insert |
| Missing vertical | Prompt missing service context | No validation on onboard | Validate `vertical` against allowlist |
| `system_prompt` NULL | First call returns empty LLM stream | `compilePrompt` failed silently | Guard in `promptBuilder`, re-trigger compile |
| Duplicate phone | 409 conflict on insert | No upsert logic | Use `ON CONFLICT` or check-then-insert |

## DO / DON'T

```javascript
// DO — validate vertical against known values before insert
const VALID_VERTICALS = ['hvac', 'plumbing', 'electrical', 'spa', 'restaurant', 'cleaning'];
if (!VALID_VERTICALS.includes(vertical)) {
  return res.status(400).json({ error: `Invalid vertical: ${vertical}` });
}

// DON'T — store raw user input without normalization
await pool.query('INSERT INTO clients (phone_number) VALUES ($1)', [req.body.phone_number]);
// Raw "+1 (954) 555-0100" will break all subsequent lookups expecting E.164
```

## Onboarding Checklist

Copy and track progress:
- [ ] Phone number normalized to E.164 via `formatPhone()`
- [ ] Vertical validated against allowlist
- [ ] Client inserted with `is_active = true`
- [ ] `compilePrompt(clientId)` called and awaited
- [ ] `system_prompt` NOT NULL verified before responding 201
- [ ] Structured log emitted: `logger.info('Client onboarded', { client_id, vertical })`
- [ ] Error forwarded via `next(err)` — never swallowed
