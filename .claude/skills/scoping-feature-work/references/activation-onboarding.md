# Activation & Onboarding Reference

## Contents
- Client Onboarding Entry Point
- Activation Checklist
- Anti-Patterns
- Prompt Recompile Trigger
- Seed vs. Migration Split

---

## Client Onboarding Entry Point

New clients enter via `POST /api/v1/onboard` (`src/routes/onboard.js`). This is the only
unauthenticated write endpoint. It creates the client row, sets default config, and triggers
the initial system prompt compile.

```javascript
// src/routes/onboard.js — v1 slice minimum:
// 1. INSERT into clients table (phone, vertical, business_name)
// 2. INSERT into wallets table with starter_balance_cents
// 3. Call promptCompiler.compile(clientId) to pre-build system_prompt
// 4. Return { client_id, onboarding_status: 'pending_fsm' }
// NOT in v1: FSM credential setup, Clerk user creation, payment processor link
```

```javascript
// src/services/promptCompiler.js — recompile trigger after onboard
async function compileAndStore(clientId) {
  const config = await loadClientConfig(clientId);
  const prompt = buildSystemPrompt(config);
  await pool.query(
    'UPDATE clients SET system_prompt = $1, prompt_compiled_at = NOW() WHERE client_id = $2',
    [prompt, clientId]
  );
  // Invalidate config cache so next call gets fresh prompt
  await redis.del(`client_config:${clientId}`);
}
```

## Activation Checklist

Copy this checklist for each new client activation:

- [ ] Step 1: POST /api/v1/onboard — creates client + wallet rows
- [ ] Step 2: Store FSM credentials (INSERT into client_integrations with AES-256 encrypted credentials)
- [ ] Step 3: Configure business hours (PUT /api/v1/dashboard/hours)
- [ ] Step 4: Configure agent persona (PUT /api/v1/dashboard/agent)
- [ ] Step 5: Trigger prompt recompile (fires automatically on dashboard config PUT)
- [ ] Step 6: Set Vapi assistant metadata `client_id` to client's UUID
- [ ] Step 7: Fund wallet (minimum balance for first calls)
- [ ] Step 8: Test call — verify `/health` returns `{ pg: 'ok', redis: 'ok' }`

## Anti-Patterns

### WARNING: Generating Prompt on Every Call

**The Problem:**
```javascript
// BAD — regenerates from all config fields on every inbound call
router.post('/api/v1/context/inject', async (req, res, next) => {
  const config = await loadFullClientConfig(clientId); // 3 DB queries
  const prompt = buildSystemPrompt(config);            // CPU work per call
  // ...
});
```

**Why This Breaks:**
1. Adds ~150ms of unnecessary latency to every live call
2. Under concurrent calls, hammers PgBouncer with redundant reads
3. Makes prompt preview in dashboard impossible — stored prompt diverges from runtime

**The Fix:**
```javascript
// GOOD — read pre-compiled prompt, append only caller context
const { system_prompt } = await pool.query(
  'SELECT system_prompt FROM clients WHERE client_id = $1',
  [clientId]
);
const finalPrompt = promptBuilder.appendCallerContext(system_prompt, callerData);
```

Recompile only on config edits (PUT /api/v1/dashboard/*).

## Prompt Recompile Trigger

All dashboard PUT routes must invalidate cache and recompile:

```javascript
// Pattern: every PUT in src/routes/dashboard.js ends with:
await promptCompiler.compileAndStore(clientId);
await redis.del(`client_config:${clientId}`);
logger.info('Prompt recompiled', { client_id: clientId, trigger: 'dashboard_update' });
```

## Seed vs. Migration Split

- **migrations/** — schema changes, new tables, ALTER TABLE — always sequential, never idempotent assumptions
- **seeds/demo_clients.sql** — demo data for development only, NEVER run in production

```sql
-- migrations/004_add_onboarding_status.sql
ALTER TABLE clients ADD COLUMN onboarding_status VARCHAR(50) DEFAULT 'active';

-- seeds/demo_clients.sql — demo data only
INSERT INTO clients (phone, business_name, vertical, onboarding_status)
VALUES ('+19545550100', 'Apex Plumbing & HVAC', 'hvac', 'active');
```
