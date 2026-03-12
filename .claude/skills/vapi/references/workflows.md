# Vapi Workflows Reference

## Contents
- Inbound Call Lifecycle
- Prompt Pipeline (Compile vs Build)
- 3-Phase Booking Flow
- Adding a New Vapi Tool
- Onboarding a New Client for Vapi

---

## Inbound Call Lifecycle

Every call follows this exact sequence. Deviating from the order causes data leaks or wrong prompts.

```
Vapi POST /api/v1/context/inject
  │
  ├─ 1. vapiAuth middleware — validate Bearer / X-Vapi-Secret
  ├─ 2. resolveClient — metadata.client_id → phone number lookup
  ├─ 3. getClientConfig — Redis cache hit (300s TTL) or PgBouncer read
  ├─ 4. walletService.getBalance — determine tool set (full vs message-only)
  ├─ 5. Promise.all([faqSearch, callerMemory]) — parallel enrichment (~50ms each)
  ├─ 6. promptBuilder.build — assemble system prompt
  ├─ 7. openai.chat.completions.create({ stream: true }) — start stream
  └─ 8. Pipe SSE chunks → res.write → res.end

Vapi POST /api/v1/call/complete  (after call ends)
  │
  ├─ 1. log call to call_logs table
  ├─ 2. Redis DEL call_holds:{call_id}
  ├─ 3. walletService.deduct(clientId, durationSeconds)
  └─ 4. triggerN8nWebhook (fire-and-forget)
```

Steps 5 and 6 must run in parallel — running them sequentially adds 50ms of unnecessary latency
to every call setup.

---

## Prompt Pipeline (Compile vs Build)

Two separate functions — never confuse them.

| | `promptCompiler.compile` | `promptBuilder.build` |
|---|---|---|
| **When** | On config edit (dashboard PUT routes) | On every inbound call |
| **Input** | All client config from DB | Pre-compiled prompt + call context |
| **Output** | Writes to `clients.system_prompt`, busts Redis cache | Returns assembled string |
| **Cost** | ~15 DB reads, ~200ms | ~2 Redis reads, ~10ms |

```javascript
// promptCompiler.js — called from dashboard routes only
async function compile(clientId) {
  const config = await pool.query(
    `SELECT business_name, industry, agent_name, agent_persona, greeting_script,
            services, business_hours, promotions, escalation_rules, after_hours_behavior
     FROM clients WHERE client_id = $1`,
    [clientId]
  );
  const prompt = assemblePrompt(config.rows[0]);
  await pool.query(
    'UPDATE clients SET system_prompt = $1 WHERE client_id = $2',
    [prompt, clientId]
  );
  await redisClient.del(`client_config:${clientId}`); // bust cache
}
```

```javascript
// promptBuilder.js — called from vapi.js on every request
async function build(client, callerPhone, lastUserMessage) {
  const [faqContext, callerContext] = await Promise.all([
    faqSearch.search(client.client_id, lastUserMessage),
    callerMemory.lookup(client.client_id, callerPhone),
  ]);

  return [
    client.system_prompt,
    `\nCurrent time: ${new Date().toLocaleString('en-US', { timeZone: client.timezone })}`,
    `Business hours status: ${getHoursStatus(client.business_hours)}`,
    faqContext ? `\nRelevant FAQ:\n${faqContext}` : '',
    callerContext ? `\nCaller history:\n${callerContext}` : '',
  ].join('\n');
}
```

---

## 3-Phase Booking Flow

This is the critical concurrent-safety sequence. Each step maps to an Express route that Vapi
calls as a tool function. See the **redis** skill for SETNX details.

```
Phase 1: checkAvailability
  POST /api/v1/availability/check
  ├─ Read cached_availability from PostgreSQL (via PgBouncer)
  ├─ SMEMBERS held_slots:{client_id} from Redis
  └─ Return slots not in held set (~150ms)

Phase 2: holdSlot
  POST /api/v1/availability/hold
  ├─ SETNX hold:{client_id}:{date}:{time} → call_id (300s TTL)
  ├─ If SETNX returns 0: slot taken — return alternatives
  ├─ SADD held_slots:{client_id} {date}:{time}
  └─ SET call_holds:{call_id} → hold key (~30ms)

Phase 3: createBooking
  POST /api/v1/booking/create
  ├─ FSM verifySlotAvailability (external API call ~300ms)
  ├─ If rejected: return fallback slots (do NOT clear Redis hold — let TTL expire)
  ├─ INSERT bookings row (PostgreSQL)
  ├─ DEL hold:{client_id}:{date}:{time}
  ├─ SREM held_slots:{client_id} {date}:{time}
  └─ triggerN8nWebhook('booking.created', ...) — fire-and-forget
```

NEVER clear the Redis hold if the FSM rejects — keep it alive until TTL so concurrent calls
don't race to a slot the FSM has already denied.

---

## Adding a New Vapi Tool

Copy this checklist when wiring a new capability for the AI agent.

```
- [ ] 1. Add function definition to BOOKING_TOOLS array in src/routes/vapi.js
- [ ] 2. Create Express route in the appropriate src/routes/*.js file
- [ ] 3. Protect route with vapiAuth middleware
- [ ] 4. Implement business logic in src/services/
- [ ] 5. Scope all DB/Redis operations by client_id
- [ ] 6. Add tool to MESSAGE_ONLY_TOOLS if it should work at $0 balance
- [ ] 7. Test with a Vapi webhook simulator (POST /api/v1/context/inject with tool_calls)
- [ ] 8. Update promptCompiler to mention the new capability in the agent instructions
- [ ] 9. Run npm run seed to verify demo clients can use the new tool
```

Example tool route skeleton:

```javascript
// src/routes/yourTool.js
'use strict';
const express = require('express');
const router = express.Router();
const { vapiAuth } = require('../middleware/auth');
const yourService = require('../services/yourService');
const logger = require('../utils/logger');

router.post('/your-action', vapiAuth, async (req, res, next) => {
  try {
    const { client_id, ...params } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });

    const result = await yourService.doAction(client_id, params);
    logger.info('Action completed', { client_id, result });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

---

## Onboarding a New Client for Vapi

Follow this sequence when a new client signs up via `POST /api/v1/onboard`.

```
- [ ] 1. INSERT into clients table (phone_number, business config fields)
- [ ] 2. INSERT into client_wallets (starting balance, tier)
- [ ] 3. Store FSM credentials → encrypt with AES-256 → INSERT client_integrations
- [ ] 4. Call promptCompiler.compile(clientId) — generate and store system_prompt
- [ ] 5. Seed cached_availability if FSM supports calendar sync
- [ ] 6. In Vapi dashboard: add Assistant with Custom LLM URL pointing to /api/v1/context/inject
- [ ] 7. Set metadata.client_id in Vapi assistant config to the new client UUID
- [ ] 8. Assign the Vapi phone number to the client's business number
- [ ] 9. Verify with test call: check call_logs row appears and wallet balance decrements
```

Validate post-onboard:

```bash
# Health check — confirm PG and Redis are reachable
curl https://YOUR_URL/health

# Confirm client resolves (replace phone with E.164 format)
curl -X POST https://YOUR_URL/api/v1/context/inject \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"client_id":"<uuid>"},"messages":[{"role":"user","content":"hi"}]}'
# Expect: SSE stream with first token within 2s
```

If the stream returns 401, the `VAPI_API_KEY` in Railway env vars does not match what Vapi is
sending. Check both the Bearer header and X-Vapi-Secret values in Vapi's assistant settings.
