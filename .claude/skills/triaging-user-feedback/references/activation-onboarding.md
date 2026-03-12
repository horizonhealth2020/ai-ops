# Activation & Onboarding Reference

## Contents
- Onboarding entry point
- Prompt compilation gate
- FAQ seeding signal
- Common activation failures
- DO/DON'T pairs

## Onboarding Entry Point

New clients enter via `POST /api/v1/onboard`. This route must create a client record, seed integrations, and trigger `promptCompiler` — if any step fails silently, the client activates but the agent is broken.

```javascript
// src/routes/onboard.js — verify all three columns are populated after onboard
const { rows } = await pool.query(
  `SELECT client_id, system_prompt, cached_availability
   FROM clients WHERE phone_number = $1`,
  [phoneNumberE164]
);
if (!rows[0]?.system_prompt) {
  logger.error('Onboard completed but system_prompt missing', { client_id: rows[0]?.client_id });
  // → Quick win: add null guard + re-trigger promptCompiler
}
```

## Prompt Compilation Gate

`system_prompt` is pre-compiled at onboard time and on config edits. A NULL prompt means the agent will fail every call for that tenant.

```javascript
// src/services/promptCompiler.js — recompile guard
async function ensurePromptCompiled(clientId) {
  const { rows } = await pool.query(
    'SELECT system_prompt FROM clients WHERE client_id = $1',
    [clientId]
  );
  if (!rows[0]?.system_prompt) {
    await compileAndStorePrompt(clientId);
    logger.info('Prompt recompiled on-demand', { client_id: clientId });
  }
}
```

**Feedback signal:** If a new client reports "agent doesn't know my business," check `system_prompt` before assuming FAQ gap. NULL prompt is a code bug; sparse FAQ is a client education issue.

## FAQ Seeding Signal

pgvector FAQ search requires at least one row in `client_faqs` to return results. Zero FAQs is not a bug — it's an activation gap.

```javascript
// Triage query: distinguish empty FAQ from broken faqSearch
const { rows } = await pool.query(
  'SELECT COUNT(*) AS faq_count FROM client_faqs WHERE client_id = $1',
  [clientId]
);
// faq_count = 0 → activation gap, add in-dashboard FAQ prompt
// faq_count > 0 but search returns nothing → pgvector issue, backlog item
```

See the **pgvector** skill for embedding generation and similarity threshold tuning.

## Common Activation Failures

| Symptom | Root Cause | Classification |
|---------|-----------|----------------|
| Agent answers but says "I'm not sure" to everything | `system_prompt` is NULL | Quick win — add null guard in `promptBuilder.js` |
| Agent rejects all bookings | FSM credentials not stored | Single-tenant config, not a code bug |
| Agent says "wallet empty" on first call | `balance_cents` initialized to 0 | Onboard bug — backlog item |
| Dashboard shows no call logs | `client_id` mismatch on `call_logs` insert | Quick win — validate FK in `POST /api/v1/call/complete` |

## DO/DON'T Pairs

**DO** check `system_prompt IS NOT NULL` before closing an "agent is broken" ticket.

**DON'T** assume FSM credential errors are product bugs — verify `client_integrations` row exists first:

```javascript
// GOOD — verify before escalating
const { rows } = await pool.query(
  'SELECT integration_type FROM client_integrations WHERE client_id = $1 AND integration_type = $2',
  [clientId, 'fsm']
);
if (rows.length === 0) {
  // Client config issue, not a code bug — route to onboarding support
}
```

**DO** log onboard failures with `client_id` so feedback can be correlated to a specific tenant.

**DON'T** recompile `system_prompt` on every call — it's expensive. Only recompile on config edit or NULL detection.

See the **designing-onboarding-paths** skill for first-run flow improvements that reduce activation failure rate.
