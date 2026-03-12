# OpenAI Workflows Reference

## Contents
- Call-time context injection workflow
- Prompt recompilation workflow
- Adding a new prompt section
- Debugging token usage
- Checklist: new LLM feature

## Call-Time Context Injection Workflow

Every inbound Vapi call triggers this flow. The goal is sub-300ms assembly before the OpenAI round-trip begins.

```
Vapi POST /api/v1/context/inject
  → vapiAuth middleware: verify Bearer token = VAPI_API_KEY
  → resolve client_id from call.metadata or fall back to call.phoneNumber
  → getClientConfig / getClientByPhone: load client row (Redis cache → PostgreSQL)
  → checkWalletBalance: query wallets.balance_cents — zero balance triggers message-only mode
  → getLastUserMessage: extract last user turn for FAQ search query
  → Promise.all([searchFaqs, lookupCaller]): parallel pgvector search + caller history lookup
  → buildPrompt(client, { faqResults, callerContext }): assemble final system prompt string
  → wallet gate: if balance = 0, append voicemail suffix and clear tools array
  → strip system messages from Vapi payload, prepend assembled system prompt
  → res.flushHeaders() — establish SSE connection
  → openai.chat.completions.create({ stream: true, tools? })
  → pipe chunks: res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  → res.write('data: [DONE]\n\n') + res.end()
  → logger.info('Context injection completed', { client_id, faqs_found, returning_caller })
```

Code path:
1. `src/routes/vapi.js` — receives request, orchestrates entire flow
2. `src/middleware/tenantResolver.js` — `getClientConfig`, `getClientByPhone`
3. `src/services/promptBuilder.js` — `buildPrompt`
4. `src/services/faqSearch.js` — `searchFaqs`
5. `src/services/callerMemory.js` — `lookupCaller`

## Prompt Recompilation Workflow

Triggered by any dashboard PUT that changes agent config, business hours, or appointment types. The compile step is synchronous with the dashboard response — the client sees the new prompt immediately on the next call.

```javascript
// Pattern used in src/routes/dashboard.js PUT handlers
router.put('/agent', requireClerkAuth, async (req, res, next) => {
  try {
    const clientId = req.auth.clientId;

    // 1. Write the changed fields
    await pool.query(
      'UPDATE clients SET agent_name = $1, agent_voice = $2, tone_tags = $3, updated_at = NOW() WHERE id = $4',
      [req.body.agent_name, req.body.agent_voice, req.body.tone_tags, clientId]
    );

    // 2. Recompile — compile() writes back to clients.system_prompt and busts Redis cache
    await promptCompiler.compile(clientId);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

`compile()` internally calls `invalidateCache(clientId)` from `src/middleware/tenantResolver.js`, so no explicit `redis.del()` call is needed in the route handler.

Recompilation is triggered by these dashboard routes: `/dashboard/agent`, `/dashboard/hours`, `/dashboard/scheduling`.

## Adding a New Prompt Section

Copy this checklist and track progress:

- [ ] Step 1: Add the new column to the `clients` table in a numbered SQL migration in `migrations/`
- [ ] Step 2: Add the field to `assemblePrompt()` in `src/services/promptCompiler.js` using the existing section-header pattern (`parts.push('\n## Section Name')`)
- [ ] Step 3: Guard the push with a truthiness check so the section is omitted when the field is empty
- [ ] Step 4: Add a dashboard PUT route (or extend an existing one) to update the field
- [ ] Step 5: Call `promptCompiler.compile(clientId)` at the end of that route handler
- [ ] Step 6: Add a sample value to `seeds/demo_clients.sql` for each demo client
- [ ] Step 7: Smoke test: call `node -e "require('./src/services/promptCompiler').compile('<demo-client-id>').then(console.log)"` and verify the new section appears
- [ ] Step 8: Make a test call via Vapi and confirm the new section reaches the model

## Debugging Token Usage

The current streaming call in `src/routes/vapi.js` does not request usage data. To add token logging during debugging, pass `stream_options: { include_usage: true }` and capture the usage field from the final chunk:

```javascript
const createParams = {
  model: env.openaiModel,
  messages: llmMessages,
  stream: true,
  stream_options: { include_usage: true }, // add this for debugging
};
if (tools.length > 0) createParams.tools = tools;

const stream = await openai.chat.completions.create(createParams);

let usage = null;
for await (const chunk of stream) {
  if (chunk.usage) usage = chunk.usage;
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

res.write('data: [DONE]\n\n');
res.end();

if (usage) {
  logger.info('OpenAI tokens used', {
    client_id: client.id,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  });
}
```

Remove `stream_options` once debugging is complete — the usage chunk adds a small amount of overhead and the project does not currently bill per-token.

Prompt bloat typically comes from two sources in this codebase:
1. Large FAQ result sets — `searchFaqs` returns the top-N results by vector similarity; reduce N if prompts are growing too large.
2. Long `client.system_prompt` — check that `assemblePrompt()` is not emitting duplicate sections, which can happen if `tone_tags` or `phrases_use` are stored as JSON strings rather than arrays.

## Wallet-Gated LLM Access

When `wallets.balance_cents` is zero, the handler still calls OpenAI but with no tools and a message-only instruction appended to the system prompt. This keeps the Vapi session alive while preventing bookings and payments from being processed.

```javascript
// src/routes/vapi.js — actual wallet gate pattern
let walletOk = true;
try {
  walletOk = await checkWalletBalance(client.id);
} catch {} // wallet check failure is non-fatal — default to allowing the call

if (!walletOk) {
  systemPrompt += '\n\nIMPORTANT: The business voicemail system is currently active. Take a message from the caller including their name, phone number, and reason for calling. Do not book appointments or process payments.';
}

const tools = walletOk ? buildToolDefs() : [];
```

The `try/catch` with empty catch is intentional — a failed wallet query (e.g., table missing for a new client) should not block the call.

## Validate: iterate-until-pass for prompt changes

1. Edit `src/services/promptCompiler.js`
2. Run: `node -e "require('./src/services/promptCompiler').compile('<test-client-id>').then(console.log).catch(console.error)"`
3. Verify all expected section headers (`## Business Hours`, `## Services`, `## Agent Persona`, etc.) appear
4. If sections are missing, check the corresponding DB columns are populated in your test client row
5. Only deploy when the full expected prompt structure appears in compiled output

See the **express** skill for route handler patterns and the **node** skill for async error handling.
