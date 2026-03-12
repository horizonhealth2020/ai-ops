# Vapi Patterns Reference

## Contents
- SSE Streaming Setup
- Vapi Authentication
- Client Resolution (Multi-Tenant)
- Tool Definitions
- Wallet-Gated Tool Access
- Anti-Patterns

---

## SSE Streaming Setup

Vapi expects OpenAI-compatible SSE. Set all three headers before writing any chunks.
Missing headers cause Vapi to buffer the entire response instead of streaming.

```javascript
// src/routes/vapi.js
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

for await (const chunk of stream) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
res.write('data: [DONE]\n\n');
res.end();
```

NEVER buffer the full OpenAI response and send it at once — Vapi will timeout waiting for
the first token and the call will fail silently.

---

## Vapi Authentication

Two accepted formats — support both, check both. Vapi can send either depending on
assistant configuration.

```javascript
// src/middleware/auth.js
function vapiAuth(req, res, next) {
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  const secret = req.headers['x-vapi-secret'];
  const key = bearer || secret;

  if (!key || key !== process.env.VAPI_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```

NEVER use a single header check. If only Bearer is checked, clients using X-Vapi-Secret
will fail with 401 and the AI agent will go silent mid-call.

---

## Client Resolution (Multi-Tenant)

Client identity comes from two sources. Always try `metadata.client_id` first (faster,
no DB lookup). Fall back to phone number lookup only when metadata is absent.

```javascript
// GOOD — metadata first, phone fallback
async function resolveClient(body) {
  const { metadata, message } = body;

  if (metadata?.client_id) {
    return metadata.client_id;
  }

  const toPhone = message?.call?.to;
  if (!toPhone) throw new Error('Cannot resolve client: no client_id or phone');

  const result = await pool.query(
    'SELECT client_id FROM clients WHERE phone_number = $1 AND is_active = true',
    [toPhone]
  );
  if (!result.rows.length) throw new Error(`No active client for phone ${toPhone}`);
  return result.rows[0].client_id;
}
```

NEVER query without `client_id` — every single DB/Redis operation in this codebase
must be scoped to one tenant. Unscoped queries are a data-isolation breach.

---

## Tool Definitions

Vapi tools must match the OpenAI function-calling schema exactly. Each tool corresponds
to a separate Express route. Keep tool definitions in a single constant so they can be
selectively filtered for wallet-gated access.

```javascript
// src/routes/vapi.js — define tools as a constant array
const BOOKING_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'checkAvailability',
      description: 'Check available appointment slots for a given date',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO date string YYYY-MM-DD' },
          service_type: { type: 'string', description: 'Type of service requested' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'holdSlot',
      description: 'Soft-lock an appointment slot for 5 minutes',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          time: { type: 'string', description: '24-hour HH:MM format' },
        },
        required: ['date', 'time'],
      },
    },
  },
];

const MESSAGE_ONLY_TOOLS = []; // empty when wallet is zero
```

---

## Wallet-Gated Tool Access

An empty wallet must not silently pass full tools to OpenAI — the AI will attempt bookings
that then fail at the FSM layer with confusing errors. Gate tool access at the stream setup.

```javascript
// GOOD — check balance before assembling the OpenAI request
const balanceCents = await walletService.getBalance(clientId);
const tools = balanceCents > 0 ? BOOKING_TOOLS : MESSAGE_ONLY_TOOLS;
const toolChoice = tools.length > 0 ? 'auto' : 'none';

const stream = await openai.chat.completions.create({
  model: process.env.OPENAI_MODEL || 'gpt-4o',
  messages: assembledMessages,
  stream: true,
  tools: tools.length > 0 ? tools : undefined,
  tool_choice: toolChoice,
});
```

```javascript
// BAD — always passing full tools regardless of balance
const stream = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: assembledMessages,
  stream: true,
  tools: BOOKING_TOOLS, // agent tries to book when wallet is $0 → broken UX
});
```

---

## WARNING: Compiling Prompts Inside the Request Handler

**The Problem:**

```javascript
// BAD — recompiling every call
router.post('/context/inject', vapiAuth, async (req, res, next) => {
  const prompt = await compileFullPrompt(clientId); // DB-heavy: reads all config fields
  // ...
});
```

**Why This Breaks:**
1. `compileFullPrompt` reads ~15 config fields from the DB — adds 200-400ms per call
2. Under concurrent calls for the same client, identical work runs N times in parallel
3. The pre-compiled prompt is stored in `clients.system_prompt` precisely to avoid this

**The Fix:**

```javascript
// GOOD — read pre-compiled prompt, append only runtime context
const client = await getClientConfig(clientId); // Redis-cached JSON, ~5ms
const systemPrompt = await promptBuilder.build(client, callerContext); // append only
```

Recompile happens only in `promptCompiler.compile(clientId)`, called from dashboard PUT routes.

---

## WARNING: Awaiting n8n Webhooks in the Response Path

**The Problem:**

```javascript
// BAD — blocks call/complete response until n8n acknowledges
await triggerN8nWebhook('call.complete', payload);
res.json({ balance: newBalance });
```

**Why This Breaks:**
1. n8n webhook latency is 200-2000ms depending on workflow complexity
2. Vapi has strict response timeouts on tool calls — a late response causes a retry
3. Duplicate n8n triggers fire if Vapi retries the `call/complete` request

**The Fix:**

```javascript
// GOOD — fire and forget, log errors separately
triggerN8nWebhook('call.complete', payload).catch(err =>
  logger.error('n8n webhook failed', { call_id, error: err.message })
);
res.json({ balance: newBalance }); // responds immediately
```

See the **node** skill for async fire-and-forget patterns.
