# Growth Engineering Reference

## Contents
- Returning Caller as a Growth Signal
- FAQ Search as Retention Signal
- Referral Loop via Call Transfer
- New Vertical Expansion Releases
- WARNING: Feature Adoption Without Follow-Through

---

## Returning Caller as a Growth Signal

`src/services/callerMemory.js` looks up caller history on every inbound call. This is a
growth feature — recognized callers feel a better experience, which drives word-of-mouth.

```javascript
// src/services/callerMemory.js — caller recognition pattern
// When a returning caller is identified, inject their history into context
async function lookupCaller(phone, clientId) {
  const result = await pool.query(
    `SELECT caller_name, last_service, call_count
     FROM call_logs
     WHERE caller_phone = $1 AND client_id = $2
     ORDER BY started_at DESC LIMIT 1`,
    [phone, clientId]
  );
  return result.rows[0] || null;
}
```

**Release story for caller memory improvements:**
```markdown
## Your Agent Now Remembers Repeat Customers

When a customer calls back, your agent greets them by name and references
their last service.

"Hi Sarah, calling about your HVAC service from last month?"

Returning customers book faster and refer more. Recognition is the difference
between a call center and a concierge.

No setup needed — active for all calls automatically.
```

**Growth metric to track:** `call_count > 1` ratio in `call_logs` (repeat caller rate).
Rising repeat caller rate after a caller-memory improvement = retention signal.

---

## FAQ Search as Retention Signal

`src/services/faqSearch.js` uses pgvector to inject FAQ answers into agent context.
Clients who configure FAQs have agents that answer service questions accurately,
reducing "I'll call you back" situations that kill booking conversion.

```javascript
// src/services/faqSearch.js — FAQ injection into prompt context
async function searchFaqs(clientId, query, limit = 3) {
  const embedding = await getEmbedding(query);
  const result = await pool.query(
    `SELECT question, answer
     FROM client_faqs
     WHERE client_id = $1
     ORDER BY embedding <-> $2
     LIMIT $3`,
    [clientId, JSON.stringify(embedding), limit]
  );
  return result.rows;
}
```

**Release story for pgvector FAQ search launch:**
```markdown
## Your Agent Now Answers Service Questions — Without You

Add your top 20 FAQs to Dashboard → Agent → FAQs.

When a caller asks "Do you work on Trane units?" or "Is there a service call fee?",
your agent answers accurately from your own FAQ library.

Fewer calls that end with "let me have someone call you back."
More calls that end with a booking.
```

See the **pgvector** skill for embedding patterns and similarity search tuning.

---

## Referral Loop via Call Transfer

`POST /api/v1/call/transfer` allows the agent to hand off to a human operator.
This is both a safety valve and a growth signal — callers who need human escalation
are the highest-intent prospects. Release copy should frame transfer as premium service,
not failure.

```javascript
// src/routes/call.js — transfer endpoint
// Returns transfer config: phone number + context message
router.post('/api/v1/call/transfer', requireVapiAuth, async (req, res, next) => {
  try {
    const config = await getTransferConfig(req.body.client_id);
    res.json(config);
  } catch (err) {
    next(err);
  }
});
```

**Release story for improved transfer flow:**
```markdown
## High-Value Calls Now Transfer Seamlessly

When a caller needs to speak with someone directly, your agent hands off
the call with a full briefing:

"I have [caller name] on the line — they're asking about a commercial HVAC
installation. Transferring now."

You pick up already knowing the job. No "what can I help you with?" from scratch.
```

---

## New Vertical Expansion Releases

When adding support for a new vertical (restaurant, cleaning) to the prompt compiler
or onboarding flow, the release story must explain the vertical-specific agent behaviors.

```javascript
// src/services/promptCompiler.js — vertical-specific prompt sections
// Each vertical has different service terminology, urgency patterns, and booking logic
const VERTICAL_PROMPTS = {
  hvac:       'Focus on equipment type, urgency, and seasonal demand...',
  plumbing:   'Triage by urgency: burst pipe = immediate, slow drain = scheduled...',
  electrical: 'Qualify job type before booking: panel, outlet, lighting, EV charger...',
  spa:        'Lead with relaxation, never rush. Upsell packages on second mention...',
  restaurant: 'Handle reservation requests, takeout inquiries, and hours questions...',
};
```

**New vertical launch checklist:**
- [ ] Step 1: Add vertical to `VERTICAL_PROMPTS` in `promptCompiler.js`
- [ ] Step 2: Add seed demo client for the new vertical in `seeds/demo_clients.sql`
- [ ] Step 3: Write vertical-specific announcement copy (see content-copy.md patterns)
- [ ] Step 4: Update onboarding flow to accept new vertical in intake form
- [ ] Step 5: Send targeted SMS to any clients in adjacent verticals (e.g., cleaning → spa list)
- [ ] Step 6: Update `/health` check to confirm new vertical renders without error

---

## WARNING: Feature Adoption Without Follow-Through

**The Problem:**

```markdown
// BAD — announce the feature, no follow-up
"ServiceTitan integration is now available!"
// ...no check at T+7 on who connected
```

**Why This Breaks:**
1. Blue-collar operators are busy — a single announcement rarely drives action
2. Integration features require setup steps (API key retrieval) that create drop-off
3. Without T+7 follow-up, you have no signal on adoption rate to report

**The Fix:**

```javascript
// GOOD — T+7 follow-up query to identify non-adopters
// Send a second touchpoint SMS to clients who haven't connected yet
const nonAdopters = await pool.query(
  `SELECT c.client_id, c.phone
   FROM clients c
   WHERE c.is_active = true
     AND NOT EXISTS (
       SELECT 1 FROM client_integrations ci
       WHERE ci.client_id = c.client_id
         AND ci.integration_type = 'servicetitan'
     )`
);

// Send follow-up SMS to nonAdopters:
// "Still haven't connected ServiceTitan? Takes 2 min: Dashboard → Integrations → ST"
```

**Follow-up SMS template (T+7 days):**
```
[Name], your agent can now sync with ServiceTitan. Connect in 2 min: Dashboard → Integrations. Reply STOP to opt out.
```

See the **orchestrating-feature-adoption** skill for full adoption tracking patterns.
