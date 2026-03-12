# Conversion Optimization Reference

## Contents
- Onboarding funnel anatomy
- The $0 wallet problem
- Activation signal in API responses
- Anti-patterns
- Validation checklist

---

## Onboarding Funnel Anatomy

The conversion funnel for this platform has four gates. An operator fails to convert if any gate blocks them silently.

```
Gate 1: Intake form submitted        → POST /api/v1/onboard returns 201
Gate 2: Agent is configured          → agent_name + greeting_script populated
Gate 3: Wallet is funded             → balance_cents > 0
Gate 4: First call answered live     → call_logs has one row for this client
```

Currently, the API confirms Gate 1 but gives no signal on Gates 2–4. Operators who hit Gate 3 — a $0 wallet — never get a first call and churn without knowing why.

---

## The $0 Wallet Problem

Every new client onboards with `balance_cents = 0`. The agent immediately enters message-only mode on first call. This is the single biggest conversion blocker.

```javascript
// src/services/walletService.js:24
async function checkBalance(clientId) {
  const result = await pool.query(
    'SELECT balance_cents FROM wallets WHERE client_id = $1',
    [clientId]
  );
  if (result.rows.length === 0) return true; // No wallet = no restriction
  return result.rows[0].balance_cents > 0;   // $0 = silently blocked
}
```

The `checkBalance` function returns `false` the moment a new client's first call comes in. There is no notification, no warning in the onboard response, nothing.

**Fix:** Add a `wallet_status` field to the onboard 201 response and the dashboard config response:

```javascript
// src/routes/onboard.js — augment the 201 response
res.status(201).json({
  client_id: clientId,
  business_phone,
  status: 'active',
  wallet_status: 'unfunded',         // explicit signal
  next_step: 'fund_wallet',          // machine-readable action
  next_step_message: 'Add funds to your wallet before your agent can answer calls.',
});
```

---

## Activation Signal in API Responses

The dashboard config endpoint (`GET /api/v1/dashboard/config`) is what the operator UI calls on first load. It currently returns no signal about whether the agent is ready to answer calls.

```javascript
// src/routes/dashboard.js:22 — current response omits readiness
res.json({
  business_name: client.business_name,
  // ... config fields
  // Missing: is the agent live? What's the wallet balance?
});
```

**Fix:** Join wallet state into the config response so the UI can show a readiness banner:

```javascript
// GET /api/v1/dashboard/config — add readiness fields
const [client, wallet] = await Promise.all([
  loadClientFromDb(req.clientId),
  getWalletInfo(req.clientId),
]);

res.json({
  ...clientConfig,
  agent_ready: wallet?.balance_cents > 0 && !!client.system_prompt,
  wallet_balance_cents: wallet?.balance_cents ?? 0,
  wallet_tier: wallet?.tier ?? 'standard',
});
```

---

### WARNING: Missing Required Field Validation on Onboard

**The Problem:**

```javascript
// src/routes/onboard.js:45 — only validates two fields
if (!business_name || !business_phone) {
  return res.status(400).json({ error: 'business_name and business_phone are required' });
}
// agent_name, greeting_script, services, integration — all silently null
```

**Why This Breaks:**
1. An operator can onboard with no agent name — `promptCompiler.compile()` produces a generic, unpersonalized prompt and the operator doesn't know it.
2. No `services` array means no `appointment_types` rows — the agent can't offer to book anything.
3. No `integration` block means FSM is never set up — bookings fail at Gate 3.

**The Fix:** Return a structured `warnings` array for non-blocking missing fields:

```javascript
// src/routes/onboard.js — after commit, before 201
const warnings = [];
if (!agent_name) warnings.push({ field: 'agent_name', message: 'Agent will use a generic persona.' });
if (!greeting_script) warnings.push({ field: 'greeting_script', message: 'Agent will use a default greeting.' });
if (!services || services.length === 0) warnings.push({ field: 'services', message: 'No appointment types — booking unavailable.' });
if (!integration) warnings.push({ field: 'integration', message: 'No FSM connected — bookings will not sync.' });

res.status(201).json({ client_id: clientId, business_phone, status: 'active', warnings });
```

---

## Validation Checklist

Copy this checklist when auditing an onboarding flow for conversion blockers:

- [ ] POST /api/v1/onboard returns `warnings` for missing optional-but-critical fields
- [ ] 201 response includes `wallet_status: 'unfunded'` and `next_step: 'fund_wallet'`
- [ ] GET /api/v1/dashboard/config includes `agent_ready` boolean and `wallet_balance_cents`
- [ ] `promptCompiler.compile()` errors are surfaced to the operator (not silently swallowed)
- [ ] Zero-balance wallet shows explicit `agent_status: 'paused_no_balance'` in dashboard config
- [ ] At least one `appointment_type` row exists before the agent handles booking intents
