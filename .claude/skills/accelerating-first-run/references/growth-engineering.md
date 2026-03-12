# Growth Engineering Reference

## Contents
- Activation loop architecture
- Returning caller recognition as a retention hook
- FAQ seeding for faster first-call quality
- Caller memory as a growth signal
- Anti-patterns

---

## Activation Loop Architecture

The core growth loop for this platform: **Onboard → First Call → Booking → Retention**.
Each step has a corresponding backend surface.

```
Onboard         → POST /api/v1/onboard
                   ↓
Fund Wallet     → Stripe/Square top-up (external)
                   ↓
Configure Vapi  → Vapi dashboard (external)
                   ↓
First Call      → POST /api/v1/context/inject → OpenAI → SSE stream
                   ↓
Booking         → POST /api/v1/booking/create → FSM + PostgreSQL
                   ↓
Retention       → Caller saved in call_logs → recognized on next call
                   ↓
Repeat          → Returning caller gets personalized experience
```

The loop is self-reinforcing: every completed booking generates a `call_log` row.
`callerMemory.js` uses that history to personalize future calls — which improves booking
rates — which generates more call logs.

---

## Returning Caller Recognition as a Retention Hook

`src/services/callerMemory.js` looks up a caller's phone number in `call_logs` and injects
their history into the prompt context. This creates a differentiated experience vs.
any generic voicebot: the AI remembers the caller.

**Ensure callerMemory is called in the context/inject route:**

```javascript
// src/routes/vapi.js — GET /api/v1/context/inject
const { getCallerContext } = require('../services/callerMemory');
const callerContext = await getCallerContext(clientId, callerPhone);

// callerContext should be injected into promptBuilder before OpenAI call
const systemPrompt = promptBuilder.build(client.system_prompt, callerContext);
```

**Surface caller history count in dashboard calls:**

```javascript
// Aggregate for dashboard — shows operators their "loyal caller" base
const { rows } = await pool.query(
  `SELECT caller_phone, COUNT(*) AS call_count, MAX(created_at) AS last_call
   FROM call_logs
   WHERE client_id = $1
   GROUP BY caller_phone
   HAVING COUNT(*) > 1
   ORDER BY call_count DESC
   LIMIT 20`,
  [clientId]
);
```

---

## FAQ Seeding for Faster First-Call Quality

`src/services/faqSearch.js` uses pgvector to inject relevant FAQ answers into each
call's context. A client who seeds their FAQ data gets a dramatically better first-call
experience because the agent can answer specific questions about their business.

**Add a FAQ seeding endpoint to the onboard flow:**

```javascript
// POST /api/v1/onboard — accept faqs array
const { faqs } = req.body;  // [{ question, answer }]

if (Array.isArray(faqs) && faqs.length > 0) {
  for (const faq of faqs) {
    // Generate embedding via OpenAI, store in client_faqs with pgvector
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: faq.question,
    });
    await conn.query(
      `INSERT INTO client_faqs (client_id, question, answer, embedding)
       VALUES ($1, $2, $3, $4)`,
      [clientId, faq.question, faq.answer, JSON.stringify(embedding.data[0].embedding)]
    );
  }
}
```

Seed 5-10 FAQs at onboard time to immediately improve first-call quality. See the
**pgvector** skill for embedding storage and similarity search patterns.

---

## Caller Memory as a Growth Signal

Every `call_log` row is a growth data point. Aggregate to identify:

- **High-value callers** — multiple calls + bookings = potential loyalty program targets
- **Dropped callers** — called once, no booking = first-call conversion failure
- **After-hours callers** — called outside business hours = opportunity for 24/7 coverage upsell

```javascript
// Growth query: callers who dropped without booking (re-engagement targets)
const { rows } = await pool.query(
  `SELECT DISTINCT cl.caller_phone, cl.client_id, cl.created_at
   FROM call_logs cl
   WHERE cl.client_id = $1
     AND cl.outcome NOT IN ('booking_confirmed', 'payment_captured')
     AND cl.caller_phone NOT IN (
       SELECT DISTINCT caller_phone FROM call_logs
       WHERE client_id = $1 AND outcome = 'booking_confirmed'
     )
   ORDER BY cl.created_at DESC`,
  [clientId]
);
// Fire to n8n for SMS re-engagement via Twilio
```

---

### WARNING: Not Firing the First-Call Milestone

**The Problem:**

```javascript
// BAD — POST /api/v1/call/complete logs the call but doesn't detect first-call event
await pool.query(
  `INSERT INTO call_logs (client_id, ...) VALUES ($1, ...)`,
  [clientId, ...]
);
// No first-call detection — missed n8n celebration/onboarding completion trigger
```

**Why This Breaks:**
1. No signal to trigger a "Congratulations, your agent just handled its first call!" email
2. No data point to measure time-to-first-call in aggregate
3. Sales/CS team can't be notified when a new client activates

**The Fix:**

```javascript
// src/routes/call.js — POST /api/v1/call/complete
const countResult = await pool.query(
  'SELECT COUNT(*) FROM call_logs WHERE client_id = $1',
  [clientId]
);
const isFirstCall = parseInt(countResult.rows[0].count) === 0; // check BEFORE insert

await pool.query(`INSERT INTO call_logs ...`);

if (isFirstCall) {
  logger.info('First call milestone reached', { client_id: clientId });
  // Fire n8n webhook for celebration email, CS notification
}
```

---

## Related Skills

- See the **orchestrating-feature-adoption** skill for sequencing growth features
- See the **pgvector** skill for FAQ embedding and semantic search setup
- See the **mapping-user-journeys** skill for identifying drop-off points in the call flow
- See the **redis** skill for caching caller context to reduce per-call latency
