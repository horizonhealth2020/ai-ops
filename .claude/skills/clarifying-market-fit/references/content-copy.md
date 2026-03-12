# Content Copy Reference

## Contents
- Voice and Tone for Blue-Collar ICP
- Agent Persona Copy Patterns
- Dashboard Copy Patterns
- Returning Caller Recognition Copy
- Anti-Patterns

---

## Voice and Tone for Blue-Collar ICP

AI Ops copy must sound like a **reliable subcontractor**, not a SaaS startup. The ICP talks in jobs,
crews, and dispatch — not "workflows" or "pipelines."

| Say This | Not This |
|----------|----------|
| "books the job" | "creates a booking event" |
| "answers every call" | "handles inbound communications" |
| "holds the slot" | "creates a soft lock on availability" |
| "your wallet is low" | "insufficient balance detected" |
| "I remember you called last month" | "returning caller detected" |

---

## Agent Persona Copy Patterns

System prompts are compiled in `src/services/promptCompiler.js` and stored in `clients.system_prompt`.
The persona must feel like a knowledgeable receptionist for that vertical — not a generic assistant.

```javascript
// src/services/promptCompiler.js
const PERSONA_TEMPLATES = {
  hvac: `You are the scheduling coordinator for {business_name}.
You know HVAC service: AC tune-ups, furnace repairs, emergency no-heat calls.
When someone calls after hours, they're likely panicking — start with "We can get someone out to you."`,

  spa: `You are the front desk for {business_name}.
Speak warmly and unhurried. Know the services: massages, facials, body treatments.
Never rush a caller — they chose a spa because they want calm.`,

  plumbing: `You are the dispatcher for {business_name}.
Triage fast: is this an emergency (burst pipe, sewage backup) or routine (dripping faucet)?
Emergency calls get same-day framing first.`,
};
```

**DO:** Include vertical-specific service vocabulary in every persona.
**DON'T:** Use the same persona template across verticals — kills trust instantly.

---

## Dashboard Copy Patterns

Dashboard API responses (`src/routes/dashboard.js`) return data that the frontend renders. Empty
states and nudge messages are copy decisions made at the API layer.

```javascript
// src/routes/dashboard.js — wallet response with copy hook
router.get('/api/v1/dashboard/wallet', requireClerkAuth, async (req, res, next) => {
  try {
    const wallet = await walletService.getWallet(req.clientId);
    res.json({
      balance_cents: wallet.balance_cents,
      tier: wallet.tier,
      // Copy hook for frontend empty/low state
      nudge: wallet.balance_cents < 1000
        ? `Low balance — your agent will go to message-only mode below $0. Reload to stay live.`
        : null,
    });
  } catch (err) {
    next(err);
  }
});
```

---

## Returning Caller Recognition Copy

`src/services/callerMemory.js` looks up caller history by phone. When a returning caller is
detected, inject a warm greeting into the system prompt context:

```javascript
// src/services/callerMemory.js
async function getCallerContext(phone, clientId) {
  const { rows } = await pool.query(
    'SELECT first_name, last_visit_date, last_service FROM call_logs WHERE caller_phone = $1 AND client_id = $2 ORDER BY created_at DESC LIMIT 1',
    [phone, clientId]
  );
  if (!rows.length) return '';
  const { first_name, last_service } = rows[0];
  return `The caller is a returning customer named ${first_name}. Their last service was: ${last_service}. Greet them by name.`;
}
```

This is the highest-trust copy pattern in the product — use it. It converts skeptical owners
("will it sound robotic?") into believers on the first demo call.

---

## Anti-Patterns

### WARNING: Technical Language in Agent Prompts

**The Problem:**
```javascript
// BAD — exposes implementation to agent
'If slot hold TTL expires, return alternative_slots array from availability endpoint.'
```

**Why This Breaks:** The LLM may parrot technical terms back to callers ("the TTL on your slot
expired"). Callers hang up when they hear system language.

**The Fix:**
```javascript
// GOOD — human framing only
'If the time slot is no longer available, offer two alternative times and apologize for the
inconvenience.'
```

### WARNING: Identical Copy Across Verticals

**The Problem:** Copying the HVAC persona for a spa client. The tone mismatch breaks trust in
the first 10 seconds of a call — callers expect warmth from a spa, urgency from HVAC.
