# Content Copy Reference

## Contents
- Where copy lives in this codebase
- The prompt compiler as copy surface
- API error messages as copy
- Anti-patterns
- Vertical-specific copy patterns

---

## Where Copy Lives

This is a backend-only project. All user-facing copy is either:
1. **API response strings** — returned to whatever frontend calls the API
2. **Agent persona text** — compiled into `clients.system_prompt` via `promptCompiler.js`
3. **Structured error messages** — returned by `errorHandler.js`

There are no HTML templates, MDX files, or CMS-driven content surfaces.

---

## The Prompt Compiler as Copy Surface

`src/services/promptCompiler.js` is the highest-leverage copy surface in the codebase. The `assemblePrompt()` function stitches together operator-provided text with structural scaffolding. The scaffolding language is hardcoded and mediocre.

```javascript
// src/services/promptCompiler.js:55 — weak scaffolding
parts.push(`You are an AI phone receptionist for a ${client.vertical} business.`);
```

This single sentence sets the agent's entire identity. "AI phone receptionist" is generic. For an HVAC company, a better framing is:

```javascript
const VERTICAL_IDENTITY = {
  hvac: 'You are a knowledgeable HVAC scheduling specialist',
  plumbing: 'You are a responsive plumbing dispatch coordinator',
  spa: 'You are a warm and welcoming spa concierge',
  electrical: 'You are a professional electrical service coordinator',
  cleaning: 'You are a friendly home cleaning scheduler',
  restaurant: 'You are an attentive restaurant reservation host',
  general: 'You are an AI phone agent',
};

parts.push(`${VERTICAL_IDENTITY[client.vertical] || VERTICAL_IDENTITY.general} for ${client.business_name}.`);
```

---

## API Error Messages as Copy

Error messages are conversion copy. A blocked operator who gets a clear, actionable error message may fix the issue and continue. One who gets `"Internal server error"` churns.

Current state — the global error handler in `src/middleware/errorHandler.js` returns opaque strings. Route-level validation returns slightly better messages:

```javascript
// src/routes/onboard.js:45 — passable
return res.status(400).json({ error: 'business_name and business_phone are required' });

// src/routes/dashboard.js:58 — passable
return res.status(400).json({ error: 'hours must be an array of 7 day entries' });
```

Improve 400 errors to include a `hint` field:

```javascript
// Better — tells the operator exactly what to fix
return res.status(400).json({
  error: 'business_name and business_phone are required',
  hint: 'Both fields must be non-empty strings. Example: { "business_name": "Apex HVAC", "business_phone": "+19545550100" }',
});
```

---

### WARNING: Generic Wallet Empty State

**The Problem:**

```javascript
// src/services/walletService.js — no message returned to caller
if (result.rows[0].balance_cents === 0) return false;
// The vapi.js route that calls checkBalance must handle this — and may not
```

**Why This Breaks:**
When `checkBalance` returns `false`, the Vapi route switches the agent to message-only mode. The caller hears a degraded agent. The operator sees nothing. There is no copy surfaced anywhere that explains the state.

**The Fix:** Return a structured signal with copy:

```javascript
// src/services/walletService.js
async function checkBalance(clientId) {
  const result = await pool.query(
    'SELECT balance_cents FROM wallets WHERE client_id = $1',
    [clientId]
  );
  if (result.rows.length === 0) return { ok: true };
  const { balance_cents } = result.rows[0];
  return {
    ok: balance_cents > 0,
    balance_cents,
    message: balance_cents === 0
      ? 'Wallet balance is $0.00. Add funds at /api/v1/payment/create-intent to restore full service.'
      : null,
  };
}
```

---

## Vertical-Specific Copy Patterns

The `clients.vertical` field drives agent persona but is used sparingly in the prompt compiler. Expand it to generate vertical-specific availability and booking copy.

```javascript
// src/services/promptCompiler.js — vertical-aware scheduling copy
const BOOKING_CONTEXT = {
  hvac: 'Appointments include service windows (AM: 8am-12pm, PM: 12pm-5pm). Confirm the customer will be home.',
  spa: 'Appointments are personal. Ask if the customer has a preferred therapist.',
  plumbing: 'For emergencies, offer same-day or next-morning slots first.',
  electrical: 'Panel work requires a 4-hour window minimum.',
};

if (BOOKING_CONTEXT[client.vertical]) {
  parts.push(`\n## Scheduling Notes\n${BOOKING_CONTEXT[client.vertical]}`);
}
```

---

## Related Skills

- See the **tightening-brand-voice** skill for editorial tone guidelines and phrase-level edits
- See the **crafting-page-messaging** skill for API response copy that drives operator action
- See the **clarifying-market-fit** skill for vertical-specific positioning language
