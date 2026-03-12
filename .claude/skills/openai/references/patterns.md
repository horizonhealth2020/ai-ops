# OpenAI Patterns Reference

## Contents
- Client initialization
- SSE streaming
- Message assembly
- Prompt compilation
- Tool definitions
- Anti-patterns

## Client Initialization

Initialize once at module load in `src/routes/vapi.js`, never per-request. Use `env.openaiApiKey` from the validated config module — do not read `process.env` directly inside route files.

```javascript
'use strict';
const OpenAI = require('openai');
const env = require('../config/env');

const openai = new OpenAI({ apiKey: env.openaiApiKey });
```

NEVER instantiate inside a route handler — this leaks memory and loses connection pooling.

## SSE Streaming Pattern

Vapi expects OpenAI-compatible SSE format. Set `X-Accel-Buffering: no` in addition to standard SSE headers to prevent Railway/nginx from buffering the stream. Call `res.flushHeaders()` immediately so the connection is established before the OpenAI round-trip begins.

```javascript
router.post('/inject', vapiAuth, async (req, res) => {
  try {
    // ... resolve client, build prompt ...

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const createParams = {
      model: env.openaiModel,
      messages: llmMessages,
      stream: true,
    };
    if (tools.length > 0) createParams.tools = tools;

    const stream = await openai.chat.completions.create(createParams);

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    logger.error('Context injection error', { error: err.message });
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
});
```

## Message Assembly

Strip all system messages from the Vapi payload and replace with the freshly built prompt. Pass all other messages (user, assistant, tool) through unchanged. This prevents Vapi's own system messages from conflicting with the injected prompt.

```javascript
// GOOD — replace system messages, pass conversation history through
const llmMessages = [{ role: 'system', content: systemPrompt }];
for (const msg of messages) {
  if (msg.role !== 'system') {
    llmMessages.push(msg);
  }
}

// BAD — passing Vapi's system messages through alongside the injected prompt
const llmMessages = [{ role: 'system', content: systemPrompt }, ...messages];
```

## Prompt Compilation

`src/services/promptCompiler.js` reads from three tables — `clients`, `business_hours`, and `appointment_types` — assembles the prompt via `assemblePrompt()`, writes it back to `clients.system_prompt`, and calls `invalidateCache(clientId)` to bust the Redis config cache. The function returns the compiled string.

```javascript
// Trigger from dashboard PUT routes — never from the context inject handler
const { compile } = require('../services/promptCompiler');

const compiled = await compile(clientId);
// compile() already writes to DB and busts cache — no further steps needed
```

`assemblePrompt()` uses section headers (`## Business Hours`, `## Services`, `## Agent Persona`, etc.) so the LLM can distinguish between configuration blocks. Sections are skipped with `filter(Boolean)` / conditional `push()` when the field is empty — do not emit empty sections.

## Tool Definitions

Tools are built by `buildToolDefs()` in `src/routes/vapi.js` and passed via the `tools` key only when the wallet is non-zero. When the wallet is empty, `tools` is omitted entirely from the `createParams` object (not set to an empty array in the API call) because some OpenAI model versions behave differently with an explicit empty tools array versus no tools key.

```javascript
const tools = walletOk ? buildToolDefs() : [];

const createParams = { model: env.openaiModel, messages: llmMessages, stream: true };
if (tools.length > 0) createParams.tools = tools;
```

The five registered tools are: `check_availability`, `hold_slot`, `create_booking`, `transfer_call`, `create_payment`. All match the tool names listed in the compiled system prompt's `## Available Tools` section.

## Call-Time Context via promptBuilder

`buildPrompt(client, { faqResults, callerContext })` in `src/services/promptBuilder.js` appends three categories of live data to the pre-compiled base:

1. **Current date/time and business-hours status** — always appended; uses `formatCurrentDateTime` and `checkBusinessHours` from `src/utils/timeUtils.js` with `client.timezone`.
2. **Relevant FAQ entries** — appended when `faqResults.length > 0`; each entry is formatted as `Q: ...\nA: ...`.
3. **Returning caller info** — appended when `callerContext` is non-null; emits `caller_name`, `previous_calls`, `last_intent`, `last_outcome` fields selectively.

```javascript
// promptBuilder.js — actual function signature
function buildPrompt(client, { faqResults = [], callerContext = null } = {}) { ... }
```

## WARNING: Stream Error Handling

**The Problem:**
```javascript
// BAD — no fallback when headers already sent
try {
  const stream = await openai.chat.completions.create(...);
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
} catch (err) {
  res.status(500).json({ error: err.message }); // throws — headers already sent
}
```

**Why This Breaks:** Once `res.flushHeaders()` is called, `res.status(500).json()` throws a "Cannot set headers after they are sent" error, masking the original OpenAI error.

**The Fix (matches actual vapi.js pattern):**
```javascript
} catch (err) {
  logger.error('Context injection error', { error: err.message });
  if (!res.headersSent) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  if (!res.writableEnded) {
    res.end();
  }
}
```

## WARNING: Floating Point in Token/Cost Tracking

**The Problem:**
```javascript
// BAD — floating point arithmetic for billing
const costCents = durationMinutes * 0.40 * 100; // precision errors
```

**The Fix — store rates as integer cents:**
```javascript
const RATE_CENTS_PER_MIN = { standard: 40, growth: 32, scale: 27, enterprise: 23 };
const costCents = Math.round(durationMinutes * RATE_CENTS_PER_MIN[client.tier]);
```

## Model Configuration

Always read from `env.openaiModel`, never hardcode a version string:

```javascript
// GOOD — from validated env module
model: env.openaiModel,  // defaults to 'gpt-4o' via env.js

// BAD — locked to a specific dated model string
model: 'gpt-4o-2024-08-06',
```
